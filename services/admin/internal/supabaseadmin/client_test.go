package supabaseadmin

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/r1jadi/unbored/packages/go/platform/config"
)

// newClient points a client at a stand-in for PostgREST and counts what reached
// it, so a test can prove a call was never sent.
func newClient(t *testing.T, handler http.HandlerFunc) (*Client, *int) {
	t.Helper()
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		handler(w, r)
	}))
	t.Cleanup(server.Close)

	client, err := New(&config.Config{
		Supabase: config.Supabase{ProjectURL: server.URL, PublishableKey: "sb_publishable_test"},
	})
	if err != nil {
		t.Fatalf("building client: %v", err)
	}
	return client, &requests
}

// TestCallCarriesTheCallerToken: the project key identifies the project, the
// bearer token identifies the caller, and the function name is the path. This is
// what makes the database's own checks meaningful.
func TestCallCarriesTheCallerToken(t *testing.T) {
	var (
		path   string
		apiKey string
		authz  string
	)
	client, requests := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		apiKey = r.Header.Get("apikey")
		authz = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"isStaff":true,"role":"admin","userId":"abc"}`))
	})

	identity, err := client.Identity(context.Background(), "caller-token")
	if err != nil {
		t.Fatalf("identity: %v", err)
	}
	if *requests != 1 {
		t.Fatalf("requests = %d, want 1", *requests)
	}
	if path != "/rest/v1/rpc/admin_identity" {
		t.Errorf("path = %q, want the function's own name", path)
	}
	if apiKey != "sb_publishable_test" {
		t.Errorf("apikey = %q", apiKey)
	}
	if authz != "Bearer caller-token" {
		t.Errorf("Authorization = %q, want the caller's token", authz)
	}
	if !identity.IsStaff || identity.Role != "admin" {
		t.Errorf("identity decoded as %+v", identity)
	}
}

// TestCallWithoutATokenIsRefusedLocally: a call with no caller token would be
// answered as `anon`, which is a deployment fault rather than a caller's
// mistake — so it never leaves the process.
func TestCallWithoutATokenIsRefusedLocally(t *testing.T) {
	client, requests := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("a request was sent without a caller token")
	})

	if _, err := client.Identity(context.Background(), ""); err == nil {
		t.Fatal("an empty token was accepted")
	}
	if *requests != 0 {
		t.Fatalf("requests = %d, want none", *requests)
	}
}

// TestErrorMapping: the SQLSTATE the database raised decides the classification,
// so a handler can answer 403, 404 or 400 without parsing prose.
func TestErrorMapping(t *testing.T) {
	cases := []struct {
		name    string
		status  int
		body    string
		forbid  bool
		missing bool
		bad     bool
		unauth  bool
	}{
		{
			name:   "the staff guard refused",
			status: http.StatusForbidden,
			body:   `{"code":"42501","message":"this operation requires a moderator or administrator role"}`,
			forbid: true,
		},
		{
			name:    "the row does not exist",
			status:  http.StatusNotFound,
			body:    `{"code":"P0002","message":"no such game"}`,
			missing: true,
		},
		{
			name:   "the transition is illegal",
			status: http.StatusBadRequest,
			body:   `{"code":"22023","message":"cannot move a game from published to draft"}`,
			bad:    true,
		},
		{
			name:   "the token was rejected",
			status: http.StatusUnauthorized,
			body:   `{"code":"PGRST301","message":"JWT expired"}`,
			unauth: true,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			client, _ := newClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(testCase.status)
				_, _ = w.Write([]byte(testCase.body))
			})

			_, err := client.SetGameStatus(context.Background(), "token", "actor-id", "id", "published", "")
			var dataErr *Error
			if !errors.As(err, &dataErr) {
				t.Fatalf("error = %v, want a data error", err)
			}
			if dataErr.IsForbidden() != testCase.forbid {
				t.Errorf("IsForbidden = %v, want %v", dataErr.IsForbidden(), testCase.forbid)
			}
			if dataErr.IsNotFound() != testCase.missing {
				t.Errorf("IsNotFound = %v, want %v", dataErr.IsNotFound(), testCase.missing)
			}
			if dataErr.IsBadRequest() != testCase.bad {
				t.Errorf("IsBadRequest = %v, want %v", dataErr.IsBadRequest(), testCase.bad)
			}
			if dataErr.IsUnauthorized() != testCase.unauth {
				t.Errorf("IsUnauthorized = %v, want %v", dataErr.IsUnauthorized(), testCase.unauth)
			}

			// The database's own message can describe the schema or echo the
			// caller's input, so it must never reach a log line or a response.
			if strings.Contains(err.Error(), "message") || strings.Contains(err.Error(), "published to draft") {
				t.Errorf("the error carries database text: %q", err.Error())
			}
		})
	}
}

// TestDirectoryArgsAreNamedAndNullable: the functions take named arguments, and
// an absent filter is SQL NULL rather than an empty string that matches nothing.
func TestDirectoryArgsAreNamedAndNullable(t *testing.T) {
	var body map[string]any
	client, _ := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	})

	if _, err := client.Games(context.Background(), "token", "actor-id", "", "", Page{Limit: 50}); err != nil {
		t.Fatalf("games: %v", err)
	}
	if value, present := body["p_status"]; !present || value != nil {
		t.Errorf("p_status = %v, want an explicit null", value)
	}
	if _, ok := body["p_limit"]; !ok {
		t.Errorf("p_limit missing from %v", body)
	}
	// One row more than the page: that is how the caller learns another page
	// exists without a COUNT.
	if value, _ := body["p_limit"].(float64); value != 51 {
		t.Errorf("p_limit = %v, want the page size plus one", body["p_limit"])
	}
}

func TestFeedbackUsesTheDirectoryBridge(t *testing.T) {
	var (
		path string
		body map[string]any
	)
	client, _ := newPrivilegedClient(t, func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	})

	if _, err := client.Feedback(context.Background(), "caller-token", "actor-uuid", "idea", "search", Page{Limit: 50, Offset: 20}); err != nil {
		t.Fatalf("feedback: %v", err)
	}
	if path != "/rest/v1/rpc/admin_feedback_directory_svc" {
		t.Errorf("path = %q, want the privileged feedback wrapper", path)
	}
	if body["p_actor"] != "actor-uuid" || body["p_category"] != "idea" || body["p_search"] != "search" {
		t.Errorf("body = %v, want actor and filters", body)
	}
	if body["p_limit"] != float64(51) || body["p_offset"] != float64(20) {
		t.Errorf("body = %v, want a one-row lookahead at offset 20", body)
	}
}

// TestParsePageValidates: the paging the API documents is enforced here, so a
// malformed page is a 400 rather than a database error.
func TestParsePageValidates(t *testing.T) {
	if _, err := ParsePage(map[string][]string{"limit": {"0"}}); err == nil {
		t.Error("limit=0 was accepted")
	}
	if _, err := ParsePage(map[string][]string{"limit": {"101"}}); err == nil {
		t.Error("limit=101 was accepted")
	}
	if _, err := ParsePage(map[string][]string{"offset": {"-1"}}); err == nil {
		t.Error("offset=-1 was accepted")
	}
	page, err := ParsePage(map[string][]string{"limit": {"10"}, "offset": {"20"}})
	if err != nil {
		t.Fatalf("a valid page was refused: %v", err)
	}
	if page.Limit != 10 || page.Offset != 20 {
		t.Errorf("page = %+v", page)
	}
}

// newPrivilegedClient points a client with the server-only secret at a
// stand-in for PostgREST, so a test can prove the privileged path sends the
// service credential, the `*_svc` function and the verified actor.
func newPrivilegedClient(t *testing.T, handler http.HandlerFunc) (*Client, *int) {
	t.Helper()
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		handler(w, r)
	}))
	t.Cleanup(server.Close)

	client, err := New(&config.Config{
		Supabase: config.Supabase{
			ProjectURL:     server.URL,
			PublishableKey: "sb_publishable_test",
			SecretKey:      "sb_secret_test",
		},
	})
	if err != nil {
		t.Fatalf("building privileged client: %v", err)
	}
	if !client.Privileged() {
		t.Fatal("the client did not pick up the secret")
	}
	return client, &requests
}

// TestPrivilegedCallUsesServiceCredentialAndActor: with the secret configured
// the call runs as the service role against the `*_svc` wrapper and carries
// the verified actor — the caller's own token is not used, and the secret
// travels only in the headers, never in the URL or the body.
func TestPrivilegedCallUsesServiceCredentialAndActor(t *testing.T) {
	var (
		path   string
		apiKey string
		authz  string
		rawURL string
		body   map[string]any
	)
	client, requests := newPrivilegedClient(t, func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		rawURL = r.URL.String()
		apiKey = r.Header.Get("apikey")
		authz = r.Header.Get("Authorization")
		encoded, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(encoded, &body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"totalUsers":7,"series":[],"activity":[],"topGames":[]}`))
	})

	overview, err := client.Overview(context.Background(), "caller-token", "actor-uuid")
	if err != nil {
		t.Fatalf("overview: %v", err)
	}
	if *requests != 1 {
		t.Fatalf("requests = %d, want 1", *requests)
	}
	if path != "/rest/v1/rpc/admin_overview_svc" {
		t.Errorf("path = %q, want the privileged wrapper", path)
	}
	if apiKey != "sb_secret_test" || authz != "Bearer sb_secret_test" {
		t.Errorf("apikey = %q Authorization = %q, want the service credential on both", apiKey, authz)
	}
	if body["p_actor"] != "actor-uuid" {
		t.Errorf("p_actor = %v, want the verified actor", body["p_actor"])
	}
	if strings.Contains(rawURL, "sb_secret_test") {
		t.Errorf("the secret leaked into the URL: %q", rawURL)
	}
	if overview.TotalUsers != 7 {
		t.Errorf("overview decoded as %+v", overview)
	}
}

// TestPrivilegedWriteCarriesActor: moderation writes attribute the verified
// actor on the privileged path, so the audit row names the administrator.
func TestPrivilegedWriteCarriesActor(t *testing.T) {
	var body map[string]any
	client, _ := newPrivilegedClient(t, func(w http.ResponseWriter, r *http.Request) {
		encoded, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(encoded, &body)
		if r.URL.Path != "/rest/v1/rpc/admin_set_game_status_svc" {
			t.Errorf("path = %q, want the privileged wrapper", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"gameId":"x","status":"published","action":"publish_game"}`))
	})

	if _, err := client.SetGameStatus(context.Background(), "caller-token", "actor-uuid", "game-id", "published", "Good"); err != nil {
		t.Fatalf("set-game-status: %v", err)
	}
	if body["p_actor"] != "actor-uuid" || body["p_game_id"] != "game-id" {
		t.Errorf("body = %v, want the actor beside the target", body)
	}
}

// TestPrivilegedCallWithoutActorIsRefusedLocally: attribution is mandatory —
// a privileged call without a verified actor never leaves the process, so a
// handler bug cannot produce an unattributed privileged write.
func TestPrivilegedCallWithoutActorIsRefusedLocally(t *testing.T) {
	client, requests := newPrivilegedClient(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("a request was sent without a verified actor")
	})

	if _, err := client.Overview(context.Background(), "caller-token", ""); err == nil {
		t.Fatal("an empty actor was accepted on the privileged path")
	}
	if _, err := client.Overview(context.Background(), "caller-token", "   "); err == nil {
		t.Fatal("a blank actor was accepted on the privileged path")
	}
	if *requests != 0 {
		t.Fatalf("requests = %d, want none", *requests)
	}
}

// TestWithoutSecretUsesCallerPath: without the secret the client keeps the
// historical behaviour — the caller's own token against the row-gated
// function — so existing deployments without the bridge keep working and the
// database guards keep deciding.
func TestWithoutSecretUsesCallerPath(t *testing.T) {
	var (
		path   string
		apiKey string
		authz  string
		body   map[string]any
	)
	client, _ := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		apiKey = r.Header.Get("apikey")
		authz = r.Header.Get("Authorization")
		encoded, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(encoded, &body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"totalUsers":7,"series":[],"activity":[],"topGames":[]}`))
	})
	if client.Privileged() {
		t.Fatal("a client without a secret reports itself privileged")
	}

	if _, err := client.Overview(context.Background(), "caller-token", "actor-uuid"); err != nil {
		t.Fatalf("overview: %v", err)
	}
	if path != "/rest/v1/rpc/admin_overview" {
		t.Errorf("path = %q, want the row-gated function", path)
	}
	if apiKey != "sb_publishable_test" || authz != "Bearer caller-token" {
		t.Errorf("apikey = %q Authorization = %q, want the project key and the caller token", apiKey, authz)
	}
	if _, present := body["p_actor"]; present {
		t.Errorf("p_actor = %v on the caller path: the row-gated functions take no actor", body["p_actor"])
	}
}
