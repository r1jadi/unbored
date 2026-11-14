package admin

import (
	"net/http"
	"strings"
	"testing"

	"github.com/r1jadi/unbored/services/admin/internal/supabaseadmin"
)

func TestDeepCutReviewsDefaultToPending(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	name := "Snake fruit"
	backend := &fakeBackend{
		identity: staffIdentity("moderator"),
		deepCutReviews: []supabaseadmin.DeepCutReview{
			{QuestionID: 4, Prompt: "Name a fruit", Key: "salak", Sample: "Salak", Verdict: "pending", Seen: 3},
			{QuestionID: 4, Prompt: "Name a fruit", Key: "zalak", Sample: "Zalak", Verdict: "accepted", AnswerName: &name},
		},
	}
	server, sign := newTestServer(t, backend)

	status, payload := call(t, server, http.MethodGet, DeepCutReviewsPath+"?q=fruit&limit=1", sign(testModerator, "moderator"), nil)
	if status != http.StatusOK {
		t.Fatalf("reviews = %d (%v)", status, payload)
	}
	if got := backend.lastArgs; len(got) != 2 || got[0] != "pending" || got[1] != "fruit" {
		t.Errorf("filters = %v, want [pending fruit]", got)
	}
	items, _ := payload["items"].([]any)
	if len(items) != 1 || payload["hasMore"] != true {
		t.Fatalf("payload = %v, want one item and hasMore", payload)
	}
	item := items[0].(map[string]any)
	if item["sample"] != "Salak" || item["questionId"] != float64(4) || item["seen"] != float64(3) {
		t.Errorf("item = %v", item)
	}
}

func TestDeepCutReviewsAllMeansEveryVerdict(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{identity: staffIdentity("moderator")}
	server, sign := newTestServer(t, backend)

	call(t, server, http.MethodGet, DeepCutReviewsPath+"?verdict=all", sign(testModerator, "moderator"), nil)
	if got := backend.lastArgs; len(got) != 2 || got[0] != "" {
		t.Errorf("filters = %v, want an empty verdict", got)
	}
	status, _ := call(t, server, http.MethodGet, DeepCutReviewsPath+"?verdict=maybe", sign(testModerator, "moderator"), nil)
	if status != http.StatusBadRequest {
		t.Errorf("unknown verdict = %d, want 400", status)
	}
}

func TestDeepCutRoutesAreClosedToPlayers(t *testing.T) {
	backend := &fakeBackend{identity: staffIdentity("user")}
	server, sign := newTestServer(t, backend)

	for _, request := range []struct{ method, path string }{
		{http.MethodGet, DeepCutReviewsPath},
		{http.MethodGet, "/api/v1/admin/deep-cut/questions/4/answers"},
		{http.MethodPut, "/api/v1/admin/deep-cut/questions/4/reviews/salak"},
		{http.MethodPatch, "/api/v1/admin/deep-cut/answers/9"},
	} {
		status, _ := call(t, server, request.method, request.path, sign(testPlayer, "user"),
			map[string]any{"verdict": "rejected", "tier": 3})
		if status != http.StatusForbidden {
			t.Errorf("%s %s = %d, want 403", request.method, request.path, status)
		}
	}
	if len(backend.calls) > 0 && strings.HasPrefix(strings.Join(backend.calls, ","), "DeepCut") {
		t.Fatalf("a player reached the database: %v", backend.calls)
	}
}

func TestDeepCutRuleAcceptsAndRejects(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{identity: staffIdentity("moderator")}
	server, sign := newTestServer(t, backend)
	token := sign(testModerator, "moderator")

	status, payload := call(t, server, http.MethodPut, "/api/v1/admin/deep-cut/questions/4/reviews/salak", token,
		map[string]any{"verdict": "accepted", "canonical": " Snake fruit ", "tier": 5})
	if status != http.StatusOK || payload["verdict"] != "accepted" {
		t.Fatalf("accept = %d %v", status, payload)
	}
	if got := backend.lastArgs; strings.Join(got, "|") != "4|salak|accepted|Snake fruit|5" {
		t.Errorf("accept args = %v", got)
	}

	status, _ = call(t, server, http.MethodPut, "/api/v1/admin/deep-cut/questions/4/reviews/salak", token,
		map[string]any{"verdict": "rejected", "canonical": "ignored", "tier": 6})
	if status != http.StatusOK || strings.Join(backend.lastArgs, "|") != "4|salak|rejected||0" {
		t.Errorf("reject = %d args %v", status, backend.lastArgs)
	}
}

func TestDeepCutRuleValidatesBeforeTheDatabase(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{identity: staffIdentity("moderator")}
	server, sign := newTestServer(t, backend)
	token := sign(testModerator, "moderator")

	for _, tc := range []struct {
		path string
		body map[string]any
	}{
		{"/api/v1/admin/deep-cut/questions/x/reviews/salak", map[string]any{"verdict": "rejected"}},
		{"/api/v1/admin/deep-cut/questions/4/reviews/Not-A-Key", map[string]any{"verdict": "rejected"}},
		{"/api/v1/admin/deep-cut/questions/4/reviews/salak", map[string]any{"verdict": "maybe"}},
		{"/api/v1/admin/deep-cut/questions/4/reviews/salak", map[string]any{"verdict": "accepted", "tier": 3}},
		{"/api/v1/admin/deep-cut/questions/4/reviews/salak", map[string]any{"verdict": "accepted", "canonical": "X", "tier": 7}},
	} {
		status, _ := call(t, server, http.MethodPut, tc.path, token, tc.body)
		if status != http.StatusBadRequest {
			t.Errorf("%s %v = %d, want 400", tc.path, tc.body, status)
		}
	}
	if backend.called("RuleDeepCut") {
		t.Fatal("an invalid ruling reached the database")
	}
}

func TestDeepCutRetier(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{identity: staffIdentity("moderator")}
	server, sign := newTestServer(t, backend)
	token := sign(testModerator, "moderator")

	status, payload := call(t, server, http.MethodPatch, "/api/v1/admin/deep-cut/answers/9", token, map[string]any{"tier": 6})
	if status != http.StatusOK || payload["tier"] != float64(6) || payload["previousTier"] != float64(3) {
		t.Fatalf("retier = %d %v", status, payload)
	}
	status, _ = call(t, server, http.MethodPatch, "/api/v1/admin/deep-cut/answers/9", token, map[string]any{"tier": 0})
	if status != http.StatusBadRequest {
		t.Errorf("tier 0 = %d, want 400", status)
	}
}

func TestDeepCutAnswersList(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "staff@example.com")
	backend := &fakeBackend{
		identity:       staffIdentity("moderator"),
		deepCutAnswers: []supabaseadmin.DeepCutAnswer{{ID: 9, Canonical: "Apple", Tier: 1, Source: "curated", Given: 12}},
	}
	server, sign := newTestServer(t, backend)

	status, payload := call(t, server, http.MethodGet, "/api/v1/admin/deep-cut/questions/4/answers", sign(testModerator, "moderator"), nil)
	items, _ := payload["items"].([]any)
	if status != http.StatusOK || len(items) != 1 || items[0].(map[string]any)["canonical"] != "Apple" {
		t.Fatalf("answers = %d %v", status, payload)
	}
	if strings.Join(backend.lastArgs, "|") != "4" {
		t.Errorf("args = %v", backend.lastArgs)
	}
}
