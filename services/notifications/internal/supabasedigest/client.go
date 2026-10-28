// Package supabasedigest is the notifications service's typed client for the
// game-release digest functions.
//
// Every call runs as the service role: the digest tables have RLS enabled with
// no policies, and the functions are executable by `service_role` alone. The
// secret key is read from the platform configuration, never logged and never
// sent anywhere but the project's own Data API.
package supabasedigest

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/config"
)

const maxBodyBytes = 1 << 20

// Client calls the digest RPCs.
type Client struct {
	baseURL string
	key     string
	http    *http.Client
}

// New builds a client from SUPABASE_URL and SUPABASE_SECRET_KEY. Both are
// required: falling back to the publishable key would answer 403 instead of
// sending anything, which is a configuration failure worth surfacing at boot.
func New(cfg *config.Config) (*Client, error) {
	if cfg == nil {
		return nil, errors.New("supabase is not configured")
	}
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.Supabase.ProjectURL), "/")
	key := strings.TrimSpace(cfg.Supabase.SecretKey)
	if baseURL == "" || key == "" {
		return nil, errors.New("SUPABASE_URL and SUPABASE_SECRET_KEY are required")
	}
	return &Client{
		baseURL: baseURL,
		key:     key,
		http:    &http.Client{Timeout: 15 * time.Second},
	}, nil
}

// Game is one game in a digest.
type Game struct {
	Slug         string  `json:"slug"`
	Title        string  `json:"title"`
	Instructions *string `json:"instructions"`
}

// Recipient is one opted-in account.
type Recipient struct {
	UserID      string `json:"user_id"`
	Email       string `json:"email"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
}

// Claim returns the open digest, or creates one from the next five announced
// games. found is false until five games are waiting.
func (c *Client) Claim(ctx context.Context) (digestID string, found bool, err error) {
	var id *string
	if err := c.call(ctx, "claim_game_release_digest", nil, &id); err != nil {
		return "", false, err
	}
	if id == nil || strings.TrimSpace(*id) == "" {
		return "", false, nil
	}
	return *id, true, nil
}

// Games returns the digest's still-published games in publication order.
func (c *Client) Games(ctx context.Context, digestID string) ([]Game, error) {
	var games []Game
	payload := map[string]any{"p_digest_id": digestID}
	if err := c.call(ctx, "game_release_digest_games", payload, &games); err != nil {
		return nil, err
	}
	return games, nil
}

// Recipients returns at most limit accounts that still need this digest.
func (c *Client) Recipients(ctx context.Context, digestID string, limit int) ([]Recipient, error) {
	var recipients []Recipient
	payload := map[string]any{"p_digest_id": digestID, "p_limit": limit}
	if err := c.call(ctx, "game_release_digest_recipients", payload, &recipients); err != nil {
		return nil, err
	}
	return recipients, nil
}

// Record marks one recipient delivered (failure is empty) or failed (failure is
// a short reason). Repeating the call is a no-op.
func (c *Client) Record(ctx context.Context, digestID, userID, failure string) error {
	payload := map[string]any{
		"p_digest_id": digestID,
		"p_user_id":   userID,
	}
	if failure != "" {
		payload["p_failure"] = failure
	}
	return c.call(ctx, "record_game_release_digest_delivery", payload, nil)
}

// Close marks the digest finished once no recipient is left. It answers false
// while deliveries remain.
func (c *Client) Close(ctx context.Context, digestID string) (bool, error) {
	var closed bool
	payload := map[string]any{"p_digest_id": digestID}
	if err := c.call(ctx, "close_game_release_digest", payload, &closed); err != nil {
		return false, err
	}
	return closed, nil
}

func (c *Client) call(ctx context.Context, function string, payload, out any) error {
	if payload == nil {
		payload = map[string]any{}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("digest rpc %s: encode: %w", function, err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/rest/v1/rpc/"+function, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("digest rpc %s: build request: %w", function, err)
	}
	request.Header.Set("apikey", c.key)
	request.Header.Set("Authorization", "Bearer "+c.key)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	response, err := c.http.Do(request)
	if err != nil {
		return fmt.Errorf("digest rpc %s: %w", function, err)
	}
	defer response.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(response.Body, maxBodyBytes))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var apiErr struct {
			Message string `json:"message"`
			Code    string `json:"code"`
		}
		_ = json.Unmarshal(raw, &apiErr)
		return fmt.Errorf("digest rpc %s: database answered %d (%s)", function, response.StatusCode, apiErr.Code)
	}
	if out == nil || len(bytes.TrimSpace(raw)) == 0 || response.StatusCode == http.StatusNoContent {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("digest rpc %s: decode response: %w", function, err)
	}
	return nil
}
