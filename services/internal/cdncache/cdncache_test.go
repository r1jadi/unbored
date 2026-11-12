package cdncache

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/r1jadi/unbored/services/internal/apiroutes"
)

const testPolicy = "s-maxage=60, stale-while-revalidate=300"

// marked is a handler that marks its answer, behind the security middleware's
// baseline `no-store`, the way a service's chain runs it.
func marked(status int) http.Handler {
	inner := Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(apiroutes.CDNCachePolicyHeader, testPolicy)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{}`))
	}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		inner.ServeHTTP(w, r)
	})
}

func serve(handler http.Handler, method string, headers map[string]string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, "/api/v1/games", nil)
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func TestGuestReadBecomesCacheableAtTheCDN(t *testing.T) {
	response := serve(marked(http.StatusOK), http.MethodGet, nil)

	if got := response.Header().Get(HeaderName); got != testPolicy {
		t.Errorf("%s = %q, want %q", HeaderName, got, testPolicy)
	}
	if got := response.Header().Values("Cache-Control"); len(got) != 1 || got[0] != BrowserCacheControl {
		t.Errorf("Cache-Control = %v, want the one revalidating value and no no-store", got)
	}
	if got := response.Header().Get(apiroutes.CDNCachePolicyHeader); got != "" {
		t.Errorf("the internal marker reached the client: %q", got)
	}
}

func TestOnlySuccessfulGuestReadsAreCacheable(t *testing.T) {
	cases := []struct {
		name    string
		status  int
		method  string
		headers map[string]string
	}{
		{"a signed-in read", http.StatusOK, http.MethodGet, map[string]string{"Authorization": "Bearer token"}},
		{"a failure", http.StatusServiceUnavailable, http.MethodGet, nil},
		{"a missing game", http.StatusNotFound, http.MethodGet, nil},
		{"a write", http.StatusOK, http.MethodPost, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			response := serve(marked(c.status), c.method, c.headers)

			if got := response.Header().Get(HeaderName); got != "" {
				t.Errorf("%s = %q, want none", HeaderName, got)
			}
			if got := response.Header().Get("Cache-Control"); got != "no-store" {
				t.Errorf("Cache-Control = %q, want the baseline no-store", got)
			}
			if got := response.Header().Get(apiroutes.CDNCachePolicyHeader); got != "" {
				t.Errorf("the internal marker reached the client: %q", got)
			}
		})
	}
}

func TestUnmarkedResponsesAreLeftAlone(t *testing.T) {
	handler := Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte(`{}`))
	}))
	response := serve(handler, http.MethodGet, nil)

	if got := response.Header().Get(HeaderName); got != "" {
		t.Errorf("%s = %q, want none", HeaderName, got)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
}
