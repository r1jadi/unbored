package config

import "testing"

// clearAddressEnv removes the variables Load uses to pick a listen address, so a
// case never inherits one from the developer's shell or from CI.
func clearAddressEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{"HTTP_ADDR", "PORT_HTTP", "PORT"} {
		t.Setenv(key, "")
	}
}

func TestListenAddressFollowsThePlatformPort(t *testing.T) {
	// Vercel (like most PaaS) hands the process a bare port in PORT. Reading it
	// as a host name instead of a port is the difference between a deployment
	// that boots and one that fails its first health check.
	cases := []struct {
		name string
		env  map[string]string
		want string
	}{
		{name: "platform injected bare port", env: map[string]string{"PORT": "3000"}, want: ":3000"},
		{name: "explicit address wins over the platform", env: map[string]string{"PORT": "3000", "HTTP_ADDR": "127.0.0.1:9090"}, want: "127.0.0.1:9090"},
		{name: "PORT_HTTP still beats PORT", env: map[string]string{"PORT": "3000", "PORT_HTTP": ":7070"}, want: ":7070"},
		{name: "local default", env: nil, want: ":8080"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			clearAddressEnv(t)
			t.Setenv("ENVIRONMENT", "development")
			for key, value := range testCase.env {
				t.Setenv(key, value)
			}

			cfg, err := Load("gateway")
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if cfg.HTTP.Addr != testCase.want {
				t.Fatalf("HTTP.Addr = %q, want %q", cfg.HTTP.Addr, testCase.want)
			}
		})
	}
}

func TestVercelProductionEnvironmentBootsWithJwksOnly(t *testing.T) {
	// The documented production environment of the Vercel deployment
	// (docs/deployment/vercel.md): the project URL is enough because the service
	// derives the JWKS endpoint from it, so no shared HS256 secret is needed.
	clearAddressEnv(t)
	t.Setenv("ENVIRONMENT", "production")
	t.Setenv("PORT", "3000")
	t.Setenv("LOG_LEVEL", "info")
	t.Setenv("LOG_FORMAT", "json")
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://unbored.lol")
	t.Setenv("RATE_LIMIT_ENABLED", "1")
	t.Setenv("SUPABASE_URL", "https://abcdefghijklmnop.supabase.co")
	t.Setenv("SUPABASE_JWKS_URL", "")
	t.Setenv("SUPABASE_JWT_SECRET", "")

	cfg, err := Load("gateway")
	if err != nil {
		t.Fatalf("the documented Vercel production environment was rejected: %v", err)
	}

	const wantJWKS = "https://abcdefghijklmnop.supabase.co/auth/v1/.well-known/jwks.json"
	if cfg.Supabase.JWKSURL != wantJWKS {
		t.Errorf("Supabase.JWKSURL = %q, want %q", cfg.Supabase.JWKSURL, wantJWKS)
	}
	if cfg.Supabase.JWTIssuer != "https://abcdefghijklmnop.supabase.co/auth/v1" {
		t.Errorf("Supabase.JWTIssuer = %q, want the derived issuer", cfg.Supabase.JWTIssuer)
	}
	if cfg.Supabase.JWTSecret != "" {
		t.Error("the deployment must verify against the JWKS, never a shared HS256 secret")
	}
	if !cfg.HasAuthMaterial() {
		t.Error("auth material is missing, so every authenticated route would answer 503")
	}
	if cfg.Environment != EnvProduction {
		t.Errorf("Environment = %q, want production", cfg.Environment)
	}
}

func TestAdminEmailsSnapshotIsParsedButNeverRequired(t *testing.T) {
	// The allowlist is fail-closed and optional: a deployment without it boots
	// and keeps its database roles; enforcement reads the live environment per
	// request (see adminallowlist), this snapshot is for logging and tests.
	clearAddressEnv(t)
	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("ADMIN_EMAILS", "  Admin@Example.com ,another@example.com,,not-an-email ")

	cfg, err := Load("gateway")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.AdminEmails) != 2 || cfg.AdminEmails[0] != "admin@example.com" || cfg.AdminEmails[1] != "another@example.com" {
		t.Fatalf("AdminEmails = %v, want the two parsed addresses", cfg.AdminEmails)
	}

	t.Setenv("ADMIN_EMAILS", "")
	cfg, err = Load("gateway")
	if err != nil {
		t.Fatalf("Load without an allowlist: %v", err)
	}
	if len(cfg.AdminEmails) != 0 {
		t.Fatalf("AdminEmails = %v, want empty (fail-closed, but booting)", cfg.AdminEmails)
	}
}
