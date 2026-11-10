package httpx

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/config"
)

// fakeUpstash answers the REST pipeline the way Upstash does, counting in memory.
func fakeUpstash(t *testing.T) (*httptest.Server, *int) {
	t.Helper()
	var mu sync.Mutex
	counts := map[string]int64{}
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/pipeline" || r.Header.Get("Authorization") != "Bearer test-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var cmds [][]string
		if err := json.NewDecoder(r.Body).Decode(&cmds); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		mu.Lock()
		calls++
		counts[cmds[0][1]]++
		n := counts[cmds[0][1]]
		mu.Unlock()
		_ = json.NewEncoder(w).Encode([]map[string]any{{"result": n}, {"result": 1}})
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

func sharedConfig(url string) config.RateLimit {
	return config.RateLimit{
		Enabled:           true,
		RequestsPerMinute: 3,
		Burst:             100, // the local bucket never binds here; the shared one does
		Shared:            config.SharedRateLimit{RESTURL: url, RESTToken: "test-token", Namespace: "t"},
	}
}

func TestSharedLimitSpansInstances(t *testing.T) {
	srv, _ := fakeUpstash(t)
	fixed := time.Unix(1_800_000_000, 0)
	a := NewRateLimiter(sharedConfig(srv.URL))
	b := NewRateLimiter(sharedConfig(srv.URL))
	a.now = func() time.Time { return fixed }
	b.now = func() time.Time { return fixed }

	// Three requests are the budget, split over two "instances".
	for i, l := range []*RateLimiter{a, b, a} {
		if !l.Allow("ip:1.2.3.4") {
			t.Fatalf("request %d refused inside the shared budget", i+1)
		}
	}
	if b.Allow("ip:1.2.3.4") {
		t.Fatal("fourth request allowed: the budget multiplied with instances")
	}
	if !a.Allow("ip:5.6.7.8") {
		t.Fatal("another client was charged for the first one's requests")
	}
}

func TestSharedLimitFailsOpenToLocal(t *testing.T) {
	cfg := sharedConfig("http://127.0.0.1:1") // nothing listens here
	cfg.Burst = 1
	l := NewRateLimiter(cfg)
	if !l.Allow("ip:1.2.3.4") {
		t.Fatal("an unreachable store must not refuse traffic")
	}
	if l.Allow("ip:1.2.3.4") {
		t.Fatal("the in-process bucket must still apply when the store is down")
	}
}

func TestNoSharedStoreMakesNoCalls(t *testing.T) {
	srv, calls := fakeUpstash(t)
	cfg := sharedConfig(srv.URL)
	cfg.Shared = config.SharedRateLimit{}
	l := NewRateLimiter(cfg)
	for range 5 {
		l.Allow("ip:1.2.3.4")
	}
	if *calls != 0 {
		t.Fatalf("made %d store calls without a configured store", *calls)
	}
}
