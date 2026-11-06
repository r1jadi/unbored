package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/r1jadi/unbored/services/internal/apiroutes"
)

const testPolicy = "s-maxage=60, stale-while-revalidate=300"

// markedHandler is the gateway in front of a service that marks its answers, with the
// security middleware's baseline already on the response.
func markedHandler(t *testing.T, status int) http.Handler {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(apiroutes.CDNCachePolicyHeader, testPolicy)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(upstream.Close)
	handler := proxyHandler(t, map[string]string{"games": upstream.URL})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		handler.ServeHTTP(w, r)
	})
}

func TestGuestReadBecomesCacheableAtTheCDN(t *testing.T) {
	response := do(t, markedHandler(t, http.StatusOK), http.MethodGet, "/api/v1/games", nil)
	defer response.Body.Close()

	if got := response.Header.Get("Vercel-CDN-Cache-Control"); got != testPolicy {
		t.Errorf("Vercel-CDN-Cache-Control = %q, want %q", got, testPolicy)
	}
	if got := response.Header.Values("Cache-Control"); len(got) != 1 || got[0] != "public, max-age=0, must-revalidate" {
		t.Errorf("Cache-Control = %v, want the one revalidating value and no no-store", got)
	}
	if got := response.Header.Get(apiroutes.CDNCachePolicyHeader); got != "" {
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
			response := do(t, markedHandler(t, c.status), c.method, "/api/v1/games", c.headers)
			defer response.Body.Close()

			if got := response.Header.Get("Vercel-CDN-Cache-Control"); got != "" {
				t.Errorf("Vercel-CDN-Cache-Control = %q, want none", got)
			}
			if got := response.Header.Get("Cache-Control"); got != "no-store" {
				t.Errorf("Cache-Control = %q, want the baseline no-store", got)
			}
			if got := response.Header.Get(apiroutes.CDNCachePolicyHeader); got != "" {
				t.Errorf("the internal marker reached the client: %q", got)
			}
		})
	}
}

func TestUnmarkedResponsesAreLeftAlone(t *testing.T) {
	rec := newRecorder(t)
	handler := proxyHandler(t, map[string]string{"auth": rec.server.URL})
	response := do(t, handler, http.MethodGet, "/api/v1/auth/session", nil)
	defer response.Body.Close()

	if got := response.Header.Get("Vercel-CDN-Cache-Control"); got != "" {
		t.Errorf("Vercel-CDN-Cache-Control = %q, want none", got)
	}
}
