# Architecture overview

## Shape of the system

```
                    ┌──────────────────────────────────────────┐
   browser / PWA ──▶│  Cloudflare Workers — unbored.lol        │
                    │    TanStack Start (React 19, SSR)        │
                    └──────────────────────────────────────────┘
        │
        │  https://api.unbored.lol/api/v1/<group>  (bearer token, CORS)
   ┌────▼─────────────────────────────────────────────────────────────────┐
   │  Render (Frankfurt): one process, services/cmd/standalone            │
   │  mounted: auth · users · games (+ game-sessions, admin, crons)       │
   │  each runs: request id · security headers · CORS · rate limit ·      │
   │             body limit · token verification                         │
   │  not deployed yet: scores · leaderboards · feed · recommendations ·  │
   │  social · notifications · search · moderation · analytics (→ 503)    │
   └────────────────────────────────┬─────────────────────────────────────┘
                                    │  SQL (service_role) / RLS (user tokens)
                    ┌───────────────▼──────────────────────────┐
                    │  Supabase                                │
                    │  Postgres (RLS on every exposed table)   │
                    │  Auth (credentials, tokens, JWKS)        │
                    │  Storage (avatars, game assets, builds)  │
                    └──────────────────────────────────────────┘
```

In production every route group is mounted in one Go process
([0016](../decisions/0016-cloudflare-and-render-hosting.md)). Locally, the Go
gateway (`services/gateway`) can sit in front of the services run separately and
route by prefix (`scripts/dev-stack.mjs`), or `go run ./cmd/standalone` runs the
production shape.

Redis, a job runner and RaiAccept payments are **not** part of this diagram yet;
where they will attach is described in
[decisions/0004-rate-limiting.md](../decisions/0004-rate-limiting.md) and
[decisions/0005-payments.md](../decisions/0005-payments.md).

## The request path, end to end

1. A page is rendered by the website on Cloudflare Workers. Public pages are
   server rendered with canonical URLs and structured data; private pages are
   served with `noindex` (see [web-app.md](web-app.md)).
2. The browser calls `https://api.unbored.lol/api/v1/<group>/...` (the
   `VITE_API_BASE_URL` build variable) through `apiFetch`
   (`src/lib/api/client.ts`). The caller's identity travels in an
   `Authorization: Bearer <supabase access token>` header and nowhere else, so the
   cross-origin call needs CORS but no cookies. The API process routes each
   `/api/v1` group to the package that owns it — see
   [deployment/production.md](../deployment/production.md).
3. The service strips any client-supplied identity headers, applies the security
   headers, the CORS allowlist, a per-IP rate limit and a 1 MiB body limit. The
   groups and their owners are listed in `services/internal/apiroutes/routes.go`.
4. The service authenticates locally: it verifies the token
   signature and audience against the Supabase JWKS, derives the user id and role
   from the token, and enforces the route tier (`public`, `optional`,
   `authenticated`, `moderator`, `admin`). Version discovery (`/api/v1`) and
   `GET /api/v1/health` are answered by the API with no dependency,
   so a health check never depends on Supabase.
5. Domain logic talks to Postgres. A service uses the `service_role` key only for
   work a user cannot be trusted to do (writing a score, hiding a comment,
   granting a role); anything a user could legitimately do is additionally
   protected by RLS, so a bug in one layer does not become a data breach.
6. Errors are one envelope: `{"error":{"code","message","request_id"}}`, produced
   by `packages/go/platform/apierr` and re-exported by `httpx`.

## Repository layout

| Path                                | What lives there                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/`, `public/`, `vite.config.ts` | The web app. It is at the repository root today; [0002](../decisions/0002-web-app-location.md) records why and how it moves to `apps/web`.                                                                                                                                                                                                                                                                                                                         |
| `services/`                         | One Go module holding every service, each with `cmd/<service>`.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/go/platform`              | Shared Go library: config, logging, errors, HTTP conventions, JWT verification, health.                                                                                                                                                                                                                                                                                                                                                                            |
| `packages/api-contracts/`           | The OpenAPI 3.1 contract for `/api/v1`.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `supabase/`                         | `config.toml`, `migrations/`, `seed.sql`. Migrations are the only way the schema changes.                                                                                                                                                                                                                                                                                                                                                                          |
| `database/`                         | Reference notes and future SQL artifacts (views, functions, policies). Migrations in `supabase/migrations` stay authoritative.                                                                                                                                                                                                                                                                                                                                     |
| `tests/`                            | Contract, e2e, integration, load, security and smoke suites. `tests/security/rls_test.sql` is live today.                                                                                                                                                                                                                                                                                                                                                          |
| `scripts/`                          | Operational helpers: `test-rls.sh`, `generate-sitemap.mjs`, `check-api-contract.mjs`.                                                                                                                                                                                                                                                                                                                                                                              |
| `.github/workflows/`                | CI: web, go, database, api-contract, security.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `infrastructure/`                   | `docker/api.Dockerfile` (the production API image); placeholders for CDN, monitoring and Terraform work.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `render.yaml`                       | The API deployment on Render (Blueprint). The website deploys to Cloudflare Workers from the build settings in its dashboard. See [deployment/production.md](../deployment/production.md) and [0016](../decisions/0016-cloudflare-and-render-hosting.md). |

## Two modules, one workspace

`go.work` ties `packages/go/platform` and `services` together for local work;
`services/go.mod` resolves the platform library through a `replace` directive so a
plain `go build ./...` works without the workspace too. The reasoning and the
graduation path to per-service modules are in
[0001](../decisions/0001-go-module-strategy.md).

## Environments

| Environment | Web                             | API                                                                          | Database                                                      |
| ----------- | ------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| development | `npm run dev`, port 8081        | `go run ./gateway/cmd/gateway`, port 8080                                    | local Supabase or the Docker harness in `scripts/test-rls.sh` |
| preview     | Cloudflare `*.workers.dev` preview build, if enabled | the production API (its origin must be added to `CORS_ALLOWED_ORIGINS`) | the hosted Supabase project |
| staging     | not set up                      | not set up                                                                   | —                                                             |
| production  | `https://unbored.lol` (Cloudflare Workers) | `https://api.unbored.lol/api/v1` (Render, Frankfurt)              | the hosted Supabase project                                   |

Deployment detail: [deployment/production.md](../deployment/production.md).

## What this foundation deliberately does not do

- Most product features are not implemented: `auth` (the session lifecycle),
  `users` (the caller's own profile), `games` (the catalogue, with real play
  counts), `sessions` (a Stack 10 run, verified and scored server-side) and one
  `leaderboards` operation (a game's board) are available; every other service
  exposes its contract and answers `501`.
- No Redis, no queue, no CDN, no autoscaling: the API runs as a single instance
  until load justifies more.
- No payments: the RaiAccept integration is designed, not built.
- The **signed-in identity is no longer mock data**: the UI reads it from
  `GET /api/v1/users/me`, and an edit writes the real `public.profiles` row. Nor
  is the play path: **Stack 10** runs from a server-issued session, its score is
  the database's replay of the run, and its detail page and board read real play
  counts and real scores. The rest of `src/lib/mock.ts` — the other games,
  comments, notifications and sample activity — is still the UI's data source
  until those services exist, and it is never used as a fallback for the
  signed-in user or for anything the API can answer.
