// Package proxy forwards `/api/v1/<group>` traffic from the gateway to the
// service that owns it.
//
// Two rules make this a controlled routing layer rather than an open proxy:
//   - only prefixes that map to a configured upstream are forwarded; anything
//     else is answered with a 503 envelope, never resolved dynamically, so a
//     request cannot be aimed at an arbitrary host (SSRF);
//   - client-supplied identity headers are removed, and no identity header is
//     added. Each service verifies the Authorization token itself, so a
//     compromised hop cannot grant itself a role.
package proxy

import (
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/internal/apiroutes"
)

// identityHeaders are stripped from both the inbound request and the outbound
// one. They exist so an internal caller can pass identity explicitly, but a
// public client must never be able to set them.
var identityHeaders = []string{
	"X-User-ID", "X-User-Id", "X-User-Role", "X-Admin", "X-Is-Admin",
	"X-Authenticated-User", "X-Forwarded-User", "X-Supabase-Auth",
}

// hopByHopHeaders must not be forwarded across a proxy hop.
var hopByHopHeaders = []string{
	"Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization",
	"Te", "Trailer", "Transfer-Encoding", "Upgrade",
}

// corsResponseHeaders belong to the gateway's own CORS middleware. A service
// that sets them too (it is allowed to: it may be reached directly) would
// otherwise contribute a second value, and a response carrying
// `Access-Control-Allow-Origin: a, a` is rejected by every browser. The origin
// the browser is speaking to is the gateway's, so only the gateway may answer
// for it.
var corsResponseHeaders = []string{
	"Access-Control-Allow-Origin", "Access-Control-Allow-Credentials",
	"Access-Control-Allow-Headers", "Access-Control-Allow-Methods",
	"Access-Control-Expose-Headers", "Access-Control-Max-Age",
}

// gatewayOwnedResponseHeaders are dropped from every upstream response because
// the gateway's own middleware has already set them on the response: CORS (see
// above), the security baseline, and the request ID it forwarded. The reverse
// proxy adds upstream headers beside the existing ones rather than replacing
// them, so without this each would reach the client twice.
var gatewayOwnedResponseHeaders = append(
	append([]string{"X-Request-ID"}, corsResponseHeaders...),
	httpx.SecurityHeaderNames()...,
)

// gatewayOwnedPaths are answered by the gateway's own router and are never
// proxied. They have to keep working in every environment, including the
// default one where no upstream is configured, because they are what a
// deployment checks first: `/api/v1` reports the API version and
// `/api/v1/health` reports that this process is serving requests.
var gatewayOwnedPaths = []string{apiroutes.BasePath, httpx.HealthPath}

type route struct {
	prefix   string
	service  string
	target   *url.URL
	handler  http.Handler
	upstream string
}

// Proxy routes API groups to upstream services.
type Proxy struct {
	routes []route
	logger *slog.Logger
}

// New builds the proxy from configuration. Unusable upstream URLs are dropped
// with a log line instead of failing the gateway, so one broken dependency does
// not take the whole API down.
func New(cfg *config.Config, logger *slog.Logger) *Proxy {
	p := &Proxy{logger: logger}

	for _, group := range apiroutes.Groups() {
		raw, ok := cfg.Upstreams[group.Service]
		if !ok {
			continue
		}
		target, err := parseUpstream(raw)
		if err != nil {
			logger.Error("ignoring invalid upstream URL",
				slog.String("service", group.Service),
				slog.Any("error", err),
			)
			continue
		}

		reverse := &httputil.ReverseProxy{
			Rewrite: func(pr *httputil.ProxyRequest) {
				pr.SetURL(target)
				pr.Out.Host = target.Host
				pr.SetXForwarded()
				if requestID := httpx.RequestIDFrom(pr.In.Context()); requestID != "" {
					pr.Out.Header.Set("X-Request-ID", requestID)
				}
				stripHeaders(pr.Out.Header)
			},
			Transport:    newTransport(),
			ErrorHandler: p.errorHandler(group.Service),
			ModifyResponse: func(response *http.Response) error {
				for _, name := range gatewayOwnedResponseHeaders {
					response.Header.Del(name)
				}
				return nil
			},
			FlushInterval: time.Duration(0),
		}

		p.routes = append(p.routes, route{
			prefix:   group.Prefix,
			service:  group.Service,
			target:   target,
			handler:  reverse,
			upstream: target.String(),
		})
	}

	// Longest prefix wins so /api/v1/games/featured can be split out later.
	sort.Slice(p.routes, func(i, j int) bool { return len(p.routes[i].prefix) > len(p.routes[j].prefix) })
	return p
}

// Middleware returns the proxy as a middleware. A group with a configured
// upstream is forwarded; a group without one is answered with a 503 envelope
// instead of being resolved dynamically (never an open proxy). Everything else
// continues down the chain, which is how the gateway's own routes (`/api/v1`,
// `/api/v1/health`) and the probes stay reachable.
func (p *Proxy) Middleware() httpx.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isGatewayOwned(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			for _, rt := range p.routes {
				if !strings.HasPrefix(r.URL.Path, rt.prefix) {
					continue
				}
				stripHeaders(r.Header)
				rt.handler.ServeHTTP(w, r)
				return
			}
			if strings.HasPrefix(r.URL.Path, "/api/") {
				// A known API path with no upstream must fail loudly rather
				// than fall through to the SPA or to a wildcard proxy.
				httpx.WriteError(w, r, httpx.NewError(
					httpx.CodeUnavailable,
					"This API is not available in this environment yet.",
				))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Routes lists the configured prefix to upstream mapping, for /readyz detail.
func (p *Proxy) Routes() map[string]string {
	out := make(map[string]string, len(p.routes))
	for _, rt := range p.routes {
		out[rt.prefix] = rt.upstream
	}
	return out
}

// isGatewayOwned reports whether the gateway's own router answers this path. A
// trailing slash is tolerated so `GET /api/v1/` reaches the router and gets an
// accurate "no such endpoint" instead of a misleading "this API is not available
// in this environment yet" from the unconfigured-group branch.
func isGatewayOwned(path string) bool {
	trimmed := strings.TrimSuffix(path, "/")
	for _, owned := range gatewayOwnedPaths {
		if path == owned || trimmed == owned {
			return true
		}
	}
	return false
}

func (p *Proxy) errorHandler(service string) func(http.ResponseWriter, *http.Request, error) {
	return func(w http.ResponseWriter, r *http.Request, err error) {
		p.logger.ErrorContext(r.Context(), "upstream request failed",
			slog.String("service", service),
			slog.String("path", r.URL.Path),
			slog.Any("error", err),
		)
		httpx.WriteError(w, r, httpx.NewError(
			httpx.CodeUnavailable,
			"That service is temporarily unavailable. Try again shortly.",
		))
	}
}

func parseUpstream(raw string) (*url.URL, error) {
	target, err := url.Parse(strings.TrimRight(raw, "/"))
	if err != nil {
		return nil, err
	}
	switch {
	case target.Scheme != "http" && target.Scheme != "https":
		return nil, fmt.Errorf("upstream scheme %q must be http or https", target.Scheme)
	case target.Host == "":
		return nil, fmt.Errorf("upstream URL %q has no host", raw)
	case target.RawQuery != "" || target.Fragment != "":
		return nil, fmt.Errorf("upstream URL %q must not contain a query or fragment", raw)
	}
	return target, nil
}

func newTransport() *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConnsPerHost = 32
	transport.IdleConnTimeout = 90 * time.Second
	transport.ResponseHeaderTimeout = 20 * time.Second
	transport.TLSHandshakeTimeout = 10 * time.Second
	return transport
}

func stripHeaders(header http.Header) {
	for _, name := range identityHeaders {
		header.Del(name)
	}
	for _, name := range hopByHopHeaders {
		header.Del(name)
	}
}
