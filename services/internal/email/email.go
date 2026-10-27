// Package email sends transactional email through Resend (https://resend.com).
//
// Supabase Auth sends its own mail (confirmation, password recovery) through
// Resend's SMTP relay, configured on the Supabase project — see
// docs/development/email.md. This package is for mail the services send
// themselves, over Resend's HTTP API, so no SMTP connection is held open.
//
// The API key is a server-only secret read from RESEND_API_KEY. Without it the
// sender is disabled: Send returns ErrNotConfigured and the caller decides
// whether that is fatal, so a service that only sometimes emails still boots.
package email

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const defaultEndpoint = "https://api.resend.com/emails"

// ErrNotConfigured is returned by Send when RESEND_API_KEY is not set.
var ErrNotConfigured = errors.New("email: RESEND_API_KEY is not set")

// Message is one email. From defaults to the sender's configured address.
type Message struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html,omitempty"`
	Text    string   `json:"text,omitempty"`
	ReplyTo string   `json:"reply_to,omitempty"`
	// IdempotencyKey makes a retried send deliver at most once (24h window).
	IdempotencyKey string `json:"-"`
}

// Sender sends email through the Resend API.
type Sender struct {
	apiKey   string
	from     string
	endpoint string
	client   *http.Client
}

// NewFromEnv reads RESEND_API_KEY and EMAIL_FROM (for example
// "Unbored <hello@unbored.lol>"; the domain must be verified in Resend).
func NewFromEnv() *Sender {
	return New(os.Getenv("RESEND_API_KEY"), os.Getenv("EMAIL_FROM"))
}

// New builds a sender. An empty apiKey yields a disabled sender.
func New(apiKey, from string) *Sender {
	return &Sender{
		apiKey:   strings.TrimSpace(apiKey),
		from:     strings.TrimSpace(from),
		endpoint: defaultEndpoint,
		client:   &http.Client{Timeout: 10 * time.Second},
	}
}

// Enabled reports whether an API key is configured.
func (s *Sender) Enabled() bool { return s.apiKey != "" }

// Send delivers msg and returns the Resend email id.
func (s *Sender) Send(ctx context.Context, msg Message) (string, error) {
	if !s.Enabled() {
		return "", ErrNotConfigured
	}
	if msg.From == "" {
		msg.From = s.from
	}
	if msg.From == "" || len(msg.To) == 0 || msg.Subject == "" || (msg.HTML == "" && msg.Text == "") {
		return "", errors.New("email: from, to, subject and a body are required")
	}

	body, err := json.Marshal(msg)
	if err != nil {
		return "", fmt.Errorf("email: encode: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.endpoint, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("email: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("Content-Type", "application/json")
	if msg.IdempotencyKey != "" {
		req.Header.Set("Idempotency-Key", msg.IdempotencyKey)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("email: send: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var apiErr struct {
			Name    string `json:"name"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(raw, &apiErr)
		return "", fmt.Errorf("email: resend answered %d: %s %s", resp.StatusCode, apiErr.Name, apiErr.Message)
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("email: decode response: %w", err)
	}
	return out.ID, nil
}
