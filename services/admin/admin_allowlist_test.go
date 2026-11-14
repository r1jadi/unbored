package admin

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/r1jadi/unbored/packages/go/platform/authn"
	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/admin/internal/supabaseadmin"
)

// newAllowlistServer is newTestServer with a configurable token email, so
// allowlist tests can sign tokens for the allowlisted address. The email in
// the token is the verified identity — never a body or query value.
func newAllowlistServer(t *testing.T, backend Backend) (*httptest.Server, func(subject, claimRole, email string) string) {
	t.Helper()
	t.Setenv("SUPABASE_JWT_SECRET", testSecret)
	t.Setenv("SUPABASE_JWT_AUDIENCE", "authenticated")

	cfg, err := config.Load("admin-allowlist-test")
	if err != nil {
		t.Fatalf("loading test configuration: %v", err)
	}
	verifier, err := authn.NewVerifier(cfg)
	if err != nil {
		t.Fatalf("building verifier: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	router := httpx.NewRouter(httpx.RouterOptions{Config: cfg, Verifier: verifier, Logger: logger})
	newService(backend, logger, []string{"gateway", "games", "admin"}, 1<<20).register(router)

	server := httptest.NewServer(router.Mux())
	t.Cleanup(server.Close)

	sign := func(subject, claimRole, email string) string {
		t.Helper()
		claims := jwt.MapClaims{
			"sub":          subject,
			"email":        email,
			"aud":          "authenticated",
			"iat":          time.Now().Add(-time.Minute).Unix(),
			"exp":          time.Now().Add(time.Hour).Unix(),
			"role":         "authenticated",
			"app_metadata": map[string]any{"role": claimRole},
		}
		signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
		if err != nil {
			t.Fatalf("signing test token: %v", err)
		}
		return signed
	}

	return server, sign
}

// TestAllowlistedEmailIsAdminWithoutARowOrClaim: a verified email in
// ADMIN_EMAILS is an administrator even when the token claim says user and the
// database row says user. This is the environment-managed path: no claim edit, no
// row edit — the Go layer authorizes from the allowlist.
func TestAllowlistedEmailIsAdminWithoutARowOrClaim(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &fakeBackend{identity: staffIdentity("user")}
	server, sign := newAllowlistServer(t, backend)
	token := sign(testPlayer, "user", "admin@example.com")

	status, payload := call(t, server, http.MethodGet, SessionPath, token, nil)
	if status != http.StatusOK {
		t.Fatalf("session = %d, want 200 (%v)", status, payload)
	}
	if payload["isAdmin"] != true || payload["isStaff"] != true || payload["role"] != "admin" {
		t.Errorf("session answered %v, want the allowlist's admin", payload)
	}

	status, payload = call(t, server, http.MethodGet, OverviewPath, token, nil)
	if status != http.StatusOK {
		t.Fatalf("overview as allowlisted = %d, want 200 (%v)", status, payload)
	}
	if !backend.called("Identity") {
		t.Error("the staff wrapper never asked the database for the row")
	}
}

// TestAllowlistMatchingIgnoresCaseAndWhitespace: the operator writes
// " Admin@Example.com " once; the token carries "admin@example.com".
func TestAllowlistMatchingIgnoresCaseAndWhitespace(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "  Admin@Example.COM , another@example.com ")
	backend := &fakeBackend{identity: staffIdentity("user")}
	server, sign := newAllowlistServer(t, backend)

	token := sign(testPlayer, "user", "ADMIN@EXAMPLE.COM")
	if status, payload := call(t, server, http.MethodGet, SessionPath, token, nil); status != http.StatusOK || payload["isAdmin"] != true {
		t.Errorf("case-insensitive session = %d %v, want admin", status, payload)
	}

	other := sign(testPlayer, "user", "another@EXAMPLE.com")
	if status, payload := call(t, server, http.MethodGet, SessionPath, other, nil); status != http.StatusOK || payload["isAdmin"] != true {
		t.Errorf("second entry session = %d %v, want admin", status, payload)
	}
}

// TestOrdinaryEmailIsStillRefused: an address not in the allowlist, with a
// user claim and a user row, gets the session truth and 403 on staff routes.
func TestOrdinaryEmailIsStillRefused(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &fakeBackend{identity: staffIdentity("user")}
	server, sign := newAllowlistServer(t, backend)
	token := sign(testPlayer, "user", "player@example.com")

	status, payload := call(t, server, http.MethodGet, SessionPath, token, nil)
	if status != http.StatusOK || payload["isAdmin"] != false || payload["isStaff"] != false {
		t.Fatalf("session = %d %v, want non-staff", status, payload)
	}
	status, payload = call(t, server, http.MethodGet, OverviewPath, token, nil)
	if status != http.StatusForbidden {
		t.Fatalf("overview as ordinary user = %d, want 403 (%v)", status, payload)
	}
	if backend.called("Overview") {
		t.Error("a refused request reached the database read")
	}
}

// TestMissingAllowlistDeniesEveryone: empty or missing ADMIN_EMAILS grants no
// one — including a database admin with an admin claim. Fail closed.
func TestMissingAllowlistDeniesEveryone(t *testing.T) {
	for _, raw := range []string{"", "   "} {
		t.Run("allowlist="+raw, func(t *testing.T) {
			t.Setenv("ADMIN_EMAILS", raw)
			backend := &fakeBackend{identity: staffIdentity("user")}
			server, sign := newAllowlistServer(t, backend)
			token := sign(testPlayer, "user", "admin@example.com")
			if status, payload := call(t, server, http.MethodGet, OverviewPath, token, nil); status != http.StatusForbidden {
				t.Errorf("overview with missing allowlist = %d, want 403 (%v)", status, payload)
			}
		})
	}

	t.Run("database admin denied without an allowlist", func(t *testing.T) {
		t.Setenv("ADMIN_EMAILS", "")
		backend := &fakeBackend{identity: staffIdentity("admin")}
		server, sign := newAllowlistServer(t, backend)
		token := sign(testAdmin, "admin", "db-admin@example.com")
		if status, payload := call(t, server, http.MethodGet, OverviewPath, token, nil); status != http.StatusForbidden {
			t.Errorf("database admin with missing allowlist = %d, want 403 (%v)", status, payload)
		}
		status, payload := call(t, server, http.MethodGet, SessionPath, token, nil)
		if status != http.StatusOK || payload["isAdmin"] != false || payload["isStaff"] != false {
			t.Errorf("session = %d %v, want a non-admin", status, payload)
		}
	})
}

// TestRemovingEmailRevokesOnNextRequest: the same token passes while its email
// is allowlisted and is refused after the configuration changes — no stale
// grant from the claim, the row, or any cache.
func TestRemovingEmailRevokesOnNextRequest(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &fakeBackend{identity: staffIdentity("user")}
	server, sign := newAllowlistServer(t, backend)
	// A user claim behind a user row: only the allowlist grants.
	token := sign(testPlayer, "user", "admin@example.com")

	if status, _ := call(t, server, http.MethodGet, OverviewPath, token, nil); status != http.StatusOK {
		t.Fatalf("overview while allowlisted = %d, want 200", status)
	}

	t.Setenv("ADMIN_EMAILS", "someone-else@example.com")
	if status, payload := call(t, server, http.MethodGet, OverviewPath, token, nil); status != http.StatusForbidden {
		t.Fatalf("overview after removal = %d, want 403 (%v)", status, payload)
	}
	status, payload := call(t, server, http.MethodGet, SessionPath, token, nil)
	if status != http.StatusOK || payload["isAdmin"] != false || payload["isStaff"] != false || payload["role"] != "user" {
		t.Fatalf("session after removal = %d %v, want a non-admin", status, payload)
	}
}

// TestPrivilegedRowAndClaimDeniedOnEveryRoute: a database admin row plus an
// admin claim, for an email outside ADMIN_EMAILS, reaches no staff route and
// no staff write. There is no alternative way to become an admin.
func TestPrivilegedRowAndClaimDeniedOnEveryRoute(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &fakeBackend{identity: staffIdentity("admin")}
	server, sign := newAllowlistServer(t, backend)
	token := sign(testAdmin, "admin", "db-admin@example.com")

	for _, path := range []string{
		SessionPath, OverviewPath, AnalyticsPath, GamesPath, CategoriesPath,
		ReportsPath, CommentsPath, UsersPath, LeaderboardsPath,
		ModerationLogPath, SystemServicesPath,
	} {
		status, payload := call(t, server, http.MethodGet, path, token, nil)
		if path == SessionPath {
			if status != http.StatusOK || payload["isAdmin"] != false || payload["isStaff"] != false {
				t.Errorf("GET %s = %d %v, want a non-admin session", path, status, payload)
			}
			continue
		}
		if status != http.StatusForbidden {
			t.Errorf("GET %s = %d, want 403 (%v)", path, status, payload)
		}
	}

	writes := []struct {
		method string
		path   string
		body   any
	}{
		{http.MethodPatch, "/api/v1/admin/games/" + testGameID, map[string]any{"status": "published"}},
		{http.MethodPatch, "/api/v1/admin/reports/" + testGameID, map[string]any{"status": "resolved", "reason": "no"}},
		{http.MethodPatch, "/api/v1/admin/comments/" + testCommentID, map[string]any{"hidden": true, "reason": "no"}},
		{http.MethodPatch, "/api/v1/admin/users/" + testPlayer, map[string]any{"suspended": true, "reason": "no"}},
		{http.MethodDelete, "/api/v1/admin/users/" + testPlayer + "/avatar", map[string]any{"reason": "no"}},
	}
	for _, write := range writes {
		if status, _ := call(t, server, write.method, write.path, token, write.body); status != http.StatusForbidden {
			t.Errorf("%s %s = %d, want 403", write.method, write.path, status)
		}
	}

	if backend.called("Overview") || backend.called("Games") || backend.called("SetGameStatus") || backend.called("SetSuspension") || backend.called("RemoveAvatar") {
		t.Error("a refused request reached the database for staff work")
	}
}

// TestInvalidIdentityIsUnauthorized: forged, expired and missing tokens are
// 401 — never 403, never 200 — whether or not the email would be allowlisted.
func TestInvalidIdentityIsUnauthorized(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &fakeBackend{identity: staffIdentity("admin")}
	server, sign := newAllowlistServer(t, backend)

	if status, _ := call(t, server, http.MethodGet, OverviewPath, "", nil); status != http.StatusUnauthorized {
		t.Errorf("no token = %d, want 401", status)
	}
	if status, _ := call(t, server, http.MethodGet, OverviewPath, "not-a-token", nil); status != http.StatusUnauthorized {
		t.Errorf("garbage token = %d, want 401", status)
	}
	// A token signed with the wrong secret is forged.
	forged := func() string {
		claims := jwt.MapClaims{
			"sub": testAdmin, "email": "admin@example.com", "aud": "authenticated",
			"iat": time.Now().Add(-time.Minute).Unix(), "exp": time.Now().Add(time.Hour).Unix(),
			"role": "authenticated", "app_metadata": map[string]any{"role": "admin"},
		}
		signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("wrong-secret-that-is-long-enough-0123456789"))
		if err != nil {
			t.Fatalf("signing forged token: %v", err)
		}
		return signed
	}()
	if status, _ := call(t, server, http.MethodGet, OverviewPath, forged, nil); status != http.StatusUnauthorized {
		t.Errorf("forged token = %d, want 401", status)
	}

	// Sanity: a valid allowlisted token still passes on the same server.
	token := sign(testAdmin, "admin", "admin@example.com")
	backend.identity = staffIdentity("admin")
	if status, _ := call(t, server, http.MethodGet, SessionPath, token, nil); status != http.StatusOK {
		t.Errorf("valid allowlisted session = %d, want 200", status)
	}
}

// TestClientSuppliedAdminMarkersAreIgnored: a role, email, user id or isAdmin
// flag in the body or query never authorizes. Unknown body fields are
// rejected; unknown query keys change nothing.
func TestClientSuppliedAdminMarkersAreIgnored(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &fakeBackend{identity: staffIdentity("user")}
	server, sign := newAllowlistServer(t, backend)
	ordinary := sign(testPlayer, "user", "player@example.com")
	allowlisted := sign(testPlayer, "user", "admin@example.com")

	// An ordinary caller sending forged admin markers is refused before the
	// body is even read: authorization precedes validation.
	status, _ := call(t, server, http.MethodPatch, "/api/v1/admin/games/"+testGameID, ordinary,
		map[string]any{"status": "published", "role": "admin", "isAdmin": true, "email": "admin@example.com"})
	if status != http.StatusForbidden {
		t.Errorf("forged body as ordinary user = %d, want 403", status)
	}
	if backend.called("SetGameStatus") {
		t.Error("a refused body reached the database")
	}

	// An authorized caller sending the same markers gets a strict-body 400:
	// the markers are unknown fields, never authorization.
	status, _ = call(t, server, http.MethodPatch, "/api/v1/admin/games/"+testGameID, allowlisted,
		map[string]any{"status": "published", "role": "admin", "isAdmin": true, "email": "admin@example.com"})
	if status != http.StatusBadRequest {
		t.Errorf("body with role/isAdmin/email = %d, want 400", status)
	}

	// Query-string markers are not read by any handler: still 403.
	status, _ = call(t, server, http.MethodGet, OverviewPath+"?role=admin&email=admin@example.com&isAdmin=true", ordinary, nil)
	if status != http.StatusForbidden {
		t.Errorf("query with role/email/isAdmin = %d, want 403", status)
	}
}

// TestAllowlistedReachesEveryWrite: the three moderation writes join the
// suspension route in answering an allowlisted caller with a user claim behind
// a user row — every staff tier, every action, no claim or row required.
func TestAllowlistedReachesEveryWrite(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &fakeBackend{
		identity: staffIdentity("user"),
		action:   supabaseadmin.ActionResult{GameID: testGameID, Action: "publish_game"},
	}
	server, sign := newAllowlistServer(t, backend)
	// Claim user on purpose: the allowlist — not the stale claim — authorizes.
	token := sign(testPlayer, "user", "admin@example.com")

	writes := []struct {
		name   string
		method string
		path   string
		body   any
		want   string
	}{
		{"moderate game", http.MethodPatch, "/api/v1/admin/games/" + testGameID,
			map[string]any{"status": "published", "reason": "Good game"}, "SetGameStatus"},
		{"moderate report", http.MethodPatch, "/api/v1/admin/reports/" + testGameID,
			map[string]any{"status": "resolved", "reason": "Handled"}, "SetReportStatus"},
		{"moderate comment", http.MethodPatch, "/api/v1/admin/comments/" + testCommentID,
			map[string]any{"hidden": true, "reason": "Abuse"}, "SetCommentHidden"},
		{"suspend account", http.MethodPatch, "/api/v1/admin/users/" + testPlayer,
			map[string]any{"suspended": true, "reason": "Abuse"}, "SetSuspension"},
		{"remove picture", http.MethodDelete, "/api/v1/admin/users/" + testPlayer + "/avatar",
			map[string]any{"reason": "Explicit picture"}, "RemoveAvatar"},
	}
	for _, write := range writes {
		t.Run(write.name, func(t *testing.T) {
			if status, payload := call(t, server, write.method, write.path, token, write.body); status != http.StatusOK {
				t.Errorf("%s %s = %d, want 200 (%v)", write.method, write.path, status, payload)
			}
			if !backend.called(write.want) {
				t.Errorf("%s never reached the database", write.name)
			}
		})
	}
}

// TestAllowlistedModeratorGateAndSuspension: an allowlisted email passes every
// staff tier and reaches the suspension route — with a user claim behind a
// user row, proving claims and rows grant nothing.
func TestAllowlistedModeratorGateAndSuspension(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &fakeBackend{
		identity: staffIdentity("user"),
		action:   supabaseadmin.ActionResult{UserID: testPlayer, Action: "suspend_account"},
	}
	server, sign := newAllowlistServer(t, backend)
	// Claim user on purpose: the allowlist — not the stale claim — authorizes.
	token := sign(testPlayer, "user", "admin@example.com")

	if status, _ := call(t, server, http.MethodGet, ReportsPath, token, nil); status != http.StatusOK {
		t.Errorf("reports as allowlisted = %d, want 200", status)
	}
	// The allowlist alone authorizes; the fake backend stands in for the data
	// call the handler makes with the caller's token.
	status, _ := call(t, server, http.MethodPatch, "/api/v1/admin/users/"+testPlayer, token,
		map[string]any{"suspended": true, "reason": "Abuse"})
	if status != http.StatusOK {
		t.Errorf("suspend as allowlisted = %d, want 200 (fake backend)", status)
	}
	if !backend.called("SetSuspension") {
		t.Error("the suspension never reached the database")
	}
}

// TestRemoveAvatarNeedsAReason: a picture is never taken down without one.
func TestRemoveAvatarNeedsAReason(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &fakeBackend{identity: staffIdentity("admin")}
	server, sign := newAllowlistServer(t, backend)
	token := sign(testPlayer, "user", "admin@example.com")

	status, _ := call(t, server, http.MethodDelete, "/api/v1/admin/users/"+testPlayer+"/avatar", token,
		map[string]any{"reason": "  "})
	if status != http.StatusBadRequest {
		t.Errorf("no reason = %d, want 400", status)
	}
	if backend.called("RemoveAvatar") {
		t.Error("a removal without a reason reached the database")
	}
}
