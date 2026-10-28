// Package supabaseauth is the auth service's typed client for the two Supabase
// APIs it uses: Auth (GoTrue) for credentials and the Data API (PostgREST) for
// the caller's own profile row. See profile.go for the Data API read.
//
// It talks to both with the project's *publishable* key and never with the
// secret key: registration, sign-in, refresh, lookup and sign-out all run as the
// caller, so nothing here can bypass Row Level Security. It never stores a
// credential, and a failure it returns carries only an operation, an HTTP status
// and Supabase's machine-readable code — never the response body, the password or
// a token — so the caller can log it safely.
package supabaseauth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/config"
)

// Error codes Supabase returns that the service maps onto its own responses.
const (
	CodeInvalidCredentials  = "invalid_credentials"
	CodeEmailNotConfirmed   = "email_not_confirmed"
	CodeEmailExists         = "email_exists"
	CodeUserAlreadyExists   = "user_already_exists"
	CodeWeakPassword        = "weak_password"
	CodeValidationFailed    = "validation_failed"
	CodeOverRequestRate     = "over_request_rate_limit"
	CodeOverEmailRate       = "over_email_send_rate_limit"
	CodeInvalidGrant        = "invalid_grant"
	CodeRefreshTokenMissing = "refresh_token_not_found"
)

// maxBodyBytes bounds what is read from Supabase. Auth responses are small; a
// larger body is a misrouted request, not a payload worth buffering.
const maxBodyBytes = 1 << 20

// User is the Supabase Auth user record, trimmed to what the API exposes. It
// deliberately has no password, token or identity-provider field.
type User struct {
	ID               string         `json:"id"`
	Email            string         `json:"email"`
	EmailConfirmedAt *time.Time     `json:"email_confirmed_at"`
	CreatedAt        time.Time      `json:"created_at"`
	Role             string         `json:"role"`
	AppMetadata      map[string]any `json:"app_metadata"`
}

// Session is a Supabase session: a token pair and its lifetime.
type Session struct {
	AccessToken  string
	RefreshToken string
	TokenType    string
	ExpiresIn    int
	ExpiresAt    time.Time
}

// Result is one Supabase Auth response. Session is nil when the project requires
// email confirmation before a session exists; User is set whenever Supabase
// returned a user record.
type Result struct {
	Session *Session
	User    *User
}

// Error is a failed Supabase Auth call. It is safe to log: it holds the
// operation, the status Supabase answered with (0 when the call never
// completed), Supabase's machine-readable code and the transport error.
type Error struct {
	Op     string
	Status int
	Code   string
	cause  error
}

func (e *Error) Error() string {
	if e.Status == 0 {
		return fmt.Sprintf("supabase auth %s: request failed (%v)", e.Op, e.cause)
	}
	if e.Code != "" {
		return fmt.Sprintf("supabase auth %s: status %d code %s", e.Op, e.Status, e.Code)
	}
	return fmt.Sprintf("supabase auth %s: status %d", e.Op, e.Status)
}

// Unwrap exposes the transport error so callers can test for timeouts.
func (e *Error) Unwrap() error { return e.cause }

// Client calls the project's Supabase Auth API.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

// New builds the client. It refuses to start without the project URL and the
// publishable key, because a client that cannot authenticate its calls would
// only turn into confusing failures per request.
func New(cfg *config.Config) (*Client, error) {
	if !cfg.HasAuthAPI() {
		return nil, errors.New("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required to call Supabase Auth")
	}
	return &Client{
		baseURL: strings.TrimRight(cfg.Supabase.ProjectURL, "/"),
		apiKey:  cfg.Supabase.PublishableKey,
		// Bounded so a slow Supabase never holds a request (and a Vercel
		// function) open.
		http: &http.Client{Timeout: 10 * time.Second},
	}, nil
}

// SignUp registers an email/password account. Supabase enforces the password
// policy; the service additionally rejects obviously unusable input before the
// call. When the project requires email confirmation the result carries a user
// and no session.
//
// A non-empty username travels as GoTrue's `data` payload. Supabase stores it on
// `auth.users.raw_user_meta_data`, which the `handle_new_user` trigger reads in
// the same transaction that creates the account, so the chosen name is on the
// profile before this call returns — including while email confirmation is
// pending. The trigger's unique index, not this client, decides whether two
// concurrent registrations may share a name. A non-empty displayName travels
// the same way (`data.display_name`); the trigger stores it and marks the
// registration finished, because the form collected everything before calling.
// The optional marketing flag is sent as `data.marketing` only when it is true;
// the trigger turns that into the email-digest preference and an absent key
// means no consent.
//
// The confirmation link Supabase emails must land on the app's own callback
// (`/auth/callback`), not on Supabase's default site URL: the callback
// verifies the link, exchanges it for tokens, and establishes the app session
// without ever treating a URL parameter as proof. The destination is resolved
// from PUBLIC_SITE_URL (preferred), SITE_URL, then VITE_PUBLIC_SITE_URL, and
// defaults to the production origin. An invalid value is ignored rather than
// sent, so a misconfigured environment cannot produce a broken link.
func (c *Client) SignUp(ctx context.Context, email, password, username, displayName string, marketing ...bool) (Result, error) {
	payload := map[string]any{"email": email, "password": password}
	data := map[string]string{}
	if username != "" {
		data["username"] = username
	}
	if displayName != "" {
		data["display_name"] = displayName
	}
	if len(marketing) > 0 && marketing[0] {
		// Explicit consent only. An absent key is the default, so an OAuth or
		// legacy client never opts an account in by accident. The sign-up trigger
		// reads this and writes the notify_new_games preference.
		data["marketing"] = "true"
	}
	if len(data) > 0 {
		payload["data"] = data
	}
	if redirect := confirmationRedirect(); redirect != "" {
		payload["options"] = map[string]string{"emailRedirectTo": redirect}
	}
	return c.sessionCall(ctx, "sign-up", http.MethodPost, "/auth/v1/signup", payload, "")
}

// SignInWithPassword exchanges credentials for a session.
func (c *Client) SignInWithPassword(ctx context.Context, email, password string) (Result, error) {
	payload := map[string]string{"email": email, "password": password}
	return c.sessionCall(ctx, "sign-in", http.MethodPost, "/auth/v1/token?grant_type=password", payload, "")
}

// RefreshSession exchanges a refresh token for a new token pair. Refresh tokens
// are rotated by Supabase, so the caller receives a new one.
func (c *Client) RefreshSession(ctx context.Context, refreshToken string) (Result, error) {
	payload := map[string]string{"refresh_token": refreshToken}
	return c.sessionCall(ctx, "refresh", http.MethodPost, "/auth/v1/token?grant_type=refresh_token", payload, "")
}

// SignOut revokes the session behind an access token. It is the only call that
// does not return a session, so it does not go through sessionCall. It is idempotent: a token
// Supabase no longer recognises (or a session that was already revoked) counts as
// signed out, so a retry cannot fail a client that is signing out.
func (c *Client) SignOut(ctx context.Context, accessToken string) error {
	response, err := c.do(ctx, "sign-out", http.MethodPost, "/auth/v1/logout", nil, accessToken)
	if err != nil {
		var apiErr *Error
		if errors.As(err, &apiErr) && (apiErr.Status == http.StatusUnauthorized || apiErr.Status == http.StatusForbidden || apiErr.Status == http.StatusNotFound) {
			return nil
		}
		return err
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maxBodyBytes))
	_ = response.Body.Close()
	return nil
}

// sessionCall performs a call whose success body is a Supabase session, a user,
// or a bare user object (a signup that still needs email confirmation).
func (c *Client) sessionCall(ctx context.Context, op, method, path string, payload any, accessToken string) (Result, error) {
	response, err := c.do(ctx, op, method, path, payload, accessToken)
	if err != nil {
		return Result{}, err
	}
	defer response.Body.Close()

	var envelope sessionEnvelope
	if err := decodeJSON(response.Body, &envelope); err != nil {
		return Result{}, &Error{Op: op, Status: response.StatusCode, cause: err}
	}
	if op == "sign-up" {
		if err := envelope.refusedRegistration(); err != nil {
			return Result{}, err
		}
	}
	return envelope.result(), nil
}

// sessionEnvelope accepts both Supabase shapes: a token response (which includes
// the user), and the bare user object returned when a signup still requires email
// confirmation.
type sessionEnvelope struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	ExpiresAt    int64  `json:"expires_at"`
	User         *User  `json:"user"`

	ID               string            `json:"id"`
	Email            string            `json:"email"`
	Role             string            `json:"role"`
	EmailConfirmedAt *time.Time        `json:"email_confirmed_at"`
	CreatedAt        time.Time         `json:"created_at"`
	Identities       []json.RawMessage `json:"identities"`
}

// refusedRegistration recognises Supabase's answer when a sign-up used an email
// that already belongs to a confirmed account.
//
// GoTrue refuses to confirm or deny that the address is registered. With email
// confirmation on it answers 200 with a *sanitized* stand-in user — a fresh
// random id, an explicitly empty `identities` array, `email_confirmed_at: null`
// and no session — instead of an error. A real signup always carries the email
// identity it created, and an existing-but-unconfirmed account gets the real
// user back with its identity and a re-sent confirmation (which stays a
// confirmation-pending success), so an empty array is the one reliable signal
// that nothing was created. Passing the stand-in through as "awaiting
// confirmation" would send the visitor to check an inbox nothing was sent to,
// and never tell them to sign in instead — so it is turned into the refusal it
// really is, which the handler maps onto 409.
func (e sessionEnvelope) refusedRegistration() *Error {
	if e.AccessToken != "" || e.ID == "" {
		return nil
	}
	if e.Identities == nil || len(e.Identities) > 0 {
		return nil
	}
	return &Error{Op: "sign-up", Status: http.StatusConflict, Code: CodeEmailExists}
}

func (e sessionEnvelope) result() Result {
	result := Result{}
	switch {
	case e.User != nil:
		result.User = e.User
	case e.ID != "":
		result.User = &User{
			ID:               e.ID,
			Email:            e.Email,
			Role:             e.Role,
			EmailConfirmedAt: e.EmailConfirmedAt,
			CreatedAt:        e.CreatedAt,
		}
	}

	if e.AccessToken == "" {
		return result
	}
	tokenType := e.TokenType
	if tokenType == "" {
		tokenType = "bearer"
	}
	session := &Session{
		AccessToken:  e.AccessToken,
		RefreshToken: e.RefreshToken,
		TokenType:    tokenType,
		ExpiresIn:    e.ExpiresIn,
	}
	if e.ExpiresAt > 0 {
		session.ExpiresAt = time.Unix(e.ExpiresAt, 0).UTC()
	} else if e.ExpiresIn > 0 {
		session.ExpiresAt = time.Now().Add(time.Duration(e.ExpiresIn) * time.Second).UTC()
	}
	result.Session = session
	return result
}

func (c *Client) do(ctx context.Context, op, method, path string, payload any, accessToken string) (*http.Response, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, &Error{Op: op, cause: err}
		}
		body = bytes.NewReader(encoded)
	}

	endpoint := c.baseURL + path
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, &Error{Op: op, cause: err}
	}
	request.Header.Set("apikey", c.apiKey)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-Client-Info", "unbored-auth-service")
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if accessToken != "" {
		request.Header.Set("Authorization", "Bearer "+accessToken)
	}

	response, err := c.http.Do(request)
	if err != nil {
		return nil, &Error{Op: op, cause: err}
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return response, nil
	}

	code, _ := errorCode(response.Body)
	_ = response.Body.Close()
	return nil, &Error{Op: op, Status: response.StatusCode, Code: code}
}

// errorEnvelope covers both Supabase error shapes: the current
// `{code, error_code, msg}` and the older `{error, error_description}`.
type errorEnvelope struct {
	ErrorCode string `json:"error_code"`
	Error     string `json:"error"`
}

// codePattern keeps only machine-readable codes. Anything else (a human message
// Supabase put in the field) is dropped rather than carried into a log line.
var codePattern = regexp.MustCompile(`^[a-z0-9_]{1,64}$`)

func errorCode(body io.Reader) (string, error) {
	raw, err := io.ReadAll(io.LimitReader(body, maxBodyBytes))
	if err != nil {
		return "", err
	}
	var envelope errorEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return "", err
	}
	for _, candidate := range []string{envelope.ErrorCode, envelope.Error} {
		if codePattern.MatchString(candidate) {
			return candidate, nil
		}
	}
	return "", nil
}

// confirmationRedirect resolves the email-confirmation landing URL. The
// Supabase dashboard must also list it under Authentication → URL
// Configuration → Redirect URLs; code can only propose the destination, the
// allowlist decides whether Supabase honours it.
func confirmationRedirect() string {
	raw := strings.TrimSpace(config.Getenv("PUBLIC_SITE_URL", "SITE_URL", "VITE_PUBLIC_SITE_URL"))
	if raw == "" {
		raw = "https://unbored.lol"
	}
	parsed, err := parseRedirectBase(raw)
	if err != nil {
		return ""
	}
	return parsed + "/auth/callback"
}

func parseRedirectBase(raw string) (string, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(raw), "/")
	if trimmed == "" {
		return "", errors.New("empty redirect base")
	}
	if !strings.Contains(trimmed, "://") {
		trimmed = "https://" + trimmed
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return "", err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", errors.New("redirect base must be http or https")
	}
	if u.Host == "" {
		return "", errors.New("redirect base has no host")
	}
	return u.Scheme + "://" + u.Host, nil
}

func decodeJSON(body io.Reader, dst any) error {
	raw, err := io.ReadAll(io.LimitReader(body, maxBodyBytes))
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, dst); err != nil {
		// The value is not echoed: it may contain a token.
		return errors.New("supabase returned a body that could not be decoded")
	}
	return nil
}
