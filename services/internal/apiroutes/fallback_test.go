package apiroutes

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGroupForMatchesWholeSegments(t *testing.T) {
	cases := map[string]string{
		"/api/v1/games":             "games",
		"/api/v1/games/stack-10":    "games",
		"/api/v1/auth/session":      "auth",
		"/api/v1/scores":            "scores",
		"/api/v1/leaderboards/x/y":  "leaderboards",
		"/api/v1/cron/game-digests": "games",
	}
	for path, want := range cases {
		group, ok := GroupFor(path)
		if !ok || group.Service != want {
			t.Errorf("GroupFor(%q) = %q, %v; want %q", path, group.Service, ok, want)
		}
	}
	for _, path := range []string{"/api/v1", "/api/v1/gamesx", "/api/v1/health", "/healthz", "/"} {
		if group, ok := GroupFor(path); ok {
			t.Errorf("GroupFor(%q) = %q, want no group", path, group.Service)
		}
	}
}

func TestUnavailableAnswersOnlyForGroupsThisProcessDoesNotRun(t *testing.T) {
	reached := false
	handler := Unavailable("games")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusTeapot)
	}))

	for path, want := range map[string]int{
		"/api/v1/games":          http.StatusTeapot,
		"/api/v1/sessions/abc":   http.StatusTeapot,
		"/api/v1/admin/users":    http.StatusTeapot,
		"/api/v1/health":         http.StatusTeapot,
		"/api/v1/nothing-here":   http.StatusTeapot,
		"/api/v1/scores":         http.StatusServiceUnavailable,
		"/api/v1/social/follows": http.StatusTeapot, // not a group prefix
		"/api/v1/follows/1":      http.StatusServiceUnavailable,
		"/api/v1/auth/session":   http.StatusServiceUnavailable,
	} {
		reached = false
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != want {
			t.Errorf("%s = %d, want %d", path, recorder.Code, want)
		}
		if reached != (want == http.StatusTeapot) {
			t.Errorf("%s: reached the service = %v", path, reached)
		}
	}
}
