package admin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/services/admin/internal/supabaseadmin"
)

// The ADMIN_EMAILS authorization bridge, proven end to end.
//
// The model under test:
//
//   - Go authorizes administrators from the verified token email against the
//     server-side ADMIN_EMAILS allowlist (no claim or row required), and
//     moderators from their own database row (never administrators).
//   - With the server-only secret configured, staff database calls run
//     privileged — as the service role, against `*_svc` wrappers only it may
//     execute — carrying the verified actor for attribution. That path serves
//     an allowlisted administrator who holds no `user_roles` row.
//   - Without the secret the caller's own token is used and the database
//     guards decide: an allowlisted administrator without a row is then
//     refused honestly as unavailable (503), never as success.
//
// The guardBackend below enforces the same `is_staff()`/`is_admin()` rule the
// database enforces, so tests against it do NOT mock the guard away.

// guardBackend is a Backend that enforces the database's own rule: staff
// functions require a moderator or administrator row, and suspension requires
// an administrator row. dbRole is what public.current_role() would report for
// the caller. Payloads are served from the embedded fakeBackend, which has no
// secret — so calls through it exercise the caller-token path.
type guardBackend struct {
	*fakeBackend
	dbRole string
}

func (g *guardBackend) guardErr(op string) *supabaseadmin.Error {
	return &supabaseadmin.Error{Op: op, Status: http.StatusForbidden, Code: "42501"}
}

func (g *guardBackend) staffAllowed(op string) error {
	if g.dbRole != "moderator" && g.dbRole != "admin" {
		return g.guardErr(op)
	}
	return nil
}

func (g *guardBackend) adminAllowed(op string) error {
	if g.dbRole != "admin" {
		return g.guardErr(op)
	}
	return nil
}

func (g *guardBackend) rowRole() string {
	if g.dbRole == "moderator" || g.dbRole == "admin" {
		return g.dbRole
	}
	return "user"
}

func (g *guardBackend) Identity(_ context.Context, token string) (supabaseadmin.Identity, error) {
	g.record("Identity")
	g.lastToken = token
	role := g.rowRole()
	return supabaseadmin.Identity{
		UserID:      testPlayer,
		Username:    "rowuser",
		DisplayName: "Row User",
		Role:        role,
		IsStaff:     role == "moderator" || role == "admin",
		IsAdmin:     role == "admin",
	}, nil
}

func (g *guardBackend) Overview(_ context.Context, token, actor string) (supabaseadmin.Overview, error) {
	g.record("Overview")
	g.lastToken = token
	g.lastActor = actor
	if err := g.staffAllowed("overview"); err != nil {
		return supabaseadmin.Overview{}, err
	}
	return g.overview, nil
}

func (g *guardBackend) Analytics(_ context.Context, token, actor string, _ int) (supabaseadmin.Analytics, error) {
	g.record("Analytics")
	g.lastToken = token
	g.lastActor = actor
	if err := g.staffAllowed("analytics"); err != nil {
		return supabaseadmin.Analytics{}, err
	}
	return g.analytics, nil
}

func (g *guardBackend) Games(_ context.Context, token, actor, status, search string, page supabaseadmin.Page) ([]supabaseadmin.Game, error) {
	g.record("Games", status, search)
	g.lastPage = page
	g.lastToken = token
	g.lastActor = actor
	if err := g.staffAllowed("games"); err != nil {
		return nil, err
	}
	return g.games, nil
}

func (g *guardBackend) Users(_ context.Context, token, actor, search, role string, page supabaseadmin.Page) ([]supabaseadmin.User, error) {
	g.record("Users", search, role)
	g.lastPage = page
	g.lastToken = token
	g.lastActor = actor
	if err := g.staffAllowed("users"); err != nil {
		return nil, err
	}
	return g.users, nil
}

func (g *guardBackend) Reports(_ context.Context, token, actor, status string, page supabaseadmin.Page) ([]supabaseadmin.Report, error) {
	g.record("Reports", status)
	g.lastPage = page
	g.lastToken = token
	g.lastActor = actor
	if err := g.staffAllowed("reports"); err != nil {
		return nil, err
	}
	return g.reports, nil
}

func (g *guardBackend) Comments(_ context.Context, token, actor, state, search string, page supabaseadmin.Page) ([]supabaseadmin.Comment, error) {
	g.record("Comments", state, search)
	g.lastPage = page
	g.lastToken = token
	g.lastActor = actor
	if err := g.staffAllowed("comments"); err != nil {
		return nil, err
	}
	return g.comments, nil
}

func (g *guardBackend) Scores(_ context.Context, token, actor, slug, username string, page supabaseadmin.Page) ([]supabaseadmin.Score, error) {
	g.record("Scores", slug, username)
	g.lastPage = page
	g.lastToken = token
	g.lastActor = actor
	if err := g.staffAllowed("scores"); err != nil {
		return nil, err
	}
	return g.scores, nil
}

func (g *guardBackend) Feedback(_ context.Context, token, actor, category, search string, page supabaseadmin.Page) ([]supabaseadmin.Feedback, error) {
	g.record("Feedback", category, search)
	g.lastPage = page
	g.lastToken = token
	g.lastActor = actor
	if err := g.staffAllowed("feedback"); err != nil {
		return nil, err
	}
	return g.feedback, nil
}

func (g *guardBackend) Categories(_ context.Context, token, actor string) ([]supabaseadmin.Category, error) {
	g.record("Categories")
	g.lastToken = token
	g.lastActor = actor
	if err := g.staffAllowed("categories"); err != nil {
		return nil, err
	}
	return g.categories, nil
}

func (g *guardBackend) ModerationLog(_ context.Context, token, actor string, page supabaseadmin.Page) ([]supabaseadmin.ModerationAction, error) {
	g.record("ModerationLog")
	g.lastPage = page
	g.lastToken = token
	g.lastActor = actor
	if err := g.staffAllowed("moderation-log"); err != nil {
		return nil, err
	}
	return g.log, nil
}

func (g *guardBackend) SetGameStatus(_ context.Context, token, actor, gameID, status, reason string) (supabaseadmin.ActionResult, error) {
	g.record("SetGameStatus", gameID, status, reason)
	g.lastToken = token
	g.lastActor = actor
	if err := g.staffAllowed("set-game-status"); err != nil {
		return supabaseadmin.ActionResult{}, err
	}
	return g.action, nil
}

func (g *guardBackend) SetReportStatus(_ context.Context, token, actor, reportID, status, reason string) (supabaseadmin.ActionResult, error) {
	g.record("SetReportStatus", reportID, status, reason)
	g.lastToken = token
	g.lastActor = actor
	if err := g.staffAllowed("set-report-status"); err != nil {
		return supabaseadmin.ActionResult{}, err
	}
	return g.action, nil
}

func (g *guardBackend) SetCommentHidden(_ context.Context, token, actor, commentID string, hidden bool, reason string) (supabaseadmin.ActionResult, error) {
	g.record("SetCommentHidden", commentID, reason)
	g.lastToken = token
	g.lastActor = actor
	if err := g.staffAllowed("set-comment-hidden"); err != nil {
		return supabaseadmin.ActionResult{}, err
	}
	return g.action, nil
}

func (g *guardBackend) SetSuspension(_ context.Context, token, actor, userID string, suspended bool, reason string) (supabaseadmin.ActionResult, error) {
	g.record("SetSuspension", userID, reason)
	g.lastToken = token
	g.lastActor = actor
	if err := g.adminAllowed("set-suspension"); err != nil {
		return supabaseadmin.ActionResult{}, err
	}
	return g.action, nil
}

// stubPostgREST stands in for PostgREST in front of a migrated database: it
// asserts the privileged credential and the verified actor, then answers with
// real-shaped payloads. Anything that is not a service-role call to a `*_svc`
// wrapper is refused, the way the locked grants refuse it.
type stubPostgREST struct {
	t         *testing.T
	secret    string
	seenActor string
	calls     []string
}

func (s *stubPostgREST) handler(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("apikey") != s.secret || r.Header.Get("Authorization") != "Bearer "+s.secret {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"code":"42501","message":"permission denied"}`))
		return
	}
	function := strings.TrimPrefix(r.URL.Path, "/rest/v1/rpc/")
	if !strings.HasSuffix(function, "_svc") {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"code":"42501","message":"permission denied"}`))
		return
	}
	raw, _ := io.ReadAll(r.Body)
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	actor, _ := body["p_actor"].(string)
	if actor == "" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"22023","message":"a verified actor is required"}`))
		return
	}
	s.seenActor = actor
	s.calls = append(s.calls, function)

	w.Header().Set("Content-Type", "application/json")
	switch function {
	case "admin_overview_svc":
		_, _ = w.Write([]byte(`{"totalUsers":7,"activeUsers":1,"games":3,"series":[],"activity":[],"topGames":[]}`))
	case "admin_set_game_status_svc":
		_, _ = w.Write([]byte(`{"gameId":"` + testGameID + `","previousStatus":"review","status":"published","action":"publish_game"}`))
	default:
		_, _ = w.Write([]byte(`{}`))
	}
}

// newPrivilegedServer serves the admin routes with the real database client
// pointed at the stub, and the secret configured — the production shape,
// without a network. The client is built from an explicit config (not the
// process environment) so the token verifier's own configuration is
// unaffected: only SUPABASE_SECRET_KEY semantics are under test here.
func newPrivilegedServer(t *testing.T, stub *stubPostgREST) (*httptest.Server, func(subject, claimRole, email string) string) {
	t.Helper()
	postgrest := httptest.NewServer(http.HandlerFunc(stub.handler))
	t.Cleanup(postgrest.Close)

	backend, err := supabaseadmin.New(&config.Config{
		Supabase: config.Supabase{
			ProjectURL:     postgrest.URL,
			PublishableKey: "sb_publishable_test",
			SecretKey:      stub.secret,
		},
	})
	if err != nil {
		t.Fatalf("building privileged client: %v", err)
	}
	if !backend.Privileged() {
		t.Fatal("the client did not pick up the server-only secret")
	}
	return newAllowlistServer(t, backend)
}

// TestPrivilegedBridgeLoadsDashboardWithoutRow is the fix, proven end to end:
// an allowlisted verified email with a user claim and no database row loads
// real dashboard data and performs a moderation write through the privileged
// path. The stub proves the service-role credential was used, the `*_svc`
// wrapper was called, and the verified actor (the token subject, not client
// input) was attributed.
func TestPrivilegedBridgeLoadsDashboardWithoutRow(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	stub := &stubPostgREST{secret: "test-server-only-secret"}
	server, sign := newPrivilegedServer(t, stub)
	// User claim on purpose: the allowlist — not the claim — authorizes, and
	// no database row exists behind it.
	token := sign(testPlayer, "user", "admin@example.com")

	status, payload := call(t, server, http.MethodGet, OverviewPath, token, nil)
	if status != http.StatusOK {
		t.Fatalf("overview as allowlisted-without-row = %d, want 200 (%v)", status, payload)
	}
	if payload["totalUsers"] != float64(7) {
		t.Errorf("totalUsers = %v, want the database's real number", payload["totalUsers"])
	}
	if stub.seenActor != testPlayer {
		t.Errorf("p_actor = %q, want the verified token subject %q", stub.seenActor, testPlayer)
	}

	status, payload = call(t, server, http.MethodPatch, "/api/v1/admin/games/"+testGameID, token,
		map[string]any{"status": "published", "reason": "Looks good"})
	if status != http.StatusOK {
		t.Fatalf("moderating a game as allowlisted-without-row = %d, want 200 (%v)", status, payload)
	}
	if payload["action"] != "publish_game" {
		t.Errorf("game moderation answered %v, want the recorded action", payload)
	}

	found := false
	for _, name := range stub.calls {
		if name == "admin_overview_svc" || name == "admin_set_game_status_svc" {
			found = true
		}
	}
	if !found {
		t.Errorf("privileged wrappers not called (saw %v)", stub.calls)
	}
}

// TestAllowlistedWithoutRowWithoutSecretIsUnavailable proves the fail-closed
// half: with no secret configured the caller's token is used, the row guard
// refuses, and the service answers 503 — an honest missing bridge, never
// success and never a privilege message that would tell an authorized
// administrator they are not staff.
func TestAllowlistedWithoutRowWithoutSecretIsUnavailable(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &guardBackend{fakeBackend: &fakeBackend{}, dbRole: "user"}
	server, sign := newAllowlistServer(t, backend)
	token := sign(testPlayer, "user", "admin@example.com")

	status, payload := call(t, server, http.MethodGet, OverviewPath, token, nil)
	if status != http.StatusServiceUnavailable {
		t.Fatalf("overview as allowlisted-without-row without a secret = %d, want 503 (%v)", status, payload)
	}
	if code := errorCode(t, payload); code != "service_unavailable" {
		t.Errorf("overview error code = %q, want service_unavailable", code)
	}
	if !backend.called("Overview") {
		t.Error("the request never reached the database: the refusal belongs to the data call, not the gate")
	}
	envelope, _ := payload["error"].(map[string]any)
	message, _ := envelope["message"].(string)
	if strings.Contains(message, "42501") || strings.Contains(strings.ToLower(message), "relation") {
		t.Errorf("the response leaked database detail: %q", message)
	}

	// The session still answers from the allowlist: the gate works, the data
	// does not.
	status, payload = call(t, server, http.MethodGet, SessionPath, token, nil)
	if status != http.StatusOK || payload["isAdmin"] != true || payload["isStaff"] != true {
		t.Errorf("session = %d %v, want the allowlist's admin (gate passes, data unavailable)", status, payload)
	}

	status, _ = call(t, server, http.MethodPatch, "/api/v1/admin/games/"+testGameID, token,
		map[string]any{"status": "published", "reason": "Looks good"})
	if status != http.StatusServiceUnavailable {
		t.Errorf("moderating a game as allowlisted-without-row without a secret = %d, want 503", status)
	}
}

// TestModeratorRetainsStaffAccessButNotSuspension proves the hierarchy through
// the API: a database moderator row behind a non-allowlisted email reaches
// staff reads and moderation writes, is reported as a moderator — and is
// refused the admin-only suspension before the database is touched.
func TestModeratorRetainsStaffAccessButNotSuspension(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &guardBackend{
		fakeBackend: &fakeBackend{
			reports: []supabaseadmin.Report{{ID: testGameID, Status: "open"}},
			action:  supabaseadmin.ActionResult{GameID: testGameID, Action: "publish_game"},
		},
		dbRole: "moderator",
	}
	server, sign := newAllowlistServer(t, backend)
	token := sign(testModerator, "moderator", "mod@example.com")

	status, payload := call(t, server, http.MethodGet, SessionPath, token, nil)
	if status != http.StatusOK || payload["role"] != "moderator" || payload["isStaff"] != true || payload["isAdmin"] != false {
		t.Fatalf("session = %d %v, want a moderator", status, payload)
	}

	if status, payload := call(t, server, http.MethodGet, ReportsPath, token, nil); status != http.StatusOK {
		t.Errorf("a moderator reading the queue = %d, want 200 (%v)", status, payload)
	}
	if status, payload := call(t, server, http.MethodPatch, "/api/v1/admin/games/"+testGameID, token,
		map[string]any{"status": "published", "reason": "Looks good"}); status != http.StatusOK {
		t.Errorf("a moderator publishing a game = %d, want 200 (%v)", status, payload)
	}

	status, _ = call(t, server, http.MethodPatch, "/api/v1/admin/users/"+testPlayer, token,
		map[string]any{"suspended": true, "reason": "Abuse"})
	if status != http.StatusForbidden {
		t.Errorf("a moderator suspending an account = %d, want 403", status)
	}
	if backend.called("SetSuspension") {
		t.Error("a refused suspension reached the database")
	}
}

// TestRevokedEmailWithStaleRowIsDenied proves revocation plus stale state is
// safe at the Go layer: an email removed from ADMIN_EMAILS is refused on every
// staff route even when its token still carries an admin claim and its stale
// database row still says admin — and no staff work reaches the database.
func TestRevokedEmailWithStaleRowIsDenied(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "someone-else@example.com")
	backend := &guardBackend{fakeBackend: &fakeBackend{}, dbRole: "admin"}
	server, sign := newAllowlistServer(t, backend)
	token := sign(testAdmin, "admin", "admin@example.com")

	if status, payload := call(t, server, http.MethodGet, OverviewPath, token, nil); status != http.StatusForbidden {
		t.Errorf("overview after revocation with a stale admin row+claim = %d, want 403 (%v)", status, payload)
	}
	if backend.called("Overview") {
		t.Error("a revoked request reached the database read")
	}

	status, _ := call(t, server, http.MethodPatch, "/api/v1/admin/users/"+testPlayer, token,
		map[string]any{"suspended": true, "reason": "Abuse"})
	if status != http.StatusForbidden {
		t.Errorf("suspension after revocation with a stale admin row+claim = %d, want 403", status)
	}

	status, payload := call(t, server, http.MethodGet, SessionPath, token, nil)
	if status != http.StatusOK || payload["isAdmin"] != false || payload["isStaff"] != false || payload["role"] != "user" {
		t.Errorf("session after revocation = %d %v, want a non-admin", status, payload)
	}
}

// TestClientMarkersCannotBypassGuardBackend proves client-supplied markers in
// the query string authorize nothing against the row-enforcing backend: an
// ordinary caller stays refused and the database is never touched for staff
// work.
func TestClientMarkersCannotBypassGuardBackend(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &guardBackend{fakeBackend: &fakeBackend{}, dbRole: "user"}
	server, sign := newAllowlistServer(t, backend)
	ordinary := sign(testPlayer, "user", "player@example.com")

	status, _ := call(t, server, http.MethodGet, OverviewPath+"?role=admin&email=admin@example.com&isAdmin=true", ordinary, nil)
	if status != http.StatusForbidden {
		t.Errorf("query with role/email/isAdmin = %d, want 403", status)
	}
	if backend.called("Overview") {
		t.Error("a refused request reached the database read")
	}
}

func (g *guardBackend) FeaturedGames(_ context.Context, token, actor string) ([]supabaseadmin.FeaturedGame, error) {
	g.record("FeaturedGames")
	return nil, nil
}

func (g *guardBackend) SetFeaturedGames(_ context.Context, token, actor string, gameIDs []string) error {
	g.record("SetFeaturedGames", gameIDs...)
	g.lastActor = actor
	return nil
}

func (g *guardBackend) PlatformSettings(_ context.Context, token, actor string) (supabaseadmin.PlatformSettings, error) {
	g.record("PlatformSettings")
	return supabaseadmin.PlatformSettings{}, nil
}

func (g *guardBackend) SetPlatformSettings(_ context.Context, token, actor, bannerText string, commentsEnabled, messagesEnabled bool) error {
	g.record("SetPlatformSettings", bannerText)
	g.lastActor = actor
	return nil
}

func (g *guardBackend) Broadcasts(_ context.Context, token, actor string, page supabaseadmin.Page) ([]supabaseadmin.Broadcast, error) {
	g.record("Broadcasts")
	return nil, nil
}

func (g *guardBackend) SendBroadcast(_ context.Context, token, actor, title, body, link string) (supabaseadmin.BroadcastResult, error) {
	g.record("SendBroadcast", title, body, link)
	g.lastActor = actor
	return supabaseadmin.BroadcastResult{ID: "broadcast-1", Recipients: 3}, nil
}
