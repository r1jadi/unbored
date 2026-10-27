package servicekit

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/r1jadi/unbored/packages/go/platform/authn"
	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
)

// testSecret must be at least 32 characters; the verifier refuses shorter ones.
const testSecret = "test-secret-used-only-in-unit-tests-0123456789"

type testOptions struct {
	env        string
	withAuth   bool
	register   func(*httpx.Router)
	corsOrigin string
}

// newTestServer boots a service through the same wiring the binaries use and
// exposes it over httptest.
func newTestServer(t *testing.T, opts testOptions) *httptest.Server {
	t.Helper()

	env := opts.env
	if env == "" {
		env = "development"
	}
	t.Setenv("ENVIRONMENT", env)
	t.Setenv("LOG_LEVEL", "error")
	t.Setenv("HTTP_ADDR", ":0")
	if opts.corsOrigin != "" {
		t.Setenv("CORS_ALLOWED_ORIGINS", opts.corsOrigin)
	}
	if opts.withAuth {
		t.Setenv("SUPABASE_JWT_SECRET", testSecret)
		t.Setenv("SUPABASE_JWT_AUDIENCE", "authenticated")
	}

	register := opts.register
	if register == nil {
		register = func(router *httpx.Router) {
			router.AuthenticatedFunc("GET /api/v1/things/me", func(w http.ResponseWriter, r *http.Request) {
				httpx.WriteJSON(w, r, http.StatusOK, map[string]string{"ok": "true"})
			})
			router.AdminFunc("GET /api/v1/things/admin", func(w http.ResponseWriter, r *http.Request) {
				httpx.WriteJSON(w, r, http.StatusOK, map[string]string{"ok": "admin"})
			})
			router.ModeratorFunc("GET /api/v1/things/moderate", func(w http.ResponseWriter, r *http.Request) {
				httpx.WriteJSON(w, r, http.StatusOK, map[string]string{"ok": "moderator"})
			})
			router.OptionalAuthFunc("GET /api/v1/things/public", func(w http.ResponseWriter, r *http.Request) {
				httpx.WriteJSON(w, r, http.StatusOK, map[string]string{"ok": "public"})
			})
		}
	}

	service := New(Options{Name: "test-service", Register: register})
	server := httpx.NewServer(service.server)
	httpServer := httptest.NewServer(server.Handler)
	t.Cleanup(httpServer.Close)
	return httpServer
}

func token(t *testing.T, subject string, appMeta map[string]any) string {
	t.Helper()
	return tokenWithEmail(t, subject, "player@example.com", appMeta)
}

// tokenWithEmail signs a token for a subject with a verified email claim.
// ADMIN_EMAILS is the single source of truth, so tests that need a grant sign
// for an allowlisted address; role claims alone never grant.
func tokenWithEmail(t *testing.T, subject, email string, appMeta map[string]any) string {
	t.Helper()
	claims := jwt.MapClaims{
		"sub":          subject,
		"email":        email,
		"aud":          "authenticated",
		"iat":          time.Now().Add(-time.Minute).Unix(),
		"exp":          time.Now().Add(time.Hour).Unix(),
		"role":         "authenticated",
		"app_metadata": appMeta,
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("signing test token: %v", err)
	}
	return signed
}

func get(t *testing.T, url string, headers map[string]string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("building request: %v", err)
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	return response
}

func decodeError(t *testing.T, response *http.Response) map[string]any {
	t.Helper()
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}
	payload := map[string]any{}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("response is not JSON: %v (%s)", err, body)
	}
	return payload
}

func TestRegisterWithRunsAfterRegisterWithTheResolvedDependencies(t *testing.T) {
	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("LOG_LEVEL", "error")
	t.Setenv("HTTP_ADDR", ":0")
	t.Setenv("SUPABASE_JWT_SECRET", testSecret)
	t.Setenv("SUPABASE_JWT_AUDIENCE", "authenticated")

	order := make([]string, 0, 2)
	service := New(Options{
		Name: "test-service",
		Register: func(*httpx.Router) {
			order = append(order, "Register")
		},
		// A service whose handlers need the resolved dependencies (the auth
		// service calls Supabase and verifies a token presented in a body) gets
		// them here instead of reading the environment a second time.
		RegisterWith: func(router *httpx.Router, cfg *config.Config, logger *slog.Logger, verifier *authn.Verifier) {
			order = append(order, "RegisterWith")
			if cfg == nil || cfg.Service != "test-service" {
				t.Errorf("RegisterWith got configuration %+v, want the resolved service configuration", cfg)
			}
			if logger == nil {
				t.Error("RegisterWith got a nil logger")
			}
			if verifier == nil {
				t.Error("RegisterWith got a nil verifier although auth material is configured")
			}
			router.PublicFunc("GET /api/v1/things/extra", func(w http.ResponseWriter, r *http.Request) {
				httpx.WriteJSON(w, r, http.StatusOK, map[string]string{"ok": "extra"})
			})
		},
	})

	server := httpx.NewServer(service.server)
	httpServer := httptest.NewServer(server.Handler)
	t.Cleanup(httpServer.Close)

	if len(order) != 2 || order[0] != "Register" || order[1] != "RegisterWith" {
		t.Fatalf("registration order = %v, want [Register RegisterWith]", order)
	}

	response := get(t, httpServer.URL+"/api/v1/things/extra", nil)
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("route registered from RegisterWith = %d, want 200", response.StatusCode)
	}
}

func TestProbesAnswerWithoutAuth(t *testing.T) {
	server := newTestServer(t, testOptions{withAuth: true})

	for _, path := range []string{"/healthz", "/readyz", httpx.HealthPath} {
		response := get(t, server.URL+path, nil)
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("%s returned %d, want 200", path, response.StatusCode)
		}
	}
}

func TestVersionedHealthRouteNeedsNoAuthMaterial(t *testing.T) {
	// No SUPABASE_JWT_SECRET: authenticated routes fail closed with 503 while
	// health keeps answering, because it verifies nothing and checks nothing
	// external. A deployment therefore reports healthy before Supabase is wired
	// up — and cannot be made unhealthy by a slow dependency either.
	server := newTestServer(t, testOptions{})

	response := get(t, server.URL+httpx.HealthPath, nil)
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("%s = %d, want 200", httpx.HealthPath, response.StatusCode)
	}

	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}
	payload := map[string]any{}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("health response is not JSON: %v (%s)", err, body)
	}
	if payload["status"] != "ok" {
		t.Fatalf("status = %v, want ok", payload["status"])
	}
}

func TestAuthenticatedRouteRequiresToken(t *testing.T) {
	server := newTestServer(t, testOptions{withAuth: true})

	response := get(t, server.URL+"/api/v1/things/me", nil)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.StatusCode)
	}
	if got := response.Header.Get("WWW-Authenticate"); !strings.Contains(got, "Bearer") {
		t.Fatalf("WWW-Authenticate = %q, want a Bearer challenge", got)
	}
	payload := decodeError(t, response)
	if payload["error"] == nil {
		t.Fatal("error envelope missing")
	}
}

func TestValidTokenIsAccepted(t *testing.T) {
	server := newTestServer(t, testOptions{withAuth: true})

	response := get(t, server.URL+"/api/v1/things/me", map[string]string{
		"Authorization": "Bearer " + token(t, "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f", nil),
	})
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
}

func TestTokenForgedWithAnotherSecretIsRejected(t *testing.T) {
	server := newTestServer(t, testOptions{withAuth: true})

	forged, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f",
		"aud": "authenticated",
		"iat": time.Now().Add(-time.Minute).Unix(),
		"exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte("a-different-secret-that-is-long-enough-000000"))
	if err != nil {
		t.Fatalf("signing forged token: %v", err)
	}

	response := get(t, server.URL+"/api/v1/things/me", map[string]string{"Authorization": "Bearer " + forged})
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.StatusCode)
	}
}

func TestAdminRouteIsAllowlistOnly(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	server := newTestServer(t, testOptions{withAuth: true})
	subject := "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f"

	plain := get(t, server.URL+"/api/v1/things/admin", map[string]string{
		"Authorization": "Bearer " + token(t, subject, nil),
	})
	plain.Body.Close()
	if plain.StatusCode != http.StatusForbidden {
		t.Fatalf("regular user got %d on an admin route, want 403", plain.StatusCode)
	}

	// A role claim alone never grants: an admin claim for a non-allowlisted
	// email is still refused.
	claimed := get(t, server.URL+"/api/v1/things/admin", map[string]string{
		"Authorization": "Bearer " + tokenWithEmail(t, subject, "player@example.com", map[string]any{"role": "admin"}),
	})
	claimed.Body.Close()
	if claimed.StatusCode != http.StatusForbidden {
		t.Fatalf("claimed admin without allowlist got %d, want 403", claimed.StatusCode)
	}

	admin := get(t, server.URL+"/api/v1/things/admin", map[string]string{
		"Authorization": "Bearer " + tokenWithEmail(t, subject, "admin@example.com", map[string]any{"role": "user"}),
	})
	admin.Body.Close()
	if admin.StatusCode != http.StatusOK {
		t.Fatalf("allowlisted email got %d, want 200", admin.StatusCode)
	}
}

func TestModeratorRouteIsAllowlistOnly(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	server := newTestServer(t, testOptions{withAuth: true})

	// A moderator claim for a non-allowlisted email grants nothing.
	claimed := get(t, server.URL+"/api/v1/things/moderate", map[string]string{
		"Authorization": "Bearer " + tokenWithEmail(t, "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f", "player@example.com", map[string]any{"role": "moderator"}),
	})
	claimed.Body.Close()
	if claimed.StatusCode != http.StatusForbidden {
		t.Fatalf("claimed moderator without allowlist got %d, want 403", claimed.StatusCode)
	}

	response := get(t, server.URL+"/api/v1/things/moderate", map[string]string{
		"Authorization": "Bearer " + tokenWithEmail(t, "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f", "admin@example.com", map[string]any{"role": "user"}),
	})
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
}

func TestTierRoutesDenyEveryoneWhenAllowlistIsMissing(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "")
	server := newTestServer(t, testOptions{withAuth: true})
	subject := "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f"

	for _, path := range []string{"/api/v1/things/admin", "/api/v1/things/moderate"} {
		response := get(t, server.URL+path, map[string]string{
			"Authorization": "Bearer " + tokenWithEmail(t, subject, "admin@example.com", map[string]any{"role": "admin"}),
		})
		response.Body.Close()
		if response.StatusCode != http.StatusForbidden {
			t.Fatalf("GET %s with missing allowlist = %d, want 403", path, response.StatusCode)
		}
	}
}

func TestServiceRoleTokenIsRefusedOnUserRoutes(t *testing.T) {
	server := newTestServer(t, testOptions{withAuth: true})

	claims := jwt.MapClaims{
		"sub":  "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f",
		"aud":  "authenticated",
		"role": "service_role",
		"iat":  time.Now().Add(-time.Minute).Unix(),
		"exp":  time.Now().Add(time.Hour).Unix(),
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("signing token: %v", err)
	}

	response := get(t, server.URL+"/api/v1/things/me", map[string]string{"Authorization": "Bearer " + signed})
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.StatusCode)
	}
}

func TestAuthenticatedRouteFailsClosedWithoutVerifier(t *testing.T) {
	// No SUPABASE_JWT_SECRET: the service must not treat "cannot verify" as
	// "allow". It answers 503 when a token is presented.
	server := newTestServer(t, testOptions{})

	response := get(t, server.URL+"/api/v1/things/me", map[string]string{
		"Authorization": "Bearer " + strings.Repeat("x", 64),
	})
	response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
}

func TestUnknownPathReturnsJSONEnvelope(t *testing.T) {
	server := newTestServer(t, testOptions{withAuth: true})

	response := get(t, server.URL+"/api/v1/nope", nil)
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", response.StatusCode)
	}
	if payload := decodeError(t, response); payload["error"] == nil {
		t.Fatal("404 did not use the error envelope")
	}
}

func TestSecurityHeadersAreAlwaysPresent(t *testing.T) {
	server := newTestServer(t, testOptions{withAuth: true})

	response := get(t, server.URL+"/api/v1/things/public", nil)
	response.Body.Close()

	expected := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "no-referrer",
		"Cache-Control":          "no-store",
	}
	for header, want := range expected {
		if got := response.Header.Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	if response.Header.Get("Strict-Transport-Security") != "" {
		t.Error("HSTS must not be sent outside production")
	}
	if response.Header.Get("X-Request-ID") == "" {
		t.Error("X-Request-ID missing")
	}
}

func TestCORSOnlyAllowsConfiguredOrigins(t *testing.T) {
	server := newTestServer(t, testOptions{withAuth: true, corsOrigin: "https://unbored.lol"})

	allowed := get(t, server.URL+"/api/v1/things/public", map[string]string{
		"Origin": "https://unbored.lol",
	})
	allowed.Body.Close()
	if got := allowed.Header.Get("Access-Control-Allow-Origin"); got != "https://unbored.lol" {
		t.Fatalf("allowed origin not echoed: %q", got)
	}

	denied := get(t, server.URL+"/api/v1/things/public", map[string]string{
		"Origin": "https://evil.example",
	})
	denied.Body.Close()
	if got := denied.Header.Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("unconfigured origin received %q", got)
	}
}

func TestRateLimitAppliesToAPIRoutesButNotProbes(t *testing.T) {
	t.Setenv("RATE_LIMIT_REQUESTS_PER_MINUTE", "1")
	t.Setenv("RATE_LIMIT_BURST", "1")
	server := newTestServer(t, testOptions{withAuth: true})

	first := get(t, server.URL+"/api/v1/things/public", nil)
	first.Body.Close()
	if first.StatusCode != http.StatusOK {
		t.Fatalf("first request = %d, want 200", first.StatusCode)
	}

	second := get(t, server.URL+"/api/v1/things/public", nil)
	second.Body.Close()
	if second.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("second request = %d, want 429", second.StatusCode)
	}
	if second.Header.Get("Retry-After") == "" {
		t.Error("429 response is missing Retry-After")
	}

	// Probes must keep working while a client is being throttled, or an
	// orchestrator would restart a perfectly healthy service — and an uptime
	// check on the published health route would report an outage.
	for i := 0; i < 5; i++ {
		for _, path := range []string{"/healthz", httpx.HealthPath} {
			response := get(t, server.URL+path, nil)
			response.Body.Close()
			if response.StatusCode != http.StatusOK {
				t.Fatalf("probe %s #%d returned %d, want 200", path, i, response.StatusCode)
			}
		}
	}
}

func TestDevelopmentAllowsWildcardCORSPubliclyConfigured(t *testing.T) {
	// A wildcard is only tolerated in development; staging and production reject
	// it during configuration validation.
	t.Setenv("ENVIRONMENT", "production")
	t.Setenv("CORS_ALLOWED_ORIGINS", "*")
	t.Setenv("SUPABASE_JWT_SECRET", testSecret)
	t.Setenv("LOG_LEVEL", "error")

	if _, err := config.Load("test-service"); err == nil {
		t.Fatal("production accepted a wildcard CORS origin")
	}
}

func TestProductionRequiresAuthMaterialAndAllowlist(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	t.Setenv("LOG_LEVEL", "error")

	if _, err := config.Load("test-service"); err == nil {
		t.Fatal("production started without CORS allowlist or auth material")
	}
}
