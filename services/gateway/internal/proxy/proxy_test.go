package proxy

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/internal/apiroutes"
)

// recorder is a stand-in upstream service.
type recorder struct {
	server     *httptest.Server
	requests   int
	lastPath   string
	lastQuery  string
	lastHeader http.Header
}

func newRecorder(t *testing.T) *recorder {
	t.Helper()
	rec := &recorder{}
	rec.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.requests++
		rec.lastPath = r.URL.Path
		rec.lastQuery = r.URL.RawQuery
		rec.lastHeader = r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"upstream":true}`))
	}))
	t.Cleanup(rec.server.Close)
	return rec
}

func testConfig(upstreams map[string]string) *config.Config {
	return &config.Config{
		Service:     "gateway",
		Environment: config.EnvDevelopment,
		Upstreams:   upstreams,
	}
}

func proxyHandler(t *testing.T, upstreams map[string]string) http.Handler {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := New(testConfig(upstreams), logger)
	return p.Middleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
}

func do(t *testing.T, handler http.Handler, method, target string, headers map[string]string) *http.Response {
	t.Helper()
	request := httptest.NewRequest(method, target, nil)
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder.Result()
}

func TestForwardsToConfiguredUpstream(t *testing.T) {
	upstream := newRecorder(t)
	handler := proxyHandler(t, map[string]string{"games": upstream.server.URL})

	response := do(t, handler, http.MethodGet, "/api/v1/games?limit=10", map[string]string{
		"Authorization": "Bearer abc.def.ghi",
	})

	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	if upstream.requests != 1 {
		t.Fatalf("upstream requests = %d, want 1", upstream.requests)
	}
	if upstream.lastPath != "/api/v1/games" || upstream.lastQuery != "limit=10" {
		t.Fatalf("upstream saw %s?%s", upstream.lastPath, upstream.lastQuery)
	}
	if got := upstream.lastHeader.Get("Authorization"); got != "Bearer abc.def.ghi" {
		t.Fatalf("Authorization = %q; the upstream must verify the token itself", got)
	}
	if got := upstream.lastHeader.Get("X-Forwarded-For"); got == "" {
		t.Error("X-Forwarded-For missing on the upstream request")
	}
}

func TestClientSuppliedIdentityHeadersAreRemoved(t *testing.T) {
	upstream := newRecorder(t)
	handler := proxyHandler(t, map[string]string{"games": upstream.server.URL})

	do(t, handler, http.MethodGet, "/api/v1/games", map[string]string{
		"X-User-ID":       "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f",
		"X-User-Role":     "admin",
		"X-Is-Admin":      "true",
		"X-Admin":         "1",
		"X-Supabase-Auth": "trusted",
	})

	for _, header := range identityHeaders {
		if got := upstream.lastHeader.Get(header); got != "" {
			t.Errorf("identity header %s reached the upstream with %q", header, got)
		}
	}
}

func TestUnconfiguredGroupIsNotProxied(t *testing.T) {
	upstream := newRecorder(t)
	handler := proxyHandler(t, map[string]string{"games": upstream.server.URL})

	// The scores group has no upstream configured here, while games does — so a
	// request for it must not be answered by the games service, and must not be
	// proxied anywhere at all.
	response := do(t, handler, http.MethodGet, "/api/v1/scores", nil)

	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	if upstream.requests != 0 {
		t.Fatalf("upstream was called %d times for a different group", upstream.requests)
	}

	body, _ := io.ReadAll(response.Body)
	payload := map[string]any{}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if payload["error"] == nil {
		t.Fatal("503 did not use the error envelope")
	}
}

func TestMalformedUpstreamIsDroppedInsteadOfTrusted(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := New(testConfig(map[string]string{
		"games":    "file:///etc/passwd",
		"users":    "https://users.internal.example",
		"comments": "https://social.internal.example/?q=1",
	}), logger)

	routes := p.Routes()
	if _, ok := routes["/api/v1/games"]; ok {
		t.Error("a non-http upstream URL must not be routable")
	}
	if routes["/api/v1/games"] != "" {
		t.Error("a non-http upstream URL must not be routable")
	}
	if routes["/api/v1/users"] != "https://users.internal.example" {
		t.Errorf("valid upstream was dropped: %v", routes)
	}
	if _, ok := routes["/api/v1/comments"]; ok {
		t.Error("an upstream with a query string must be rejected")
	}
}

func TestNonAPIPathFallsThroughToTheNextHandler(t *testing.T) {
	handler := proxyHandler(t, nil)

	response := do(t, handler, http.MethodGet, "/healthz", nil)

	if response.StatusCode != http.StatusTeapot {
		t.Fatalf("status = %d, want the fallback handler's 418", response.StatusCode)
	}
}

func TestGatewayOwnedPathsAreNotTreatedAsUnconfiguredGroups(t *testing.T) {
	handler := proxyHandler(t, nil)

	// `/api/v1` (version discovery) and `/api/v1/health` (liveness) belong to the
	// gateway's own router. Answering them with the unconfigured-upstream 503
	// would make a healthy deployment look down to every probe that reports it.
	for _, path := range []string{"/api/v1", "/api/v1/", httpx.HealthPath} {
		response := do(t, handler, http.MethodGet, path, nil)
		response.Body.Close()
		if response.StatusCode != http.StatusTeapot {
			t.Errorf("%s = %d, want the fallback handler's 418 (never proxied, never 503)", path, response.StatusCode)
		}
	}
}

func TestUpstreamCorsHeadersAreDropped(t *testing.T) {
	// The browser's origin is the gateway's, so the gateway answers for it. An
	// upstream is free to set its own CORS headers (it may be reached directly),
	// but copying them in beside the gateway's produces two
	// `Access-Control-Allow-Origin` values — which every browser rejects.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "http://localhost:8081")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"upstream":true}`))
	}))
	t.Cleanup(upstream.Close)

	handler := proxyHandler(t, map[string]string{"auth": upstream.URL})
	response := do(t, handler, http.MethodPost, "/api/v1/auth/sign-in", nil)
	response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	if got := response.Header.Values("Access-Control-Allow-Origin"); len(got) != 0 {
		t.Errorf("Access-Control-Allow-Origin = %v, want none: the gateway owns CORS", got)
	}
	if got := response.Header.Get("Access-Control-Allow-Credentials"); got != "" {
		t.Errorf("Access-Control-Allow-Credentials = %q, want empty", got)
	}
	// Everything else the upstream sent must survive untouched.
	if got := response.Header.Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q, want the upstream's value", got)
	}
}

func TestUpstreamSecurityHeadersAreNotDuplicated(t *testing.T) {
	// Every service runs the same security middleware as the gateway. Copying
	// the upstream's set in beside the gateway's sends each header twice, and a
	// repeated Strict-Transport-Security header is non-compliant (RFC 6797).
	upstream := httptest.NewServer(httpx.SecurityHeaders(config.EnvProduction)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Request-ID", r.Header.Get("X-Request-ID"))
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"upstream":true}`))
		}),
	))
	t.Cleanup(upstream.Close)

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := New(testConfig(map[string]string{"games": upstream.URL}), logger)
	handler := httpx.RequestID(httpx.SecurityHeaders(config.EnvProduction)(p.Middleware()(http.NotFoundHandler())))

	response := do(t, handler, http.MethodGet, "/api/v1/games", nil)
	response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	for _, name := range append(httpx.SecurityHeaderNames(), "X-Request-ID") {
		if got := response.Header.Values(name); len(got) != 1 {
			t.Errorf("%s = %v, want exactly one value", name, got)
		}
	}
	if got := response.Header.Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q, want the upstream's value", got)
	}
}

func TestLongestPrefixWins(t *testing.T) {
	// Every group in the routing table must be proxied to the service the table
	// names. Two of them are served by a deployment whose name is not their own
	// (the play sessions and the admin API are mounted in the games service,
	// because Vercel's Go preset gives a service root three entrypoint names and
	// all three are taken), so the mapping is asserted from the table rather than
	// assumed from the prefix.
	// Every service in the table gets an upstream, so every group is routed.
	upstreams := map[string]string{}
	recorders := map[string]*recorder{}
	for _, group := range apiroutes.Groups() {
		if _, ok := recorders[group.Service]; !ok {
			recorders[group.Service] = newRecorder(t)
			upstreams[group.Service] = recorders[group.Service].server.URL
		}
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := New(testConfig(upstreams), logger)

	for _, group := range apiroutes.Groups() {
		found := false
		for _, rt := range p.routes {
			if rt.prefix == group.Prefix && rt.service == group.Service {
				found = true
			}
		}
		if !found {
			t.Fatalf("%s is not proxied to the %s service, which the routing table names", group.Prefix, group.Service)
		}
	}
	games := recorders["games"]

	// Longest prefix wins, so a nested path under a group in the table is still
	// answered by that group's upstream with its path intact.
	handler := p.Middleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	response := do(t, handler, http.MethodGet, "/api/v1/games/stack-10/leaderboard?period=week", nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("nested path status = %d, want 200 from the upstream", response.StatusCode)
	}
	if got := games.lastPath; got != "/api/v1/games/stack-10/leaderboard" {
		t.Fatalf("upstream saw %q, want the nested path", got)
	}
	if got := games.lastQuery; got != "period=week" {
		t.Fatalf("upstream query = %q, want period=week", got)
	}
}
