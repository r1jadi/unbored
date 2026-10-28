# services

Every backend service lives here, in one Go module
(`github.com/r1jadi/unbored/services`). Each service has its own `cmd/<name>`
binary, so they deploy independently while sharing one module. The reasoning is in
[../docs/decisions/0001-go-module-strategy.md](../docs/decisions/0001-go-module-strategy.md).

```
services/
├── gateway/                    the only public entry point; owns /api/v1 and proxies by prefix
├── auth/                       session lifecycle on top of Supabase Auth
├── users/                      profiles
├── games/                      catalogue and game metadata
├── game-sessions/              play sessions; the only path to a score
├── scores/                     score records (read-only to clients)
├── leaderboards/               global and friends boards
├── feed/                       the personalised feed
├── recommendations/            suggestions
├── social/                     comments, follows, likes
├── notifications/              the new-games email digest; in-app/push scaffolded
├── search/                     games, creators, players
├── moderation/                 reports and moderation actions
├── analytics/                  product events and dashboards
├── admin/                      the operations API behind the admin dashboard
└── internal/
    ├── apiroutes/              URL prefix → service table (single source of truth)
    └── servicekit/             the bootstrap every cmd/ uses
```

## A service main is tiny on purpose

```go
package main

import (
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/internal/servicekit"
)

const serviceName = "users"

func main() {
	servicekit.MustRun(servicekit.Options{
		Name: serviceName,
		Register: func(router *httpx.Router) {
			router.AuthenticatedFunc("GET /api/v1/users/me",
				httpx.NotImplemented(serviceName, "Reading the signed-in profile"))
		},
	})
}
```

`servicekit` provides, and a service cannot opt out of: validated fail-fast
configuration, structured logging, JWT verification, the full middleware chain
(security headers, CORS, request ids, request logging, body limit, rate limiting),
`/healthz` and `/readyz`, and graceful shutdown with readiness draining.

`httpx.NotImplemented(service, endpoint)` answers `501` with the standard envelope
for an endpoint that is in the contract but not implemented yet. That is the
current state of every product endpoint, and it is deliberate: the route exists, is
authorized and is rate limited, so clients fail predictably instead of hitting a
`404`.

## Commands

```bash
go build ./...                 # every binary
go test ./...                  # unit + integration tests
go vet ./...
go test -race ./...            # needs cgo and a C toolchain (CI runs this)

# run the gateway against a local database
ENVIRONMENT=development LOG_FORMAT=text CORS_ALLOWED_ORIGINS=http://localhost:8081 \
  go run ./gateway/cmd/gateway
```

## Rules

- Route tiers come from the router: `Public`, `OptionalAuthFunc`, `Authenticated`,
  `Moderator`, `Admin`. There is no unguarded handler.
- Identity comes from `identity.FromContext(r.Context())`, never from the request.
- Validate everything the client sends: `httpx.DecodeJSON` for bodies (rejects
  unknown fields), `httpx.RequireQuery` for required query values, explicit range
  and format checks in the handler.
- When a service owns data, its rules must also exist in the database (grants, RLS,
  constraints). See [../docs/security/data-access.md](../docs/security/data-access.md).
- A new endpoint needs its OpenAPI entry, its prefix in `internal/apiroutes`, and a
  test for the tier boundary — see
  [../docs/development/testing.md](../docs/development/testing.md).
