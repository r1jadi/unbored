package supabasegames

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/config"
)

const (
	testPublishableKey = "sb_publishable_test_value"
	testGameID         = "11111111-1111-4111-8111-111111111111"
	testUserID         = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f"
)

// recorded is one request the client made.
type recorded struct {
	method string
	path   string
	query  url.Values
	header http.Header
	// body is the request payload, which is how the read-only function calls
	// are asserted: their arguments are the request.
	body map[string]any
}

// stubServer serves the Data API and records what the client sent.
func stubServer(t *testing.T, handler http.HandlerFunc) (*Client, *[]recorded) {
	t.Helper()

	requests := &[]recorded{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entry := recorded{
			method: r.Method,
			path:   r.URL.Path,
			query:  r.URL.Query(),
			header: r.Header.Clone(),
		}
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

func writeJSON(w http.ResponseWriter, status int, payload string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(payload))
}

const gameRowJSON = `[{"id":"11111111-1111-4111-8111-111111111111",` +
	`"slug":"stack-10","title":"Stack 10","tagline":"Make every column add up to ten.",` +
	`"description":"Drop numbered tiles into columns.","instructions":"Tap a column to drop a tile.",` +
	`"cover_path":null,"runtime":null,"playable":false,"is_official":true,` +
	`"published_at":"2026-09-01T12:00:00+00:00","updated_at":"2026-09-01T12:00:00+00:00",` +
	`"categories":{"slug":"puzzle","name":"Puzzle"}}]`

func TestNewRequiresConfiguration(t *testing.T) {
	tests := map[string]config.Supabase{
		"no url":             {PublishableKey: testPublishableKey},
		"no publishable key": {ProjectURL: "https://example.supabase.co"},
		"neither":            {},
	}
	for name, supabase := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := New(&config.Config{Supabase: supabase}); err == nil {
				t.Fatal("expected an error, got none")
			}
		})
	}
}

func TestProjectionNeverAsksForEveryColumn(t *testing.T) {
	// `select=*` would make a column added to `games` later appear in a public
	// response by accident, which is the failure this constant exists to prevent.
	if strings.Contains(gameColumns, "*") {
		t.Fatalf("the projection must name columns, got %q", gameColumns)
	}
	for _, column := range []string{"slug", "title", "tagline", "description", "instructions", "runtime", "playable", "is_official", "categories(slug,name)"} {
		if !strings.Contains(gameColumns, column) {
			t.Errorf("expected %q in the projection, got %q", column, gameColumns)
		}
	}
}

func TestListGamesQueriesOnlyPublishedGames(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, "[]")
	})

	if _, err := client.ListGames(context.Background(), ListQuery{Limit: 20}); err != nil {
		t.Fatalf("ListGames: %v", err)
	}
	if len(*requests) != 1 {
		t.Fatalf("requests = %d, want 1", len(*requests))
	}
	sent := (*requests)[0]
	if sent.path != "/rest/v1/games" {
		t.Fatalf("path = %q", sent.path)
	}
	if sent.method != http.MethodGet {
		t.Fatalf("method = %q; this client only reads", sent.method)
	}
	if got := sent.query.Get("status"); got != "eq.published" {
		t.Fatalf("status filter = %q, want eq.published", got)
	}
	if got := sent.query.Get("order"); got != gameOrder {
		t.Fatalf("order = %q, want %q", got, gameOrder)
	}
	// One row more than the page: that extra row is how the caller learns a
	// further page exists without a COUNT.
	if got := sent.query.Get("limit"); got != "21" {
		t.Fatalf("limit = %q, want 21 for a page of 20", got)
	}
	// The catalogue is public, so the request is answered as `anon`. Sending the
	// publishable key is what identifies the project; a user token would be a
	// different (and unnecessary) trust story.
	if got := sent.header.Get("Authorization"); got != "" {
		t.Fatalf("Authorization = %q; public reads must not carry a token", got)
	}
	if got := sent.header.Get("apikey"); got != testPublishableKey {
		t.Fatalf("apikey = %q, want the publishable key", got)
	}
}

func TestListGamesAppliesCategoryAndSearch(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, "[]")
	})

	query := ListQuery{Limit: 10, CategoryID: "aaaaaaaa-0000-4000-8000-000000000001", Search: "stack"}
	if _, err := client.ListGames(context.Background(), query); err != nil {
		t.Fatalf("ListGames: %v", err)
	}
	sent := (*requests)[0]
	if got := sent.query.Get("category_id"); got != "eq."+query.CategoryID {
		t.Fatalf("category_id = %q", got)
	}
	or := sent.query.Get("or")
	for _, column := range []string{"title.ilike.*stack*", "tagline.ilike.*stack*", "description.ilike.*stack*"} {
		if !strings.Contains(or, column) {
			t.Errorf("the search must cover %s, got %q", column, or)
		}
	}
}

func TestListGamesCombinesCursorAndSearchInOneLogicTree(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, "[]")
	})

	stamp := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	query := ListQuery{
		Limit:            5,
		Search:           "merge",
		AfterID:          testGameID,
		AfterPublishedAt: stamp,
		HasAfter:         true,
	}
	if _, err := client.ListGames(context.Background(), query); err != nil {
		t.Fatalf("ListGames: %v", err)
	}

	sent := (*requests)[0]
	// PostgREST accepts one top-level logic tree per request. Sending `or` twice
	// would silently drop one of the two conditions, which is why both live in a
	// single `and(...)`.
	if sent.query.Get("or") != "" {
		t.Fatalf("or = %q; the keyset and the search must share one tree", sent.query.Get("or"))
	}
	tree := sent.query.Get("and")
	if tree == "" {
		t.Fatal("no logic tree was sent")
	}
	if !strings.Contains(tree, "published_at.lt.2026-09-16T12:00:00Z") {
		t.Errorf("the keyset cursor is missing from %q", tree)
	}
	if !strings.Contains(tree, "and(published_at.eq.2026-09-16T12:00:00Z,id.lt."+testGameID+")") {
		t.Errorf("the tie-break on id is missing from %q", tree)
	}
	if !strings.Contains(tree, "title.ilike.*merge*") {
		t.Errorf("the search is missing from %q", tree)
	}
}

func TestListGamesRequiresAPositiveLimit(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, "[]")
	})
	if _, err := client.ListGames(context.Background(), ListQuery{}); err == nil {
		t.Fatal("expected an error for a zero limit")
	}
	if len(*requests) != 0 {
		t.Fatal("no request should have been made")
	}
}

func TestGetGameFiltersBySlugAndPublication(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, gameRowJSON)
	})

	game, found, err := client.GetGame(context.Background(), "stack-10")
	if err != nil {
		t.Fatalf("GetGame: %v", err)
	}
	if !found {
		t.Fatal("found = false for a served row")
	}
	if game.Slug != "stack-10" || game.Title != "Stack 10" {
		t.Fatalf("game = %#v", game)
	}
	if game.IsOfficial != true || game.Playable != false {
		t.Fatalf("flags = official:%v playable:%v", game.IsOfficial, game.Playable)
	}
	if game.Category == nil || game.Category.Slug != "puzzle" {
		t.Fatalf("category = %#v", game.Category)
	}
	if game.PublishedAt == nil {
		t.Fatal("published_at did not decode")
	}

	sent := (*requests)[0]
	if got := sent.query.Get("slug"); got != "eq.stack-10" {
		t.Fatalf("slug filter = %q", got)
	}
	// The status filter is what keeps an unpublished game indistinguishable from
	// a missing one, so a draft can never be discovered by guessing its slug.
	if got := sent.query.Get("status"); got != "eq.published" {
		t.Fatalf("status filter = %q, want eq.published", got)
	}
}

func TestGetGameNotFound(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, "[]")
	})
	_, found, err := client.GetGame(context.Background(), "never-made")
	if err != nil {
		t.Fatalf("GetGame: %v", err)
	}
	if found {
		t.Fatal("found = true for an empty result")
	}
}

func TestGetGameRequiresASlug(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, "[]")
	})
	if _, _, err := client.GetGame(context.Background(), ""); err == nil {
		t.Fatal("expected an error")
	}
	if len(*requests) != 0 {
		t.Fatal("no request should have been made")
	}
}

func TestCategoryIDResolution(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, `[{"id":"aaaaaaaa-0000-4000-8000-000000000001"}]`)
	})

	id, found, err := client.CategoryID(context.Background(), "puzzle")
	if err != nil {
		t.Fatalf("CategoryID: %v", err)
	}
	if !found || id != "aaaaaaaa-0000-4000-8000-000000000001" {
		t.Fatalf("CategoryID = %q, %v", id, found)
	}
	sent := (*requests)[0]
	if sent.path != "/rest/v1/categories" {
		t.Fatalf("path = %q", sent.path)
	}
	if got := sent.query.Get("slug"); got != "eq.puzzle" {
		t.Fatalf("slug filter = %q", got)
	}
}

func TestCategoryIDUnknownSlug(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, "[]")
	})
	id, found, err := client.CategoryID(context.Background(), "strategy")
	if err != nil {
		t.Fatalf("CategoryID: %v", err)
	}
	if found || id != "" {
		t.Fatalf("found = %v, id = %q", found, id)
	}
}

func TestCategoryCountsReadTheView(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, `[{"slug":"puzzle","name":"Puzzle","description":"Fit and clear.",`+
			`"sort_order":10,"game_count":2},{"slug":"word","name":"Word","description":null,`+
			`"sort_order":70,"game_count":0}]`)
	})

	counts, err := client.CategoryCounts(context.Background())
	if err != nil {
		t.Fatalf("CategoryCounts: %v", err)
	}
	if len(counts) != 2 {
		t.Fatalf("counts = %d, want 2", len(counts))
	}
	if counts[0].Slug != "puzzle" || counts[0].GameCount != 2 {
		t.Fatalf("first = %#v", counts[0])
	}
	if counts[1].GameCount != 0 {
		t.Fatalf("an empty category must report 0, got %d", counts[1].GameCount)
	}
	sent := (*requests)[0]
	if sent.path != "/rest/v1/category_game_counts" {
		t.Fatalf("path = %q, want the counted view", sent.path)
	}
}

// ── Activity, ranking and standing ──────────────────────────────────────────

func TestGameStatsReadsOnlyTheGrantedColumns(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, `[{"slug":"stack-10","plays":12},{"slug":"one-move","plays":0}]`)
	})

	stats, err := client.GameStats(context.Background())
	if err != nil {
		t.Fatalf("GameStats: %v", err)
	}
	if stats["stack-10"].Plays != 12 {
		t.Fatalf("stack-10 plays = %d, want 12", stats["stack-10"].Plays)
	}
	if stats["one-move"].Plays != 0 {
		t.Fatalf("one-move plays = %d, want a measured zero", stats["one-move"].Plays)
	}
	// A slug the view does not list is absent from the map, so a caller looking
	// it up gets Go's zero — which is the answer, not a missing value.
	if _, ok := stats["never-made"]; ok {
		t.Fatal("a game with no stat row must not appear in the map")
	}

	sent := (*requests)[0]
	if sent.path != "/rest/v1/game_stats" {
		t.Fatalf("path = %q, want the activity view", sent.path)
	}
	if sent.query.Get("select") != statColumns {
		t.Fatalf("select = %q, want exactly the granted columns", sent.query.Get("select"))
	}
	if strings.Contains(sent.query.Get("select"), "game_id") {
		t.Fatal("the internal uuid is being selected from a public view")
	}
	// No user token: this is the anonymous read the browser could make itself.
	if token := sent.header.Get("Authorization"); token != "" {
		t.Fatalf("Authorization = %q, want none", token)
	}
}

func TestGameStatFiltersBySlug(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, `[{"slug":"stack-10","plays":3}]`)
	})

	stat, found, err := client.GameStat(context.Background(), "stack-10")
	if err != nil {
		t.Fatalf("GameStat: %v", err)
	}
	if !found || stat.Plays != 3 {
		t.Fatalf("found = %v, stat = %#v", found, stat)
	}
	sent := (*requests)[0]
	if sent.query.Get("slug") != "eq.stack-10" {
		t.Fatalf("slug filter = %q, want an equality filter", sent.query.Get("slug"))
	}
	if sent.query.Get("limit") != "1" {
		t.Fatalf("limit = %q, want one row", sent.query.Get("limit"))
	}
}

func TestGameStatOfAnUnknownGameIsNotAnError(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, `[]`)
	})

	_, found, err := client.GameStat(context.Background(), "never-made")
	if err != nil {
		t.Fatalf("GameStat: %v", err)
	}
	if found {
		t.Fatal("a game with no stat row reported found")
	}
}

func TestLeaderboardCallsTheBoardFunctionWithOneRowMoreThanThePage(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, `[{"rank":1,"user_id":"3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f",`+
			`"username":"rija","score":120,"achieved_at":"2026-10-12T09:30:00+00:00","plays":3},`+
			`{"rank":2,"user_id":null,"username":null,"score":95,`+
			`"achieved_at":"2026-10-12T09:30:00+00:00","plays":1}]`)
	})

	entries, err := client.Leaderboard(context.Background(), "stack-10", BoardQuery{Limit: 25})
	if err != nil {
		t.Fatalf("Leaderboard: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(entries))
	}
	if entries[0].Rank != 1 || entries[0].Username != "rija" || entries[0].Score != 120 || entries[0].Plays != 3 {
		t.Fatalf("first entry = %#v", entries[0])
	}
	if entries[0].AchievedAt == nil {
		t.Fatal("the first entry lost the time it was achieved")
	}
	// A score whose profile row is gone is still a real score: it keeps its place
	// and its rank rather than being dropped and shifting everybody else up.
	if entries[1].Username != "" {
		t.Fatalf("a nameless entry = %q, want empty", entries[1].Username)
	}

	sent := (*requests)[0]
	if sent.method != http.MethodPost || sent.path != "/rest/v1/rpc/game_leaderboard" {
		t.Fatalf("request = %s %s, want the board function", sent.method, sent.path)
	}
	if sent.body["p_game_slug"] != "stack-10" {
		t.Fatalf("p_game_slug = %v", sent.body["p_game_slug"])
	}
	if sent.body["p_limit"] != float64(26) {
		t.Fatalf("p_limit = %v, want one row past the page", sent.body["p_limit"])
	}
	if sent.body["p_offset"] != float64(0) {
		t.Fatalf("p_offset = %v, want 0", sent.body["p_offset"])
	}
	if sent.body["p_since"] != nil {
		t.Fatalf("p_since = %v, want null for an all-time board", sent.body["p_since"])
	}
}

func TestFollowingGamesCallsTheFeedFunctionWithOneRowMoreThanThePage(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, `[{"id":"11111111-1111-4111-8111-111111111111",`+
			`"slug":"creator-hit","title":"Creator Hit","tagline":null,"description":null,`+
			`"instructions":null,"cover_path":null,"runtime":null,"playable":false,"is_official":false,`+
			`"published_at":"2026-09-03T12:00:00+00:00","updated_at":"2026-09-03T12:00:00+00:00",`+
			`"category_slug":"puzzle","category_name":"Puzzle"}]`)
	})

	games, err := client.FollowingGames(context.Background(), FollowingQuery{FollowerID: testUserID, Limit: 20})
	if err != nil {
		t.Fatalf("FollowingGames: %v", err)
	}
	if len(games) != 1 || games[0].Slug != "creator-hit" {
		t.Fatalf("games = %#v, want the followed creator's game", games)
	}
	if games[0].Category == nil || games[0].Category.Slug != "puzzle" {
		t.Fatalf("category = %#v, want the joined category", games[0].Category)
	}

	sent := (*requests)[0]
	if sent.method != http.MethodPost || sent.path != "/rest/v1/rpc/following_feed" {
		t.Fatalf("request = %s %s, want the feed function", sent.method, sent.path)
	}
	if sent.body["p_follower"] != testUserID {
		t.Fatalf("p_follower = %v, want the verified follower", sent.body["p_follower"])
	}
	if sent.body["p_limit"] != float64(21) {
		t.Fatalf("p_limit = %v, want one row past the page", sent.body["p_limit"])
	}
}

func TestFollowingGamesRequiresAFollower(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, `[]`)
	})

	if _, err := client.FollowingGames(context.Background(), FollowingQuery{Limit: 20}); err == nil {
		t.Fatal("the feed was read without a follower")
	}
	if len(*requests) != 0 {
		t.Fatal("the database was read without a follower")
	}
}

func TestLeaderboardSendsAWindowedBoundary(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, `[]`)
	})
	since := time.Date(2026, 10, 11, 9, 0, 0, 0, time.UTC)

	if _, err := client.Leaderboard(context.Background(), "stack-10",
		BoardQuery{Limit: 20, Since: since, HasSince: true}); err != nil {
		t.Fatalf("Leaderboard: %v", err)
	}

	got, ok := (*requests)[0].body["p_since"].(string)
	if !ok {
		t.Fatalf("p_since = %v, want a timestamp rather than a zero date", (*requests)[0].body["p_since"])
	}
	parsed, err := time.Parse(time.RFC3339Nano, got)
	if err != nil || !parsed.Equal(since) {
		t.Fatalf("p_since = %q (%v), want %v", got, err, since)
	}
}

func TestLeaderboardRequiresAPositiveLimit(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("a page with no limit must not reach the database")
	})

	if _, err := client.Leaderboard(context.Background(), "stack-10", BoardQuery{}); err == nil {
		t.Fatal("a zero limit was accepted")
	}
	if len(*requests) != 0 {
		t.Fatalf("requests = %d, want none", len(*requests))
	}
}

// A standing is read as the caller, so the database can tell the player from a
// stranger asking about them.
func TestStandingIsReadAsTheCaller(t *testing.T) {
	var authorization []string
	client, _ := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		authorization = append(authorization, r.Header.Get("Authorization"))
		writeJSON(w, http.StatusOK, `[{"rank":1,"score":10,"achieved_at":"2026-10-12T09:30:00+00:00","plays":1}]`)
	})

	ctx := WithCallerToken(context.Background(), "caller.jwt.token")
	if _, found, err := client.Standing(ctx, "stack-10", testUserID, BoardQuery{}); err != nil || !found {
		t.Fatalf("Standing: found = %v, err = %v", found, err)
	}
	if _, _, err := client.Standing(context.Background(), "stack-10", testUserID, BoardQuery{}); err != nil {
		t.Fatalf("Standing without a token: %v", err)
	}
	if len(authorization) != 2 || authorization[0] != "Bearer caller.jwt.token" || authorization[1] != "" {
		t.Fatalf("Authorization headers = %q; want the caller's token, then none", authorization)
	}
}

// The database re-checks the token with its own clock. One it refuses must not
// fail the board: the read is repeated as an anonymous caller.
func TestStandingFallsBackWhenTheTokenIsRefused(t *testing.T) {
	var authorization []string
	client, _ := stubServer(t, func(w http.ResponseWriter, r *http.Request) {
		authorization = append(authorization, r.Header.Get("Authorization"))
		if r.Header.Get("Authorization") != "" {
			writeJSON(w, http.StatusUnauthorized, `{"code":"PGRST301","message":"JWT expired"}`)
			return
		}
		writeJSON(w, http.StatusOK, `[{"rank":2,"score":7,"achieved_at":"2026-10-12T09:30:00+00:00","plays":1}]`)
	})

	ctx := WithCallerToken(context.Background(), "expired.jwt.token")
	standing, found, err := client.Standing(ctx, "stack-10", testUserID, BoardQuery{})
	if err != nil || !found || standing.Rank != 2 {
		t.Fatalf("standing = %#v, found = %v, err = %v", standing, found, err)
	}
	if len(authorization) != 2 || authorization[1] != "" {
		t.Fatalf("Authorization headers = %q; want one attempt with the token and one without", authorization)
	}
}

func TestStandingReadsOnePlayersPlace(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, `[{"rank":4,"score":88,"achieved_at":"2026-10-12T09:30:00+00:00","plays":2}]`)
	})

	standing, found, err := client.Standing(context.Background(), "stack-10", testUserID, BoardQuery{})
	if err != nil {
		t.Fatalf("Standing: %v", err)
	}
	if !found || standing.Rank != 4 || standing.Score != 88 || standing.Plays != 2 {
		t.Fatalf("found = %v, standing = %#v", found, standing)
	}

	sent := (*requests)[0]
	if sent.path != "/rest/v1/rpc/game_standing" {
		t.Fatalf("path = %q, want the standing function", sent.path)
	}
	if sent.body["p_user_id"] != testUserID {
		t.Fatalf("p_user_id = %v, want the caller", sent.body["p_user_id"])
	}
}

func TestStandingOfAnUnrankedPlayerIsAnAnswer(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, `[]`)
	})

	_, found, err := client.Standing(context.Background(), "stack-10", testUserID, BoardQuery{})
	if err != nil {
		t.Fatalf("Standing: %v", err)
	}
	if found {
		t.Fatal("a player with no scored run reported a standing")
	}
}

func TestStandingWithoutAUserIsNeverSent(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("an empty user id must not become a query")
	})

	_, found, err := client.Standing(context.Background(), "stack-10", "", BoardQuery{})
	if err != nil || found {
		t.Fatalf("err = %v, found = %v; want no answer and no error", err, found)
	}
	if len(*requests) != 0 {
		t.Fatalf("requests = %d, want none", len(*requests))
	}
}

func TestReadOnlyFunctionFailureIsClassified(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusForbidden, `{"code":"42501","message":"permission denied for function game_leaderboard",`+
			`"details":"the role lacks execute"}`)
	})

	_, err := client.Leaderboard(context.Background(), "stack-10", BoardQuery{Limit: 20})
	var dataErr *Error
	if !errors.As(err, &dataErr) {
		t.Fatalf("err = %v, want a classified Data API error", err)
	}
	if !dataErr.IsForbidden() || dataErr.Code != "42501" {
		t.Fatalf("error = %+v, want a forbidden classification", dataErr)
	}
	// The database's own message describes the schema and is never carried.
	if strings.Contains(err.Error(), "permission denied") || strings.Contains(err.Error(), "details") {
		t.Fatalf("error %q carries the upstream message", err)
	}
}

func TestSearchTermStripsFilterGrammar(t *testing.T) {
	tests := map[string]string{
		"plain":                  "merge",
		"comma":                  "stack,10",
		"parentheses":            "stack(10)",
		"wildcard":               "st*ack",
		"quotes and backslashes": `st"ack\`,
		"whitespace":             "  merged  ",
	}
	for name, raw := range tests {
		t.Run(name, func(t *testing.T) {
			term, ok := SearchTerm(raw)
			if !ok {
				t.Fatalf("SearchTerm(%q) reported no searchable content", raw)
			}
			for _, forbidden := range []string{",", "(", ")", "*", `"`, `\`} {
				if strings.Contains(term, forbidden) {
					t.Fatalf("term %q still contains %q, which changes the query rather than searching for it", term, forbidden)
				}
			}
		})
	}
}

func TestSearchTermRejectsWhitespaceOnly(t *testing.T) {
	for _, raw := range []string{"", "   ", "\t\n", ",,,"} {
		if _, ok := SearchTerm(raw); ok {
			t.Fatalf("SearchTerm(%q) must report no searchable content", raw)
		}
	}
}

func TestErrorClassification(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		// PostgREST's body can echo the caller's input, so only the code may be
		// carried forward.
		writeJSON(w, http.StatusForbidden, `{"code":"42501","message":"permission denied for table games","details":"stack-10"}`)
	})

	_, err := client.ListGames(context.Background(), ListQuery{Limit: 5})
	if err == nil {
		t.Fatal("expected an error")
	}
	var dataErr *Error
	if !errors.As(err, &dataErr) {
		t.Fatalf("error type = %T, want *Error", err)
	}
	if !dataErr.IsForbidden() {
		t.Fatal("a 42501 must be classified as forbidden")
	}
	if dataErr.Op != "list-games" {
		t.Fatalf("Op = %q", dataErr.Op)
	}
	for _, leaked := range []string{"permission denied", "stack-10"} {
		if strings.Contains(err.Error(), leaked) {
			t.Fatalf("error %q leaked the response body", err)
		}
	}
}

func TestTransportFailureIsReportedWithoutTheURL(t *testing.T) {
	client, err := New(&config.Config{Supabase: config.Supabase{
		ProjectURL:     "http://127.0.0.1:1", // nothing listens here
		PublishableKey: testPublishableKey,
	}})
	if err != nil {
		t.Fatalf("building client: %v", err)
	}

	_, listErr := client.ListGames(context.Background(), ListQuery{Limit: 5})
	if listErr == nil {
		t.Fatal("expected a transport error")
	}
	var dataErr *Error
	if !errors.As(listErr, &dataErr) {
		t.Fatalf("error type = %T, want *Error", listErr)
	}
	if dataErr.Status != 0 {
		t.Fatalf("Status = %d, want 0 for a call that never completed", dataErr.Status)
	}
}

func TestUndecodableBodyIsAReportedFailure(t *testing.T) {
	client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, "not json at all")
	})
	if _, err := client.CategoryCounts(context.Background()); err == nil {
		t.Fatal("expected an error for an undecodable body")
	}
}

func TestBodyIsBounded(t *testing.T) {
	// A body that never ends must not be read forever; the client stops at
	// maxBodyBytes and reports a decode failure instead of hanging.
	client, _ := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "[")
		_, _ = io.WriteString(w, strings.Repeat(" ", maxBodyBytes+16))
	})
	if _, err := client.CategoryCounts(context.Background()); err == nil {
		t.Fatal("expected a bounded read to fail rather than succeed")
	}
}
