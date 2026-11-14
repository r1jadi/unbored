# Local setup

## Prerequisites

| Tool | Version used | Needed for |
| --- | --- | --- |
| Node | 22.x | web app, scripts |
| bun | 1.2.x | the repo's lockfile (`bun.lock`); `bun install` is the canonical install |
| Go | 1.27.x | services and the platform library |
| Docker | any recent | the database security suite, `supabase start`, gitleaks |
| Supabase CLI | latest | running the hosted-parity local stack |

`npm` works too but the lockfile is bun's; prefer `bun install`, and never
regenerate a different lockfile.

## Web app

```bash
bun install          # or: npm install --legacy-peer-deps
cp .env.example .env.local   # fill in the public values
bun run dev          # http://localhost:8081
```

With a local Supabase stack running, `bun run env:supabase --write` fills in the
Supabase URL and keys in `.env.local` for you; the remaining values are chosen by
hand. See [environments.md](environments.md#how-to-find-each-value) for where each
one comes from.

Verification commands used in this repository:

```bash
bun run typecheck    # tsc --noEmit
bun run lint         # eslint .
bun run test         # vitest run
bun run build        # production build, same command Cloudflare runs
bun run sitemap:check
node scripts/check-api-contract.mjs
```

If `eslint .` reports thousands of `Delete \`␍\`` errors, that is a Windows
checkout artifact: `core.autocrlf=true` gives the working tree CRLF endings while
Prettier expects LF. Run `bun run format` (Prettier rewrites the affected files
with LF) or check out with `git config core.autocrlf false`. CI runs on Linux and
is unaffected. Do not "fix" it by committing a repo-wide reformat: that would
rewrite every file and destroy the review history.

## Database

Option A — the Supabase CLI (hosted parity):

```bash
supabase start            # local Postgres, Auth, Storage, Studio
supabase db reset         # migrations + seed
```

Option B — the Docker harness (no Supabase CLI, used by CI):

```bash
./scripts/test-rls.sh
```

It starts `postgres:16-alpine`, applies the Supabase stub, every migration, the
seed and the RLS suite, then removes the container. It asserts allowed **and**
denied operations for anon, authenticated, suspended, moderator, administrator
and service_role. `DATABASE_URL=postgres://... ./scripts/test-rls.sh` uses an
existing disposable database instead.

Adding a migration:

```bash
supabase migration new add_leaderboard_snapshots
# edit supabase/migrations/<timestamp>_add_leaderboard_snapshots.sql
./scripts/test-rls.sh
```

## Go services

```bash
cd services
go build ./...                     # every service binary
go test ./...                      # unit + integration tests
go vet ./...
go test -race ./...                # needs cgo and a C toolchain (CI does this)
```

Run the gateway:

```bash
cd services
ENVIRONMENT=development LOG_FORMAT=text CORS_ALLOWED_ORIGINS=http://localhost:8081 \
  go run ./gateway/cmd/gateway
curl -s localhost:8080/healthz        # liveness, plain text
curl -s localhost:8080/api/v1/health  # the published liveness route
curl -s localhost:8080/readyz         # readiness, runs dependency checks
curl -s localhost:8080/api/v1         # version discovery
```

`go run ./gateway/cmd/gateway` uses `HTTP_ADDR` when it is set, then `PORT_HTTP`,
then `PORT`, then `:8080`. The gateway is local only: production runs every group
in one process, `services/cmd/standalone`, which you can also run locally
(`go run ./cmd/standalone` from `services/`). `services/cmd/api` is **not** an
alias for the gateway — it is the users service's old Vercel entrypoint, kept so
CI still builds it. The environment variables production needs are in
[deployment/production.md](../deployment/production.md).

Run one service:

```bash
cd services
HTTP_ADDR=:8090 go run ./users/cmd/users
```

`go.work` at the repository root makes `packages/go/platform` resolve locally, so
a change to the platform library is picked up without publishing anything.

## Adding a service

1. `services/<name>/cmd/<name>/main.go` — a `servicekit.MustRun` call with a
   `Register` function. Nothing else is required to get config, logging, auth,
   rate limiting, probes, security headers and graceful shutdown.
2. Add the API prefix to `services/internal/apiroutes/routes.go`.
3. Document the endpoints in `packages/api-contracts/openapi-v1.yaml`.
4. Add `UPSTREAM_<NAME>_URL` to `.env.example`.
5. `node scripts/check-api-contract.mjs` must pass.

## Environment files

`.env.example` is the template; copy it rather than inventing names. Every
variable is documented there and in [environments.md](environments.md)—the naming
rules in [the public/secret split](environments.md#the-publicsecret-split), and the
source of each value in
[how to find each value](environments.md#how-to-find-each-value).
