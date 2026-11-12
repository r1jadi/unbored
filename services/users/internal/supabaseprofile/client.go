// Package supabaseprofile is the users service's typed client for the two
// PostgREST surfaces it reads and writes: `public.profiles` and
// `public.user_roles`.
//
// It talks to the Data API with the project's *publishable* key and the
// **caller's own access token**, never the secret key, so Row Level Security
// stays the authorization boundary: the database decides which rows this caller
// may read and which columns they may write. A bug in this package cannot read
// another user's private data or grant a role, because it has no credential that
// would let it.
//
// One constraint shapes every query here: the SELECT grant on `profiles`
// excludes `is_suspended` on purpose (see supabase/migrations/0002), and
// PostgREST answers a request for a column it may not read with 403 — including
// `select=*` and a bare `Prefer: return=representation`, both of which project
// every column. So every query names its columns explicitly, and a write asks
// for its projection with `?select=`. Requesting the whole row is not a style
// choice here; it is a 403.
package supabaseprofile

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/config"
)

// Postgres error codes the service maps onto its own responses. PostgREST passes
// the SQLSTATE through in `code`, which is the only stable way to tell a
// constraint failure from a permission failure.
const (
	codeInsufficientPrivilege = "42501"
	codeUniqueViolation       = "23505"
	codeCheckViolation        = "23514"
	// codeObjectionable is raised by public.refuse_objectionable_text, the
	// database's word filter for profile text.
	codeObjectionable       = "UB001"
	codeForeignKeyViolation = "23503"
	codeNotNullViolation    = "23502"
	codeRLSViolation        = "42501"
)

// maxBodyBytes bounds what is read from the Data API.
const maxBodyBytes = 1 << 20

// Columns is the projection every query uses. It is exactly the set the SELECT
// grant allows: `is_suspended` is absent by design, and `select=*` is never used.
const Columns = "id,username,display_name,bio,avatar_path,onboarded_at,created_at,updated_at"

// Profile is one `public.profiles` row as this service exposes it. The field
// names are the database's; the service maps them onto the API's camelCase view.
type Profile struct {
	ID          string     `json:"id"`
	Username    string     `json:"username"`
	DisplayName string     `json:"display_name"`
	Bio         *string    `json:"bio"`
	AvatarPath  *string    `json:"avatar_path"`
	OnboardedAt *time.Time `json:"onboarded_at"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// Patch is a set of column values to write. A nil field is left unchanged, so a
// request that names one field cannot clear another. `Username` is a plain
// string like `DisplayName`: it cannot be empty (the service validates the
// format first), so an empty value means "leave it alone".
//
// Clearing a nullable column (setting `bio` to null) cannot be expressed by a nil
// field, so the pointers are paired with explicit "set" flags.
type Patch struct {
	DisplayName string
	Username    string
	Bio         *string
	SetBio      bool
	AvatarPath  *string
	SetAvatar   bool
}

// Error is a failed Data API call. It is safe to log: it carries the operation,
// the HTTP status PostgREST answered with (0 when the call never completed),
// the machine-readable SQLSTATE or PostgREST code, and the transport error —
// never the response body, which can echo caller-supplied text.
type Error struct {
	Op     string
	Status int
	Code   string
	cause  error
}

func (e *Error) Error() string {
	if e.Status == 0 {
		return fmt.Sprintf("supabase profiles %s: request failed (%v)", e.Op, e.cause)
	}
	if e.Code != "" {
		return fmt.Sprintf("supabase profiles %s: status %d code %s", e.Op, e.Status, e.Code)
	}
	return fmt.Sprintf("supabase profiles %s: status %d", e.Op, e.Status)
}

func (e *Error) Unwrap() error { return e.cause }

// IsForbidden reports whether the database refused the operation on privilege
// grounds, which for this service means the caller tried to write a column they
// may not write.
func (e *Error) IsForbidden() bool {
	return e.Status == http.StatusForbidden || e.Code == codeInsufficientPrivilege || e.Code == codeRLSViolation
}

// IsObjectionable reports text the database's word filter refused.
func (e *Error) IsObjectionable() bool { return e.Code == codeObjectionable }

// IsUniqueViolation reports a duplicate value on a unique index.
func (e *Error) IsUniqueViolation() bool { return e.Code == codeUniqueViolation }

// IsConstraintViolation reports a value the database's own rules rejected: a
// check constraint, a not-null or a foreign key.
func (e *Error) IsConstraintViolation() bool {
	switch e.Code {
	case codeCheckViolation, codeNotNullViolation, codeForeignKeyViolation:
		return true
	}
	return false
}

// Client reads and writes the caller's own profile row.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

// New builds the client. It refuses to start without the project URL and the
// publishable key, because a client that cannot authenticate its calls would
// only turn into a confusing failure per request.
func New(cfg *config.Config) (*Client, error) {
	if !cfg.HasAuthAPI() {
		return nil, errors.New("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required to read a profile")
	}
	return &Client{
		baseURL: strings.TrimRight(cfg.Supabase.ProjectURL, "/"),
		apiKey:  cfg.Supabase.PublishableKey,
		// Bounded so a slow database never holds a request open.
		http: &http.Client{Timeout: 10 * time.Second},
	}, nil
}

// GetProfile reads one profile row. `userID` comes from a verified token
// subject, never from the request, so it cannot be used to aim the query.
//
// found is false when the account has no row. That is not an error: the row is
// created by the `handle_new_user` trigger, so a missing one means the account
// predates the trigger or the row was removed, and the caller needs a clear
// answer rather than a 500.
func (c *Client) GetProfile(ctx context.Context, accessToken, userID string) (Profile, bool, error) {
	if userID == "" {
		return Profile{}, false, errors.New("a profile lookup needs a user id")
	}

	query := url.Values{}
	query.Set("select", Columns)
	query.Set("id", "eq."+userID)
	query.Set("limit", "1")

	response, err := c.do(ctx, "read-profile", http.MethodGet, "/rest/v1/profiles?"+query.Encode(), nil, accessToken, nil)
	if err != nil {
		return Profile{}, false, err
	}
	defer response.Body.Close()

	var rows []Profile
	if err := decodeJSON(response.Body, &rows); err != nil {
		return Profile{}, false, &Error{Op: "read-profile", Status: response.StatusCode, cause: err}
	}
	if len(rows) == 0 {
		return Profile{}, false, nil
	}
	return rows[0], true, nil
}

// Update writes the caller's own profile row and returns the row as the database
// now holds it.
//
// Concurrency: when `expectedUpdatedAt` is non-zero the UPDATE is filtered on
// `updated_at = expectedUpdatedAt`, so two writers cannot silently overwrite one
// another — the second one matches no row. The `profiles_touch_updated_at`
// trigger guarantees the column changes on every write, which is what makes that
// filter meaningful. Callers that omit it accept last-write-wins, which is the
// documented default.
//
// The projection is requested explicitly (`?select=`) instead of a bare
// `Prefer: return=representation`, because returning every column would ask for
// `is_suspended` and be refused.
func (c *Client) Update(ctx context.Context, accessToken, userID string, patch Patch, expectedUpdatedAt time.Time) (Profile, bool, error) {
	if userID == "" {
		return Profile{}, false, errors.New("a profile update needs a user id")
	}

	payload := map[string]any{}
	if patch.DisplayName != "" {
		payload["display_name"] = patch.DisplayName
	}
	if patch.Username != "" {
		payload["username"] = patch.Username
	}
	if patch.SetBio {
		payload["bio"] = patch.Bio
	}
	if patch.SetAvatar {
		payload["avatar_path"] = patch.AvatarPath
	}
	if len(payload) == 0 {
		return Profile{}, false, errors.New("a profile update needs at least one column")
	}

	query := url.Values{}
	query.Set("select", Columns)
	query.Set("id", "eq."+userID)
	if !expectedUpdatedAt.IsZero() {
		query.Set("updated_at", "eq."+expectedUpdatedAt.UTC().Format(time.RFC3339Nano))
	}

	headers := map[string]string{"Prefer": "return=representation"}
	response, err := c.do(ctx, "update-profile", http.MethodPatch, "/rest/v1/profiles?"+query.Encode(), payload, accessToken, headers)
	if err != nil {
		return Profile{}, false, err
	}
	defer response.Body.Close()

	var rows []Profile
	if err := decodeJSON(response.Body, &rows); err != nil {
		return Profile{}, false, &Error{Op: "update-profile", Status: response.StatusCode, cause: err}
	}
	// An empty projection means the filter matched nothing: either the row is
	// gone, or it moved on since the caller read it. The handler tells those two
	// apart by reading the row back, because the caller's answer differs.
	if len(rows) == 0 {
		return Profile{}, false, nil
	}
	return rows[0], true, nil
}

func (c *Client) do(ctx context.Context, op, method, path string, payload any, accessToken string, extra map[string]string) (*http.Response, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, &Error{Op: op, cause: err}
		}
		body = bytes.NewReader(encoded)
	}

	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return nil, &Error{Op: op, cause: err}
	}
	request.Header.Set("apikey", c.apiKey)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-Client-Info", "unbored-users-service")
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	// The caller's own token, so RLS decides what this request may touch. A
	// read or write can never be broader than the person who asked for it.
	request.Header.Set("Authorization", "Bearer "+accessToken)
	for name, value := range extra {
		request.Header.Set(name, value)
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

// errorEnvelope covers PostgREST's error shape.
type errorEnvelope struct {
	Code    string `json:"code"`
	Message string `json:"message"`
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
		return "", err
	}
	if len(envelope.Code) > 32 {
		return "", nil
	}
	for _, r := range envelope.Code {
		if !(r >= '0' && r <= '9') && !(r >= 'a' && r <= 'z') && !(r >= 'A' && r <= 'Z') && r != '_' {
			return "", nil
		}
	}
	return envelope.Code, nil
}

func decodeJSON(body io.Reader, dst any) error {
	raw, err := io.ReadAll(io.LimitReader(body, maxBodyBytes))
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, dst); err != nil {
		return errors.New("supabase returned a body that could not be decoded")
	}
	return nil
}
