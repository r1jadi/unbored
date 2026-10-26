package httpx

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/identity"
	"github.com/r1jadi/unbored/packages/go/platform/logging"
)

type ctxKey int

const requestIDKey ctxKey = 1

// RequestIDFrom returns the request id, or "" when the middleware is absent.
func RequestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}

// Middleware decorates an http.Handler.
type Middleware func(http.Handler) http.Handler

// Chain applies middleware so the first argument is the outermost layer.
func Chain(h http.Handler, middlewares ...Middleware) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		h = middlewares[i](h)
	}
	return h
}

var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{8,64}$`)

// RequestID trusts an inbound request id only when it looks like one; otherwise
// a fresh id is generated. This keeps logs correlatable without letting a
// caller poison them.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if !requestIDPattern.MatchString(id) {
			id = newRequestID()
		}
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey, id)))
	})
}

func newRequestID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return "req-" + time.Now().UTC().Format("20060102150405.000000")
	}
	return hex.EncodeToString(buf)
}

// RequestLogger logs one structured line per request with the request id and,
// when present, the caller identity.
func RequestLogger(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			ctx := logging.WithLogger(r.Context(), logger.With(slog.String("request_id", RequestIDFrom(r.Context()))))
			next.ServeHTTP(recorder, r.WithContext(ctx))

			attrs := []slog.Attr{
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", recorder.status),
				slog.Int("bytes", recorder.bytes),
				slog.Duration("duration", time.Since(start).Round(time.Millisecond)),
			}
			if id, ok := identity.FromContext(r.Context()); ok && !id.Anonymous {
				attrs = append(attrs, slog.String("user_id", id.UserID))
			}
			logger.LogAttrs(r.Context(), slog.LevelInfo, "http_request", attrs...)
		})
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (s *statusRecorder) WriteHeader(status int) {
	s.status = status
	s.ResponseWriter.WriteHeader(status)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	n, err := s.ResponseWriter.Write(b)
	s.bytes += n
	return n, err
}

// Recover converts a panic into a logged 500 using the standard envelope.
func Recover(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					logger.ErrorContext(r.Context(), "panic recovered",
						slog.Any("panic", rec),
						slog.String("path", r.URL.Path),
						slog.String("method", r.Method),
					)
					WriteError(w, r, NewError(CodeInternal, "Something went wrong on our side."))
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// securityHeaders is the API baseline. HSTS is listed separately because it is
// only sent in production.
var securityHeaders = [][2]string{
	{"X-Content-Type-Options", "nosniff"},
	{"X-Frame-Options", "DENY"},
	{"Referrer-Policy", "no-referrer"},
	{"Cross-Origin-Resource-Policy", "same-site"},
	{"Cross-Origin-Opener-Policy", "same-origin"},
	{"Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()"},
	{"Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"},
	{"Cache-Control", "no-store"},
}

const hstsHeader = "Strict-Transport-Security"

// SecurityHeaderNames lists every header SecurityHeaders may set. A proxy in
// front of a service that also runs SecurityHeaders drops these from the
// upstream response, or the client receives each one twice — and a repeated
// Strict-Transport-Security header is non-compliant with RFC 6797.
func SecurityHeaderNames() []string {
	names := make([]string, 0, len(securityHeaders)+1)
	for _, header := range securityHeaders {
		names = append(names, header[0])
	}
	return append(names, hstsHeader)
}

// SecurityHeaders applies the API baseline. The web app sets its own document
// headers; these protect JSON responses.
func SecurityHeaders(env config.Environment) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			for _, header := range securityHeaders {
				h.Set(header[0], header[1])
			}
			if env.IsProduction() {
				h.Set(hstsHeader, "max-age=63072000; includeSubDomains; preload")
			}
			next.ServeHTTP(w, r)
		})
	}
}

// CORS enforces an exact origin allowlist. Credentials are never combined with
// a wildcard, and unknown origins receive no CORS headers at all.
func CORS(cfg *config.Config) Middleware {
	allowed := make(map[string]struct{}, len(cfg.CORSAllowedOrigins))
	wildcard := false
	for _, origin := range cfg.CORSAllowedOrigins {
		if origin == "*" {
			wildcard = true
			continue
		}
		allowed[origin] = struct{}{}
	}
	devFallback := cfg.Environment.IsDevelopment() && len(allowed) == 0

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" {
				_, ok := allowed[origin]
				switch {
				case ok || (devFallback && isLoopbackOrigin(origin)):
					h := w.Header()
					h.Set("Access-Control-Allow-Origin", origin)
					h.Set("Access-Control-Allow-Credentials", "true")
					h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
					h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID")
					h.Set("Access-Control-Expose-Headers", "X-Request-ID")
					h.Set("Access-Control-Max-Age", "600")
					h.Add("Vary", "Origin")
				case wildcard:
					w.Header().Set("Access-Control-Allow-Origin", "*")
				}

				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusNoContent)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func isLoopbackOrigin(origin string) bool {
	for _, prefix := range []string{"http://localhost:", "http://127.0.0.1:", "http://[::1]:"} {
		if strings.HasPrefix(origin, prefix) {
			return true
		}
	}
	return false
}

// BodyLimit caps the request body for every route so an oversized payload is
// rejected before it can be buffered.
func BodyLimit(limit int64) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, limit)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RateLimiter is a per-client token bucket. It is deliberately in-process: the
// API runs as a single instance today, and the interface is small enough to be
// backed by Redis when that changes (docs/decisions/0004-rate-limiting.md).
type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64
	burst   float64
	now     func() time.Time
}

type bucket struct {
	tokens   float64
	lastSeen time.Time
}

// NewRateLimiter builds a limiter from configuration.
func NewRateLimiter(cfg config.RateLimit) *RateLimiter {
	return &RateLimiter{
		buckets: make(map[string]*bucket),
		rate:    float64(cfg.RequestsPerMinute) / 60.0,
		burst:   float64(max(cfg.Burst, 1)),
		now:     time.Now,
	}
}

// Allow reports whether a client may make a request now.
func (l *RateLimiter) Allow(client string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	b, ok := l.buckets[client]
	if !ok || now.Sub(b.lastSeen) > 10*time.Minute {
		b = &bucket{tokens: l.burst, lastSeen: now}
		l.buckets[client] = b
	}

	elapsed := now.Sub(b.lastSeen).Seconds()
	b.lastSeen = now
	b.tokens = min(l.burst, b.tokens+elapsed*l.rate)
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// Cleanup drops idle buckets so the map cannot grow without bound.
func (l *RateLimiter) Cleanup() {
	l.mu.Lock()
	defer l.mu.Unlock()
	cutoff := l.now().Add(-15 * time.Minute)
	for key, b := range l.buckets {
		if b.lastSeen.Before(cutoff) {
			delete(l.buckets, key)
		}
	}
}

// RateLimit rejects clients that exceed their budget.
func RateLimit(limiter *RateLimiter, cfg config.RateLimit) Middleware {
	return func(next http.Handler) http.Handler {
		if !cfg.Enabled || limiter == nil {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Health probes must never be rate limited: a throttled client
			// would otherwise turn a healthy deployment red.
			if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" || r.URL.Path == HealthPath {
				next.ServeHTTP(w, r)
				return
			}
			if !limiter.Allow(ClientKey(r)) {
				w.Header().Set("Retry-After", "30")
				WriteError(w, r, NewError(CodeRateLimited, "Too many requests. Slow down and try again shortly."))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ClientKey names the bucket a request is metered in: the verified user id when
// the caller is authenticated, otherwise the client IP. It is exported so a
// service can add its own, tighter bucket to a sensitive endpoint (the auth
// service meters credential attempts by IP and by account) without inventing a
// second way to identify a caller.
func ClientKey(r *http.Request) string {
	if id, ok := identity.FromContext(r.Context()); ok && !id.Anonymous && id.UserID != "" {
		return "user:" + id.UserID
	}
	// Behind Vercel the first entry of X-Forwarded-For is the real client. It is
	// only a bucketing hint — never an authorization input.
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		first, _, _ := strings.Cut(forwarded, ",")
		if first = strings.TrimSpace(first); first != "" {
			return "ip:" + first
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return "ip:" + host
	}
	return "ip:" + r.RemoteAddr
}

// StripIdentityHeaders removes headers a client might use to impersonate an
// authenticated caller downstream. The gateway installs this so no service can
// mistake a client-supplied header for verified identity.
func StripIdentityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, header := range []string{
			"X-User-ID", "X-User-Id", "X-Authenticated-User", "X-User-Role",
			"X-Admin", "X-Is-Admin", "X-Forwarded-User", "X-Supabase-Auth",
		} {
			r.Header.Del(header)
		}
		next.ServeHTTP(w, r)
	})
}
