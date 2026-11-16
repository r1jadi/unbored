package gamesessions

import (
	"errors"
	"net/http"
	"testing"

	"github.com/r1jadi/unbored/services/game-sessions/internal/supabaseplay"
)

// ── Claiming a guest run ────────────────────────────────────────────────────

const claimPath = "/api/v1/sessions/" + sessionID + "/claim"

func claimedBackend(outcome string) *fakeBackend {
	backend := testBackend()
	backend.claim = supabaseplay.Claim{
		Outcome:      outcome,
		SessionID:    sessionID,
		GameSlug:     "stack-10",
		Score:        ptr(int64(55)),
		PersonalBest: ptr(int64(80)),
		Rank:         ptr(int64(4)),
	}
	return backend
}

func TestClaimSessionSavesTheVerifiedScore(t *testing.T) {
	backend := claimedBackend("claimed")
	server := testServer(t, backend)
	caller := token(t, testUserID)

	status, body := post(t, server, claimPath, "", caller)

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if body["sessionId"] != sessionID || body["gameSlug"] != "stack-10" ||
		body["score"] != float64(55) || body["personalBest"] != float64(80) ||
		body["rank"] != float64(4) || body["duplicate"] != false {
		t.Fatalf("body = %#v, want the claimed run", body)
	}
	// The claim is made as the caller, with the run named by the path alone.
	if backend.lastClaim.AccessToken != caller || backend.lastClaim.SessionID != sessionID {
		t.Fatalf("claim request = %#v, want the caller's token and the path's session", backend.lastClaim)
	}
}

func TestClaimSessionReportsARetryAsADuplicate(t *testing.T) {
	server := testServer(t, claimedBackend("duplicate"))

	status, body := post(t, server, claimPath, "", token(t, testUserID))

	if status != http.StatusOK || body["duplicate"] != true {
		t.Fatalf("status = %d body = %#v, want 200 and duplicate", status, body)
	}
}

func TestClaimSessionNeedsAnAccount(t *testing.T) {
	backend := claimedBackend("claimed")
	server := testServer(t, backend)

	status, body := post(t, server, claimPath, "", "")

	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (%#v)", status, body)
	}
	if backend.claimCalls != 0 {
		t.Fatalf("a guest reached the database %d times, want never", backend.claimCalls)
	}
}

func TestClaimSessionRejectsAMalformedID(t *testing.T) {
	backend := claimedBackend("claimed")
	server := testServer(t, backend)

	status, body := post(t, server, "/api/v1/sessions/not-a-session/claim", "", token(t, testUserID))

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%#v)", status, body)
	}
	if backend.claimCalls != 0 {
		t.Fatalf("a malformed id reached the database")
	}
}

func TestClaimSessionMapsEveryRefusal(t *testing.T) {
	cases := []struct {
		outcome string
		status  int
	}{
		{"not_found", http.StatusNotFound},
		{"expired", http.StatusConflict},
		{"already_played", http.StatusConflict},
		{"unauthenticated", http.StatusUnauthorized},
		{"something_new", http.StatusInternalServerError},
	}
	for _, tc := range cases {
		t.Run(tc.outcome, func(t *testing.T) {
			server := testServer(t, claimedBackend(tc.outcome))
			status, body := post(t, server, claimPath, "", token(t, testUserID))
			if status != tc.status {
				t.Fatalf("status = %d, want %d (%#v)", status, tc.status, body)
			}
			if _, ok := body["score"]; ok {
				t.Fatalf("a refusal carried a score: %#v", body)
			}
			if tc.outcome == "already_played" || tc.outcome == "expired" {
				details, _ := body["error"].(map[string]any)["details"].([]any)
				if len(details) != 1 || details[0].(map[string]any)["rule"] != tc.outcome {
					t.Fatalf("details = %#v, want the rule %q", details, tc.outcome)
				}
			}
		})
	}
}

func TestClaimSessionAnswersServiceUnavailableWhenTheDatabaseFails(t *testing.T) {
	backend := claimedBackend("claimed")
	backend.claimErr = errors.New("connection refused")
	server := testServer(t, backend)

	status, _ := post(t, server, claimPath, "", token(t, testUserID))

	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", status)
	}
}
