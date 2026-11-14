package httpx

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/r1jadi/unbored/packages/go/platform/config"
)

func request(remote string, headers map[string][]string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/api/v1/games", nil)
	r.RemoteAddr = remote
	for name, values := range headers {
		for _, v := range values {
			r.Header.Add(name, v)
		}
	}
	return r
}

func TestResolveClientIP(t *testing.T) {
	// A client sent "6.6.6.6"; two proxies appended the client's real address
	// (203.0.113.9) and then their own (10.0.0.2). The TCP peer is the last proxy.
	spoofed := map[string][]string{"X-Forwarded-For": {"6.6.6.6, 203.0.113.9", "10.0.0.2"}}
	cases := []struct {
		name    string
		source  string
		remote  string
		headers map[string][]string
		want    string
	}{
		{"default takes the leftmost entry, spoofable", "", "10.0.0.3:443", spoofed, "6.6.6.6"},
		{"one trusted proxy: the last entry", "xff-hops:1", "10.0.0.3:443", spoofed, "10.0.0.2"},
		{"two trusted proxies: the client they saw", "xff-hops:2", "10.0.0.3:443", spoofed, "203.0.113.9"},
		{"more hops than entries: the leftmost", "xff-hops:9", "10.0.0.3:443", spoofed, "6.6.6.6"},
		{"no header: the peer", "xff-hops:1", "198.51.100.4:5000", nil, "198.51.100.4"},
		{"trusted header", "header:True-Client-IP", "10.0.0.3:443",
			map[string][]string{"True-Client-IP": {"203.0.113.9"}, "X-Forwarded-For": {"6.6.6.6"}}, "203.0.113.9"},
		{"trusted header missing: the peer", "header:True-Client-IP", "10.0.0.3:443", spoofed, "10.0.0.3"},
		{"remote ignores every header", "remote", "10.0.0.3:443", spoofed, "10.0.0.3"},
		{"garbage is never a key", "", "10.0.0.3:443",
			map[string][]string{"X-Forwarded-For": {"not-an-ip, 1.2.3.4"}}, "10.0.0.3"},
		{"port and brackets are stripped", "xff-hops:1", "10.0.0.3:443",
			map[string][]string{"X-Forwarded-For": {"[2001:db8::1]:8080"}}, "2001:db8::1"},
		{"IPv4-mapped IPv6 is unmapped", "header:X-Real-IP", "10.0.0.3:443",
			map[string][]string{"X-Real-IP": {"::ffff:203.0.113.9"}}, "203.0.113.9"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			source := config.ParseClientIP(tc.source)
			if source.Err != nil {
				t.Fatal(source.Err)
			}
			if got := ResolveClientIP(request(tc.remote, tc.headers), source); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestClientKeyUsesTheResolvedAddress(t *testing.T) {
	source := config.ParseClientIP("xff-hops:1")
	var key string
	handler := ClientIP(source)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key = ClientKey(r)
	}))
	// Each request claims a different leftmost address; the bucket must not follow it.
	for _, claimed := range []string{"1.1.1.1", "2.2.2.2"} {
		handler.ServeHTTP(httptest.NewRecorder(), request("10.0.0.3:443",
			map[string][]string{"X-Forwarded-For": {claimed + ", 203.0.113.9"}}))
		if key != "ip:203.0.113.9" {
			t.Fatalf("claimed %s: key %q, want ip:203.0.113.9", claimed, key)
		}
	}
}

func TestParseClientIPRejectsNonsense(t *testing.T) {
	for _, raw := range []string{"xff-hops:0", "xff-hops:x", "xff-hops:11", "header:", "header:bad header", "first"} {
		if config.ParseClientIP(raw).Err == nil {
			t.Errorf("%q was accepted", raw)
		}
	}
}

func TestClientIPDebugShowsOnlyTheCallersHeaders(t *testing.T) {
	source := config.ParseClientIP("xff-hops:1")
	handler := ClientIP(source)(ClientIPDebugHandler(source))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request("10.0.0.3:443",
		map[string][]string{"X-Forwarded-For": {"6.6.6.6, 203.0.113.9"}, "Authorization": {"Bearer secret"}}))

	var body struct {
		Configured        string              `json:"configured"`
		Resolved          string              `json:"resolved"`
		ForwardingHeaders map[string][]string `json:"forwardingHeaders"`
		Modes             map[string]string   `json:"modes"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Configured != "xff-hops:1" || body.Resolved != "203.0.113.9" {
		t.Fatalf("configured %q resolved %q", body.Configured, body.Resolved)
	}
	if body.Modes["xff-first"] != "6.6.6.6" || body.Modes["xff-hops:2"] != "6.6.6.6" {
		t.Fatalf("modes %v", body.Modes)
	}
	if _, leaked := body.ForwardingHeaders["Authorization"]; leaked {
		t.Fatal("the debug route echoed a non-forwarding header")
	}
}
