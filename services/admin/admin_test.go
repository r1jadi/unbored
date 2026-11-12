package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
	"github.com/r1jadi/unbored/services/admin/internal/supabaseadmin"
)

const (
	// testSecret must be at least 32 characters; the verifier refuses shorter ones.
	testSecret = "test-secret-used-only-in-unit-tests-0123456789"
	// testAdmin is the account the admin claims below are signed for.
	testAdmin = "44444444-4444-4444-8444-444444444444"
	// testModerator signs moderator claims; testPlayer signs ordinary ones.
	testModerator = "33333333-3333-4333-8333-333333333333"
	testPlayer    = "11111111-1111-4111-8111-111111111111"
	// testGameID is the row the moderation tests act on.
	testGameID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
	// testCommentID is the comment the hide tests act on.
	testCommentID = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb"
)

// fakeBackend stands in for the Supabase client. It is deliberately dumb: it
// returns what it was given and records what it was asked for, so a test can
// assert what the handler *requested* as well as what it rendered — which is how
// the "the call was never made" assertions below work.
type fakeBackend struct {
	identity    supabaseadmin.Identity
	identityErr error

	overview   supabaseadmin.Overview
	analytics  supabaseadmin.Analytics
	games      []supabaseadmin.Game
	users      []supabaseadmin.User
	reports    []supabaseadmin.Report
	comments   []supabaseadmin.Comment
	scores     []supabaseadmin.Score
	feedback   []supabaseadmin.Feedback
	categories []supabaseadmin.Category
	log        []supabaseadmin.ModerationAction

	action    supabaseadmin.ActionResult
	actionErr error
	readErr   error

	// calls records the method names that were exercised, so a test can prove a
	// request never reached the database.
	calls []string
	// lastPage and lastToken record the last paging and credential a handler used.
	lastPage  supabaseadmin.Page
	lastToken string
	lastArgs  []string
	// lastActor records the verified actor the handler attributed the call to.
	lastActor string
}

func (f *fakeBackend) record(name string, args ...string) {
	f.calls = append(f.calls, name)
	f.lastArgs = args
}

func (f *fakeBackend) called(name string) bool {
	for _, call := range f.calls {
		if call == name {
			return true
		}
	}
	return false
}

func (f *fakeBackend) Identity(_ context.Context, token string) (supabaseadmin.Identity, error) {
	f.record("Identity")
	f.lastToken = token
	if f.identityErr != nil {
		return supabaseadmin.Identity{}, f.identityErr
	}
	return f.identity, nil
}

func (f *fakeBackend) Overview(_ context.Context, token, actor string) (supabaseadmin.Overview, error) {
	f.record("Overview")
	f.lastToken = token
	f.lastActor = actor
	return f.overview, f.readErr
}

func (f *fakeBackend) Analytics(_ context.Context, token, actor string, _ int) (supabaseadmin.Analytics, error) {
	f.record("Analytics")
	f.lastToken = token
	f.lastActor = actor
	return f.analytics, f.readErr
}

func (f *fakeBackend) Games(_ context.Context, token, actor, status, search string, page supabaseadmin.Page) ([]supabaseadmin.Game, error) {
	f.record("Games", status, search)
	f.lastPage = page
	f.lastToken = token
	f.lastActor = actor
	return f.games, f.readErr
}

func (f *fakeBackend) Users(_ context.Context, token, actor, search, role string, page supabaseadmin.Page) ([]supabaseadmin.User, error) {
	f.record("Users", search, role)
	f.lastPage = page
	f.lastToken = token
	f.lastActor = actor
	return f.users, f.readErr
}

func (f *fakeBackend) Reports(_ context.Context, token, actor, status string, page supabaseadmin.Page) ([]supabaseadmin.Report, error) {
	f.record("Reports", status)
	f.lastPage = page
	f.lastToken = token
	f.lastActor = actor
	return f.reports, f.readErr
}

func (f *fakeBackend) Comments(_ context.Context, token, actor, state, search string, page supabaseadmin.Page) ([]supabaseadmin.Comment, error) {
	f.record("Comments", state, search)
	f.lastPage = page
	f.lastToken = token
	f.lastActor = actor
	return f.comments, f.readErr
}

func (f *fakeBackend) Scores(_ context.Context, token, actor, slug, username string, page supabaseadmin.Page) ([]supabaseadmin.Score, error) {
	f.record("Scores", slug, username)
	f.lastPage = page
	f.lastToken = token
	f.lastActor = actor
	return f.scores, f.readErr
}

func (f *fakeBackend) Feedback(_ context.Context, token, actor, category, search string, page supabaseadmin.Page) ([]supabaseadmin.Feedback, error) {
	f.record("Feedback", category, search)
	f.lastPage = page
	f.lastToken = token
	f.lastActor = actor
	return f.feedback, f.readErr
}

func (f *fakeBackend) Categories(_ context.Context, token, actor string) ([]supabaseadmin.Category, error) {
	f.record("Categories")
	f.lastToken = token
	f.lastActor = actor
	return f.categories, f.readErr
}

func (f *fakeBackend) ModerationLog(_ context.Context, token, actor string, page supabaseadmin.Page) ([]supabaseadmin.ModerationAction, error) {
	f.record("ModerationLog")
	f.lastPage = page
	f.lastToken = token
	f.lastActor = actor
	return f.log, f.readErr
}

func (f *fakeBackend) SetGameStatus(_ context.Context, token, actor, gameID, status, reason string) (supabaseadmin.ActionResult, error) {
	f.record("SetGameStatus", gameID, status, reason)
	f.lastToken = token
	f.lastActor = actor
	if f.actionErr != nil {
		return supabaseadmin.ActionResult{}, f.actionErr
	}
	return f.action, nil
}

func (f *fakeBackend) SetReportStatus(_ context.Context, token, actor, reportID, status, reason string) (supabaseadmin.ActionResult, error) {
	f.record("SetReportStatus", reportID, status, reason)
	f.lastToken = token
	f.lastActor = actor
	if f.actionErr != nil {
		return supabaseadmin.ActionResult{}, f.actionErr
	}
	return f.action, nil
}

func (f *fakeBackend) SetCommentHidden(_ context.Context, token, actor, commentID string, hidden bool, reason string) (supabaseadmin.ActionResult, error) {
	f.record("SetCommentHidden", commentID, reason)
	f.lastToken = token
	f.lastActor = actor
	if f.actionErr != nil {
		return supabaseadmin.ActionResult{}, f.actionErr
	}
	return f.action, nil
}

func (f *fakeBackend) RemoveAvatar(_ context.Context, token, actor, userID, reason string) (supabaseadmin.ActionResult, error) {
	f.record("RemoveAvatar", userID, reason)
	f.lastToken = token
	f.lastActor = actor
	return supabaseadmin.ActionResult{UserID: userID, Action: "remove_avatar"}, nil
}

func (f *fakeBackend) SetSuspension(_ context.Context, token, actor, userID string, suspended bool, reason string) (supabaseadmin.ActionResult, error) {
	f.record("SetSuspension", userID, reason)
	f.lastToken = token
	f.lastActor = actor
	if f.actionErr != nil {
		return supabaseadmin.ActionResult{}, f.actionErr
	}
	return f.action, nil
}

// staffIdentity is the fake database's profile answer for a caller. Its role
// fields are ignored for authorization (the allowlist alone decides); tests
// set them to `user` to prove no row is needed, or to staff roles to prove a
// row grants nothing without the allowlist.
func staffIdentity(role string) supabaseadmin.Identity {
	return supabaseadmin.Identity{
		UserID:   testAdmin,
		Username: "ada",
		Role:     role,
		IsStaff:  role == "moderator" || role == "admin",
		IsAdmin:  role == "admin",
	}
}

// newTestServer serves the admin routes with a real token verifier, exactly as
// the deployment does, and returns a function that signs a token for a subject
// with a role claim.
func newTestServer(t *testing.T, backend Backend) (*httptest.Server, func(subject, claimRole string) string) {
	t.Helper()
	t.Setenv("SUPABASE_JWT_SECRET", testSecret)
	t.Setenv("SUPABASE_JWT_AUDIENCE", "authenticated")

	cfg, err := config.Load("admin-test")
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

	sign := func(subject, claimRole string) string {
		t.Helper()
		claims := jwt.MapClaims{
			"sub":          subject,
			"email":        "staff@example.com",
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

// call performs one request and decodes the answer.
func call(t *testing.T, server *httptest.Server, method, path, token string, body any) (int, map[string]any) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("encoding request body: %v", err)
		}
		reader = bytes.NewReader(encoded)
	}

	request, err := http.NewRequest(method, server.URL+path, reader)
	if err != nil {
		t.Fatalf("building request: %v", err)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}

	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("performing request: %v", err)
	}
	defer response.Body.Close()

	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("reading response: %v", err)
	}
	payload := map[string]any{}
	if len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatalf("response is not JSON: %v (%s)", err, raw)
		}
	}
	return response.StatusCode, payload
}

// errorCode reads the envelope's machine-readable code.
func errorCode(t *testing.T, payload map[string]any) string {
	t.Helper()
	envelope, ok := payload["error"].(map[string]any)
	if !ok {
		t.Fatalf("response has no error envelope: %v", payload)
	}
	code, _ := envelope["code"].(string)
	return code
}

// ── Authorization ───────────────────────────────────────────────────────────

// TestAnonymousIsRefused: without a token, every admin route is a 401 — not a
// 403, and never a 200 with an empty list.
func TestAnonymousIsRefused(t *testing.T) {
	backend := &fakeBackend{identity: staffIdentity("admin")}
	server, _ := newTestServer(t, backend)

	routes := []struct {
		method string
		path   string
	}{
		{http.MethodGet, SessionPath},
		{http.MethodGet, OverviewPath},
		{http.MethodGet, AnalyticsPath},
		{http.MethodGet, GamesPath},
		{http.MethodGet, CategoriesPath},
		{http.MethodGet, ReportsPath},
		{http.MethodGet, CommentsPath},
		{http.MethodGet, UsersPath},
		{http.MethodGet, LeaderboardsPath},
		{http.MethodGet, FeedbackPath},
		{http.MethodGet, ModerationLogPath},
		{http.MethodGet, SystemServicesPath},
		{http.MethodPatch, "/api/v1/admin/games/" + testGameID},
		{http.MethodPatch, "/api/v1/admin/comments/" + testCommentID},
		{http.MethodPatch, "/api/v1/admin/users/" + testPlayer},
	}

	for _, route := range routes {
		status, payload := call(t, server, route.method, route.path, "", map[string]any{})
		if status != http.StatusUnauthorized {
			t.Errorf("%s %s without a token = %d, want 401", route.method, route.path, status)
			continue
		}
		if code := errorCode(t, payload); code != "unauthorized" {
			t.Errorf("%s %s error code = %q, want unauthorized", route.method, route.path, code)
		}
	}

	if backend.called("Overview") {
		t.Error("an anonymous request reached the database")
	}
}

// TestOrdinaryUserIsRefused: a signed-in account whose verified email is not in
// ADMIN_EMAILS gets a 403 from every staff route, and may only read its own
// session (reported as a non-admin). Database rows and claims grant nothing.
func TestOrdinaryUserIsRefused(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &fakeBackend{identity: staffIdentity("user")}
	server, sign := newTestServer(t, backend)
	token := sign(testPlayer, "user")

	status, payload := call(t, server, http.MethodGet, SessionPath, token, nil)
	if status != http.StatusOK {
		t.Fatalf("session = %d, want 200 (%v)", status, payload)
	}
	if payload["isStaff"] != false || payload["role"] != "user" {
		t.Errorf("session answered %v, want a non-staff role", payload)
	}

	refused := []struct {
		method string
		path   string
		body   any
	}{
		{http.MethodGet, OverviewPath, nil},
		{http.MethodGet, AnalyticsPath, nil},
		{http.MethodGet, GamesPath, nil},
		{http.MethodGet, CategoriesPath, nil},
		{http.MethodGet, ReportsPath, nil},
		{http.MethodGet, CommentsPath, nil},
		{http.MethodGet, UsersPath, nil},
		{http.MethodGet, LeaderboardsPath, nil},
		{http.MethodGet, ModerationLogPath, nil},
		{http.MethodGet, SystemServicesPath, nil},
		{http.MethodPatch, "/api/v1/admin/games/" + testGameID, map[string]any{"status": "published"}},
		{http.MethodPatch, "/api/v1/admin/reports/" + testGameID, map[string]any{"status": "resolved", "reason": "no"}},
		{http.MethodPatch, "/api/v1/admin/comments/" + testCommentID, map[string]any{"hidden": true, "reason": "no"}},
		{http.MethodPatch, "/api/v1/admin/users/" + testPlayer, map[string]any{"suspended": true, "reason": "no"}},
	}

	for _, route := range refused {
		status, payload := call(t, server, route.method, route.path, token, route.body)
		if status != http.StatusForbidden {
			t.Errorf("%s %s as an ordinary user = %d, want 403 (%v)", route.method, route.path, status, payload)
			continue
		}
		if code := errorCode(t, payload); code != "forbidden" {
			t.Errorf("%s %s error code = %q, want forbidden", route.method, route.path, code)
		}
	}

	if backend.called("Overview") || backend.called("SetGameStatus") || backend.called("SetSuspension") {
		t.Error("a refused request reached the database")
	}
}

// TestDatabaseRowNeverGrants: a database admin row plus an admin claim, for an
// email outside ADMIN_EMAILS, is refused on staff routes and reported as a
// non-admin on the session. Rows are never consulted for the decision.
func TestDatabaseRowNeverGrants(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &fakeBackend{identity: staffIdentity("admin")}
	server, sign := newTestServer(t, backend)
	token := sign(testAdmin, "admin")

	status, payload := call(t, server, http.MethodGet, OverviewPath, token, nil)
	if status != http.StatusForbidden {
		t.Fatalf("a database admin outside the allowlist = %d, want 403 (%v)", status, payload)
	}
	if backend.called("Overview") {
		t.Error("a refused request reached the database read")
	}

	status, payload = call(t, server, http.MethodGet, SessionPath, token, nil)
	if status != http.StatusOK || payload["isAdmin"] != false || payload["isStaff"] != false || payload["role"] != "user" {
		t.Errorf("session = %d %v, want a non-admin", status, payload)
	}
}

// TestClaimNeverGrants: an admin claim for an email outside ADMIN_EMAILS is
// refused, even with no database role behind it. Claims are never consulted.
func TestClaimNeverGrants(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &fakeBackend{identity: staffIdentity("user")}
	server, sign := newTestServer(t, backend)
	token := sign(testAdmin, "admin")

	status, payload := call(t, server, http.MethodGet, OverviewPath, token, nil)
	if status != http.StatusForbidden {
		t.Fatalf("an admin claim outside the allowlist = %d, want 403 (%v)", status, payload)
	}
	if backend.called("Overview") {
		t.Error("a refused request reached the database read")
	}

	// The session route still answers, so the account can be told what it is:
	// not an admin.
	status, payload = call(t, server, http.MethodGet, SessionPath, token, nil)
	if status != http.StatusOK || payload["isAdmin"] != false || payload["isStaff"] != false {
		t.Errorf("session = %d %v, want a non-admin", status, payload)
	}
}

// TestDatabaseModeratorReachesStaffButNotSuspension: a database moderator row
// (non-allowlisted email, moderator claim) reaches staff reads and moderation
// writes through the moderator tier — and is refused the admin-only suspension
// before the database is touched. The session reports a moderator, never an
// administrator.
func TestDatabaseModeratorReachesStaffButNotSuspension(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &fakeBackend{identity: staffIdentity("moderator")}
	server, sign := newTestServer(t, backend)
	token := sign(testModerator, "moderator")

	if status, payload := call(t, server, http.MethodGet, ReportsPath, token, nil); status != http.StatusOK {
		t.Fatalf("a database moderator reading the queue = %d, want 200 (%v)", status, payload)
	}

	status, _ := call(t, server, http.MethodPatch, "/api/v1/admin/users/"+testPlayer, token,
		map[string]any{"suspended": true, "reason": "Abuse"})
	if status != http.StatusForbidden {
		t.Fatalf("a database moderator suspending an account = %d, want 403", status)
	}
	if backend.called("SetSuspension") {
		t.Error("a refused suspension reached the database")
	}

	status, payload := call(t, server, http.MethodGet, SessionPath, token, nil)
	if status != http.StatusOK || payload["role"] != "moderator" || payload["isAdmin"] != false || payload["isStaff"] != true {
		t.Errorf("session = %d %v, want a moderator", status, payload)
	}
}

// TestAllowlistedReachesEveryRoute: a verified email in ADMIN_EMAILS is the
// full surface — no admin claim and no database row required. The test signs a
// `user` claim behind a `user` row on purpose.
func TestAllowlistedReachesEveryRoute(t *testing.T) {
	// newTestServer signs tokens for staff@example.com.
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{
		identity:   staffIdentity("user"),
		overview:   supabaseadmin.Overview{TotalUsers: 7, Series: []supabaseadmin.SeriesPoint{{Day: "2026-10-13", Runs: 2}}},
		games:      []supabaseadmin.Game{{ID: testGameID, Slug: "stack-10", Title: "Stack 10", Status: "published"}},
		categories: []supabaseadmin.Category{{Slug: "puzzle", Name: "Puzzle", PublishedGames: 1, TotalGames: 2}},
		reports:    []supabaseadmin.Report{{ID: testGameID, Status: "open", TargetKind: "comment"}},
		comments:   []supabaseadmin.Comment{{ID: testCommentID, Body: "hi", IsHidden: true}},
		users:      []supabaseadmin.User{{ID: testPlayer, Username: "nora", Role: "user"}},
		scores:     []supabaseadmin.Score{{ID: testGameID, GameSlug: "stack-10", Username: "nora", Score: 80}},
		log:        []supabaseadmin.ModerationAction{{ID: testGameID, Action: "publish_game"}},
		action:     supabaseadmin.ActionResult{GameID: testGameID, Action: "publish_game"},
	}
	server, sign := newTestServer(t, backend)
	token := sign(testAdmin, "user")

	for _, path := range []string{
		OverviewPath, AnalyticsPath, GamesPath, CategoriesPath, ReportsPath,
		CommentsPath, UsersPath, LeaderboardsPath, FeedbackPath, ModerationLogPath, SystemServicesPath, SessionPath,
	} {
		if status, payload := call(t, server, http.MethodGet, path, token, nil); status != http.StatusOK {
			t.Errorf("GET %s = %d, want 200 (%v)", path, status, payload)
		}
	}

	status, payload := call(t, server, http.MethodPatch, "/api/v1/admin/users/"+testPlayer, token,
		map[string]any{"suspended": true, "reason": "Abuse"})
	if status != http.StatusOK {
		t.Fatalf("an administrator suspending an account = %d, want 200 (%v)", status, payload)
	}
	if !backend.called("SetSuspension") {
		t.Fatal("the suspension never reached the database")
	}
	if got := backend.lastArgs[0]; got != testPlayer {
		t.Errorf("the suspension was sent for %q, want the path's account", got)
	}
}

// TestNoSupabaseConfigurationIsUnavailable: a deployment without credentials
// answers 503 rather than panicking or allowing anything.
func TestNoSupabaseConfigurationIsUnavailable(t *testing.T) {
	// newTestServer signs tokens for staff@example.com.
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	server, sign := newTestServer(t, nil)
	token := sign(testAdmin, "admin")

	if status, _ := call(t, server, http.MethodGet, OverviewPath, token, nil); status != http.StatusServiceUnavailable {
		t.Fatalf("overview without a backend = %d, want 503", status)
	}
	if status, _ := call(t, server, http.MethodGet, SessionPath, token, nil); status != http.StatusServiceUnavailable {
		t.Fatalf("session without a backend = %d, want 503", status)
	}
}

// TestIdentityFailureOnSessionIsReportedHonestly: an expired or rejected token
// is a 401 on the session route, and a database outage is a 503 — never a 200
// with a made-up role.
func TestIdentityFailureOnSessionIsReportedHonestly(t *testing.T) {
	// newTestServer signs tokens for staff@example.com.
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{
		identityErr: &supabaseadmin.Error{Op: "identity", Status: http.StatusUnauthorized},
	}
	server, sign := newTestServer(t, backend)

	status, payload := call(t, server, http.MethodGet, SessionPath, sign(testAdmin, "admin"), nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("session with a rejected token = %d, want 401 (%v)", status, payload)
	}

	backend.identityErr = errors.New("connection refused")
	status, _ = call(t, server, http.MethodGet, SessionPath, sign(testAdmin, "admin"), nil)
	if status != http.StatusServiceUnavailable {
		t.Fatalf("session during an outage = %d, want 503", status)
	}
}

// ── Reads ───────────────────────────────────────────────────────────────────

// TestOverviewReportsMeasuredValues: the nullable average stays null, a real
// series is passed through, and the activity feed is not padded.
func TestOverviewReportsMeasuredValues(t *testing.T) {
	// newTestServer signs tokens for staff@example.com.
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{
		identity: staffIdentity("moderator"),
		overview: supabaseadmin.Overview{
			TotalUsers:    5,
			GamesPlayed:   3,
			AvgRunSeconds: nil,
			RunsMeasured:  0,
			Series:        []supabaseadmin.SeriesPoint{{Day: "2026-10-12", Runs: 1, Players: 1}},
			Activity:      []supabaseadmin.Activity{},
			TopGames:      []supabaseadmin.TopGame{},
		},
	}
	server, sign := newTestServer(t, backend)

	status, payload := call(t, server, http.MethodGet, OverviewPath, sign(testModerator, "moderator"), nil)
	if status != http.StatusOK {
		t.Fatalf("overview = %d, want 200 (%v)", status, payload)
	}
	if payload["avgRunSeconds"] != nil {
		t.Errorf("avgRunSeconds = %v, want null when no run has been completed", payload["avgRunSeconds"])
	}
	if payload["runsMeasured"] != float64(0) {
		t.Errorf("runsMeasured = %v, want 0", payload["runsMeasured"])
	}
	series, ok := payload["series"].([]any)
	if !ok || len(series) != 1 {
		t.Fatalf("series = %v, want the one real day", payload["series"])
	}
}

// TestDirectoryPagingAsksForOneExtraRow: the service requests limit+1 so it can
// report whether another page exists without counting the table.
func TestDirectoryPagingAsksForOneExtraRow(t *testing.T) {
	// newTestServer signs tokens for staff@example.com.
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{
		identity: staffIdentity("moderator"),
		games:    []supabaseadmin.Game{{ID: testGameID}, {ID: testPlayer}, {ID: testCommentID}},
	}
	server, sign := newTestServer(t, backend)

	status, payload := call(t, server, http.MethodGet, GamesPath+"?limit=2", sign(testModerator, "moderator"), nil)
	if status != http.StatusOK {
		t.Fatalf("games = %d, want 200 (%v)", status, payload)
	}
	if backend.lastPage.Limit != 2 {
		t.Errorf("the database was asked for %d rows, want the page size", backend.lastPage.Limit)
	}
	if payload["hasMore"] != true {
		t.Errorf("hasMore = %v, want true when the extra row came back", payload["hasMore"])
	}
	items, _ := payload["items"].([]any)
	if len(items) != 2 {
		t.Errorf("items = %d, want the page size", len(items))
	}
}

func TestFeedbackDirectoryUsesTheStaffBridge(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{
		identity: staffIdentity("user"),
		feedback: []supabaseadmin.Feedback{
			{ID: testGameID, Mood: 4, Category: "idea", Message: "More puzzles", SenderUsername: "nora"},
			{ID: testPlayer, Mood: 3, Category: "bug", Message: "A tiny issue", SenderUsername: "liam"},
		},
	}
	server, sign := newTestServer(t, backend)

	status, payload := call(t, server, http.MethodGet,
		FeedbackPath+"?category=idea&q=puzzles&limit=1", sign(testAdmin, "user"), nil)
	if status != http.StatusOK {
		t.Fatalf("feedback = %d, want 200 (%v)", status, payload)
	}
	if !backend.called("Feedback") || backend.lastActor != testAdmin {
		t.Fatalf("feedback did not use the staff bridge: calls=%v actor=%q", backend.calls, backend.lastActor)
	}
	if got := backend.lastArgs; len(got) != 2 || got[0] != "idea" || got[1] != "puzzles" {
		t.Errorf("feedback filters = %v, want [idea puzzles]", got)
	}
	if backend.lastPage.Limit != 1 || payload["hasMore"] != true {
		t.Errorf("page = %+v response = %v, want one item and hasMore", backend.lastPage, payload)
	}
	items, _ := payload["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("items = %v, want one row", payload["items"])
	}
	item, _ := items[0].(map[string]any)
	if item["senderUsername"] != "nora" || item["message"] != "More puzzles" {
		t.Errorf("feedback item = %v, want the mapped API fields", item)
	}
}

// TestDirectoryFiltersAreValidated: an unknown enum is a 400 that names the
// field, and the database is never asked an unanswerable question.
func TestDirectoryFiltersAreValidated(t *testing.T) {
	// newTestServer signs tokens for staff@example.com.
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{identity: staffIdentity("moderator")}
	server, sign := newTestServer(t, backend)
	token := sign(testModerator, "moderator")

	cases := []struct {
		path  string
		field string
	}{
		{GamesPath + "?status=live", "status"},
		{UsersPath + "?role=creator", "role"},
		{ReportsPath + "?status=urgent", "status"},
		{CommentsPath + "?state=reported", "state"},
		{LeaderboardsPath + "?game=Not_A_Slug", "game"},
		{FeedbackPath + "?category=spam", "category"},
		{GamesPath + "?limit=0", "limit"},
		{GamesPath + "?offset=-5", "offset"},
		{GamesPath + "?q=" + strings.Repeat("x", 101), "q"},
	}

	for _, testCase := range cases {
		status, payload := call(t, server, http.MethodGet, testCase.path, token, nil)
		if status != http.StatusBadRequest {
			t.Errorf("GET %s = %d, want 400 (%v)", testCase.path, status, payload)
			continue
		}
		envelope, _ := payload["error"].(map[string]any)
		details, _ := envelope["details"].([]any)
		if len(details) == 0 {
			t.Errorf("GET %s has no field detail", testCase.path)
			continue
		}
		detail, _ := details[0].(map[string]any)
		if detail["field"] != testCase.field {
			t.Errorf("GET %s named field %v, want %q", testCase.path, detail["field"], testCase.field)
		}
	}

	if len(backend.calls) > 0 && backend.called("Games") {
		t.Error("a malformed filter reached the database")
	}
}

// TestCommentsDefaultToListEverything: `all` is the screen's default and means
// "no filter", which the database expresses as a null argument.
func TestCommentsDefaultToListEverything(t *testing.T) {
	// newTestServer signs tokens for staff@example.com.
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{identity: staffIdentity("moderator")}
	server, sign := newTestServer(t, backend)
	token := sign(testModerator, "moderator")

	if status, _ := call(t, server, http.MethodGet, CommentsPath+"?state=all", token, nil); status != http.StatusOK {
		t.Fatalf("comments?state=all = %d, want 200", status)
	}
	if got := backend.lastArgs[0]; got != "" {
		t.Errorf("state passed to the database = %q, want empty for all", got)
	}
}

// TestSystemServicesReportsNoMetrics: the platform's service list is real; the
// health of those services is not measured, and nothing pretends otherwise.
func TestSystemServicesReportsNoMetrics(t *testing.T) {
	// newTestServer signs tokens for staff@example.com.
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{identity: staffIdentity("moderator")}
	server, sign := newTestServer(t, backend)

	status, payload := call(t, server, http.MethodGet, SystemServicesPath, sign(testModerator, "moderator"), nil)
	if status != http.StatusOK {
		t.Fatalf("system services = %d, want 200 (%v)", status, payload)
	}
	if payload["measured"] != false {
		t.Errorf("measured = %v, want false", payload["measured"])
	}
	items, _ := payload["items"].([]any)
	if len(items) != 3 {
		t.Fatalf("items = %d, want the platform's three services", len(items))
	}
	for _, item := range items {
		entry, _ := item.(map[string]any)
		if entry["status"] != "unmeasured" {
			t.Errorf("service %v reports status %v, want unmeasured", entry["name"], entry["status"])
		}
		for _, forbidden := range []string{"uptime", "latency"} {
			if _, present := entry[forbidden]; present {
				t.Errorf("service %v carries a %s field", entry["name"], forbidden)
			}
		}
	}
}

// TestReadFailureIsUnavailable: a database failure is a 503 whose body carries
// no database text.
func TestReadFailureIsUnavailable(t *testing.T) {
	// newTestServer signs tokens for staff@example.com.
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{
		identity: staffIdentity("moderator"),
		readErr:  &supabaseadmin.Error{Op: "overview", Status: http.StatusInternalServerError, Code: "42P01"},
	}
	server, sign := newTestServer(t, backend)

	status, payload := call(t, server, http.MethodGet, OverviewPath, sign(testModerator, "moderator"), nil)
	if status != http.StatusServiceUnavailable {
		t.Fatalf("overview during a failure = %d, want 503", status)
	}
	envelope, _ := payload["error"].(map[string]any)
	message, _ := envelope["message"].(string)
	if strings.Contains(message, "42P01") || strings.Contains(strings.ToLower(message), "relation") {
		t.Errorf("the response leaked database detail: %q", message)
	}
}

// ── Moderation writes ───────────────────────────────────────────────────────

// TestModerationWritesReachTheDatabase: each write passes the path id and the
// body through, and answers with what changed.
func TestModerationWritesReachTheDatabase(t *testing.T) {
	published := "published"
	hidden := true
	suspended := true

	// newTestServer signs tokens for staff@example.com.
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{identity: staffIdentity("admin")}
	server, sign := newTestServer(t, backend)
	token := sign(testAdmin, "admin")

	backend.action = supabaseadmin.ActionResult{GameID: testGameID, Status: &published, Action: "publish_game"}
	status, payload := call(t, server, http.MethodPatch, "/api/v1/admin/games/"+testGameID, token,
		map[string]any{"status": "published", "reason": "Looks good"})
	if status != http.StatusOK {
		t.Fatalf("moderating a game = %d, want 200 (%v)", status, payload)
	}
	if payload["action"] != "publish_game" || payload["status"] != "published" {
		t.Errorf("game moderation answered %v", payload)
	}
	if got := backend.lastArgs; got[0] != testGameID || got[1] != "published" || got[2] != "Looks good" {
		t.Errorf("the database was called with %v", got)
	}

	backend.action = supabaseadmin.ActionResult{CommentID: testCommentID, Hidden: &hidden, Action: "hide_comment"}
	status, _ = call(t, server, http.MethodPatch, "/api/v1/admin/comments/"+testCommentID, token,
		map[string]any{"hidden": true, "reason": "Abuse"})
	if status != http.StatusOK {
		t.Fatalf("hiding a comment = %d, want 200", status)
	}

	backend.action = supabaseadmin.ActionResult{UserID: testPlayer, Suspended: &suspended, Action: "suspend_account"}
	status, _ = call(t, server, http.MethodPatch, "/api/v1/admin/users/"+testPlayer, token,
		map[string]any{"suspended": true, "reason": "Abuse"})
	if status != http.StatusOK {
		t.Fatalf("suspending an account = %d, want 200", status)
	}
}

// TestModerationRejectionsAreMapped: a change the database refuses is a 400, a
// missing row is a 404, and a refused database call is a 503 — never a 200. A
// refusal of an already-authorized caller is a deployment fault (a missing
// bridge or a refused privileged call), not a privilege answer, so it is
// reported as unavailable rather than as "not staff".
func TestModerationRejectionsAreMapped(t *testing.T) {
	// newTestServer signs tokens for staff@example.com.
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{identity: staffIdentity("admin")}
	server, sign := newTestServer(t, backend)
	token := sign(testAdmin, "admin")

	cases := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"an illegal transition", &supabaseadmin.Error{Op: "set-game-status", Status: http.StatusBadRequest, Code: "22023"}, http.StatusBadRequest, "bad_request"},
		{"a missing row", &supabaseadmin.Error{Op: "set-game-status", Status: http.StatusNotFound, Code: "P0002"}, http.StatusNotFound, "not_found"},
		{"a refused database call", &supabaseadmin.Error{Op: "set-game-status", Status: http.StatusForbidden, Code: "42501"}, http.StatusServiceUnavailable, "service_unavailable"},
		{"an outage", errors.New("connection refused"), http.StatusServiceUnavailable, "service_unavailable"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			backend.actionErr = testCase.err
			status, payload := call(t, server, http.MethodPatch, "/api/v1/admin/games/"+testGameID, token,
				map[string]any{"status": "archived", "reason": "Retired"})
			if status != testCase.status {
				t.Fatalf("status = %d, want %d (%v)", status, testCase.status, payload)
			}
			if code := errorCode(t, payload); code != testCase.code {
				t.Errorf("error code = %q, want %q", code, testCase.code)
			}
		})
	}
}

// TestModerationBodiesAreValidated: the shape of a write is checked before the
// database is asked, and the checks are the ones the contract documents.
func TestModerationBodiesAreValidated(t *testing.T) {
	// newTestServer signs tokens for staff@example.com.
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{identity: staffIdentity("admin")}
	server, sign := newTestServer(t, backend)
	token := sign(testAdmin, "admin")

	cases := []struct {
		name   string
		path   string
		body   string
		status int
	}{
		{"a malformed game id", "/api/v1/admin/games/not-a-uuid", `{"status":"published"}`, http.StatusBadRequest},
		{"an unknown game status", "/api/v1/admin/games/" + testGameID, `{"status":"live"}`, http.StatusBadRequest},
		{"a missing comment state", "/api/v1/admin/comments/" + testCommentID, `{"reason":"Abuse"}`, http.StatusBadRequest},
		{"a missing account state", "/api/v1/admin/users/" + testPlayer, `{"reason":"Abuse"}`, http.StatusBadRequest},
		{"an unknown field", "/api/v1/admin/games/" + testGameID, `{"status":"published","featured":true}`, http.StatusBadRequest},
		{"a body that is not JSON", "/api/v1/admin/games/" + testGameID, `not json`, http.StatusBadRequest},
		{"a reason that is too long", "/api/v1/admin/games/" + testGameID,
			`{"status":"archived","reason":"` + strings.Repeat("x", 501) + `"}`, http.StatusBadRequest},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			request, err := http.NewRequest(http.MethodPatch, server.URL+testCase.path, strings.NewReader(testCase.body))
			if err != nil {
				t.Fatalf("building request: %v", err)
			}
			request.Header.Set("Authorization", "Bearer "+token)
			request.Header.Set("Content-Type", "application/json")

			response, err := server.Client().Do(request)
			if err != nil {
				t.Fatalf("performing request: %v", err)
			}
			defer response.Body.Close()

			if response.StatusCode != testCase.status {
				body, _ := io.ReadAll(response.Body)
				t.Fatalf("status = %d, want %d (%s)", response.StatusCode, testCase.status, body)
			}
		})
	}

	if backend.called("SetGameStatus") || backend.called("SetCommentHidden") || backend.called("SetSuspension") {
		t.Error("a malformed request reached the database")
	}
}

// TestTokenIsForwardedToTheDatabase: the caller's own token is what the database
// sees, because that is what makes RLS and the function guards meaningful.
func TestTokenIsForwardedToTheDatabase(t *testing.T) {
	// newTestServer signs tokens for staff@example.com.
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{identity: staffIdentity("moderator")}
	server, sign := newTestServer(t, backend)
	token := sign(testModerator, "moderator")

	if status, _ := call(t, server, http.MethodGet, ReportsPath, token, nil); status != http.StatusOK {
		t.Fatalf("reports = %d, want 200", status)
	}
	if backend.lastToken != token {
		t.Errorf("the database received token %q, want the caller's own", backend.lastToken)
	}
}

func (f *fakeBackend) FeaturedGames(_ context.Context, token, actor string) ([]supabaseadmin.FeaturedGame, error) {
	f.record("FeaturedGames")
	return nil, nil
}

func (f *fakeBackend) SetFeaturedGames(_ context.Context, token, actor string, gameIDs []string) error {
	f.record("SetFeaturedGames", gameIDs...)
	f.lastActor = actor
	return nil
}

func (f *fakeBackend) PlatformSettings(_ context.Context, token, actor string) (supabaseadmin.PlatformSettings, error) {
	f.record("PlatformSettings")
	return supabaseadmin.PlatformSettings{}, nil
}

func (f *fakeBackend) SetPlatformSettings(_ context.Context, token, actor, bannerText string, commentsEnabled, messagesEnabled bool) error {
	f.record("SetPlatformSettings", bannerText)
	f.lastActor = actor
	return nil
}

func (f *fakeBackend) Broadcasts(_ context.Context, token, actor string, page supabaseadmin.Page) ([]supabaseadmin.Broadcast, error) {
	f.record("Broadcasts")
	return nil, nil
}

func (f *fakeBackend) SendBroadcast(_ context.Context, token, actor, title, body, link string) (supabaseadmin.BroadcastResult, error) {
	f.record("SendBroadcast", title, body, link)
	f.lastActor = actor
	return supabaseadmin.BroadcastResult{ID: "broadcast-1", Recipients: 3}, nil
}
