package apicache

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCacheable(t *testing.T) {
	cases := map[string]bool{
		"/api/v1/games":              true,
		"/api/v1/games?limit=5":      true,
		"/api/v1/categories":         true,
		"/api/v1/games/crowns":       true,
		"/api/v1/games/following":    false,
		"/api/v1/games/crowns/board": false,
		"/api/v1/users/me":           false,
		"/api/v1/sessions":           false,
	}
	for target, want := range cases {
		r := httptest.NewRequest(http.MethodGet, target, nil)
		if got := Cacheable(r); got != want {
			t.Errorf("Cacheable(%s) = %v, want %v", target, got, want)
		}
	}
	authed := httptest.NewRequest(http.MethodGet, "/api/v1/games", nil)
	authed.Header.Set("Authorization", "Bearer x")
	if Cacheable(authed) {
		t.Error("a request with a token must not be cached")
	}
	if Cacheable(httptest.NewRequest(http.MethodPost, "/api/v1/games", nil)) {
		t.Error("POST must not be cached")
	}
}

func TestMiddlewareCachesOKAndExpires(t *testing.T) {
	calls := 0
	status := http.StatusOK
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"n":1}`))
	})
	c := New(time.Minute)
	clock := time.Unix(0, 0)
	c.now = func() time.Time { return clock }
	h := c.Middleware()(handler)

	get := func(target string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
		return rec
	}

	first := get("/api/v1/games?limit=5")
	second := get("/api/v1/games?limit=5")
	if calls != 1 {
		t.Fatalf("handler ran %d times, want 1", calls)
	}
	if first.Header().Get("X-Cache") != "MISS" || second.Header().Get("X-Cache") != "HIT" {
		t.Errorf("X-Cache = %q then %q", first.Header().Get("X-Cache"), second.Header().Get("X-Cache"))
	}
	if second.Body.String() != `{"n":1}` || second.Header().Get("Cache-Control") != BrowserCacheControl {
		t.Errorf("hit body %q cache-control %q", second.Body.String(), second.Header().Get("Cache-Control"))
	}

	get("/api/v1/games?limit=6")
	if calls != 2 {
		t.Errorf("a different query must miss; calls = %d", calls)
	}

	clock = clock.Add(2 * time.Minute)
	get("/api/v1/games?limit=5")
	if calls != 3 {
		t.Errorf("an expired entry must miss; calls = %d", calls)
	}

	status = http.StatusServiceUnavailable
	clock = clock.Add(2 * time.Minute)
	bad := get("/api/v1/categories")
	get("/api/v1/categories")
	if calls != 5 || bad.Code != http.StatusServiceUnavailable || bad.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("errors must not be cached: calls=%d code=%d cc=%q", calls, bad.Code, bad.Header().Get("Cache-Control"))
	}
}
