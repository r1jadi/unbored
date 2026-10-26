package games

import (
	"context"
	"net/http"
	"testing"

	"github.com/r1jadi/unbored/services/games/internal/supabasegames"
)

const overallPath = "/api/v1/games/leaderboard"

func (b *fakeBackend) OverallLeaderboard(_ context.Context, query supabasegames.BoardQuery) ([]supabasegames.OverallEntry, error) {
	b.overallCalls++
	b.boardQuery = query
	if b.err != nil {
		return nil, b.err
	}
	if b.boardErr != nil {
		return nil, b.boardErr
	}
	// Like the real client, it answers with one row more than the page.
	limit := min(query.Limit+1, len(b.overall))
	return b.overall[:limit], nil
}

func (b *fakeBackend) OverallStanding(_ context.Context, userID string, query supabasegames.BoardQuery) (supabasegames.OverallStanding, bool, error) {
	b.overallUser = userID
	b.boardQuery = query
	if b.err != nil {
		return supabasegames.OverallStanding{}, false, b.err
	}
	if b.overallStanding == nil {
		return supabasegames.OverallStanding{}, false, nil
	}
	return *b.overallStanding, true, nil
}

func testOverall() []supabasegames.OverallEntry {
	return []supabasegames.OverallEntry{
		{Rank: 1, Username: "rija", Rating: 280, Games: 3},
		{Rank: 2, Username: "ana", Rating: 250, Games: 4},
		{Rank: 3, Username: "kim", Rating: 120, Games: 3},
	}
}

func TestOverallBoardReturnsTheDatabasesRanking(t *testing.T) {
	backend := testBackend()
	backend.overall = testOverall()
	server := testServer(t, backend)

	status, body := get(t, server, overallPath)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if body["scope"] != "global" || body["period"] != "all" || body["minGames"] != float64(3) {
		t.Fatalf("body = %#v, want the global all-time board with its game minimum", body)
	}
	if body["hasMore"] != false || body["me"] != nil {
		t.Fatalf("body = %#v, want the last page and no standing for an anonymous caller", body)
	}
	items := entriesOf(t, body)
	if len(items) != 3 {
		t.Fatalf("entries = %d, want 3", len(items))
	}
	first, _ := items[0].(map[string]any)
	if first["rank"] != float64(1) || first["username"] != "rija" ||
		first["rating"] != float64(280) || first["games"] != float64(3) {
		t.Fatalf("first entry = %#v, want rija rated 280 over 3 games", first)
	}
	if _, ok := first["userId"]; ok {
		t.Fatalf("an entry exposes a user id: %#v", first)
	}
}

func TestOverallBoardIsNotReadAsAGameSlug(t *testing.T) {
	// "leaderboard" is a static segment: it must reach the all-games board, never
	// a lookup of a game called "leaderboard".
	backend := testBackend()
	server := testServer(t, backend)

	status, _ := get(t, server, overallPath)
	if status != http.StatusOK || backend.overallCalls != 1 {
		t.Fatalf("status = %d, all-games reads = %d; want 200 from the all-games board", status, backend.overallCalls)
	}
}

func TestOverallBoardPagesAndWindows(t *testing.T) {
	backend := testBackend()
	backend.overall = testOverall()
	server := testServer(t, backend)

	_, body := get(t, server, overallPath+"?limit=2&period=week")
	if len(entriesOf(t, body)) != 2 || body["hasMore"] != true {
		t.Fatalf("body = %#v, want 2 entries and another page", body)
	}
	if body["period"] != "week" || !backend.boardQuery.HasSince || backend.boardQuery.Limit != 2 {
		t.Fatalf("board query = %+v, want a bounded weekly page of 2", backend.boardQuery)
	}

	status, _ := get(t, server, overallPath+"?period=month")
	if status != http.StatusBadRequest {
		t.Fatalf("status = %d for an unknown period, want 400", status)
	}
}

func TestOverallBoardIncludesTheCallersRating(t *testing.T) {
	backend := testBackend()
	backend.overall = testOverall()
	// Two rated games: a rating, but no rank yet.
	backend.overallStanding = &supabasegames.OverallStanding{Rating: 140, Games: 2}
	server, sign := testServerWithAuth(t, backend)

	status, body := getWithToken(t, server, overallPath+"?userId="+testOtherID, sign(testUserID))
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	me, ok := body["me"].(map[string]any)
	if !ok {
		t.Fatalf("me = %v, want the caller's rating", body["me"])
	}
	if me["rank"] != nil || me["rating"] != float64(140) || me["games"] != float64(2) {
		t.Fatalf("me = %#v, want an unranked rating of 140 over 2 games", me)
	}
	if backend.overallUser != testUserID {
		t.Fatalf("the rating was read for %q, want the token's subject", backend.overallUser)
	}
}

func TestOverallBoardWithoutSupabaseIsUnavailable(t *testing.T) {
	server := testServer(t, nil)

	status, _ := get(t, server, overallPath)
	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", status)
	}
}
