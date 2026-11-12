package supabaseauth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

// ErrUsernameLookupUnavailable means this deployment has no secret key, so a
// username cannot be turned into an email address. Email sign-in is unaffected.
var ErrUsernameLookupUnavailable = errors.New("signing in with a username needs SUPABASE_SECRET_KEY")

// EmailForUsername returns the address behind a username, or "" when no account
// holds that name, so a password can be checked against it.
//
// This is the only call in the service that uses the secret key. A username is
// public and an address is not, so the database function behind it is service-role
// only, and the result must go no further than the password grant: it is never
// logged, and never sent to the caller.
func (c *Client) EmailForUsername(ctx context.Context, username string) (string, error) {
	if c.secret == "" {
		return "", ErrUsernameLookupUnavailable
	}

	response, err := c.send(ctx, "username-lookup", http.MethodPost, "/rest/v1/rpc/login_email_for_username",
		map[string]string{"p_username": username}, c.secret, c.secret)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()

	// A scalar function answers with a bare JSON string, or null for no match.
	var email *string
	if err := decodeJSON(response.Body, &email); err != nil {
		return "", &Error{Op: "username-lookup", Status: response.StatusCode, cause: err}
	}
	if email == nil {
		return "", nil
	}
	return *email, nil
}

// UsernameAvailable reports whether a username is still unclaimed.
//
// The read goes to the Data API with the publishable key and no bearer token:
// `anon` has a column-level SELECT grant on `profiles` and the
// `profiles_select_public` policy allows the row, so availability can be
// answered before any account exists. Only `id` is selected and nothing but the
// boolean leaves this package — the caller's endpoint never exposes another
// person's profile.
//
// `username` is already normalized (trimmed and lowercased) by the auth service.
// The column is `citext`, so the equality filter is case-insensitive even if a
// caller reaches this with another spelling.
func (c *Client) UsernameAvailable(ctx context.Context, username string) (bool, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return false, errors.New("an availability lookup needs a username")
	}

	query := url.Values{}
	query.Set("select", "id")
	query.Set("username", "eq."+username)
	query.Set("limit", "1")

	response, err := c.do(ctx, "username-available", http.MethodGet, "/rest/v1/profiles?"+query.Encode(), nil, "")
	if err != nil {
		return false, err
	}
	defer response.Body.Close()

	// A row means the name is taken. Only the id is decoded, and it is discarded
	// rather than returned: the answer is a boolean, not a directory entry.
	var rows []struct {
		ID string `json:"id"`
	}
	if err := decodeJSON(response.Body, &rows); err != nil {
		return false, &Error{Op: "username-available", Status: response.StatusCode, cause: err}
	}
	if len(rows) > 0 {
		return false, nil
	}
	// A free name the community rules refuse is not offered either: the
	// database's word filter (public.text_is_objectionable) is the one list.
	refused, err := c.usernameRefused(ctx, username)
	if err != nil {
		return false, err
	}
	return !refused, nil
}

// usernameRefused asks the database's word filter about a username. Before the
// migration that adds the filter is applied the function is missing (404), and
// the name is judged on availability alone rather than failing every sign-up.
func (c *Client) usernameRefused(ctx context.Context, username string) (bool, error) {
	response, err := c.do(ctx, "username-filter", http.MethodPost, "/rest/v1/rpc/text_is_objectionable",
		map[string]string{"p_text": username}, "")
	if err != nil {
		var dataErr *Error
		if errors.As(err, &dataErr) && dataErr.Status == http.StatusNotFound {
			return false, nil
		}
		return false, err
	}
	defer response.Body.Close()
	var refused bool
	if err := decodeJSON(response.Body, &refused); err != nil {
		return false, &Error{Op: "username-filter", Status: response.StatusCode, cause: err}
	}
	return refused, nil
}
