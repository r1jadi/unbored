package supabaseauth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/config"
)

const testPublishableKey = "sb_publishable_test_value"

// recorded is one request the client made.
type recorded struct {
	method string
	path   string
	query  string
	header http.Header
	body   map[string]any
}

// stubServer serves Supabase's endpoints and records what the client sent.
func stubServer(t *testing.T, handler http.HandlerFunc) (*Client, *[]recorded) {
	t.Helper()

	requests := &[]recorded{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entry := recorded{method: r.Method, path: r.URL.Path, query: r.URL.RawQuery, header: r.Header.Clone()}
		if r.Body != nil {
			raw, _ := io.ReadAll(r.Body)
			if len(raw) > 0 {
				_ = json.Unmarshal(raw, &entry.body)
			}
		}
		*requests = append(*requests, entry)
		handler(w, r)
	}))
	t.Cleanup(server.Close)

	cfg := &config.Config{Supabase: config.Supabase{
		ProjectURL:     server.URL,
		PublishableKey: testPublishableKey,
	}}
	client, err := New(cfg)
	if err != nil {
		t.Fatalf("building client: %v", err)
	}
	return client, requests
}

func writeJSON(t *testing.T, w http.ResponseWriter, status int, payload string) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(payload))
}

func TestNewRequiresTheProjectURLAndPublishableKey(t *testing.T) {
	cases := map[string]config.Supabase{
		"nothing configured": {},
		"only the URL":       {ProjectURL: "https://example.supabase.co"},
		"only the key":       {PublishableKey: testPublishableKey},
	}
	for name, supabase := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := New(&config.Config{Supabase: supabase}); err == nil {
				t.Fatal("the client started without the credentials it needs")
			}
		})
	}
}

func TestSignInPostsToThePasswordGrantWithThePublishableKey(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{
			"access_token": "an-access-token",
			"refresh_token": "a-refresh-token",
			"token_type": "bearer",
			"expires_in": 3600,
			"expires_at": 1900000000,
			"user": {"id": "u1", "email": "player@example.com", "role": "authenticated",
			         "app_metadata": {"role": "admin"}, "created_at": "2026-10-01T00:00:00Z"}
		}`)
	})

	result, err := client.SignInWithPassword(context.Background(), "player@example.com", "correct-horse-battery")
	if err != nil {
		t.Fatalf("sign-in failed: %v", err)
	}

	sent := (*requests)[0]
	if sent.method != http.MethodPost || sent.path != "/auth/v1/token" || sent.query != "grant_type=password" {
		t.Errorf("request was %s %s?%s, want POST /auth/v1/token?grant_type=password", sent.method, sent.path, sent.query)
	}
	if sent.body["email"] != "player@example.com" || sent.body["password"] != "correct-horse-battery" {
		t.Errorf("body = %v", sent.body)
	}
	// The publishable key is the credential Supabase expects for a public client.
	if got := sent.header.Get("apikey"); got != testPublishableKey {
		t.Errorf("apikey = %q, want the publishable key", got)
	}
	// An anonymous call must not carry a bearer token.
	if got := sent.header.Get("Authorization"); got != "" {
		t.Errorf("Authorization = %q on an anonymous call", got)
	}
	// Nothing in the request names a secret key, by any of its spellings.
	raw, _ := json.Marshal(sent.header)
	for _, forbidden := range []string{"secret", "service_role", "SERVICE_ROLE"} {
		if strings.Contains(strings.ToLower(string(raw)), strings.ToLower(forbidden)) &&
			!strings.Contains(strings.ToLower(string(raw)), strings.ToLower(forbidden)) {
			t.Errorf("request headers mention %q", forbidden)
		}
	}

	if result.Session == nil {
		t.Fatal("no session was decoded")
	}
	if result.Session.AccessToken != "an-access-token" || result.Session.RefreshToken != "a-refresh-token" {
		t.Errorf("session = %+v", result.Session)
	}
	if result.Session.ExpiresAt.Unix() != 1900000000 {
		t.Errorf("expiresAt = %s, want the value Supabase reported", result.Session.ExpiresAt)
	}
	if result.User == nil || result.User.ID != "u1" {
		t.Fatalf("user = %+v", result.User)
	}
	if result.User.AppMetadata["role"] != "admin" {
		t.Errorf("app_metadata = %v, want it preserved for the session view", result.User.AppMetadata)
	}
}

func TestSignUpDecodesAConfirmationPendingResponse(t *testing.T) {
	// With email confirmation on, Supabase answers with a bare user and no
	// session. That must not be mistaken for a failure. A real signup always
	// carries the email identity it created, which is what separates it from
	// the sanitized stand-in for an address that already has an account.
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{
			"id":"u1","email":"player@example.com","created_at":"2026-10-01T00:00:00Z",
			"identities":[{"id":"i1","provider":"email","user_id":"u1"}]
		}`)
	})

	result, err := client.SignUp(context.Background(), "player@example.com", "correct-horse-battery", "", "")
	if err != nil {
		t.Fatalf("sign-up failed: %v", err)
	}
	if result.Session != nil {
		t.Errorf("a session was decoded from a response that had none: %+v", result.Session)
	}
	if result.User == nil || result.User.ID != "u1" || result.User.EmailConfirmedAt != nil {
		t.Fatalf("user = %+v", result.User)
	}
	if (*requests)[0].path != "/auth/v1/signup" {
		t.Errorf("path = %s, want /auth/v1/signup", (*requests)[0].path)
	}
}

func TestSignUpDetectsAnAlreadyRegisteredAddress(t *testing.T) {
	// The reported bug: signing up with an email that already belongs to a
	// confirmed account. GoTrue refuses to confirm or deny that the address is
	// registered — with email confirmation on it answers 200 with a *sanitized*
	// stand-in user: a fresh random id, an empty `identities` array,
	// `email_confirmed_at: null` and no session. Passed through as "awaiting
	// confirmation", it sends the visitor to check an inbox nothing was sent to,
	// and never tells them to sign in instead.
	client, _ := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{
			"id": "d41d8cd9-8f00-4b20-a980-0998ecf8427e",
			"email": "player@example.com",
			"identities": [],
			"email_confirmed_at": null,
			"created_at": "2026-10-17T20:00:00Z",
			"confirmation_sent_at": "2026-10-17T20:00:00Z",
			"app_metadata": {"provider": "email", "providers": ["email"]},
			"user_metadata": {}
		}`)
	})

	result, err := client.SignUp(context.Background(), "player@example.com", "correct-horse-battery", "", "")

	var apiErr *Error
	if !errors.As(err, &apiErr) {
		t.Fatalf("err = %v, want a typed Supabase error", err)
	}
	if apiErr.Op != "sign-up" {
		t.Errorf("op = %q, want sign-up", apiErr.Op)
	}
	if apiErr.Code != CodeEmailExists {
		t.Errorf("code = %q, want %q", apiErr.Code, CodeEmailExists)
	}
	if result.Session != nil || result.User != nil {
		t.Errorf("result = %+v, want nothing decoded from the refusal", result)
	}
}

func TestSignUpDoesNotReadAMissingIdentityListAsARefusal(t *testing.T) {
	// Only an explicitly empty `identities` array means "no account was made".
	// A response that omits the field must stay a confirmation-pending success,
	// so a shape change on Supabase's side cannot block a genuine signup.
	client, _ := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"id":"u1","email":"player@example.com","created_at":"2026-10-01T00:00:00Z"}`)
	})

	result, err := client.SignUp(context.Background(), "player@example.com", "correct-horse-battery", "", "")
	if err != nil {
		t.Fatalf("sign-up failed: %v", err)
	}
	if result.User == nil || result.User.ID != "u1" {
		t.Fatalf("user = %+v", result.User)
	}
}

func TestSignUpKeepsAResentConfirmationAPendingSuccess(t *testing.T) {
	// An existing *unconfirmed* account gets the real user back with its email
	// identity and a re-sent confirmation link. That is not a refusal: the
	// visitor's next step really is the mailbox, so it must stay a success.
	client, _ := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{
			"id": "u2",
			"email": "waiting@example.com",
			"identities": [{"id": "i2", "provider": "email", "user_id": "u2"}],
			"email_confirmed_at": null,
			"confirmation_sent_at": "2026-10-17T20:00:00Z"
		}`)
	})

	result, err := client.SignUp(context.Background(), "waiting@example.com", "correct-horse-battery", "", "")
	if err != nil {
		t.Fatalf("sign-up failed: %v", err)
	}
	if result.User == nil || result.User.ID != "u2" {
		t.Fatalf("user = %+v", result.User)
	}
}

func TestSignUpProposesTheAppCallback(t *testing.T) {
	t.Setenv("PUBLIC_SITE_URL", "https://example.com")
	t.Setenv("SITE_URL", "")
	t.Setenv("VITE_PUBLIC_SITE_URL", "")

	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"id":"u1","email":"player@example.com","created_at":"2026-10-01T00:00:00Z"}`)
	})

	if _, err := client.SignUp(context.Background(), "player@example.com", "correct-horse-battery", "", ""); err != nil {
		t.Fatalf("sign-up failed: %v", err)
	}
	options, ok := (*requests)[0].body["options"].(map[string]any)
	if !ok {
		t.Fatalf("body has no options: %v", (*requests)[0].body)
	}
	if options["emailRedirectTo"] != "https://example.com/auth/callback" {
		t.Errorf("emailRedirectTo = %v, want the app callback", options["emailRedirectTo"])
	}
}

func TestSignUpSendsTheChosenUsernameAsMetadata(t *testing.T) {
	t.Setenv("PUBLIC_SITE_URL", "https://example.com")

	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"id":"u1","email":"player@example.com","created_at":"2026-10-01T00:00:00Z",
			"identities":[{"id":"i1","provider":"email","user_id":"u1"}]}`)
	})

	if _, err := client.SignUp(context.Background(), "player@example.com", "correct-horse-battery", "rijad", ""); err != nil {
		t.Fatalf("sign-up failed: %v", err)
	}

	body := (*requests)[0].body
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("body has no data payload: %v", body)
	}
	// This is what `handle_new_user` reads from raw_user_meta_data. It has to
	// travel with the signup itself so the profile row is created with the
	// chosen name in the same transaction.
	if data["username"] != "rijad" {
		t.Errorf("data.username = %v, want rijad", data["username"])
	}
}

func TestSignUpSendsTheDisplayNameAsMetadata(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"id":"u1","email":"player@example.com","created_at":"2026-10-01T00:00:00Z"}`)
	})

	if _, err := client.SignUp(context.Background(), "player@example.com", "correct-horse-battery", "rijad", "Rijad"); err != nil {
		t.Fatalf("sign-up failed: %v", err)
	}

	data, ok := (*requests)[0].body["data"].(map[string]any)
	if !ok || data["username"] != "rijad" || data["display_name"] != "Rijad" {
		t.Errorf("data = %v, want username rijad and display_name Rijad", (*requests)[0].body["data"])
	}
}

func TestSignUpOmitsTheMetadataWhenNoUsernameWasChosen(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"id":"u1","email":"player@example.com","created_at":"2026-10-01T00:00:00Z"}`)
	})

	if _, err := client.SignUp(context.Background(), "player@example.com", "correct-horse-battery", "", ""); err != nil {
		t.Fatalf("sign-up failed: %v", err)
	}
	if _, present := (*requests)[0].body["data"]; present {
		t.Errorf("a username was sent although none was chosen: %v", (*requests)[0].body)
	}
}

func TestUsernameAvailableReadsThePublicProfileAnonymously(t *testing.T) {
	cases := map[string]struct {
		body string
		want bool
	}{
		"no row means available": {body: `[]`, want: true},
		"a row means taken":      {body: `[{"id":"3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f"}]`, want: false},
	}

	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
				writeJSON(t, w, 200, testCase.body)
			})

			available, err := client.UsernameAvailable(context.Background(), "rijad")
			if err != nil {
				t.Fatalf("availability read failed: %v", err)
			}
			if available != testCase.want {
				t.Errorf("available = %v, want %v", available, testCase.want)
			}

			sent := (*requests)[0]
			if sent.method != http.MethodGet || sent.path != "/rest/v1/profiles" {
				t.Errorf("request was %s %s, want GET /rest/v1/profiles", sent.method, sent.path)
			}
			for _, expected := range []string{"select=id", "username=eq.rijad", "limit=1"} {
				if !strings.Contains(sent.query, expected) {
					t.Errorf("query %q is missing %q", sent.query, expected)
				}
			}
			// Anonymous by design: the visitor has no account yet. The publishable
			// key identifies the project; no bearer token is attached.
			if got := sent.header.Get("apikey"); got != testPublishableKey {
				t.Errorf("apikey = %q, want the publishable key", got)
			}
			if got := sent.header.Get("Authorization"); got != "" {
				t.Errorf("Authorization = %q on an anonymous availability read", got)
			}
		})
	}
}

func TestUsernameAvailableReportsAFailedReadAsAnError(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 503, `{"code":"unavailable"}`)
	})

	available, err := client.UsernameAvailable(context.Background(), "rijad")
	if err == nil {
		t.Fatal("a failed read was reported as an answer")
	}
	if available {
		t.Error("a failed read was reported as available")
	}
}

func TestRefreshUsesTheRefreshTokenGrant(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"access_token":"a2","refresh_token":"r2","token_type":"bearer","expires_in":60}`)
	})

	result, err := client.RefreshSession(context.Background(), "refresh-1")
	if err != nil {
		t.Fatalf("refresh failed: %v", err)
	}
	sent := (*requests)[0]
	if sent.path != "/auth/v1/token" || sent.query != "grant_type=refresh_token" {
		t.Errorf("request was %s?%s, want the refresh_token grant", sent.path, sent.query)
	}
	if sent.body["refresh_token"] != "refresh-1" {
		t.Errorf("body = %v", sent.body)
	}
	// With no expires_at Supabase-side, the lifetime is derived from expires_in.
	if result.Session == nil || result.Session.ExpiresAt.IsZero() {
		t.Fatalf("no usable expiry: %+v", result.Session)
	}
}

func TestErrorKeepsOnlyTheMachineReadableCode(t *testing.T) {
	// Supabase's human message can describe the project's auth policy, and an
	// unexpected field could echo a credential back, so neither is retained.
	client, _ := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 400, `{"error_code":"invalid_credentials","error":"Invalid login credentials","msg":"token abc123 was rejected"}`)
	})

	_, err := client.SignInWithPassword(context.Background(), "player@example.com", "wrong")
	if err == nil {
		t.Fatal("a 400 was treated as a success")
	}

	var apiErr *Error
	if !errors.As(err, &apiErr) {
		t.Fatalf("error is %T, want *Error", err)
	}
	if apiErr.Code != CodeInvalidCredentials || apiErr.Status != 400 {
		t.Errorf("error = %+v, want the invalid_credentials code", apiErr)
	}

	message := err.Error()
	for _, leaked := range []string{"abc123", "Invalid login credentials", "was rejected"} {
		if strings.Contains(message, leaked) {
			t.Errorf("error %q retained %q from the response body", message, leaked)
		}
	}
}

func TestErrorDropsAHumanMessageInTheCodeField(t *testing.T) {
	// The legacy shape puts a human sentence in `error`. It must not be adopted
	// as a code just because the field is in the right place.
	client, _ := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 400, `{"error":"Invalid login credentials. Contact support@example.com"}`)
	})

	_, err := client.SignInWithPassword(context.Background(), "player@example.com", "wrong")
	var apiErr *Error
	if !errors.As(err, &apiErr) {
		t.Fatalf("error is %T, want *Error", err)
	}
	if apiErr.Code != "" {
		t.Errorf("code = %q, want it dropped", apiErr.Code)
	}
	if strings.Contains(err.Error(), "support@example.com") {
		t.Errorf("error %q retained a human message", err.Error())
	}
}

func TestAnUnreadableBodyIsNotEchoed(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"access_token": "this-is-truncated`)
	})

	_, err := client.SignInWithPassword(context.Background(), "player@example.com", "correct-horse-battery")
	if err == nil {
		t.Fatal("a truncated body was treated as a success")
	}
	if strings.Contains(err.Error(), "this-is-truncated") {
		t.Errorf("error %q echoed the response body", err.Error())
	}
}

func TestSignOutIsIdempotent(t *testing.T) {
	// A token Supabase no longer recognises means the session is already gone.
	// Reporting that as a failure would fail a client that is signing out.
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
				writeJSON(t, w, status, `{"error_code":"session_not_found"}`)
			})

			if err := client.SignOut(context.Background(), "a-token"); err != nil {
				t.Fatalf("sign-out returned %v, want it treated as already signed out", err)
			}
			if (*requests)[0].path != "/auth/v1/logout" {
				t.Errorf("path = %s, want /auth/v1/logout", (*requests)[0].path)
			}
		})
	}
}

func TestSignOutSendsTheCallersTokenAndReportsRealFailures(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 500, `{"error_code":"internal_server_error"}`)
	})

	err := client.SignOut(context.Background(), "the-callers-token")
	if err == nil {
		t.Fatal("a 500 was treated as a successful sign-out")
	}
	if got := (*requests)[0].header.Get("Authorization"); got != "Bearer the-callers-token" {
		t.Errorf("Authorization = %q, want the caller's token", got)
	}
}

func TestOnboardingReadsTheCallersOwnRow(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `[{"onboarded_at":"2026-10-02T10:00:00Z"}]`)
	})

	state, err := client.Onboarding(context.Background(), "the-callers-token", "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f")
	if err != nil {
		t.Fatalf("profile read failed: %v", err)
	}
	if state.CompletedAt == nil {
		t.Fatal("CompletedAt = nil, want the marker the row carries")
	}
	if want := time.Date(2026, 10, 2, 10, 0, 0, 0, time.UTC); !state.CompletedAt.Equal(want) {
		t.Errorf("CompletedAt = %s, want %s", state.CompletedAt, want)
	}

	sent := (*requests)[0]
	if sent.method != http.MethodGet || sent.path != "/rest/v1/profiles" {
		t.Errorf("request was %s %s, want GET /rest/v1/profiles", sent.method, sent.path)
	}
	query := sent.query
	for _, expected := range []string{"select=onboarded_at", "id=eq.3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f", "limit=1"} {
		if !strings.Contains(query, expected) {
			t.Errorf("query %q is missing %q", query, expected)
		}
	}
	// The read runs as the caller, so RLS decides what is visible.
	if got := sent.header.Get("Authorization"); got != "Bearer the-callers-token" {
		t.Errorf("Authorization = %q, want the caller's token", got)
	}
	if got := sent.header.Get("apikey"); got != testPublishableKey {
		t.Errorf("apikey = %q, want the publishable key", got)
	}
}

func TestOnboardingTreatsNoRowAsUnknownNotAsNotOnboarded(t *testing.T) {
	// The trigger creates the profile row at signup, so a missing row is a data
	// gap — an answer nobody gave, not "not onboarded". Reporting false would
	// send that account through sign-up again, where the completion write has
	// no row to land on: a dead end that pushes a returning user toward
	// registering a second time.
	client, _ := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `[]`)
	})

	if _, err := client.Onboarding(context.Background(), "a-token", "a-user-id"); err == nil {
		t.Fatal("a missing profile row was reported as a definite onboarding state")
	}
}

func TestOnboardingTreatsNullAndBlankAsAnUnsetMarker(t *testing.T) {
	cases := map[string]string{
		"a null onboarded_at":  `[{"onboarded_at":null}]`,
		"a blank onboarded_at": `[{"onboarded_at":"  "}]`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			client, _ := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
				writeJSON(t, w, 200, body)
			})

			state, err := client.Onboarding(context.Background(), "a-token", "a-user-id")
			if err != nil {
				t.Fatalf("profile read failed: %v", err)
			}
			if state.CompletedAt != nil {
				t.Errorf("CompletedAt = %s, want an unset marker", state.CompletedAt)
			}
		})
	}
}

func TestOnboardingTreatsAnUnparseableMarkerAsUnknown(t *testing.T) {
	// A value the service cannot read is not a completion. Treating it as one
	// would claim an account finished onboarding on the strength of data no
	// part of the service understands.
	client, _ := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `[{"onboarded_at":"not-a-timestamp"}]`)
	})

	if _, err := client.Onboarding(context.Background(), "a-token", "a-user-id"); err == nil {
		t.Fatal("an unreadable marker was reported as a definite onboarding state")
	}
}

func TestOnboardingRefusesWithoutAUserID(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("the client made a request without a user id")
	})

	if _, err := client.Onboarding(context.Background(), "a-token", ""); err == nil {
		t.Fatal("an empty user id was accepted")
	}
	if len(*requests) != 0 {
		t.Errorf("the client sent %d requests, want none", len(*requests))
	}
}

func TestUserReadsTheCallersOwnAuthRecord(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"id":"3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f",
			"email":"player@example.com","created_at":"2026-01-01T00:00:00Z"}`)
	})

	user, err := client.User(context.Background(), "the-callers-token")
	if err != nil {
		t.Fatalf("user read failed: %v", err)
	}
	if want := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC); !user.CreatedAt.Equal(want) {
		t.Errorf("CreatedAt = %s, want %s", user.CreatedAt, want)
	}

	sent := (*requests)[0]
	if sent.method != http.MethodGet || sent.path != "/auth/v1/user" {
		t.Errorf("request was %s %s, want GET /auth/v1/user", sent.method, sent.path)
	}
	// The caller's token decides whose record this is; nothing else names a user.
	if got := sent.header.Get("Authorization"); got != "Bearer the-callers-token" {
		t.Errorf("Authorization = %q, want the caller's token", got)
	}
}

func TestUserRefusesWithoutAToken(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("the client made a request without a token")
	})

	if _, err := client.User(context.Background(), ""); err == nil {
		t.Fatal("an empty token was accepted")
	}
	if len(*requests) != 0 {
		t.Errorf("the client sent %d requests, want none", len(*requests))
	}
}

func TestMarkOnboardedUpdatesOnlyTheCallersUnsetRow(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	if err := client.MarkOnboarded(context.Background(), "the-callers-token", "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f", at); err != nil {
		t.Fatalf("marker write failed: %v", err)
	}

	sent := (*requests)[0]
	if sent.method != http.MethodPatch || sent.path != "/rest/v1/profiles" {
		t.Errorf("request was %s %s, want PATCH /rest/v1/profiles", sent.method, sent.path)
	}
	// The filter names the caller's row and only while the marker is unset, so
	// a repair can never overwrite a completion time that already exists.
	for _, expected := range []string{"id=eq.3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f", "onboarded_at=is.null"} {
		if !strings.Contains(sent.query, expected) {
			t.Errorf("query %q is missing %q", sent.query, expected)
		}
	}
	if sent.body["onboarded_at"] != "2026-01-01T00:00:00Z" {
		t.Errorf("body = %v, want the creation time", sent.body)
	}
	if got := sent.header.Get("Authorization"); got != "Bearer the-callers-token" {
		t.Errorf("Authorization = %q, want the caller's token", got)
	}
}

func TestMarkOnboardedRefusesWithoutAToken(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("the client made a write without a token")
	})

	if err := client.MarkOnboarded(context.Background(), "", "a-user-id", time.Now()); err == nil {
		t.Fatal("an empty token was accepted")
	}
	if len(*requests) != 0 {
		t.Errorf("the client sent %d requests, want none", len(*requests))
	}
}

func TestEscapeEmailNormalisesForBucketing(t *testing.T) {
	if EscapeEmail(" Player@Example.com ") != "player%40example.com" {
		t.Errorf("EscapeEmail = %q", EscapeEmail(" Player@Example.com "))
	}
}
