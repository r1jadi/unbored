package supabasegames

import (
	"context"
	"net/http"
	"testing"
)

func TestOverallLeaderboardCallsTheBoardFunctionWithOneRowMoreThanThePage(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, `[{"rank":1,"user_id":"3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f",`+
			`"username":"rija","rating":280,"games":3},`+
			`{"rank":2,"user_id":null,"username":null,"rating":250,"games":4}]`)
	})

	entries, err := client.OverallLeaderboard(context.Background(), BoardQuery{Limit: 20})
	if err != nil {
		t.Fatalf("OverallLeaderboard: %v", err)
	}
	if len(entries) != 2 || entries[0].Username != "rija" || entries[0].Rating != 280 || entries[0].Games != 3 {
		t.Fatalf("entries = %#v", entries)
	}
	if entries[1].Username != "" {
		t.Fatalf("a nameless entry = %q, want empty", entries[1].Username)
	}

	sent := (*requests)[0]
	if sent.method != http.MethodPost || sent.path != "/rest/v1/rpc/overall_leaderboard" {
		t.Fatalf("request = %s %s, want the all-games board function", sent.method, sent.path)
	}
	if sent.body["p_limit"] != float64(21) || sent.body["p_offset"] != float64(0) || sent.body["p_since"] != nil {
		t.Fatalf("body = %#v, want one row past an all-time page", sent.body)
	}
}

func TestOverallStandingKeepsAMissingRank(t *testing.T) {
	client, requests := stubServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, `[{"rank":null,"rating":140,"games":2}]`)
	})

	standing, found, err := client.OverallStanding(context.Background(),
		"3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f", BoardQuery{})
	if err != nil || !found {
		t.Fatalf("OverallStanding: found=%v err=%v", found, err)
	}
	// Below the game minimum there is a rating and no rank — never rank zero.
	if standing.Rank != nil || standing.Rating != 140 || standing.Games != 2 {
		t.Fatalf("standing = %#v, want an unranked 140 over 2 games", standing)
	}
	if (*requests)[0].path != "/rest/v1/rpc/overall_standing" {
		t.Fatalf("path = %s", (*requests)[0].path)
	}
}
