package games

import (
	"context"
	"encoding/base64"
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
	"github.com/r1jadi/unbored/services/games/internal/supabasegames"
)

const (
	publishedID = "11111111-1111-4111-8111-111111111111"
	olderID     = "22222222-2222-4222-8222-222222222222"
	oldestID    = "33333333-3333-4333-8333-333333333333"
)

const (
	// testSecret must be at least 32 characters; the verifier refuses shorter ones.
	testSecret = "test-secret-used-only-in-unit-tests-0123456789"
	// testUserID is the subject signed into every token below.
	testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f"
	// testOtherID is a second account, used to prove that no request can reach
	// it: the handlers have no parameter that could address it.
	testOtherID = "11111111-2222-4333-8444-555555555555"
)

// boardPath is the leaderboard route for the catalogue's Stack 10 record, with
// the `{slug}` placeholder filled in as a real client would.
const boardPath = "/api/v1/games/stack-10/leaderboard"

// fakeBackend stands in for the Supabase client. It is deliberately dumb: it
// returns what it was given and records the last query, so a test asserts what
// the handler *asked for* as well as what it rendered.
type fakeBackend struct {
	games       []supabasegames.Game
	categoryIDs map[string]string
	counts      []supabasegames.CategoryCount
	// stats is the play count per slug, as `game_stats` stores it. A slug that
	// is absent has no counted play, which is a zero and not a gap.
	stats   map[string]int64
	entries []supabasegames.LeaderboardEntry
	// standing is the caller's own board row, or nil when they have none.
	standing *supabasegames.Standing
	err      error
	// statErr fails the play-count read on its own, which is how a test drives
	// the case where the catalogue and the activity view disagree.
	statErr error
	// boardErr fails the ranking read on its own.
	boardErr error

	lastQuery  supabasegames.ListQuery
	boardQuery supabasegames.BoardQuery
	boardScope string
	standUser  string
	listCalls  int
	statCalls  int
	boardCalls int
	standCalls int
	// owners maps a game slug to its creator's user id. Slugs absent from the
	// map are official ownerless games, which the Following feed must exclude.
	owners map[string]string
	// followed maps an owner id to the set of follower ids following them.
	followed map[string]map[string]bool
	// lastFollowing records the FollowingQuery the handler built, so tests
	// assert the follower came from the token rather than a parameter.
	lastFollowing supabasegames.FollowingQuery

	// The all-games board: its rows, the caller's rating (nil when they have
	// none), and what the handler asked for.
	overall         []supabasegames.OverallEntry
	overallStanding *supabasegames.OverallStanding
	overallCalls    int
	overallUser     string
}

func (b *fakeBackend) ListGames(_ context.Context, query supabasegames.ListQuery) ([]supabasegames.Game, error) {
	b.listCalls++
	b.lastQuery = query
	if b.err != nil {
		return nil, b.err
	}
	// The real client always asks the Data API for one row more than the page,
	// so the fake returns the same shape.
	limit := query.Limit + 1
	if limit > len(b.games) {
		limit = len(b.games)
	}
	return b.games[:limit], nil
}

func (b *fakeBackend) FollowingGames(_ context.Context, query supabasegames.FollowingQuery) ([]supabasegames.Game, error) {
	b.listCalls++
	b.lastFollowing = query
	if b.err != nil {
		return nil, b.err
	}
	// The fake honours the follower scoping the handler promised: only games
	// whose owner the follower follows are returned. Ownership lives in the
	// owners map (slug → owner id); games without an entry are official and
	// never match any follower.
	out := make([]supabasegames.Game, 0, len(b.games))
	for _, game := range b.games {
		owner, ok := b.owners[game.Slug]
		if !ok || owner == "" {
			continue
		}
		if followers, ok := b.followed[owner]; !ok || !followers[query.FollowerID] {
			continue
		}
		// Honour the keyset cursor exactly as the SQL does: strictly older
		// publication time, or the same stamp with a lower id.
		if query.HasAfter && game.PublishedAt != nil {
			after := query.AfterPublishedAt
			switch {
			case game.PublishedAt.After(after):
				continue
			case game.PublishedAt.Equal(after) && game.ID >= query.AfterID:
				continue
			}
		}
		out = append(out, game)
	}
	limit := query.Limit + 1
	if limit > len(out) {
		limit = len(out)
	}
	return out[:limit], nil
}

func (b *fakeBackend) GetGame(_ context.Context, slug string) (supabasegames.Game, bool, error) {
	if b.err != nil {
		return supabasegames.Game{}, false, b.err
	}
	for _, game := range b.games {
		if game.Slug == slug {
			return game, true, nil
		}
	}
	return supabasegames.Game{}, false, nil
}

func (b *fakeBackend) CategoryID(_ context.Context, slug string) (string, bool, error) {
	if b.err != nil {
		return "", false, b.err
	}
	id, ok := b.categoryIDs[slug]
	return id, ok, nil
}

func (b *fakeBackend) CategoryCounts(_ context.Context) ([]supabasegames.CategoryCount, error) {
	if b.err != nil {
		return nil, b.err
	}
	return b.counts, nil
}

func (b *fakeBackend) GameStats(_ context.Context) (map[string]supabasegames.PlayStat, error) {
	b.statCalls++
	if b.err != nil {
		return nil, b.err
	}
	if b.statErr != nil {
		return nil, b.statErr
	}
	stats := make(map[string]supabasegames.PlayStat, len(b.stats))
	for slug, plays := range b.stats {
		stats[slug] = supabasegames.PlayStat{Slug: slug, Plays: plays}
	}
	return stats, nil
}

func (b *fakeBackend) GameStat(_ context.Context, slug string) (supabasegames.PlayStat, bool, error) {
	b.statCalls++
	if b.err != nil {
		return supabasegames.PlayStat{}, false, b.err
	}
	if b.statErr != nil {
		return supabasegames.PlayStat{}, false, b.statErr
	}
	plays, ok := b.stats[slug]
	return supabasegames.PlayStat{Slug: slug, Plays: plays}, ok, nil
}

func (b *fakeBackend) Leaderboard(_ context.Context, _ string, query supabasegames.BoardQuery) ([]supabasegames.LeaderboardEntry, error) {
	b.boardCalls++
	b.boardQuery = query
	if b.err != nil {
		return nil, b.err
	}
	if b.boardErr != nil {
		return nil, b.boardErr
	}
	// Like the real client, it answers with one row more than the page.
	limit := min(query.Limit+1, len(b.entries))
	return b.entries[:limit], nil
}

func (b *fakeBackend) Standing(_ context.Context, _ string, userID string, query supabasegames.BoardQuery) (supabasegames.Standing, bool, error) {
	b.standCalls++
	b.standUser = userID
	b.boardQuery = query
	if b.err != nil {
		return supabasegames.Standing{}, false, b.err
	}
	if b.boardErr != nil {
		return supabasegames.Standing{}, false, b.boardErr
	}
	if b.standing == nil {
		return supabasegames.Standing{}, false, nil
	}
	return *b.standing, true, nil
}

func testGame(id, slug, title string, publishedAt time.Time) supabasegames.Game {
	stamp := publishedAt.UTC()
	tagline := "Make every column add up to ten."
	return supabasegames.Game{
		ID:          id,
		Slug:        slug,
		Title:       title,
		Tagline:     &tagline,
		IsOfficial:  true,
		PublishedAt: &stamp,
		UpdatedAt:   stamp,
		Category:    &supabasegames.Category{Slug: "puzzle", Name: "Puzzle"},
	}
}

func testBackend() *fakeBackend {
	base := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	return &fakeBackend{
		games: []supabasegames.Game{
			testGame(publishedID, "one-move", "One Move", base),
			testGame(olderID, "memory-flash", "Memory Flash", base.Add(-48*time.Hour)),
			testGame(oldestID, "stack-10", "Stack 10", base.Add(-96*time.Hour)),
		},
		categoryIDs: map[string]string{"puzzle": "aaaaaaaa-0000-4000-8000-000000000001"},
		counts: []supabasegames.CategoryCount{
			{Slug: "puzzle", Name: "Puzzle", GameCount: 2},
			{Slug: "word", Name: "Word", GameCount: 0},
		},
	}
}

// router serves the public catalogue exactly as production does, including
// Go's method+pattern routing (which is what makes `{slug}` resolvable).
func testServer(t *testing.T, backend Backend) *httptest.Server {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	router := httpx.NewRouter(httpx.RouterOptions{Config: &config.Config{}, Logger: logger})
	newService(backend, logger).register(router)

	server := httptest.NewServer(router.Mux())
	t.Cleanup(server.Close)
	return server
}

// testServerWithAuth serves the same routes with a real token verifier — the
// difference that turns the optional-auth leaderboard into a personalised
// response. It returns the server and a function that signs a token for a
// subject, so a test can be a specific signed-in player.
func testServerWithAuth(t *testing.T, backend Backend) (*httptest.Server, func(subject string) string) {
	t.Helper()
	t.Setenv("SUPABASE_JWT_SECRET", testSecret)
	t.Setenv("SUPABASE_JWT_AUDIENCE", "authenticated")

	cfg, err := config.Load("games-test")
	if err != nil {
		t.Fatalf("loading test configuration: %v", err)
	}
	verifier, err := authn.NewVerifier(cfg)
	if err != nil {
		t.Fatalf("building verifier: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	router := httpx.NewRouter(httpx.RouterOptions{Config: cfg, Verifier: verifier, Logger: logger})
	newService(backend, logger).register(router)

	server := httptest.NewServer(router.Mux())
	t.Cleanup(server.Close)

	sign := func(subject string) string {
		t.Helper()
		claims := jwt.MapClaims{
			"sub":          subject,
			"email":        "player@example.com",
			"aud":          "authenticated",
			"iat":          time.Now().Add(-time.Minute).Unix(),
			"exp":          time.Now().Add(time.Hour).Unix(),
			"role":         "authenticated",
			"app_metadata": map[string]any{"role": "user"},
		}
		signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
		if err != nil {
			t.Fatalf("signing test token: %v", err)
		}
		return signed
	}

	return server, sign
}

// getWithToken performs a request as a signed-in caller.
func getWithToken(t *testing.T, server *httptest.Server, path, token string) (int, map[string]any) {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, server.URL+path, nil)
	if err != nil {
		t.Fatalf("building request for %s: %v", path, err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("decoding %s body %q: %v", path, raw, err)
	}
	return response.StatusCode, body
}

// get performs a request and returns the status plus the decoded body.
func get(t *testing.T, server *httptest.Server, path string) (int, map[string]any) {
	t.Helper()
	response, err := http.Get(server.URL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("decoding %s body %q: %v", path, raw, err)
	}
	return response.StatusCode, body
}

func itemsOf(t *testing.T, body map[string]any) []any {
	t.Helper()
	items, ok := body["items"].([]any)
	if !ok {
		t.Fatalf("body has no items array: %#v", body)
	}
	return items
}

func entriesOf(t *testing.T, body map[string]any) []any {
	t.Helper()
	entries, ok := body["entries"].([]any)
	if !ok {
		t.Fatalf("body has no entries array: %#v", body)
	}
	return entries
}

// ── Listing ─────────────────────────────────────────────────────────────────

func TestListGamesReturnsAPageAndACursor(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	status, body := get(t, server, GamesPath+"?limit=2")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	items := itemsOf(t, body)
	if len(items) != 2 {
		t.Fatalf("items = %d, want 2", len(items))
	}
	first, _ := items[0].(map[string]any)
	if first["slug"] != "one-move" {
		t.Fatalf("first slug = %v, want the newest game", first["slug"])
	}
	// The handler must ask the client for one row more than the page, which is
	// the only way it can know a further page exists without a COUNT.
	if backend.lastQuery.Limit != 2 {
		t.Fatalf("limit requested = %d, want 2", backend.lastQuery.Limit)
	}
	if backend.lastQuery.Search != "" || backend.lastQuery.CategoryID != "" {
		t.Fatalf("an unfiltered listing must send no filter, got %+v", backend.lastQuery)
	}

	cursor, _ := body["nextCursor"].(string)
	if cursor == "" {
		t.Fatal("nextCursor is empty, want a cursor for the second page")
	}

	// The cursor must be the last row of the page that was just served, so the
	// next request resumes after it rather than repeating it.
	status, second := get(t, server, GamesPath+"?limit=2&cursor="+cursor)
	if status != http.StatusOK {
		t.Fatalf("second page status = %d, want 200", status)
	}
	if !backend.lastQuery.HasAfter {
		t.Fatal("the cursor was not applied to the query")
	}
	if backend.lastQuery.AfterID != olderID {
		t.Fatalf("cursor id = %q, want the last row of the first page (%q)", backend.lastQuery.AfterID, olderID)
	}
	if !backend.lastQuery.AfterPublishedAt.Equal(backend.games[1].PublishedAt.UTC()) {
		t.Fatalf("cursor timestamp = %v, want %v", backend.lastQuery.AfterPublishedAt, backend.games[1].PublishedAt)
	}
	if len(itemsOf(t, second)) != 2 {
		t.Fatalf("second page items = %d, want 2", len(itemsOf(t, second)))
	}
}

func TestListGamesLastPageHasNoCursor(t *testing.T) {
	server := testServer(t, testBackend())

	status, body := get(t, server, GamesPath)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if len(itemsOf(t, body)) != 3 {
		t.Fatalf("items = %d, want 3", len(itemsOf(t, body)))
	}
	if body["nextCursor"] != nil {
		t.Fatalf("nextCursor = %v, want null on the last page", body["nextCursor"])
	}
}

func TestListGamesEmptyCatalogueIsAnEmptyPage(t *testing.T) {
	backend := testBackend()
	backend.games = nil
	server := testServer(t, backend)

	status, body := get(t, server, GamesPath)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if items := itemsOf(t, body); len(items) != 0 {
		t.Fatalf("items = %d, want 0", len(items))
	}
	if body["nextCursor"] != nil {
		t.Fatalf("nextCursor = %v, want null", body["nextCursor"])
	}
}

func TestListGamesUnknownCategoryIsAnEmptyPageNotAnError(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	status, body := get(t, server, GamesPath+"?category=strategy")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 — a well-formed slug that names nothing is a valid question", status)
	}
	if items := itemsOf(t, body); len(items) != 0 {
		t.Fatalf("items = %d, want 0", len(items))
	}
	// The listing must not run at all: there is no id to filter by, and running
	// it would return the whole catalogue under a category URL.
	if backend.listCalls != 0 {
		t.Fatalf("the listing ran %d times for an unknown category, want 0", backend.listCalls)
	}
}

func TestListGamesFiltersByCategory(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	status, _ := get(t, server, GamesPath+"?category=puzzle&limit=5")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if backend.lastQuery.CategoryID != backend.categoryIDs["puzzle"] {
		t.Fatalf("category filter = %q, want the resolved id", backend.lastQuery.CategoryID)
	}
}

func TestListGamesSanitisesTheSearchTerm(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	status, _ := get(t, server, GamesPath+"?q=stack%2C10)%2A")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if backend.lastQuery.Search != "stack10" {
		t.Fatalf("search term = %q, want the filter grammar stripped", backend.lastQuery.Search)
	}
}

func TestListGamesRejectsInvalidParameters(t *testing.T) {
	tests := map[string]string{
		"limit below range":    GamesPath + "?limit=0",
		"limit above range":    GamesPath + "?limit=101",
		"limit not a number":   GamesPath + "?limit=lots",
		"negative limit":       GamesPath + "?limit=-3",
		"unsupported sort":     GamesPath + "?sort=trending",
		"popular sort":         GamesPath + "?sort=popular",
		"malformed category":   GamesPath + "?category=Puzzle",
		"too short category":   GamesPath + "?category=p",
		"search with no words": GamesPath + "?q=***",
		"cursor is not base64": GamesPath + "?cursor=not-a-cursor",
		"cursor of the wrong version": GamesPath + "?cursor=" +
			base64.RawURLEncoding.EncodeToString([]byte("v9|2026-01-01T00:00:00Z|"+publishedID)),
		"cursor with a bad id": GamesPath + "?cursor=" +
			base64.RawURLEncoding.EncodeToString([]byte("v1|2026-01-01T00:00:00Z|not-a-uuid")),
		"cursor with a bad date": GamesPath + "?cursor=" +
			base64.RawURLEncoding.EncodeToString([]byte("v1|yesterday|"+publishedID)),
	}

	for name, path := range tests {
		t.Run(name, func(t *testing.T) {
			server := testServer(t, testBackend())
			status, body := get(t, server, path)
			if status != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", status)
			}
			failure, _ := body["error"].(map[string]any)
			if failure["code"] != "bad_request" {
				t.Fatalf("code = %v, want bad_request", failure["code"])
			}
			details, _ := failure["details"].([]any)
			if len(details) == 0 {
				t.Fatal("the failure names no field, so a client cannot tell which parameter was wrong")
			}
		})
	}
}

func TestUnsupportedSortIsRefusedAndExplainsWhy(t *testing.T) {
	server := testServer(t, testBackend())

	_, body := get(t, server, GamesPath+"?sort=popular")
	failure, _ := body["error"].(map[string]any)
	message, _ := failure["message"].(string)
	// The refusal has to say that the ranking is missing rather than pretend the
	// value is a typo: nothing in this project can compute popularity yet.
	if !strings.Contains(message, "play data") {
		t.Fatalf("message = %q, want it to explain that popularity needs play data", message)
	}
}

// ── Detail ──────────────────────────────────────────────────────────────────

func TestGetGameReturnsThePublishedRecord(t *testing.T) {
	server := testServer(t, testBackend())

	status, body := get(t, server, GamesPath+"/stack-10")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if body["slug"] != "stack-10" || body["title"] != "Stack 10" {
		t.Fatalf("body = %#v, want the stack-10 record", body)
	}
	category, _ := body["category"].(map[string]any)
	if category["slug"] != "puzzle" {
		t.Fatalf("category = %#v, want puzzle", category)
	}
	// The embedded reference is a link target, not a category listing: it may not
	// carry a count, because a game response does not count anything.
	if len(category) != 2 {
		t.Fatalf("embedded category = %#v, want only slug and name", category)
	}
	if _, ok := category["gameCount"]; ok {
		t.Fatalf("embedded category carries a count: %#v", category)
	}
}

func TestGetGameAnswers404ForAnUnknownSlug(t *testing.T) {
	server := testServer(t, testBackend())

	status, body := get(t, server, GamesPath+"/never-made")
	if status != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", status)
	}
	failure, _ := body["error"].(map[string]any)
	if failure["code"] != "not_found" {
		t.Fatalf("code = %v, want not_found", failure["code"])
	}
}

func TestGetGameRejectsAMalformedSlug(t *testing.T) {
	for _, slug := range []string{"Stack-10", "a", strings.Repeat("x", 60)} {
		t.Run(slug, func(t *testing.T) {
			server := testServer(t, testBackend())
			status, body := get(t, server, GamesPath+"/"+slug)
			if status != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 for %q", status, slug)
			}
			failure, _ := body["error"].(map[string]any)
			if failure["code"] != "bad_request" {
				t.Fatalf("code = %v, want bad_request", failure["code"])
			}
		})
	}
}

// TestGameResponseCarriesNoFabricatedMetrics is the guard the whole phase turns
// on. Every field in a game response has to be something the service actually
// measured: `plays` is a real count of completed runs, while likes, comments,
// saves, ratings, average session time and rankings remain inventions no service
// records. The field set is asserted exactly, which also means a new field has to
// be a deliberate decision rather than a side effect of adding a database column.
func TestGameResponseCarriesNoFabricatedMetrics(t *testing.T) {
	backend := testBackend()
	backend.stats = map[string]int64{"stack-10": 12}
	server := testServer(t, backend)

	_, body := get(t, server, GamesPath+"/stack-10")
	want := map[string]bool{
		"slug": true, "title": true, "tagline": true, "description": true,
		"instructions": true, "category": true, "runtime": true, "playable": true,
		"plays": true, "isOfficial": true, "coverPath": true, "publishedAt": true,
		"updatedAt": true,
	}
	// The one metric that is present is the one that was measured, and it is the
	// number the database counted.
	if body["plays"] != float64(12) {
		t.Errorf("plays = %v, want the 12 completed runs the activity view counted", body["plays"])
	}
	for key := range body {
		if !want[key] {
			t.Errorf("unexpected field %q in a game response", key)
		}
	}
	for key := range want {
		if _, ok := body[key]; !ok {
			t.Errorf("missing field %q in a game response", key)
		}
	}

	// A game with no runtime must say so rather than imply it can be played.
	if body["playable"] != false {
		t.Errorf("playable = %v, want false while no runtime exists", body["playable"])
	}
	if body["runtime"] != nil {
		t.Errorf("runtime = %v, want null while no runtime exists", body["runtime"])
	}
}

// ── Categories ──────────────────────────────────────────────────────────────

func TestCategoriesReturnRealCounts(t *testing.T) {
	server := testServer(t, testBackend())

	status, body := get(t, server, CategoriesPath)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	items := itemsOf(t, body)
	if len(items) != 2 {
		t.Fatalf("items = %d, want 2", len(items))
	}
	first, _ := items[0].(map[string]any)
	if first["slug"] != "puzzle" || first["gameCount"] != float64(2) {
		t.Fatalf("first category = %#v, want puzzle with a real count", first)
	}
	// A category with no published game is present with a zero, which is an
	// answer: the category exists and holds nothing yet.
	second, _ := items[1].(map[string]any)
	if second["gameCount"] != float64(0) {
		t.Fatalf("second category count = %v, want 0", second["gameCount"])
	}
}

// ── Failure modes ───────────────────────────────────────────────────────────

func TestRoutesWithoutConfigurationAnswer503(t *testing.T) {
	server := testServer(t, nil)

	for _, path := range []string{GamesPath, GamesPath + "/stack-10", CategoriesPath, boardPath} {
		t.Run(path, func(t *testing.T) {
			status, body := get(t, server, path)
			if status != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want 503", status)
			}
			failure, _ := body["error"].(map[string]any)
			if failure["code"] != "service_unavailable" {
				t.Fatalf("code = %v, want service_unavailable", failure["code"])
			}
			// The message must not name an environment variable or carry a value.
			message, _ := failure["message"].(string)
			if strings.Contains(message, "SUPABASE") {
				t.Fatalf("message %q names configuration", message)
			}
		})
	}
}

func TestUpstreamFailureIsUnavailableWithoutLeaking(t *testing.T) {
	backend := testBackend()
	backend.err = &supabasegames.Error{Op: "list-games", Status: 500, Code: "XX000"}

	server := testServer(t, backend)
	status, body := get(t, server, GamesPath)
	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", status)
	}
	failure, _ := body["error"].(map[string]any)
	message, _ := failure["message"].(string)
	for _, leaked := range []string{"list-games", "XX000", "supabase", "500"} {
		if strings.Contains(message, leaked) {
			t.Fatalf("message %q leaked upstream detail %q", message, leaked)
		}
	}
}

func TestNotConfiguredDoesNotLeakConfiguration(t *testing.T) {
	// A nil backend is the "no Supabase credentials" deployment: the routes must
	// still answer, and refuse, in a language a user can act on.
	server := testServer(t, nil)
	_, body := get(t, server, GamesPath)
	failure, _ := body["error"].(map[string]any)
	if failure["message"] != "The game catalogue is not available right now." {
		t.Fatalf("message = %v", failure["message"])
	}
}

// ── Cursor round-trip ───────────────────────────────────────────────────────

func TestCursorRoundTripsTheSortKey(t *testing.T) {
	stamp := time.Date(2026, 9, 16, 12, 0, 0, 123456000, time.UTC)
	game := supabasegames.Game{ID: publishedID, PublishedAt: &stamp}

	cursor := nextCursor(game)
	if cursor == "" {
		t.Fatal("nextCursor returned an empty cursor for a published game")
	}
	after, id, err := decodeCursor(cursor)
	if err != nil {
		t.Fatalf("decodeCursor: %v", err)
	}
	if !after.Equal(stamp) {
		t.Fatalf("decoded timestamp = %v, want %v", after, stamp)
	}
	if id != publishedID {
		t.Fatalf("decoded id = %q, want %q", id, publishedID)
	}
	// The cursor is opaque, not structured JSON a client could build itself.
	if cursor == "" || strings.ContainsAny(cursor, "|\"'") {
		t.Fatalf("cursor %q must be opaque", cursor)
	}
}

func TestCursorIsNotEmittedForAGameWithNoPublicationTimestamp(t *testing.T) {
	if cursor := nextCursor(supabasegames.Game{ID: publishedID}); cursor != "" {
		t.Fatalf("cursor = %q, want none: a row with no timestamp cannot be resumed from", cursor)
	}
}

func TestParseListQueryDefaults(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, GamesPath, nil)
	query, err := parseListQuery(request)
	if err != nil {
		t.Fatalf("parseListQuery: %v", err)
	}
	if query.Limit != defaultPageLimit {
		t.Fatalf("limit = %d, want the documented default %d", query.Limit, defaultPageLimit)
	}
	if query.HasAfter || query.Search != "" || query.CategorySlug != "" {
		t.Fatalf("an empty query must apply no filter, got %+v", query)
	}
}

func TestParseListQueryAcceptsASupportedSort(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, GamesPath+"?sort="+supportedSort, nil)
	if _, err := parseListQuery(request); err != nil {
		t.Fatalf("the documented sort value must be accepted: %v", err)
	}
}

func TestSearchTermRejectsOnlyStructuralCharacters(t *testing.T) {
	term, ok := supabasegames.SearchTerm("  Colour, Merge!  ")
	if !ok || term != "Colour Merge!" {
		t.Fatalf("SearchTerm = %q, %v; want the punctuation a user can type preserved", term, ok)
	}
	if _, ok := supabasegames.SearchTerm(" \t\n "); ok {
		t.Fatal("a term of only whitespace must report no searchable content")
	}
}

// guardedBackend counts how often the listing is reached, so a test can assert
// that a rejected request never touched the database.
type guardedBackend struct {
	fakeBackend
	calls int
}

func (b *guardedBackend) ListGames(_ context.Context, _ supabasegames.ListQuery) ([]supabasegames.Game, error) {
	b.calls++
	return nil, nil
}

func TestInvalidParametersNeverReachTheDatabase(t *testing.T) {
	backend := &guardedBackend{}
	server := testServer(t, backend)

	status, _ := get(t, server, GamesPath+"?limit=1000")
	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", status)
	}
	if backend.calls != 0 {
		t.Fatalf("the listing ran %d times for a rejected request, want 0", backend.calls)
	}
}

// ── Play counts ─────────────────────────────────────────────────────────────

func TestListGamesCarriesRealPlayCounts(t *testing.T) {
	backend := testBackend()
	backend.stats = map[string]int64{"stack-10": 41}
	server := testServer(t, backend)

	status, body := get(t, server, GamesPath+"?limit=3")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	items := itemsOf(t, body)
	if len(items) != 3 {
		t.Fatalf("items = %d, want 3", len(items))
	}
	third, _ := items[2].(map[string]any)
	if third["slug"] != "stack-10" || third["plays"] != float64(41) {
		t.Fatalf("stack-10 = %#v, want its real 41 completed runs", third)
	}
	// A game nobody has finished reports zero, which is a measurement rather
	// than a missing value.
	first, _ := items[0].(map[string]any)
	if first["plays"] != float64(0) {
		t.Fatalf("one-move plays = %v, want 0", first["plays"])
	}
	// One read for the page, not one per row.
	if backend.statCalls != 1 {
		t.Fatalf("play counts were read %d times for one page, want 1", backend.statCalls)
	}
}

func TestUnreadablePlayCountsFailTheListing(t *testing.T) {
	// An absent count and a count of zero render identically on screen, so a
	// listing whose counts cannot be read fails instead of claiming zero.
	backend := testBackend()
	backend.statErr = errors.New("activity view is not readable")
	server := testServer(t, backend)

	status, body := get(t, server, GamesPath)
	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", status)
	}
	failure, _ := body["error"].(map[string]any)
	if failure["code"] != "service_unavailable" {
		t.Fatalf("code = %v, want service_unavailable", failure["code"])
	}
}

func TestGetGameCarriesItsRealPlayCount(t *testing.T) {
	backend := testBackend()
	backend.stats = map[string]int64{"stack-10": 7}
	server := testServer(t, backend)

	status, body := get(t, server, GamesPath+"/stack-10")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if body["plays"] != float64(7) {
		t.Fatalf("plays = %v, want 7", body["plays"])
	}
}

// ── Leaderboard ─────────────────────────────────────────────────────────────

// testBoard is a ranking of three players.
func testBoard() []supabasegames.LeaderboardEntry {
	achieved := time.Date(2026, 10, 12, 9, 30, 0, 0, time.UTC)
	return []supabasegames.LeaderboardEntry{
		{Rank: 1, Username: "rija", Score: 120, AchievedAt: &achieved, Plays: 3},
		{Rank: 2, Username: "sam", Score: 95, AchievedAt: &achieved, Plays: 1},
		{Rank: 3, Username: "kim", Score: 90, AchievedAt: &achieved, Plays: 2},
	}
}

func TestLeaderboardReturnsPersistedRanking(t *testing.T) {
	backend := testBackend()
	backend.entries = testBoard()
	server := testServer(t, backend)

	status, body := get(t, server, boardPath)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if body["gameSlug"] != "stack-10" || body["scope"] != "global" || body["period"] != "all" {
		t.Fatalf("body = %#v, want the stack-10 global all-time board", body)
	}
	if body["hasMore"] != false {
		t.Fatalf("hasMore = %v, want false on the last page", body["hasMore"])
	}
	if body["me"] != nil {
		t.Fatalf("me = %v, want null for an anonymous caller", body["me"])
	}
	items := entriesOf(t, body)
	if len(items) != 3 {
		t.Fatalf("entries = %d, want 3", len(items))
	}
	first, _ := items[0].(map[string]any)
	if first["rank"] != float64(1) || first["username"] != "rija" || first["score"] != float64(120) {
		t.Fatalf("first entry = %#v, want rank 1 with the real score", first)
	}
	if first["plays"] != float64(3) {
		t.Fatalf("first entry plays = %v, want the player's real 3 scored runs", first["plays"])
	}
	if _, ok := first["userId"]; ok {
		t.Fatalf("an entry exposes a user id: %#v", first)
	}
}

func TestLeaderboardReportsAnotherPage(t *testing.T) {
	backend := testBackend()
	backend.entries = testBoard()
	server := testServer(t, backend)

	_, body := get(t, server, boardPath+"?limit=2")
	if len(entriesOf(t, body)) != 2 {
		t.Fatalf("entries = %d, want the requested 2", len(entriesOf(t, body)))
	}
	if body["hasMore"] != true {
		t.Fatalf("hasMore = %v, want true when a further row exists", body["hasMore"])
	}
	// The board is read with the page size the caller asked for and the offset
	// they asked for, so paging is real rather than re-read from the top.
	if backend.boardQuery.Limit != 2 || backend.boardQuery.Offset != 0 {
		t.Fatalf("board query = %+v, want limit 2 from the start", backend.boardQuery)
	}
}

func TestLeaderboardPagingIsValidatedBeforeTheDatabase(t *testing.T) {
	cases := []struct {
		name string
		path string
		rule string
	}{
		{"zero limit", boardPath + "?limit=0", "limit"},
		{"over-long page", boardPath + "?limit=101", "limit"},
		{"negative offset", boardPath + "?offset=-1", "offset"},
		{"absurd offset", boardPath + "?offset=100000", "offset"},
		{"unknown period", boardPath + "?period=month", "period"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			backend := testBackend()
			server := testServer(t, backend)

			status, body := get(t, server, testCase.path)
			if status != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", status)
			}
			failure, _ := body["error"].(map[string]any)
			details, _ := failure["details"].([]any)
			if len(details) == 0 {
				t.Fatalf("no field was named: %#v", failure)
			}
			detail, _ := details[0].(map[string]any)
			if detail["field"] != testCase.rule {
				t.Fatalf("field = %v, want %s", detail["field"], testCase.rule)
			}
			if backend.boardCalls != 0 {
				t.Fatalf("the ranking was read %d times for a rejected request, want 0", backend.boardCalls)
			}
		})
	}
}

func TestFriendBoardIsRefusedWithAReason(t *testing.T) {
	// `friends` is a real scope that cannot be computed yet: refusing it with an
	// explanation is the difference between an unimplemented feature and a typo.
	server := testServer(t, testBackend())

	status, body := get(t, server, boardPath+"?scope=friends")
	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", status)
	}
	failure, _ := body["error"].(map[string]any)
	message, _ := failure["message"].(string)
	if !strings.Contains(message, "global") {
		t.Fatalf("message %q does not tell the caller what is available", message)
	}
}

func TestBoardWindowsBecomeASinceBoundary(t *testing.T) {
	for _, testCase := range []struct {
		period string
		window time.Duration
	}{
		{periodDay, 24 * time.Hour},
		{periodWeek, 7 * 24 * time.Hour},
	} {
		t.Run(testCase.period, func(t *testing.T) {
			backend := testBackend()
			server := testServer(t, backend)

			get(t, server, boardPath+"?period="+testCase.period)

			if !backend.boardQuery.HasSince {
				t.Fatal("a windowed board must bound the scores it reads")
			}
			want := time.Now().UTC().Add(-testCase.window)
			if delta := backend.boardQuery.Since.Sub(want); delta > time.Minute || delta < -time.Minute {
				t.Fatalf("since = %v, want about %v", backend.boardQuery.Since, want)
			}
		})
	}

	// The default board is all-time: no boundary at all, not a zero timestamp.
	backend := testBackend()
	server := testServer(t, backend)
	get(t, server, boardPath)
	if backend.boardQuery.HasSince {
		t.Fatalf("the default board bounded its window from %v", backend.boardQuery.Since)
	}
}

func TestLeaderboardOfAnUnknownGameIsNotFound(t *testing.T) {
	server := testServer(t, testBackend())

	status, body := get(t, server, "/api/v1/games/never-made/leaderboard")
	if status != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", status)
	}
	failure, _ := body["error"].(map[string]any)
	if failure["code"] != "not_found" {
		t.Fatalf("code = %v, want not_found", failure["code"])
	}
}

func TestLeaderboardRejectsAMalformedSlug(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	status, _ := get(t, server, "/api/v1/games/Stack-10/leaderboard")
	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", status)
	}
	if backend.boardCalls != 0 {
		t.Fatalf("the ranking was read for a malformed slug")
	}
}

func TestLeaderboardIncludesTheCallersOwnStanding(t *testing.T) {
	backend := testBackend()
	backend.entries = testBoard()
	achieved := time.Date(2026, 10, 12, 8, 0, 0, 0, time.UTC)
	backend.standing = &supabasegames.Standing{Rank: 4, Score: 88, AchievedAt: &achieved, Plays: 2}
	server, sign := testServerWithAuth(t, backend)

	// The query string names somebody else entirely. It must make no difference:
	// identity comes from the verified token and from nowhere else.
	status, body := getWithToken(t, server, boardPath+"?userId="+testOtherID, sign(testUserID))
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	me, ok := body["me"].(map[string]any)
	if !ok {
		t.Fatalf("me = %v, want the caller's own standing", body["me"])
	}
	if me["rank"] != float64(4) || me["score"] != float64(88) || me["plays"] != float64(2) {
		t.Fatalf("me = %#v, want the persisted standing", me)
	}
	if backend.standUser != testUserID {
		t.Fatalf("the standing was read for %q, want the token's subject", backend.standUser)
	}
}

func TestLeaderboardDoesNotInventAStanding(t *testing.T) {
	// No scored run in this window: the answer is no rank at all, not rank zero
	// and not a zero score.
	backend := testBackend()
	backend.entries = testBoard()
	server, sign := testServerWithAuth(t, backend)

	status, body := getWithToken(t, server, boardPath, sign(testUserID))
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if body["me"] != nil {
		t.Fatalf("me = %v, want null for a player with no scored run", body["me"])
	}
	if backend.standCalls != 1 {
		t.Fatalf("the standing was read %d times, want 1", backend.standCalls)
	}
}

func TestAnonymousBoardDoesNotLookUpAStanding(t *testing.T) {
	// The deployment has no auth material at all here, which is the same shape as
	// a visitor with no token: the board is public and nothing is personalised.
	backend := testBackend()
	backend.entries = testBoard()
	server := testServer(t, backend)

	status, body := get(t, server, boardPath)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if body["me"] != nil {
		t.Fatalf("me = %v, want null", body["me"])
	}
	if backend.standCalls != 0 {
		t.Fatalf("a standing was read for an anonymous caller")
	}
}

func TestUnreadableRankingIsUnavailableWithoutLeaking(t *testing.T) {
	backend := testBackend()
	backend.boardErr = errors.New("game_leaderboard is not executable")
	server := testServer(t, backend)

	status, body := get(t, server, boardPath)
	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", status)
	}
	message, _ := body["error"].(map[string]any)["message"].(string)
	for _, leaked := range []string{"game_leaderboard", "executable", "42501"} {
		if strings.Contains(message, leaked) {
			t.Fatalf("message %q leaked upstream detail %q", message, leaked)
		}
	}
}

// ── Following feed ──────────────────────────────────────────────────────────

const followingPath = "/api/v1/games/following"

func followingBackend() *fakeBackend {
	backend := testBackend()
	base := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	creatorA := "aaaaaaaa-1111-4111-8111-111111111111"
	creatorB := "bbbbbbbb-2222-4222-8222-222222222222"
	stranger := "cccccccc-3333-4333-8333-333333333333"
	backend.games = []supabasegames.Game{
		testGame(publishedID, "one-move", "One Move", base),
		testGame(olderID, "creator-hit", "Creator Hit", base.Add(-48*time.Hour)),
		testGame(oldestID, "stranger-hit", "Stranger Hit", base.Add(-96*time.Hour)),
	}
	backend.owners = map[string]string{
		"one-move":     creatorA,
		"creator-hit":  creatorB,
		"stranger-hit": stranger,
	}
	backend.followed = map[string]map[string]bool{
		creatorA: {testUserID: true},
		creatorB: {testUserID: true},
	}
	backend.stats = map[string]int64{"one-move": 3, "creator-hit": 1, "stranger-hit": 9}
	return backend
}

func slugs(t *testing.T, body map[string]any) []string {
	t.Helper()
	raw, ok := body["items"].([]any)
	if !ok {
		t.Fatalf("items = %v, want a list", body["items"])
	}
	out := make([]string, 0, len(raw))
	for _, entry := range raw {
		item, ok := entry.(map[string]any)
		if !ok {
			t.Fatalf("item = %v, want an object", entry)
		}
		slug, _ := item["slug"].(string)
		out = append(out, slug)
	}
	return out
}

func TestFollowingFeedNeedsASession(t *testing.T) {
	backend := followingBackend()
	server, _ := testServerWithAuth(t, backend)

	response, err := http.Get(server.URL + followingPath)
	if err != nil {
		t.Fatalf("GET %s: %v", followingPath, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 for an anonymous caller", response.StatusCode)
	}
	if backend.listCalls != 0 {
		t.Fatal("the database was read for an anonymous caller")
	}
}

func TestFollowingFeedIsScopedToTheToken(t *testing.T) {
	backend := followingBackend()
	server, sign := testServerWithAuth(t, backend)

	// A caller-supplied identity parameter must make no difference: the feed
	// belongs to the token's subject.
	status, body := getWithToken(t, server, followingPath+"?userId="+testOtherID+"&followerId="+testOtherID, sign(testUserID))
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	got := slugs(t, body)
	for _, slug := range got {
		if slug == "stranger-hit" {
			t.Fatalf("feed = %v, want no games from unfollowed creators", got)
		}
	}
	if len(got) != 2 {
		t.Fatalf("feed = %v, want the two followed creators' games", got)
	}
	if backend.lastFollowing.FollowerID != testUserID {
		t.Fatalf("follower = %q, want the token's subject", backend.lastFollowing.FollowerID)
	}
}

func TestFollowingFeedExcludesUnrelatedAndOfficialGames(t *testing.T) {
	backend := followingBackend()
	// An official ownerless game must never appear, even though it is published.
	official := testGame("44444444-4444-4444-8444-444444444444", "official-pick", "Official Pick", time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC))
	backend.games = append([]supabasegames.Game{official}, backend.games...)
	server, sign := testServerWithAuth(t, backend)

	status, body := getWithToken(t, server, followingPath, sign(testUserID))
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	got := slugs(t, body)
	for _, slug := range got {
		if slug == "official-pick" || slug == "stranger-hit" {
			t.Fatalf("feed = %v, want only followed creators' games", got)
		}
	}
}

func TestFollowingFeedEmptyFollowsIsAnEmptyPage(t *testing.T) {
	backend := followingBackend()
	backend.followed = map[string]map[string]bool{}
	server, sign := testServerWithAuth(t, backend)

	status, body := getWithToken(t, server, followingPath, sign(testUserID))
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if got := slugs(t, body); len(got) != 0 {
		t.Fatalf("feed = %v, want an empty page for no follows", got)
	}
	if _, hasCursor := body["nextCursor"]; hasCursor && body["nextCursor"] != nil {
		t.Fatalf("nextCursor = %v, want null on an empty page", body["nextCursor"])
	}
}

func TestFollowingFeedPaginatesWithACursor(t *testing.T) {
	backend := followingBackend()
	server, sign := testServerWithAuth(t, backend)

	status, first := getWithToken(t, server, followingPath+"?limit=1", sign(testUserID))
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	firstSlugs := slugs(t, first)
	if len(firstSlugs) != 1 {
		t.Fatalf("first page = %v, want one game", firstSlugs)
	}
	cursor, _ := first["nextCursor"].(string)
	if cursor == "" {
		t.Fatal("first page carries no cursor while a second game exists")
	}

	status, second := getWithToken(t, server, followingPath+"?limit=1&cursor="+cursor, sign(testUserID))
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	secondSlugs := slugs(t, second)
	if len(secondSlugs) != 1 || secondSlugs[0] == firstSlugs[0] {
		t.Fatalf("second page = %v, want the remaining game", secondSlugs)
	}
}

func TestFollowingFeedRejectsBadParametersBeforeTheDatabase(t *testing.T) {
	backend := followingBackend()
	server, sign := testServerWithAuth(t, backend)

	for _, path := range []string{followingPath + "?limit=0", followingPath + "?limit=101", followingPath + "?cursor=bogus"} {
		calls := backend.listCalls
		status, _ := getWithToken(t, server, path, sign(testUserID))
		if status != http.StatusBadRequest {
			t.Fatalf("GET %s: status = %d, want 400", path, status)
		}
		if backend.listCalls != calls {
			t.Fatalf("GET %s reached the database with an invalid parameter", path)
		}
	}
}

func TestFollowingFeedFailureIsUnavailableWithoutLeaking(t *testing.T) {
	backend := followingBackend()
	backend.err = errors.New("following_feed is not executable")
	server, sign := testServerWithAuth(t, backend)

	status, body := getWithToken(t, server, followingPath, sign(testUserID))
	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", status)
	}
	message, _ := body["error"].(map[string]any)["message"].(string)
	for _, leaked := range []string{"following_feed", "executable"} {
		if strings.Contains(message, leaked) {
			t.Fatalf("message %q leaked upstream detail %q", message, leaked)
		}
	}
}

// ── Wiring ──────────────────────────────────────────────────────────────────

func TestOptionsWiresTheServiceName(t *testing.T) {
	options := Options()
	if options.Name != Name {
		t.Fatalf("Name = %q, want %q", options.Name, Name)
	}
	if options.RegisterWith == nil {
		t.Fatal("the service needs RegisterWith to mount its routes")
	}
}

func TestBackendInterfaceIsSatisfiedByTheSupabaseClient(t *testing.T) {
	// A compile-time assertion, kept in a test so a signature change surfaces
	// here rather than in every handler.
	var _ Backend = (*supabasegames.Client)(nil)
}
