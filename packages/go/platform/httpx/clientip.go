package httpx

import (
	"context"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"

	"github.com/r1jadi/unbored/packages/go/platform/config"
)

const clientIPKey ctxKey = 2

// ClientIPDebugPath shows a caller its own forwarding headers when
// CLIENT_IP_DEBUG=1. It is unversioned, like /healthz: an operator tool, not
// part of the API contract.
const ClientIPDebugPath = "/debug/client-ip"

// forwardingHeaders are the headers proxies commonly use to report the client.
// The debug route echoes them; none is trusted unless CLIENT_IP_SOURCE names it.
var forwardingHeaders = []string{
	"X-Forwarded-For", "True-Client-IP", "CF-Connecting-IP", "X-Real-IP", "Forwarded",
}

// ClientIP resolves the caller's address once per request, as CLIENT_IP_SOURCE
// says (see config.ClientIP), and stores it for ClientKey. It must run before
// anything that meters by IP.
func ClientIP(source config.ClientIP) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := ResolveClientIP(r, source)
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), clientIPKey, ip)))
		})
	}
}

// ClientIPFrom returns the address the ClientIP middleware resolved, or "".
func ClientIPFrom(ctx context.Context) string {
	ip, _ := ctx.Value(clientIPKey).(string)
	return ip
}

// ResolveClientIP applies one CLIENT_IP_SOURCE mode to a request. Whatever the
// mode, a missing or malformed source falls back to the TCP peer, so the result
// is always an address and never text a client chose freely.
func ResolveClientIP(r *http.Request, source config.ClientIP) string {
	peer := remoteIP(r)
	var candidate string
	switch source.Mode {
	case "remote":
		return peer
	case "header":
		candidate, _, _ = strings.Cut(r.Header.Get(source.Header), ",")
	case "xff-hops":
		entries := forwardedFor(r)
		if len(entries) == 0 {
			return peer
		}
		// Fewer entries than trusted proxies means every entry was written by
		// one of them, so the leftmost is the closest to the client.
		index := max(len(entries)-source.Hops, 0)
		candidate = entries[index]
	default: // "xff-first", and the zero value in tests that build a Config by hand
		if entries := forwardedFor(r); len(entries) > 0 {
			candidate = entries[0]
		}
	}
	if ip, ok := parseIP(candidate); ok {
		return ip
	}
	return peer
}

// forwardedFor flattens every X-Forwarded-For line into one list of entries.
func forwardedFor(r *http.Request) []string {
	var entries []string
	for _, line := range r.Header.Values("X-Forwarded-For") {
		for _, entry := range strings.Split(line, ",") {
			if entry = strings.TrimSpace(entry); entry != "" {
				entries = append(entries, entry)
			}
		}
	}
	return entries
}

// parseIP accepts "1.2.3.4", "1.2.3.4:5678", "2001:db8::1" and "[2001:db8::1]:80",
// and returns the canonical form of the address.
func parseIP(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	if addr, err := netip.ParseAddr(raw); err == nil {
		return addr.Unmap().String(), true
	}
	if addrPort, err := netip.ParseAddrPort(raw); err == nil {
		return addrPort.Addr().Unmap().String(), true
	}
	return "", false
}

func remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip, ok := parseIP(host); ok {
		return ip
	}
	return host
}

// ClientIPDebugHandler answers with the caller's own forwarding headers, the
// TCP peer, what every CLIENT_IP_SOURCE mode would make of this request, and
// the mode in force. It reveals nothing about anyone but the caller, and is
// only mounted when CLIENT_IP_DEBUG=1.
//
// To see which entries a client controls, send a made-up X-Forwarded-For and
// look for it in the answer: a mode that returns it is spoofable here.
func ClientIPDebugHandler(source config.ClientIP) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		headers := map[string][]string{}
		for _, name := range forwardingHeaders {
			if values := r.Header.Values(name); len(values) > 0 {
				headers[name] = values
			}
		}
		modes := map[string]string{
			"xff-first": ResolveClientIP(r, config.ClientIP{Mode: "xff-first"}),
			"remote":    ResolveClientIP(r, config.ClientIP{Mode: "remote"}),
		}
		for _, hops := range []int{1, 2, 3} {
			modes["xff-hops:"+strconv.Itoa(hops)] = ResolveClientIP(r, config.ClientIP{Mode: "xff-hops", Hops: hops})
		}
		for _, name := range forwardingHeaders[1:4] {
			modes["header:"+name] = ResolveClientIP(r, config.ClientIP{Mode: "header", Header: name})
		}
		configured := source.Raw
		if configured == "" {
			configured = "xff-first (default)"
		}
		WriteJSON(w, r, http.StatusOK, map[string]any{
			"configured":        configured,
			"resolved":          ClientIPFrom(r.Context()),
			"remoteAddr":        r.RemoteAddr,
			"forwardingHeaders": headers,
			"modes":             modes,
		})
	}
}
