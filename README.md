# Unbored

Unbored is short games you can play instantly, with scores that mean something and
people you follow to beat.

The repository holds the whole product: a TanStack Start web app, a Go API split
into independent services behind one gateway, and a Supabase (Postgres) database
whose authorization lives in Row Level Security rather than in application code.

- **Web** — <https://unboredapp.vercel.app>
- **API** — <https://unboredapp.vercel.app/api/v1> (a service of the same Vercel project)
- **Source** — <https://github.com/r1jadi/unbored>

## Status

This is at the **foundation** stage. The web UI is complete and the platform it
will be built on is in place: one public gateway, a middleware chain every service
inherits, a published API contract, an RLS-governed database with a live security
suite, and five CI workflows.

Five slices are implemented end to end; the rest are contract-only.

| Area                                                                                                                | State                                                                      |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Web app (routing, SEO, PWA, design system)                                                                          | Complete, served from the production domain                                |
| Session lifecycle (`auth`)                                                                                          | **Implemented** — sign-up, sign-in, refresh, session exchange, sign-out    |
| The caller's own profile (`users`)                                                                                  | **Implemented** — read and update the signed-in `public.profiles` row      |
| The game catalogue (`games`)                                                                                        | **Implemented** — published games, search, categories with real counts     |
| Play sessions and server-verified scores (`game-sessions`)                                                          | **Implemented** — a score exists only if the database replays the run      |
| The admin dashboard's API (`admin`)                                                                                 | **Implemented** — staff-gated reads and moderation writes, no fixture data |
| Everything else (scores, leaderboards, feed, recommendations, social, notifications, search, moderation, analytics) | Scaffolded: each has a published contract and answers `501`                |
| Payments (RaiAccept)                                                                                                | Designed, not built — see [0005](docs/decisions/0005-payments.md)          |

A scaffolded endpoint is deliberate, not missing: the route exists, authenticates,
is rate limited and is documented, so a client fails predictably (`501`) instead of
hitting a `404`. The per-operation truth is the `x-status` field in
[`packages/api-contracts/openapi-v1.yaml`](packages/api-contracts/openapi-v1.yaml).

The web app's catalogue screens read the real API
([`src/lib/games/catalog.ts`](src/lib/games/catalog.ts)): browse, search,
categories, and the game detail page. Nothing falls back to a hardcoded game — a
failed request shows a failure, and a screen renders nothing for a metric the API
does not return.

What remains on fixtures is what has no backend yet, and it is now empty states
rather than invented content: [`src/lib/mock.ts`](src/lib/mock.ts) holds only the
unimplemented features (public profiles, comments, notifications, achievements).
The internal admin console no longer appears here: its fixtures are deleted and
its screens read the admin API or say plainly that a feature has no backend yet.
Screens whose data would be a
personal history — liked, saved, recently played, activity, leaderboards — say they
are unavailable instead of showing fabricated rows.

## Games

Nine games are playable end to end. Each has a browser runtime in
[`src/lib/games/`](src/lib/games/), a server-issued play session, and a score the
database accepts only after replaying the run.

| Game                  | Slug                   | Runtime module    |
| --------------------- | ---------------------- | ----------------- |
| Stack 10              | `stack-10`             | `stack10.ts`      |
| One Move              | `one-move`             | `one-move.ts`     |
| Don't Break the Chain | `dont-break-the-chain` | `chain.ts`        |
| Memory Flash          | `memory-flash`         | `memory-flash.ts` |
| Color Merge           | `color-merge`          | `color-merge.ts`  |
| Don't Touch the Black | `dont-touch-the-black` | `dont-touch.ts`   |
| 7 Second              | `7-second`             | `seven-second.ts` |
| Queens                | `queens`               | `queens.ts`       |
| Zip                   | `zip`                  | `zip.ts`          |

7 Second is the daily game: one shared deck per UTC day and one ranked attempt a
day. `play.$id.tsx` mounts a runtime only for a game whose `runtime` identifier it
ships, so a catalogue row without one gets an honest "no runtime yet" screen. How
to add a game, and the rules a runtime must follow, are in
[docs/games/README.md](docs/games/README.md).

## Architecture

```
   browser / PWA
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ Vercel project — one domain                             │
│   web service   → /            TanStack Start (SSR)     │
│   api service   → /api/v1/*    Go gateway (container)   │
│                                 └── private bindings ──┐│
│   auth service  (Go)  ◀────────────────────────────────┤│
│   users service (Go)  ◀────────────────────────────────┘│
└──────────────────────────┬──────────────────────────────┘
                           │ SQL — service_role for privileged writes,
                           │ the caller's own token for everything a user may do
                           ▼
┌─────────────────────────────────────────────────────────┐
│ Supabase — Postgres (RLS on every exposed table),       │
│            Auth (credentials, tokens, JWKS), Storage    │
└─────────────────────────────────────────────────────────┘
```

1. The web service renders the page. Public pages are server rendered with
   canonical URLs and structured data; private pages are `noindex`.
2. The browser calls `/api/v1/...` with `Authorization: Bearer <supabase access
token>` and nothing else. The rewrite table in [`vercel.json`](vercel.json)
   sends every `/api/v1/*` path to the API service.
3. The gateway strips any client-supplied identity header, applies security
   headers, the CORS allowlist, a per-IP rate limit and a 1 MiB body limit, then
   routes by prefix from [`services/internal/apiroutes/routes.go`](services/internal/apiroutes/routes.go).
4. The owning service verifies the token again locally against the Supabase JWKS
   and enforces its route tier (`public`, `optional`, `authenticated`,
   `moderator`, `admin`).
5. Domain logic talks to Postgres. `service_role` is used only for work a user
   cannot be trusted to do; anything a user may legitimately do is _additionally_
   constrained by RLS, so a bug in one layer does not become a data breach.
6. Errors are one envelope everywhere: `{"error":{"code","message","request_id"}}`.

Full detail, including the request path end to end, is in
[architecture/overview.md](docs/architecture/overview.md).

## Stack

| Layer       | Choice                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------- |
| Web         | TanStack Start + TanStack Router, React 19, Vite, TypeScript                                    |
| Styling     | Tailwind CSS v4, shadcn/ui on Radix primitives                                                  |
| Web tests   | Vitest + Testing Library (jsdom)                                                                |
| Web tooling | bun (lockfile of record), ESLint + Prettier                                                     |
| API         | Go 1.27, stdlib `net/http` with one thin router, two modules in one workspace                   |
| Database    | Supabase Postgres, RLS, migrations as the only schema history                                   |
| Deployment  | Vercel services mode: one container image for the gateway, Go runtime for the internal services |
| CI          | GitHub Actions — web, go, database, api-contract, security                                      |

## Quick start

Prerequisites: **Node 22.x**, **bun 1.2.x**, **Go 1.27.x**, **Docker** and the
**Supabase CLI**. `bun.lock` is the lockfile of record: prefer `bun install`, and
never regenerate a different lockfile.

```bash
# Web app
bun install
cp .env.example .env.local     # fill in the public Supabase values
bun run dev                    # http://localhost:8081

# Database, without the Supabase CLI (this is what CI runs)
./scripts/test-rls.sh          # postgres:16-alpine, all migrations, seed, RLS suite

# Database, hosted parity
supabase start                 # local Postgres, Auth, Storage, Studio
supabase db reset              # migrations + seed

# API
cd services
ENVIRONMENT=development LOG_FORMAT=text \
  CORS_ALLOWED_ORIGINS=http://localhost:8081 go run ./gateway/cmd/gateway
curl -s localhost:8080/api/v1/health
```

With a local Supabase stack running, `bun run env:supabase --write` fills the
Supabase URL and keys into `.env.local` for you; the rest are chosen by hand. Every
variable is documented in [`.env.example`](.env.example) and in
[environments.md](docs/development/environments.md) — including where a human
actually finds each value.

Step-by-step setup, ports and per-service commands: [local-setup.md](docs/development/local-setup.md).

## Repository layout

| Path                                                         | What lives there                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`, `public/`                                            | The web app: routes, components, SEO/PWA assets.                                                                                                                          |
| `services/`                                                  | One Go module holding every service, each with `cmd/<service>`.                                                                                                           |
| `packages/go/platform`                                       | Shared Go library: config, logging, errors, HTTP conventions, JWT verification, health.                                                                                   |
| `packages/api-contracts`                                     | The OpenAPI 3.1 contract for `/api/v1`.                                                                                                                                   |
| `supabase/`                                                  | `config.toml`, `migrations/`, `seed.sql`. Migrations are the only way the schema changes.                                                                                 |
| `tests/`                                                     | Contract, e2e, integration, load, security and smoke suites. `tests/security/rls_test.sql` is live today.                                                                 |
| `scripts/`                                                   | Operational helpers: `test-rls.sh`, `check-api-contract.mjs`, `generate-sitemap.mjs`, `env-from-supabase.mjs`.                                                            |
| `docs/`                                                      | Architecture, development, deployment, security and the decision records.                                                                                                 |
| `.github/workflows/`                                         | CI: web, go, database, api-contract, security.                                                                                                                            |
| `vercel.json`, `Dockerfile.vercel`                           | The deployment: four services, the `/api/v1` rewrites and the two service bindings.                                                                                       |
| `apps/`, `config/`, `database/`, `games/`, `infrastructure/` | Placeholders for future work (mobile apps, environment config, SQL artifacts, game catalogues, infrastructure). `supabase/migrations` stays authoritative for the schema. |

## Services

Every backend service lives in one Go module and has its own `cmd/<name>` binary,
so they deploy independently while sharing code. `servicekit` gives each one — and
cannot be opted out of — validated fail-fast configuration, structured logging, JWT
verification, the full middleware chain, `/healthz` and `/readyz`, and graceful
shutdown with readiness draining.

| Service           | Owns                                                              | State                         |
| ----------------- | ----------------------------------------------------------------- | ----------------------------- |
| `gateway`         | The only public entry point; owns `/api/v1` and proxies by prefix | Implemented                   |
| `auth`            | Session lifecycle on top of Supabase Auth                         | **Implemented**               |
| `users`           | Profiles                                                          | **Implemented** (own profile) |
| `games`           | Catalogue and game metadata                                       | **Implemented** (read-only)   |
| `game-sessions`   | Play sessions; the only path to a score                           | **Implemented**               |
| `scores`          | Score records (read-only to clients)                              | Scaffolded                    |
| `leaderboards`    | Global and friends boards                                         | Scaffolded                    |
| `feed`            | The personalised feed                                             | Scaffolded                    |
| `recommendations` | Suggestions                                                       | Scaffolded                    |
| `social`          | Comments, follows, likes                                          | Scaffolded                    |
| `notifications`   | In-app and push                                                   | Scaffolded                    |
| `search`          | Games, creators, players                                          | Scaffolded                    |
| `moderation`      | Reports and moderation actions                                    | Scaffolded                    |
| `analytics`       | Product events and dashboards                                     | Scaffolded                    |
| `admin`           | The operations API behind the admin dashboard                     | **Implemented**               |

Adding one: create `services/<name>/cmd/<name>/main.go`, add its prefix to
`internal/apiroutes/routes.go`, document it in the OpenAPI contract, add its
`UPSTREAM_<NAME>_URL` to `.env.example`, and run the contract check. The rules a
service must follow are in [services/README.md](services/README.md).

## API

One version, `/api/v1`, described by
[`packages/api-contracts/openapi-v1.yaml`](packages/api-contracts/openapi-v1.yaml).
Each operation carries `x-status`; `available` means it is implemented, anything
else is a contract with a `501` behind it.

Drift between the contract and the gateway's routing table is a CI failure:

```bash
node scripts/check-api-contract.mjs
npx --yes @redocly/cli@2 lint --config packages/api-contracts/redocly.yaml packages/api-contracts/openapi-v1.yaml
```

The gateway's own routes (`GET /api/v1` for version discovery and
`GET /api/v1/health`) answer before the proxy is consulted, so a health check never
depends on an upstream being deployed.

## Database and security

Migrations are the only schema history, applied in filename order by the Supabase
CLI and by `scripts/test-rls.sh`. They are append-only: never edit a migration that
has been applied anywhere, add another. Migrations are written for **Postgres 16**,
which is what `scripts/test-rls.sh` (`postgres:16-alpine`) and
[`database.yml`](.github/workflows/database.yml) pin.

Row Level Security is the security boundary, not application code. Every exposed
table has RLS enabled, an explicit grant, and policies for each verb a role may
attempt — with an `allow` **and** a `denied`/`blocked` assertion in
[`tests/security/rls_test.sql`](tests/security/rls_test.sql) (50+ assertions across
anon, authenticated, suspended, moderator, administrator and `service_role`).

```bash
./scripts/test-rls.sh                                    # throwaway container
DATABASE_URL=postgres://... ./scripts/test-rls.sh        # an existing disposable database
```

The full picture: [the authorization matrix](docs/security/data-access.md), the
[threat model](docs/security/threat-model.md), the
[API hardening baseline](docs/security/api-hardening.md) and
[secrets handling](docs/security/env-and-secrets.md).

## Testing

| Suite                         | Command                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- |
| Web unit tests                | `bun run test`                                                              |
| Web type check / lint / build | `bun run typecheck` · `bun run lint` · `bun run build`                      |
| Sitemap drift                 | `bun run sitemap:check`                                                     |
| Contract drift                | `node scripts/check-api-contract.mjs`                                       |
| Go tests (both modules)       | `cd services && go test ./...` · `cd packages/go/platform && go test ./...` |
| Go static checks              | `go vet ./...` and `gofmt -l`                                               |
| Database security             | `./scripts/test-rls.sh`                                                     |

CI adds `go test -race` (which needs cgo, so it runs on Linux rather than this
repository's Windows checkout), `govulncheck`, `gitleaks` and `bun audit`.

What is **not** covered yet — no end-to-end browser tests, no load tests, no
contract tests against a running service, no fuzzing — is listed explicitly in
[testing.md](docs/development/testing.md) so nobody assumes otherwise.

## CI

Five workflows, all read-only with respect to the repository:

| Workflow                                                 | Jobs                                                                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`web.yml`](.github/workflows/web.yml)                   | `verify` — frozen install, typecheck, lint, unit tests, sitemap check, production build, `bun audit`                                                              |
| [`go.yml`](.github/workflows/go.yml)                     | `verify` — gofmt, vet, `go test -race`, build every binary · `vulnerabilities` — govulncheck on both modules                                                      |
| [`database.yml`](.github/workflows/database.yml)         | `migrations-and-rls` — every migration, the RLS suite and seed idempotency on Postgres 16                                                                         |
| [`api-contract.yml`](.github/workflows/api-contract.yml) | `verify` — contract/routing drift and a Redocly lint of the OpenAPI document                                                                                      |
| [`security.yml`](.github/workflows/security.yml)         | `secret-scan` (gitleaks with [`.gitleaks.toml`](.gitleaks.toml)) · `dependency-review` (PRs) · `workflow-integrity` (pinned actions, least-privilege permissions) |

## Deployment

One Vercel project serves five services from one domain, declared in
[`vercel.json`](vercel.json):

- **`web`** — the TanStack Start app, at `/`.
- **`api`** — the Go gateway, built from [`Dockerfile.vercel`](Dockerfile.vercel)
  as a container image because it needs service bindings, which the Go runtime
  cannot express.
- **`auth`**, **`users`** and **`games`** — Go runtime services. The gateway
  reaches them over service bindings that inject `UPSTREAM_AUTH_URL`,
  `UPSTREAM_USERS_URL` and `UPSTREAM_GAMES_URL` at runtime, and the rewrite table
  sends no path directly to any of them, so `/api/v1` is the only way in. Those
  three variables must never be set by hand in the dashboard.

  The `games` service deploys from [`services/main.go`](services/main.go): Vercel's
  Go preset recognises exactly three entrypoint names and the other two are taken
  by `auth` and `users`. The file is a slot name, not a description — it runs the
  same one line as the local binary.

Deploys come from Git. Environment variables are scoped per environment in the
Vercel project; the API needs `ENVIRONMENT=production`, the Supabase URL and the
CORS allowlist, and must never be given `SUPABASE_JWT_SECRET` or
`SUPABASE_SECRET_KEY`.

Routing, variables and post-deploy verification: [deployment/vercel.md](docs/deployment/vercel.md).

## Conventions

Read [conventions.md](docs/development/conventions.md) before opening a pull
request. The short version:

- Configuration fails closed: a service refuses to start on an invalid value
  instead of running with a weakened default.
- Identity comes from the verified token, never from the request.
- Every route is behind a tier — `public`, `optional`, `authenticated`,
  `moderator`, `admin`. There is no unguarded handler.
- Migrations are append-only and a destructive change is three migrations
  (expand, migrate, contract), not one.
- A service that owns data must also enforce its rules in the database.

On Windows, `eslint .` can report a wall of `Delete ␍` errors because
`core.autocrlf=true` gives the working tree CRLF while Prettier expects LF. Run
`bun run format` or check out with `git config core.autocrlf false`; CI runs on
Linux and is unaffected. Do not commit a repo-wide reformat to silence it.

## Documentation

[docs/README.md](docs/README.md) is the map. The shortest path from here:

| Read it when you need to…                                 | Document                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| Understand the system shape                               | [architecture/overview.md](docs/architecture/overview.md)       |
| Add or change an endpoint, or understand the gateway      | [architecture/api.md](docs/architecture/api.md)                 |
| Change the schema, or understand ownership and row access | [architecture/data-model.md](docs/architecture/data-model.md)   |
| Work on the web app (SSR, SEO, PWA, performance)          | [architecture/web-app.md](docs/architecture/web-app.md)         |
| Get a working checkout                                    | [development/local-setup.md](docs/development/local-setup.md)   |
| Configure an environment                                  | [development/environments.md](docs/development/environments.md) |
| Know which control answers which threat                   | [security/threat-model.md](docs/security/threat-model.md)       |
| Deploy or verify the API                                  | [deployment/vercel.md](docs/deployment/vercel.md)               |
| Know why something is the way it is                       | [decisions/](docs/decisions/README.md)                          |

## License

Copyright (c) 2026 Unbored. All rights reserved. See [LICENSE](LICENSE).
