package httpx

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/authn"
	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/identity"
	"github.com/r1jadi/unbored/packages/go/platform/version"
)

// APIVersion is the only API version served at this point. Paths outside a
// version prefix are not part of the contract.
const APIVersion = version.APIVersion

// Router wraps http.ServeMux with the three authorization tiers the API
// contracts distinguish: public, authenticated and admin.
type Router struct {
	mux      *http.ServeMux
	cfg      *config.Config
	verifier *authn.Verifier
	logger   *slog.Logger
	limiter  *RateLimiter
}

// RouterOptions wires a router.
type RouterOptions struct {
	Config *config.Config
	// Verifier may be nil for services without auth material yet; authenticated
	// and admin groups then fail closed with 503 instead of allowing anyone in.
	Verifier *authn.Verifier
	Logger   *slog.Logger
	// Limiter enables a second, per-user bucket on authenticated routes. The
	// outer limiter in NewServer buckets anonymous traffic by IP.
	Limiter *RateLimiter
}

// NewRouter builds a router from its options.
func NewRouter(opts RouterOptions) *Router {
	return &Router{
		mux:      http.NewServeMux(),
		cfg:      opts.Config,
		verifier: opts.Verifier,
		logger:   opts.Logger,
		limiter:  opts.Limiter,
	}
}

// Mux exposes the underlying mux for probe registration.
func (r *Router) Mux() *http.ServeMux { return r.mux }

// Public registers a route that anyone may call.
func (r *Router) Public(pattern string, handler http.Handler) { r.mux.Handle(pattern, handler) }

// PublicFunc registers a public handler function.
func (r *Router) PublicFunc(pattern string, handler http.HandlerFunc) { r.mux.Handle(pattern, handler) }

// OptionalAuth registers a route that serves both anonymous and authenticated
// callers, with personalisation applied only when a token is valid.
func (r *Router) OptionalAuth(pattern string, handler http.Handler) {
	r.mux.Handle(pattern, r.requireAuth(false)(handler))
}

// OptionalAuthFunc registers an optional-auth handler function.
func (r *Router) OptionalAuthFunc(pattern string, handler http.HandlerFunc) {
	r.mux.Handle(pattern, r.requireAuth(false)(handler))
}

// Authenticated registers a route that requires a verified Supabase token.
func (r *Router) Authenticated(pattern string, handler http.Handler) {
	r.mux.Handle(pattern, r.requireAuth(true)(handler))
}

// Admin registers a route that additionally requires administrator access.
//
// ADMIN_EMAILS is the single source of truth (see authn.RequireAdmin): a
// verified token email in the server-side allowlist passes, anything else is
// refused — including token role claims and database rows. The email is taken
// from the verified identity only, never from a body, query or header, and an
// empty allowlist grants no one.
func (r *Router) Admin(pattern string, handler http.Handler) {
	r.mux.Handle(pattern, r.requireAuth(true)(authn.RequireAdmin()(handler)))
}

// AdminFunc registers an admin handler function.
func (r *Router) AdminFunc(pattern string, handler http.HandlerFunc) { r.Admin(pattern, handler) }

// Moderator registers a route that requires administrator access under the
// single-source model (see authn.RequireModerator): the same allowlist
// decides. There is no separate moderator grant.
func (r *Router) Moderator(pattern string, handler http.Handler) {
	r.mux.Handle(pattern, r.requireAuth(true)(authn.RequireModerator()(handler)))
}

// ModeratorFunc registers a moderator handler function.
func (r *Router) ModeratorFunc(pattern string, handler http.HandlerFunc) {
	r.Moderator(pattern, handler)
}

// AuthenticatedFunc registers an authenticated handler function.
func (r *Router) AuthenticatedFunc(pattern string, handler http.HandlerFunc) {
	r.Authenticated(pattern, handler)
}

// NotFoundHandler answers unknown API paths with the standard envelope instead
// of the default text/plain 404.
func NotFoundHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		WriteError(w, r, NewError(CodeNotFound, "No such endpoint."))
	}
}

func (r *Router) methodHandler() http.Handler {
	mux := r.mux
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// ServeMux's own 404 for an unregistered path.
		NotFoundHandler()(w, r)
	})
	return mux
}

// requireAuth authenticates first and only then applies the per-user rate
// limit, so an authenticated caller is metered by verified user id rather than
// by a spoofable header.
func (r *Router) requireAuth(required bool) Middleware {
	// authn.Middleware returns the bare function type, which is assignable to
	// httpx.Middleware without the two packages importing each other.
	auth := authn.Middleware(authn.MiddlewareOptions{
		Verifier: r.verifier,
		Required: required,
		Logger:   r.logger,
	})
	if r.limiter == nil || !r.cfg.HTTP.RateLimit.Enabled {
		return auth
	}
	limit := authenticatedRateLimit(r.limiter, r.cfg.HTTP.RateLimit)
	return func(next http.Handler) http.Handler { return auth(limit(next)) }
}

// authenticatedRateLimit meters verified callers by user id. Anonymous traffic
// is already metered by IP in NewServer, so it is not charged twice.
func authenticatedRateLimit(limiter *RateLimiter, cfg config.RateLimit) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id, ok := identity.FromContext(r.Context())
			if !ok || id.Anonymous || id.UserID == "" {
				next.ServeHTTP(w, r)
				return
			}
			if !limiter.Allow("user:" + id.UserID) {
				w.Header().Set("Retry-After", "30")
				WriteError(w, r, NewError(CodeRateLimited, "Too many requests. Slow down and try again shortly."))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ServerOptions configures Run.
type ServerOptions struct {
	Config  *config.Config
	Router  *Router
	Health  *Health
	Logger  *slog.Logger
	Limiter *RateLimiter
	// ExtraLimiters are additional buckets a service created for its own
	// endpoints (the auth service's credential endpoints). Run keeps them
	// garbage collected alongside the shared limiter.
	ExtraLimiters []*RateLimiter
	// ExtraHandlers run after the middleware chain, before the mux. The gateway
	// uses this hook to install its reverse proxy.
	ExtraHandlers []Middleware
}

// NewServer assembles the full handler chain.
//
// Execution order, outermost first:
//
//	request id → client ip → recovery → security headers → CORS →
//	identity strip → logging → rate limit → body limit → extra handlers → routes
//
// The client-supplied identity headers are stripped before anything can read
// them, and the limiter is the outermost layer that can still be keyed by IP.
// The client address is resolved once, first, from CLIENT_IP_SOURCE.
func NewServer(opts ServerOptions) *http.Server {
	if opts.Config.HTTP.ClientIP.Debug {
		opts.Router.mux.HandleFunc("GET "+ClientIPDebugPath, ClientIPDebugHandler(opts.Config.HTTP.ClientIP))
	}
	handler := opts.Router.methodHandler()
	handler = Chain(handler,
		BodyLimit(opts.Config.HTTP.MaxRequestBytes),
		RateLimit(opts.Limiter, opts.Config.HTTP.RateLimit),
	)
	if len(opts.ExtraHandlers) > 0 {
		handler = Chain(handler, opts.ExtraHandlers...)
	}

	middlewares := []Middleware{
		RequestID,
		ClientIP(opts.Config.HTTP.ClientIP),
		Recover(opts.Logger),
		SecurityHeaders(opts.Config.Environment),
		CORS(opts.Config),
		StripIdentityHeaders,
		RequestLogger(opts.Logger),
	}

	return &http.Server{
		Addr:              opts.Config.HTTP.Addr,
		Handler:           Chain(handler, middlewares...),
		ReadHeaderTimeout: opts.Config.HTTP.ReadHeaderTimeout,
		ReadTimeout:       opts.Config.HTTP.ReadTimeout,
		WriteTimeout:      opts.Config.HTTP.WriteTimeout,
		IdleTimeout:       opts.Config.HTTP.IdleTimeout,
		MaxHeaderBytes:    opts.Config.HTTP.MaxHeaderBytes,
		ErrorLog:          slog.NewLogLogger(opts.Logger.Handler(), slog.LevelWarn),
	}
}

// Run starts the server and blocks until a termination signal or a fatal error.
// It performs a graceful shutdown and fails fast on configuration problems.
func Run(opts ServerOptions) error {
	server := NewServer(opts)
	logger := opts.Logger

	// One ticker, every bucket: a limiter that is never cleaned up grows without
	// bound, so a service cannot forget one.
	limiters := make([]*RateLimiter, 0, len(opts.ExtraLimiters)+1)
	if opts.Limiter != nil {
		limiters = append(limiters, opts.Limiter)
	}
	limiters = append(limiters, opts.ExtraLimiters...)
	if len(limiters) > 0 {
		go func() {
			ticker := time.NewTicker(10 * time.Minute)
			defer ticker.Stop()
			for range ticker.C {
				for _, limiter := range limiters {
					limiter.Cleanup()
				}
			}
		}()
	}

	rootCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		logger.Info("service listening",
			slog.String("addr", server.Addr),
			slog.String("api_version", APIVersion),
			slog.String("version", version.Version),
		)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-rootCtx.Done():
		logger.Info("shutdown signal received, draining")
	}

	opts.Health.Drain()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), opts.Config.HTTP.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", slog.Any("error", err))
		return server.Close()
	}
	logger.Info("shutdown complete")
	return nil
}

// ServiceName normalises a service name for logs and the SERVICE_NAME default.
func ServiceName(name string) string { return strings.ToLower(strings.TrimSpace(name)) }
