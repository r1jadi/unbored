// Package config loads and validates service configuration from the
// environment. Configuration is fail-fast: a service refuses to start with an
// invalid or insecure configuration instead of falling back to a default that
// silently weakens security.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/adminallowlist"
)

// Environment names the deployment stage a service runs in.
type Environment string

const (
	EnvDevelopment Environment = "development"
	EnvStaging     Environment = "staging"
	EnvProduction  Environment = "production"
)

// IsProduction reports whether extra hardening rules apply.
func (e Environment) IsProduction() bool { return e == EnvProduction }

// IsDevelopment reports whether development-only conveniences are allowed.
func (e Environment) IsDevelopment() bool { return e == EnvDevelopment }

// HTTP holds the server level settings shared by every service.
type HTTP struct {
	Addr              string
	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	ShutdownTimeout   time.Duration
	MaxRequestBytes   int64
	MaxHeaderBytes    int
	RateLimit         RateLimit
}

// RateLimit configures the in-process token bucket limiter. It protects the
// API from abuse today; the same interface moves to Redis when the API runs on
// more than one instance (see docs/decisions/0004-rate-limiting.md).
type RateLimit struct {
	Enabled           bool
	RequestsPerMinute int
	Burst             int
}

// Supabase holds the project metadata used to verify access tokens.
//
// PublishableKey is not a secret (see below). SecretKey is: the project's
// secret key (`sb_secret_…`, legacy `SUPABASE_SERVICE_ROLE_KEY`). It bypasses
// Row Level Security by design, so it is strictly server-only — never a VITE_*
// variable, never logged, never sent to a client — and it is only loaded into
// services that perform privileged server-side work after their own
// authorization check (today: the admin API mounted in the games deployment,
// which verifies ADMIN_EMAILS first). Every other service must leave it unset.
type Supabase struct {
	ProjectURL  string
	JWKSURL     string
	JWTAudience string
	JWTIssuer   string
	JWTSecret   string // legacy HS256 projects only, server-side
	// PublishableKey is the project's publishable key (`sb_publishable_…`, the
	// legacy anon key). It is not a secret — Supabase designs it to be readable
	// by anyone — but a service needs it as the `apikey` header when it calls
	// Supabase Auth on a caller's behalf (services/auth).
	PublishableKey string
	// SecretKey authorizes privileged server-side database calls that run as the
	// service role. Today that is the admin API and the game-release digest, both
	// mounted in the games deployment after their own authorization checks. Empty
	// means unconfigured: privileged paths stay disabled and fail closed rather
	// than falling back to an unprivileged identity.
	SecretKey string
}

// Logging holds structured logging settings.
type Logging struct {
	Level  string
	Format string
}

// Config is the fully resolved configuration for one service.
type Config struct {
	Service     string
	Environment Environment
	HTTP        HTTP
	Supabase    Supabase
	Logging     Logging
	// CORSAllowedOrigins is an exact allowlist. A wildcard is rejected outside
	// development so credentials can never be sent to an untrusted origin.
	CORSAllowedOrigins []string
	// Upstreams maps a logical service name to its base URL (gateway only).
	Upstreams map[string]string
	// AdminEmails is the server-side ADMIN_EMAILS allowlist snapshot taken at
	// startup: lower-cased, trimmed, deduplicated. Enforcement reads the live
	// environment per request (see adminallowlist.Get) so a change takes
	// effect on the next request; this snapshot exists for startup logging
	// and for tests that assert what was configured. Empty means no
	// allowlist grants (fail-closed); database roles still apply.
	AdminEmails []string
}

// Getenv reads an environment variable, preferring the service-scoped name so a
// single process can be pointed at a different dependency than its neighbours.
func Getenv(keys ...string) string {
	for _, key := range keys {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			return v
		}
	}
	return ""
}

// Load resolves configuration for the named service.
func Load(service string) (*Config, error) {
	env, err := parseEnvironment(Getenv("ENVIRONMENT", "APP_ENV"))
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		Service:     service,
		Environment: env,
		HTTP: HTTP{
			// HTTP_ADDR is the explicit setting. PORT is what Vercel (and most
			// PaaS) injects, so a platform-managed process never has to guess its
			// port — see docs/deployment/vercel.md.
			Addr:              normalizeAddr(Getenv("HTTP_ADDR", "PORT_HTTP", "PORT"), ":8080"),
			ReadHeaderTimeout: 5 * time.Second,
			ReadTimeout:       15 * time.Second,
			WriteTimeout:      30 * time.Second,
			IdleTimeout:       60 * time.Second,
			ShutdownTimeout:   20 * time.Second,
			MaxRequestBytes:   1 << 20, // 1 MiB
			MaxHeaderBytes:    1 << 16, // 64 KiB
			RateLimit: RateLimit{
				Enabled:           EnvInt("RATE_LIMIT_ENABLED", 1) == 1,
				RequestsPerMinute: EnvInt("RATE_LIMIT_REQUESTS_PER_MINUTE", 600),
				Burst:             EnvInt("RATE_LIMIT_BURST", 60),
			},
		},
		Supabase: Supabase{
			ProjectURL:     strings.TrimRight(Getenv("SUPABASE_URL"), "/"),
			JWKSURL:        Getenv("SUPABASE_JWKS_URL"),
			JWTAudience:    Getenv("SUPABASE_JWT_AUDIENCE"),
			JWTIssuer:      Getenv("SUPABASE_JWT_ISSUER"),
			JWTSecret:      Getenv("SUPABASE_JWT_SECRET"),
			PublishableKey: Getenv("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"),
			// Server-only privileged credential. The legacy service-role name is
			// accepted so an existing secret store keeps working; the new name
			// wins when both are set. Never a VITE_* variable.
			SecretKey: Getenv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
		},
		Logging: Logging{
			Level:  defaultString(Getenv("LOG_LEVEL"), "info"),
			Format: defaultString(Getenv("LOG_FORMAT"), "json"),
		},
		CORSAllowedOrigins: splitList(Getenv("CORS_ALLOWED_ORIGINS")),
		Upstreams:          loadUpstreams(),
		AdminEmails:        parseAdminEmails(Getenv("ADMIN_EMAILS")),
	}

	if cfg.Supabase.JWKSURL == "" && cfg.Supabase.ProjectURL != "" {
		cfg.Supabase.JWKSURL = cfg.Supabase.ProjectURL + "/auth/v1/.well-known/jwks.json"
	}
	if cfg.Supabase.JWTIssuer == "" && cfg.Supabase.ProjectURL != "" {
		cfg.Supabase.JWTIssuer = cfg.Supabase.ProjectURL + "/auth/v1"
	}
	if cfg.Supabase.JWTAudience == "" {
		cfg.Supabase.JWTAudience = "authenticated"
	}

	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// MustLoad is Load with fail-fast semantics, used by service main functions.
func MustLoad(service string) *Config {
	cfg, err := Load(service)
	if err != nil {
		fmt.Fprintf(os.Stderr, "configuration error: %v\n", err)
		os.Exit(1)
	}
	return cfg
}

// Validate rejects configurations that would be insecure in the current
// environment. Messages name the variable to change.
func (c *Config) Validate() error {
	var problems []error

	if c.Service == "" {
		problems = append(problems, errors.New("SERVICE_NAME must not be empty"))
	}
	switch c.Logging.Level {
	case "debug", "info", "warn", "error":
	default:
		problems = append(problems, fmt.Errorf("LOG_LEVEL %q must be one of debug, info, warn, error", c.Logging.Level))
	}
	switch c.Logging.Format {
	case "json", "text":
	default:
		problems = append(problems, fmt.Errorf("LOG_FORMAT %q must be json or text", c.Logging.Format))
	}
	if c.HTTP.MaxRequestBytes <= 0 || c.HTTP.MaxRequestBytes > 64<<20 {
		problems = append(problems, fmt.Errorf("request body limit %d is outside the supported range", c.HTTP.MaxRequestBytes))
	}
	if c.HTTP.RateLimit.Enabled && c.HTTP.RateLimit.RequestsPerMinute <= 0 {
		problems = append(problems, errors.New("rate limit requires a positive requests-per-minute budget"))
	}
	if c.HTTP.RateLimit.Enabled && c.HTTP.RateLimit.Burst <= 0 {
		problems = append(problems, errors.New("rate limit requires a positive burst size"))
	}
	if !c.HTTP.RateLimit.Enabled && c.Environment.IsProduction() {
		// An environment flag that removes abuse protection is a footgun; make it
		// impossible to ship.
		problems = append(problems, errors.New("RATE_LIMIT_ENABLED=0 is not allowed in production"))
	}

	for _, origin := range c.CORSAllowedOrigins {
		if origin == "*" && !c.Environment.IsDevelopment() {
			problems = append(problems, fmt.Errorf("CORS_ALLOWED_ORIGINS must not contain \"*\" in %s", c.Environment))
		}
		if origin != "*" && !strings.HasPrefix(origin, "http://") && !strings.HasPrefix(origin, "https://") {
			problems = append(problems, fmt.Errorf("CORS origin %q must be an absolute http(s) origin", origin))
		}
	}
	if c.Environment.IsProduction() && len(c.CORSAllowedOrigins) == 0 {
		problems = append(problems, errors.New("CORS_ALLOWED_ORIGINS must be set in production"))
	}

	if c.Environment.IsProduction() {
		if c.Supabase.JWKSURL == "" && c.Supabase.JWTSecret == "" {
			problems = append(problems, errors.New("production requires SUPABASE_JWKS_URL (preferred) or SUPABASE_JWT_SECRET"))
		}
		if c.Supabase.JWKSURL != "" && !strings.HasPrefix(c.Supabase.JWKSURL, "https://") {
			problems = append(problems, errors.New("SUPABASE_JWKS_URL must use https in production"))
		}
	}

	return errors.Join(problems...)
}

// HasAuthMaterial reports whether tokens can be verified.
func (c *Config) HasAuthMaterial() bool {
	return c.Supabase.JWKSURL != "" || c.Supabase.JWTSecret != ""
}

// HasAuthAPI reports whether the service can call Supabase's hosted Auth API on
// a caller's behalf. Verification needs only the JWKS; the auth service
// additionally needs the project URL and the publishable key, and answers 503 on
// its credential endpoints until both are set.
func (c *Config) HasAuthAPI() bool {
	return c.Supabase.ProjectURL != "" && c.Supabase.PublishableKey != ""
}

// HasPrivilegedData reports whether the service may make privileged
// service-role database calls. The key bypasses Row Level Security, so callers
// must authorize first (the admin service verifies ADMIN_EMAILS) and must fail
// closed — never fall back to pretending an unprivileged call succeeded — when
// this is false.
func (c *Config) HasPrivilegedData() bool {
	return c.Supabase.SecretKey != ""
}

func parseEnvironment(raw string) (Environment, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", string(EnvDevelopment), "dev", "local":
		return EnvDevelopment, nil
	case string(EnvStaging), "stage", "preview":
		return EnvStaging, nil
	case string(EnvProduction), "prod":
		return EnvProduction, nil
	default:
		return "", fmt.Errorf("ENVIRONMENT %q must be development, staging or production", raw)
	}
}

func loadUpstreams() map[string]string {
	names := []string{
		"auth", "users", "games", "game-sessions", "scores", "leaderboards",
		"feed", "recommendations", "social", "notifications", "search",
		"moderation", "analytics", "admin",
	}
	upstreams := make(map[string]string, len(names))
	for _, name := range names {
		key := "UPSTREAM_" + strings.ToUpper(strings.ReplaceAll(name, "-", "_")) + "_URL"
		if v := strings.TrimRight(Getenv(key), "/"); v != "" {
			upstreams[name] = v
		}
	}
	return upstreams
}

// parseAdminEmails parses ADMIN_EMAILS with the single implementation in
// adminallowlist, so the snapshot and the per-request check cannot disagree
// on trimming, casing or fail-closed behaviour.
func parseAdminEmails(raw string) []string {
	return adminallowlist.Parse(raw)
}

func splitList(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if v := strings.TrimSpace(p); v != "" {
			out = append(out, strings.TrimRight(v, "/"))
		}
	}
	return out
}

func defaultString(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return v
}

// normalizeAddr turns the ways a host names a listen port into an address
// net.Listen accepts. An explicit ":8080" or "0.0.0.0:8080" is returned
// unchanged, while a bare port — which is how Vercel passes PORT — gets the
// colon it needs; without that, "8080" would be read as a host name and the
// server would refuse to start.
func normalizeAddr(raw, fallback string) string {
	v := strings.TrimSpace(raw)
	if v == "" {
		return fallback
	}
	if _, err := strconv.Atoi(v); err == nil {
		return ":" + v
	}
	return v
}

// EnvInt parses an integer environment variable with a fallback. Exported for
// services that need their own tuning knobs.
func EnvInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return v
}
