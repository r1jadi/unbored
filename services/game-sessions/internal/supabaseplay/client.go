// Package supabaseplay is the play-session service's typed client for the
// database functions that own a run: `start_game_session` and the verifiers,
// `complete_stack10_run`, `complete_chain_run`, `complete_memory_flash_run` and
// `complete_one_move_run`, `complete_color_merge_run`, `complete_dont_touch_run`
// `complete_seven_second_run`, `complete_queens_run`, `complete_zip_run` and
// `complete_eight_puzzle_run`.
//
// Three properties shape it, and all three are deliberate:
//
//   - **It presents the publishable key and the caller's own token.** The writes
//     are authorised as the *player*, so `auth.uid()` inside those functions is
//     the verified caller and a request body can never name a user. No service
//     credential appears here: the ledger's integrity comes from the verifier, not
//     from this client's privileges.
//   - **It never computes a score.** It sends the run, reads back the outcome, and
//     hands on the numbers the database derived. A number this package produced
//     would be a claim, and claims are what the verifier exists to check.
//   - **A row becomes an API-shaped value here.** The service's handlers depend on
//     the types and the interface in this file, not on the HTTP call, which is what
//     lets them be tested without a network — the same split the catalogue uses.
package supabaseplay

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

// maxBodyBytes bounds what is read from the Data API. One session or one verdict
// is far smaller than this.
const maxBodyBytes = 1 << 20

// codeInvalidParameterValue is the SQLSTATE the play functions raise for input
// the service should already have rejected. It is still mapped, because a second
// layer that answered "internal error" for a caller mistake would be worse than
// useless.
const codeInvalidParameterValue = "22023"

// ── The play surface, as the service sees it ────────────────────────────────

// StartRequest asks for a run. AccessToken is the caller's own credential and may
// be empty, which is exactly what makes a run anonymous.
type StartRequest struct {
	GameSlug     string
	RulesVersion string
	Client       string
	AccessToken  string
}

// Start is an issued run: the session, and the seed the client plays from.
type Start struct {
	Outcome      string
	ID           string
	GameSlug     string
	RulesVersion string
	// Seed is carried as text because it is a 63-bit database value, and JSON
	// numbers do not survive JavaScript's float parsing intact. A client that
	// rounded it would play a different deck than the verifier replays.
	Seed      string
	TileCount int
	StartedAt time.Time
	ExpiresAt time.Time
	// Ranked is the database's answer, decided by whether the caller presented a
	// token: a guest run is verified and closed, and can never hold a score.
	Ranked bool
}

// CompleteRequest submits a finished run for verification. Score is the client's
// claim; the verifier compares it with its own replay and never trusts it.
type CompleteRequest struct {
	SessionID    string
	RulesVersion string
	Actions      []int32
	Score        int64
	DurationMS   int
	AccessToken  string
}

// Result is the verifier's verdict: the outcome, and — when a run was recorded —
// the numbers the database derived from the replay.
type Result struct {
	Outcome        string
	SessionID      string
	GameSlug       string
	Score          *int64
	ClearedColumns *int
	TilesPlaced    *int
	DurationMS     *int
	Ranked         *bool
	RecordedAt     *time.Time
	PersonalBest   *int64
	Rank           *int64
}

// ── Transport ───────────────────────────────────────────────────────────────

// Client calls the play functions through Supabase's Data API.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

// New builds the client. It refuses to start without the project URL and the
// publishable key, because a client that cannot authenticate its calls would only
// turn into a confusing failure per request.
func New(cfg *config.Config) (*Client, error) {
	if !cfg.HasAuthAPI() {
		return nil, errors.New("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required to play")
	}
	return &Client{
		baseURL: strings.TrimRight(cfg.Supabase.ProjectURL, "/"),
		apiKey:  cfg.Supabase.PublishableKey,
		// Bounded so a slow database never holds a request open. Replaying 60
		// moves is milliseconds of work.
		http: &http.Client{Timeout: 10 * time.Second},
	}, nil
}

// sessionStartRow is the `public.session_start` composite, as PostgREST sends it.
type sessionStartRow struct {
	Outcome      string      `json:"outcome"`
	ID           *string     `json:"id"`
	GameSlug     *string     `json:"game_slug"`
	RulesVersion *string     `json:"rules_version"`
	Seed         json.Number `json:"seed"`
	TileCount    *int        `json:"tile_count"`
	StartedAt    *time.Time  `json:"started_at"`
	ExpiresAt    *time.Time  `json:"expires_at"`
	Ranked       *bool       `json:"ranked"`
}

// StartSession asks the database to issue a run.
func (c *Client) StartSession(ctx context.Context, request StartRequest) (Start, error) {
	payload := map[string]any{
		"p_game_slug":     request.GameSlug,
		"p_rules_version": request.RulesVersion,
		"p_client":        nullable(request.Client),
	}

	var row sessionStartRow
	if err := c.rpc(ctx, "start-session", "start_game_session", payload, request.AccessToken, &row); err != nil {
		return Start{}, err
	}
	if row.Outcome != "started" {
		return Start{Outcome: row.Outcome}, nil
	}
	if row.ID == nil || row.GameSlug == nil || row.RulesVersion == nil ||
		row.StartedAt == nil || row.ExpiresAt == nil || row.TileCount == nil || row.Ranked == nil {
		return Start{}, errors.New("supabase play start-session: the database returned an incomplete session")
	}

	return Start{
		Outcome:      row.Outcome,
		ID:           *row.ID,
		GameSlug:     *row.GameSlug,
		RulesVersion: *row.RulesVersion,
		Seed:         row.Seed.String(),
		TileCount:    *row.TileCount,
		StartedAt:    row.StartedAt.UTC(),
		ExpiresAt:    row.ExpiresAt.UTC(),
		Ranked:       *row.Ranked,
	}, nil
}

// playResultRow is the `public.play_result` composite, as PostgREST sends it.
type playResultRow struct {
	Outcome        string     `json:"outcome"`
	SessionID      *string    `json:"session_id"`
	GameSlug       *string    `json:"game_slug"`
	Score          *int64     `json:"score"`
	ClearedColumns *int       `json:"cleared_columns"`
	TilesPlaced    *int       `json:"tiles_placed"`
	DurationMS     *int       `json:"duration_ms"`
	Ranked         *bool      `json:"ranked"`
	RecordedAt     *time.Time `json:"recorded_at"`
	PersonalBest   *int64     `json:"personal_best"`
	BoardRank      *int64     `json:"board_rank"`
}

// CompleteRun submits a finished run and returns the verifier's verdict.
func (c *Client) CompleteRun(ctx context.Context, request CompleteRequest) (Result, error) {
	// A copy, so the caller's slice is never handed to another goroutine's
	// encoder by surprise, and so a nil slice becomes an empty array rather than
	// JSON null — which the function rejects as a ragged submission.
	actions := make([]int32, len(request.Actions))
	copy(actions, request.Actions)

	payload := map[string]any{
		"p_session_id":  request.SessionID,
		"p_actions":     actions,
		"p_score":       request.Score,
		"p_duration_ms": request.DurationMS,
	}

	var row playResultRow
	if err := c.rpc(ctx, "complete-run", completeFunction(request.RulesVersion), payload, request.AccessToken, &row); err != nil {
		return Result{}, err
	}

	result := Result{
		Outcome:        row.Outcome,
		PersonalBest:   row.PersonalBest,
		Rank:           row.BoardRank,
		Score:          row.Score,
		ClearedColumns: row.ClearedColumns,
		TilesPlaced:    row.TilesPlaced,
		DurationMS:     row.DurationMS,
		Ranked:         row.Ranked,
	}
	if row.SessionID != nil {
		result.SessionID = *row.SessionID
	}
	if row.GameSlug != nil {
		result.GameSlug = *row.GameSlug
	}
	if row.RecordedAt != nil {
		recorded := row.RecordedAt.UTC()
		result.RecordedAt = &recorded
	}
	return result, nil
}

// completeFunction names the verifier for a pinned rules version. The version
// selects the replay: a Chain run is verified by complete_chain_run, a Memory
// Flash run by complete_memory_flash_run, a One Move run by
// complete_one_move_run, a Color Merge run by complete_color_merge_run, a Don't
// Touch the Black run by complete_dont_touch_run, a 7 Second run by
// complete_seven_second_run, a Queens run by complete_queens_run, a Zip run by
// complete_zip_run, an 8 Puzzle run by complete_eight_puzzle_run, and anything
// else by complete_stack10_run — which
// answers wrong_rules for a version it does not implement, so an unknown version
// is still a refusal, never a pass.
func completeFunction(rulesVersion string) string {
	switch {
	case strings.HasPrefix(rulesVersion, "chain@"):
		return "complete_chain_run"
	case strings.HasPrefix(rulesVersion, "memory-flash@"):
		return "complete_memory_flash_run"
	case strings.HasPrefix(rulesVersion, "one-move@"):
		return "complete_one_move_run"
	case strings.HasPrefix(rulesVersion, "color-merge@"):
		return "complete_color_merge_run"
	case strings.HasPrefix(rulesVersion, "dont-touch@"):
		return "complete_dont_touch_run"
	case strings.HasPrefix(rulesVersion, "seven-second@"):
		return "complete_seven_second_run"
	case strings.HasPrefix(rulesVersion, "queens@"):
		return "complete_queens_run"
	case strings.HasPrefix(rulesVersion, "zip@"):
		return "complete_zip_run"
	case strings.HasPrefix(rulesVersion, "eight-puzzle@"):
		return "complete_eight_puzzle_run"
	default:
		return "complete_stack10_run"
	}
}

// rpc posts to one Data API function and decodes its single-object answer.
// `accessToken` may be empty, which is how a guest run is started and completed:
// the function then runs as `anon`, `auth.uid()` is null, and the run can never
// become a ranked score.
func (c *Client) rpc(ctx context.Context, op, function string, payload any, accessToken string, dst any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return &Error{Op: op, cause: err}
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/rest/v1/rpc/"+function, bytes.NewReader(body))
	if err != nil {
		return &Error{Op: op, cause: err}
	}
	request.Header.Set("apikey", c.apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-Client-Info", "unbored-game-sessions-service")
	if accessToken != "" {
		request.Header.Set("Authorization", "Bearer "+accessToken)
	}

	response, err := c.http.Do(request)
	if err != nil {
		return &Error{Op: op, cause: err}
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		code, _ := errorCode(response.Body)
		return &Error{Op: op, Status: response.StatusCode, Code: code}
	}

	raw, err := io.ReadAll(io.LimitReader(response.Body, maxBodyBytes))
	if err != nil {
		return &Error{Op: op, Status: response.StatusCode, cause: err}
	}
	if err := json.Unmarshal(raw, dst); err != nil {
		return &Error{Op: op, Status: response.StatusCode,
			cause: errors.New("supabase returned a body that could not be decoded")}
	}
	return nil
}

// nullable keeps an absent optional field out of the request rather than sending
// an empty string the function would have to interpret.
func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}

// Error is a failed Data API call. It is safe to log: it carries the operation,
// the HTTP status PostgREST answered with (0 when the call never completed), the
// machine-readable SQLSTATE or PostgREST code, and the transport error — never the
// response body, which can echo caller-supplied text.
type Error struct {
	Op     string
	Status int
	Code   string
	cause  error
}

func (e *Error) Error() string {
	if e.Status == 0 {
		return fmt.Sprintf("supabase play %s: request failed (%v)", e.Op, e.cause)
	}
	if e.Code != "" {
		return fmt.Sprintf("supabase play %s: status %d code %s", e.Op, e.Status, e.Code)
	}
	return fmt.Sprintf("supabase play %s: status %d", e.Op, e.Status)
}

func (e *Error) Unwrap() error { return e.cause }

// IsInvalidInput reports whether the database rejected the request as malformed.
// The service validates the same shapes, so this only fires if the two definitions
// ever drift — which is worth a warning, and worth answering as a caller mistake
// rather than as an outage.
func (e *Error) IsInvalidInput() bool { return e.Code == codeInvalidParameterValue }

// errorEnvelope covers PostgREST's error shape.
type errorEnvelope struct {
	Code string `json:"code"`
}

// errorCode reads only the machine-readable code. PostgREST's `message` and
// `details` can echo the caller's own input or describe the schema, so they are
// deliberately dropped rather than carried into a log line or a response.
func errorCode(body io.Reader) (string, error) {
	raw, err := io.ReadAll(io.LimitReader(body, maxBodyBytes))
	if err != nil {
		return "", err
	}
	var envelope errorEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		// PostgREST can answer a raised exception with a plain string instead of an
		// envelope; then there is no code to read.
		return "", nil
	}
	if len(envelope.Code) > 32 {
		return "", nil
	}
	for _, r := range envelope.Code {
		if !(r >= '0' && r <= '9') && !(r >= 'A' && r <= 'Z') && !(r >= 'a' && r <= 'z') && r != '_' {
			return "", nil
		}
	}
	return envelope.Code, nil
}
