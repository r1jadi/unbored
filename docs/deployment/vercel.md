# Deploying to Vercel

One Vercel project serves the whole product on one domain: the TanStack Start web
app, the Go API gateway, the Go auth service and the Go users service. There is no
second host and no `api.` subdomain.

|                    |                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project            | `unboredapp` → `https://unbored.lol`                                                                                                                                             |
| Configuration      | [`vercel.json`](../../vercel.json) (services + rewrites + two service bindings)                                                                                                            |
| Web service        | `web` — repository root, framework `tanstack-start-lovable` (TanStack Start + Vite, SSR through Nitro)                                                                                     |
| API service        | `api` — **container image**, `Dockerfile.vercel` at the repository root; this is the Go gateway                                                                                            |
| Auth service       | `auth` — `services/`, framework `go`, entrypoint `services/cmd/server/main.go`                                                                                                             |
| Users service      | `users` — `services/`, framework `go`, entrypoint `services/cmd/api/main.go`                                                                                                               |
| Games service      | `games` — `services/`, framework `go`, entrypoint `services/main.go`; serves the catalogue, the play sessions **and** the admin API (one remaining preset entrypoint name, three packages) |
| Reachability       | `auth`, `users` and `games` are internal: no rewrite targets them, so only the gateway can reach them                                                                                      |
| Local API          | `http://localhost:8080/api/v1` (`go run ./gateway/cmd/gateway`, `HTTP_ADDR=:8080`)                                                                                                         |
| Production API     | `https://unbored.lol/api/v1`                                                                                                                                                     |
| Production auth    | `https://unbored.lol/api/v1/auth/*`                                                                                                                                              |
| Production profile | `https://unbored.lol/api/v1/users/me`                                                                                                                                            |
| Health             | `https://unbored.lol/api/v1/health`                                                                                                                                              |

## The four services

| Service | Root        | Built as                                     | Public?                                    |
| ------- | ----------- | -------------------------------------------- | ------------------------------------------ |
| `web`   | `./`        | Node (TanStack Start preset)                 | **Yes** — the catch-all rewrite            |
| `api`   | `./`        | Custom container image (`Dockerfile.vercel`) | **Yes** — `/api/v1`, `/healthz`, `/readyz` |
| `auth`  | `services/` | Vercel Go framework preset                   | **No** — internal only                     |
| `users` | `services/` | Vercel Go framework preset                   | **No** — internal only                     |
| `games` | `services/` | Vercel Go framework preset                   | **No** — internal only                     |

A service is internal by default and only becomes routable if a top-level rewrite
targets it. `web` and `api` have rewrites; `auth` and `users` do not, and that is
deliberate: the public entry for authentication and for the profile must stay the
gateway, so the gateway keeps ownership of CORS, rate limiting and the error
envelope for `/api/v1/auth/*` and `/api/v1/users/*` exactly as it does for every
other group.

The two Go services share one root and one framework, and differ only in which of
the preset's fixed entrypoint names they occupy — see
[why the users service is `cmd/api/main.go`](#why-the-entrypoint-is-cmdapimaingo).

## Why Vercel Services

Vercel builds one project as **services** when the project's framework preset is
_Services_ **and** `vercel.json` contains a `services` key. All four services
share one domain, one firewall, one set of environment variables and one public
routing table.

The alternatives were rejected on purpose:

- **A second Vercel project** (or Fly/Render/Railway) for the API would create a
  second public surface, a second CORS problem and a second thing to keep in
  sync with this repository.
- **`api/*.go` serverless functions** are Vercel's other Go path. They expect a
  `go.mod` at the project root and one `http.HandlerFunc` per file, which would
  mean a shim around the router instead of the gateway that already exists — and
  they are not part of what a Nitro build emits.
- **A public rewrite into `auth`.** Routing `/api/v1/auth/*` straight at the auth
  service would bypass the gateway's CORS and rate-limiting layer and duplicate
  the public API surface across two services. It is also unnecessary: the binding
  exists so the gateway can reach `auth` without either of them being public.

### Why the gateway is a container image and the Go services are not

The gateway is the service that calls `auth`, and a service binding is declared
on the caller. Vercel's bindings documentation is explicit that bindings are not
available to services on the Go or Rust runtime and that such a service has to be
built as a container image instead:

> Service bindings aren't available yet for services that use the Go or Rust
> runtime. If your service uses one of these runtimes and declares bindings,
> build it as a container image instead. A container image service can use
> bindings.

`api` therefore declares the bindings **and** is a container image. `auth` and
`users` declare nothing and stay on the Go framework preset, which builds the
binary and runs it with no operating system to ship: reachability is declared by
the caller, so a callee needs no binding of its own.

Two details about that container are load-bearing and were measured, not assumed:

- **The file name must be exactly `Dockerfile.vercel`.** Vercel auto-detects
  `Dockerfile.vercel` or `Containerfile.vercel` at the service root. A
  second, explicitly named entrypoint file (`Dockerfile.api.vercel`) was not
  detected at all in testing — the container service silently disappeared from
  the detected topology — so there is one container and one
  `Dockerfile.vercel`.
- **The build context is the service root**, which is why `api` has
  `"root": "./"`. `services/go.mod` replaces the platform module with a relative
  path (`../packages/go/platform`), so the image has to carry both Go modules and
  the context has to be the whole repository. `.dockerignore` keeps that context
  small and keeps every `.env*` file (except `.env.example`) out of the image.

Port resolution: Vercel routes container traffic to **port 80** unless the project
sets `PORT`. The image declares `ENV PORT=80` and the final stage is `FROM
scratch` with one static binary, so the app's listener and Vercel's router agree
without a project-wide variable — a project-wide `PORT` would also be read by the
web and auth services. `config.Load` reads `HTTP_ADDR`, then `PORT_HTTP`, then
`PORT`; never set `HTTP_ADDR` in Vercel, because it would override the injected
port.

## How the gateway finds the auth and users services

`api` declares one service binding per callee:

```json
"bindings": [
  { "type": "service", "service": "auth",  "format": "url", "env": "UPSTREAM_AUTH_URL" },
  { "type": "service", "service": "users", "format": "url", "env": "UPSTREAM_USERS_URL" },
  { "type": "service", "service": "games", "format": "url", "env": "UPSTREAM_GAMES_URL" }
]
```

Vercel generates the value of each variable and injects it into the `api` service
at runtime. They are **deployment-aware**: a preview deployment's gateway reaches
that same preview deployment's services, so no fixed hostname is ever referenced.
`config.loadUpstreams` then reads them like any other upstream
(`UPSTREAM_AUTH_URL`, `UPSTREAM_USERS_URL`, `UPSTREAM_GAMES_URL`), trims a trailing
slash, and the proxy replaces the scheme and host while keeping the original
request path.

Two consequences worth stating plainly:

- **Do not set `UPSTREAM_AUTH_URL`, `UPSTREAM_USERS_URL` or `UPSTREAM_GAMES_URL`
  in the dashboard.** A project-level value is not deployment-aware and would be
  the value the gateway actually used instead of the binding's. The variables are
  listed in `.env.example` because a local shell sets them, not because a
  deployment sets them.
- **A binding grants reachability, not authorization.** Vercel's documentation is
  explicit that a binding "does not authenticate or authorize the call". Both
  services verify the caller's access token themselves, against the project's
  JWKS, for every authenticated endpoint.

## Why the web service pins a framework

A service has no dashboard preset of its own, and Vercel refuses to guess: the
first deployment with only `"root": "./"` failed with

> Multiple frameworks detected in project root: TanStack Start, Nitro, Node.
> Specify "framework" explicitly in services.

`tanstack-start-lovable` is the entry Vercel defines for a repository that has
both `@lovable.dev/vite-tanstack-config` and `@tanstack/react-start` — exactly
this one. It **supersedes** the generic `tanstack-start` and `vite` detectors,
and its build settings are `vite build` with output `dist`, identical to the
generic entry, so `"framework": "tanstack-start"` is the drop-in fallback if the
Lovable slug is ever removed. Both slugs are real values in Vercel's published
schema.

The project-wide framework preset must still be **Services**; the per-service
`framework` only replaces the ambiguous auto-detection inside the service.

### Why the entrypoint is `cmd/api/main.go`

Vercel's Go framework preset detects exactly **three** entrypoints at a service
root: `main.go`, `cmd/api/main.go` and `cmd/server/main.go`. Anything else is not
built, and the failure is silent — the service simply does not appear.

That is the only reason the users service is reached through a file called
`cmd/api`: the slot name is Vercel's fixed list, not a description of what the
service does. The mapping follows what each service needs:

| Service     | Entrypoint                     | Why that one                                                                                                                                                                                                                |
| ----------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`      | `services/cmd/server/main.go`  | Built by the Go preset, so it needs one of the three names                                                                                                                                                                  |
| `users`     | `services/cmd/api/main.go`     | Also built by the Go preset, so it takes the remaining name                                                                                                                                                                 |
| `games`     | `services/main.go`             | The Go preset's third and last name. It sits at the module root because that is where the preset looks; the file is a slot, not a description. It mounts three packages: the catalogue, the play sessions and the admin API |
| The gateway | `services/gateway/cmd/gateway` | Built by `Dockerfile.vercel`, which has no naming rule to satisfy, so its own command is used                                                                                                                               |

All four run the same `servicekit.MustRun(<service>.Options())` as their local
`cmd/<name>` binary, so no entrypoint is a second implementation:
`services/users/cmd/users`, `services/auth/cmd/auth`, `services/games/cmd/games`
and `services/gateway/cmd/gateway` are the local shells for the same wiring.

## Routing

`vercel.json` routes public traffic with service rewrites. Vercel evaluates them in
order, and routing into a service is final: a request routed to the API service
never falls back to the web app, whatever path it is.

| Request                                 | Service         | Notes                                                                                                    |
| --------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| `/api/v1/health`                        | `api`           | Liveness of the gateway; no auth, no dependency checks                                                   |
| `/api/v1`                               | `api`           | Version discovery                                                                                        |
| `/api/v1/auth/…`                        | `api` → `auth`  | The gateway proxies it over the binding to the deployed auth service                                     |
| `/api/v1/users/…`                       | `api` → `users` | The same, over the users binding — `/api/v1/users/me` is the profile                                     |
| `/api/v1/games/…`, `/api/v1/categories` | `api` → `games` | The same, over the games binding — the public catalogue and each game's leaderboard                      |
| `/api/v1/sessions/…`                    | `api` → `games` | The same binding: the play-session routes are mounted in the games deployment                            |
| `/api/v1/admin/…`                       | `api` → `games` | The same binding again: the admin routes are mounted in the games deployment, and stay fully staff-gated |
| `/api/v1/<other group>/…`               | `api`           | The gateway proxies a group only when its `UPSTREAM_<SERVICE>_URL` is set; otherwise `503`               |
| `/healthz`, `/readyz`                   | `api`           | The Go probes, so they stay usable in production                                                         |
| everything else                         | `web`           | `/`, `/explore`, `/games/…`, `/categories/…`, `/profile/…`, `/settings`, assets, sitemap                 |

A service receives the **original** request path (`/api/v1/auth/sign-in`, not
`/auth/sign-in`), which is why both the gateway's own routes and the auth
service's routes are mounted under `/api/v1` and nothing has to be rewritten in
Go.

## Health, liveness and readiness

Three routes, two purposes, and none of them needs Supabase:

| Route                | Purpose                                                             | Answers                                                                              |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /api/v1/health` | The published liveness probe, for deployments and uptime checks     | `200 {"status":"ok","version":"…"}`; `503 {"status":"draining"}` while shutting down |
| `GET /healthz`       | The same liveness signal for orchestrators, unversioned, plain text | `200 ok`                                                                             |
| `GET /readyz`        | **Readiness**: runs the registered dependency checks                | `200 {"status":"ready","checks":…}` or `503 {"status":"not_ready",…}`                |

`/api/v1/health` verifies no token, opens no database connection and calls no
upstream, so it stays `200` while every backend service is still unimplemented —
and it is exempt from the rate limiter. Readiness is deliberately separate: a
dependency that is down must not make a healthy process look dead, because that
is how a restart loop starts.

The auth service serves the same two routes on its own port, but it is internal,
so `https://unbored.lol/api/v1/health` is always the gateway's
answer. Reach the auth service's own probes from inside the deployment, or
locally.

## Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**. Vercel
scopes variables per environment; the values below are for **Production**.

### Public — compiled into the browser bundle (`VITE_` prefix)

| Name                            | Production value                         |
| ------------------------------- | ---------------------------------------- |
| `VITE_SUPABASE_URL`             | `https://<project-ref>.supabase.co`      |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the publishable key (`sb_publishable_…`) |
| `VITE_PUBLIC_SITE_URL`          | `https://unbored.lol`          |
| `VITE_API_BASE_URL`             | `https://unbored.lol/api/v1`   |

`VITE_API_BASE_URL` is the gateway's origin. It is the same origin as the app, so
the browser calls it without CORS preflights; the absolute value is used so the
built bundle is explicit about where the API lives rather than depending on the
origin it happens to be served from. For local work the same variable is
`http://localhost:8080/api/v1`. Nothing hardcodes either value: `src/lib/config.ts`
reads the variable and falls back to same-origin `/api/v1`.

### Server-only — never a `VITE_` name

| Name                       | Production value                              | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`              | `production`                                  | Selects `config.Validate`'s hardening rules                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `NITRO_PRESET`             | `vercel`                                      | The web service: `@lovable.dev/vite-tanstack-config` defaults Nitro to a Cloudflare worker, which is not what this project deploys                                                                                                                                                                                                                                                                                                                                                          |
| `SUPABASE_URL`             | same URL as `VITE_SUPABASE_URL`               | Both Go services derive `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` from it                                                                                                                                                                                                                                                                                                                                                                                                              |
| `SUPABASE_PUBLISHABLE_KEY` | same value as `VITE_SUPABASE_PUBLISHABLE_KEY` | Read by **both** Go services: `auth` calls the Supabase Auth API, `users` calls the Data API. The value is already public, so this is not a secret — it is set twice because the browser and the services read different names                                                                                                                                                                                                                                                              |
| `CORS_ALLOWED_ORIGINS`     | `https://unbored.lol`               | Required in production; `*` is rejected. A wrong value surfaces in the browser as a network failure, never as an auth error — see the troubleshooting row for two-origin CORS errors.                                                                                                                                                                                                                                                                                                       |
| `PUBLIC_SITE_URL`          | `https://unbored.lol`               | Origin the auth service proposes as Supabase `emailRedirectTo` (`…/auth/callback`); must also be allowlisted in Supabase redirect URLs. `SITE_URL` is accepted as a fallback name.                                                                                                                                                                                                                                                                                                          |
| `RATE_LIMIT_ENABLED`       | `1`                                           | Cannot be disabled in production                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ADMIN_EMAILS`             | `admin@example.com,another@example.com`       | Single source of truth for administrator access (server-only, never `VITE_`): comma-separated verified emails, matched case-insensitively per request; missing/empty grants no one; claims never grant, and a `user_roles` row grants the moderator tier at most, never suspension. Set for **Production** and **Preview** (preview needs its own test admins, never production secrets). Takes effect on the next request after deploy; removal revokes with no database cleanup.          |
| `SUPABASE_SECRET_KEY`      | the `games-admin` secret key (`sb_secret_…`)  | Privileged Data API credential for the admin bridge (server-only, never `VITE_`, never logged): after verifying `ADMIN_EMAILS`, the games deployment calls the `service_role`-only `*_svc` database wrappers with the verified actor — this is what serves an allowlisted administrator who holds no `user_roles` row. Without it those callers are answered `503`. Set for **Production** and **Preview**; no other service reads it. Legacy name `SUPABASE_SERVICE_ROLE_KEY` is accepted. |
| `LOG_LEVEL`, `LOG_FORMAT`  | `info`, `json` (defaults)                     | Optional; structured logs are what Vercel captures                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `SERVICE_NAME`             | optional                                      | Appears in log lines; both services log a sensible default already                                                                                                                                                                                                                                                                                                                                                                                                                          |

All three Go services read the server-only names from the same project scope, so
setting them once covers `api`, `auth` and `users`. That is intended: the values
are the same, and the publishable key is not a secret.

Deliberately **not** set:

- `SUPABASE_JWT_SECRET` — both services verify tokens against the project's
  JWKS, so no shared HS256 secret exists to leak or rotate. Setting only
  `SUPABASE_URL` is enough; removing the secret is a security improvement, not a
  missing value.
- `UPSTREAM_AUTH_URL`, `UPSTREAM_USERS_URL` — injected by the service bindings.
  See above.
- `UPSTREAM_<OTHER>_URL` — the gateway answers `503` for a group whose upstream
  is unset, which is the intended state until those services exist. No value is
  committed here, because a deployment address is environment-specific.
- `HTTP_ADDR` — Vercel injects the port; setting `HTTP_ADDR` would override it.
- `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER` — derived from `SUPABASE_URL`.

Vercel environment variables are project-scoped, so the API service can read the
`VITE_` values too — that is harmless in that direction. The rule that matters is
the other one: **only `VITE_`-prefixed names ever reach the browser bundle**, so a
secret never gets that prefix. See
[security/env-and-secrets.md](../security/env-and-secrets.md).

### Preview deployments

Preview deployments share the project's variables. Set the public values for
_Preview_ as well (preview URLs are `unboredapp-<hash>.vercel.app`), and add
those origins to `CORS_ALLOWED_ORIGINS` if the preview is meant to call the API
cross-origin. Leave `ENVIRONMENT=production` scoped to Production so a preview
cannot be mistaken for it; unscoped, a service defaults to `development`, which
relaxes the CORS and auth-material checks instead of loosening production.

`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` must also be available to Preview,
or the preview's auth service boots and answers `503` on the credential
endpoints.

## Deploying

The whole deployment is a `vercel.json` change plus the environment variables in
the tables above. Both Go services are already in the repository and need no build
step of their own.

### 1. Prerequisites (dashboard, once)

- **Framework preset = Services.** Vercel → project → _Settings → Build and
  Deployment → Framework Preset_ → **Services**. Without this, Vercel ignores the
  `services` key in `vercel.json` and falls back to its default framework
  detection, so the deployment is not the one this document describes.
- **Environment variables** from the tables above — in particular
  `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. They are not secrets but they are
  not optional either: without them `auth` boots, serves its probes, and answers
  `503` on `/api/v1/auth/sign-in|sign-up|refresh|session` instead of talking to
  Supabase, and `users` answers `503` on `/api/v1/users/me` for the same reason.
- **`NITRO_PRESET=vercel`**, or the web service emits a Cloudflare worker.

### 2. Deploy

```bash
vercel login
vercel link --project unboredapp   # link this checkout to the existing project
# if the CLI reports that project as missing, run `vercel link` without --project
# and pick the existing project from the list — a checkout linked before the
# rename still holds the old slug in .vercel/project.json
vercel deploy                          # preview first
vercel --prod                          # promote once the preview is correct
```

`vercel deploy` sends the **local working tree**, not a commit, so the preview can
be built and tested before anything is committed or pushed.

**Read the build log before testing anything else.** It is the only place that
confirms Vercel detected the topology you intended, and the failure modes are
silent: a service that is not detected does not error, it simply does not exist,
and its rewrite answers `404` from the web app instead. Four services must appear
(`web`, `api`, `auth`, `users`), and `api` must be reported as a container image
build rather than a Go build. If a service is missing, the cause is the service
object in `vercel.json` (root, `runtime`, `entrypoint`), not the Go code — and for
a Go service it is usually an entrypoint name outside the preset's three.

### 3. Verify the preview

```bash
BASE=https://unboredapp-<hash>.vercel.app
curl -sS "$BASE/api/v1/health"          # {"status":"ok","version":"dev"}
curl -sS "$BASE/api/v1"                 # {"apiVersion":"v1",...}
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/"   # 200 — the web app renders
```

If Deployment Protection is enabled for previews, an outside `curl` is answered
by the protection wall rather than by the service. Service-to-service calls skip
it, so the binding still works — but the end-to-end check below then has to run
against production.

### 4. Verify the end-to-end auth path in production

`/api/v1/auth/*` is the point of this deployment. Before this change it answered
`503 service_unavailable` with _"This API is not available in this environment
yet."_ — a correct answer for a group with no upstream. After it, the group must
reach the auth service and Supabase:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://unbored.lol/api/v1/auth/session
# 401 — routed, proxied and verified by the auth service. 503 means the binding
#       did not inject UPSTREAM_AUTH_URL; check the build log for the `auth` service.

curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"email":"does-not-exist@example.com","password":"a-long-password"}' \
  https://unbored.lol/api/v1/auth/sign-in
# 401 {"error":{"code":"unauthorized","message":"That email and password do not match."}}
# This is Supabase's answer, mapped to the platform envelope. It proves the whole
# chain — Vercel routing, the binding, the auth service and the Supabase project —
# because a missing Supabase configuration would answer 503 instead.
```

A sign-in that returns `200` with `{ session, tokens, user }` proves the same
chain from the other side. Email confirmation is a Supabase project setting: while
it is on, `sign-up` answers `201` _without_ `tokens`, which is a success and not a
failure.

### 5. Verify the end-to-end profile path in production

`/api/v1/users/*` is the point of the users service: the identity the UI shows
must be the account's own row, read from Supabase.

```bash
BASE=https://unbored.lol
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/api/v1/users/me"
# 401 — the binding resolved and the Users service verified the absence of a
#       token. 503 means the gateway has no UPSTREAM_USERS_URL; 404 from the web
#       app would mean the `users` service was not detected at all.

TOKEN=$(curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"email":"<confirmed account>","password":"<password>"}' \
  "$BASE/api/v1/auth/sign-in" | jq -r .tokens.accessToken)

curl -sS "$BASE/api/v1/users/me" -H "Authorization: Bearer $TOKEN"
# 200 with the account's real row: username, displayName, role, timestamps.

curl -sS -X PATCH -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"displayName":"A New Name"}' "$BASE/api/v1/users/me"
# 200 and the same row with the new displayName and a new updatedAt — which proves
# the write reached Postgres, not just the service.
```

A field the database does not grant must be refused, and the privilege has to be
enforced by the database rather than by the handler:

```bash
curl -sS -X PATCH -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"username":"someone_else"}' "$BASE/api/v1/users/me"
# 400 bad_request, details[0] = {"field":"username","rule":"unknown"}
```

Finally, load the app in a browser, sign in, and open **Profile** and **Settings →
Profile**: they must show the signed-in account's own display name and username,
and saving must persist. Two account-level checks matter and are easy to get
wrong: a second account must not see or change the first account's profile, and a
`PATCH` carrying a stale `expectedUpdatedAt` must be answered `409` instead of
overwriting.

### Rolling back

`vercel.json` is committed, so a rollback is a revert, and `vercel rollback`
restores the previous deployment without a rebuild. To leave services mode
entirely, set the framework preset back to its previous value and remove the
`services` key; the web app then deploys exactly as it did before this change —
though `/api/v1` and `/api/v1/auth/*` go with it, since the Go services only exist
in services mode.

## Troubleshooting

| Symptom                                                                                                                  | Cause                                                                                                                                   | Fix                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Multiple frameworks detected in project root: TanStack Start, Nitro, Node. Specify "framework" explicitly in services.` | A service has no dashboard preset, and the root matches several detectors                                                               | Already fixed: the `web` service pins `"framework": "tanstack-start-lovable"`                                                                                                                                                                                              |
| The `web` service build emits a Cloudflare worker (`.output/nitro.json` with `"preset": "cloudflare-module"`)            | `@lovable.dev/vite-tanstack-config` sets that preset as the _default_ for local builds; Vercel needs the `vercel` preset                | Set `NITRO_PRESET=vercel` in the project's environment variables (Nitro's documented switch; an explicit preset beats the default). Never run that in Lovable's sandbox — the config ignores it there                                                                      |
| `/api/v1/*` returns the app's HTML 404                                                                                   | The project is not in services mode, so the rewrites are inert                                                                          | Set the framework preset to **Services**                                                                                                                                                                                                                                   |
| A group answers `503 This API is not available in this environment yet.`                                                 | That group has no `UPSTREAM_<SERVICE>_URL`                                                                                              | Expected for the groups with no service yet. For `auth` or `users`, check that the service exists in the build log and that the binding is declared on `api` (the **caller**), not on the callee                                                                           |
| `/api/v1/auth/*` answers `503` on every credential endpoint, but `/api/v1/auth/session` answers `401`                    | The binding works; the auth service has no Supabase credentials                                                                         | Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for the environment being tested — a preview needs them too                                                                                                                                                              |
| `/api/v1/users/me` answers `503 Profiles are not available right now.`                                                   | The users service is deployed but has no Data API configuration                                                                         | Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. A `503` naming the _group_ (`This API is not available in this environment yet.`) is a different fault: the binding, not the credentials                                                                                |
| `/api/v1/users/me` answers `403 permission denied for table profiles` on a read                                          | A query asked for a column the SELECT grant excludes — `select=*` or a bare `Prefer: return=representation` projects `is_suspended` too | Name the projection. `supabaseprofile.Columns` is the list the grant allows, and both the read and the write use it; see [services/users/README.md](../../services/users/README.md#how-it-talks-to-supabase)                                                               |
| The profile page shows a sign-in prompt immediately after a reload                                                       | No stored session for this browser (first visit, cleared storage, another device) or the server refused the stored one                  | Not a fault. A stored session is restored from `unbored.auth.session.v1` (a session stored before the rename under `onemore.auth.session.v1` is read once and moved forward) and re-validated with `GET /api/v1/auth/session`; a refused pair is cleared, so sign in again |
| The `api` service is missing from the build log, or the deployment reports one fewer service than expected               | A container service was not detected                                                                                                    | The Dockerfile must be named exactly `Dockerfile.vercel` at the service root, and the service needs `"runtime": "container"` with `"entrypoint": "Dockerfile.vercel"`                                                                                                      |
| The `api` container builds but every request times out                                                                   | The app bound a port Vercel does not route to                                                                                           | The image declares `ENV PORT=80` and Vercel routes to 80 by default. Do not set `HTTP_ADDR` or `PORT` in the dashboard                                                                                                                                                     |
| The container build fails with `"/packages/go/platform": not found`                                                      | The build context is a subdirectory, so the relative `replace` in `services/go.mod` cannot resolve                                      | `api` must keep `"root": "./"` and build from the repository root                                                                                                                                                                                                          |
| Every browser request fails with a CORS error naming two origins                                                         | An upstream set its own `Access-Control-Allow-Origin` and the gateway's was appended                                                    | Already fixed: the gateway strips upstream CORS headers (`corsResponseHeaders` in `services/gateway/internal/proxy`)                                                                                                                                                       |

## Verified in the repository

Verified in the repository (see [development/testing.md](../development/testing.md)):

- `gofmt -l` clean and `go vet ./...` clean in both modules; `go test ./...` green
  in both; all seventeen `main` packages build (fourteen services, the gateway,
  `services/cmd/api` and `services/cmd/server`).
- **Every deployment entrypoint** — `services/cmd/api` (the users service on the Go
  preset), `services/cmd/server` (the auth service on the Go preset) and
  `services/gateway/cmd/gateway` (the gateway container) — executes the same
  `servicekit.MustRun(<service>.Options())` wiring as its local binary, and each
  oneshot local command (`go run ./users/cmd/users`, `./auth/cmd/auth`,
  `./gateway/cmd/gateway`) calls the same function, so a deployment and a local
  shell run one implementation, not two.
- **The container image**: `docker build -f Dockerfile.vercel .` succeeds and the
  result serves `GET /api/v1/health` → `200 {"status":"ok","version":"dev"}` on
  port 80 with an empty filesystem and a CA bundle, which is what the JWKS fetch
  and the upstream call need.
- **The full production-shaped path, locally**: the built container run with
  `UPSTREAM_AUTH_URL` pointed at the deployed entrypoint of the auth service
  (itself configured with the real `SUPABASE_URL` and publishable key) answers
  `/api/v1/auth/sign-in` with a real Supabase `401` mapped to the platform
  envelope — not the `503` of an unconfigured group — while an unconfigured group
  still answers `503`, a token-less `/api/v1/auth/session` answers `401`, and
  every response carries exactly one `Access-Control-Allow-Origin`.
- **The whole product, locally, against the real Supabase project**: the three Go
  services (auth, users, gateway) and `vite dev` were run together and driven in a
  browser. Signing in showed the account's real display name and username on
  `/settings`, `/profile` and `/settings/profile` instead of the prototype
  identity; an edit saved through the form changed the stored row (confirmed by
  re-reading it over the API); uploading a picture put a real object in the
  `avatars` bucket and pointed `avatarPath` at it, and the image then rendered from
  its public URL; a `PATCH` with a stale `expectedUpdatedAt` was answered `409`.
  The probe account and its object were deleted afterwards.
- `npx tsc --noEmit` clean, 62 vitest tests pass, `npm run build` succeeds and
  `npm run sitemap:check` reports `sitemap.xml is up to date`. The frontend suite
  includes the profile store and the profile editor, which drive the real
  `apiFetch` path against a stubbed `fetch`: the request shapes, the states
  (loading, signed out, no profile row, failure), the conditional write and its
  `409`, and that no edit is written to web storage.
- The built bundle contains no value of `SUPABASE_SECRET_KEY` — searched by value,
  not by name — and the publishable key is present, as designed.
- `node scripts/check-api-contract.mjs` reports the 16 routed groups documented
  across 28 paths, and `redocly lint` accepts the contract.

## Verified against production

The deployment described above was performed and exercised on **2026-10-08**
against the project's Vercel production domain as it was at the time. The project
has since been renamed to `unboredapp`; the requests below are shown against the
current host. Every request was a real request to the live deployment, and the
credential cases ran against the live Supabase project.

| Request                                                  | Observed                                                                                                   | What it proves                                                                                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/health`                                     | `200 {"status":"ok","version":"dev"}`                                                                      | The container-image gateway is serving                                                                                                                                            |
| `GET /api/v1`                                            | `200 {"apiVersion":"v1","commit":"","version":"dev"}`                                                      | Version discovery                                                                                                                                                                 |
| `GET /healthz` · `GET /readyz`                           | `200 ok` · `200 {"status":"ready","version":"dev"}`                                                        | Both probes                                                                                                                                                                       |
| `GET /`                                                  | `200`                                                                                                      | The web app still renders alongside two backends                                                                                                                                  |
| `GET /api/v1/games`                                      | `200 {"items":[…],"nextCursor":…}`                                                                         | The games service is deployed and the binding resolved. A `503` here means the binding did not (check the build log for the `games` service)                                      |
| `GET /api/v1/categories`                                 | `200 {"items":[… "gameCount": …]}`                                                                         | Real counts from the database view                                                                                                                                                |
| `GET /api/v1/admin/…`                                    | `503 This API is not available in this environment yet.`                                                   | A group with no upstream still answers as documented — so the gateway distinguishes configured from unconfigured groups, and `/api/v1/games/*` reaching `games` is not a wildcard |
| `GET /api/v1/auth/session` (no token)                    | `401 unauthorized`                                                                                         | **The binding resolved**: this is the auth service's answer, not the gateway's `503`                                                                                              |
| `POST /api/v1/auth/sign-in` (unknown field)              | `400 bad_request`, `details[0] = {field:"sneaky",rule:"unknown"}`                                          | Request validation through production                                                                                                                                             |
| `POST /api/v1/auth/sign-in` (wrong password)             | `401 "That email and password do not match."`                                                              | A live round trip to Supabase, mapped to the platform envelope                                                                                                                    |
| `OPTIONS /api/v1/auth/sign-in`                           | `204`, exactly **one** `Access-Control-Allow-Origin: https://unbored.lol`                        | CORS works and the upstream's header is not duplicated                                                                                                                            |
| `POST /api/v1/auth/sign-in` (confirmed account)          | `200`, `session.userId` = a real Supabase uuid, `role: user`, `onboarded: false`, `tokens.expiresIn: 3600` | Sign-in end to end, including the RLS-guarded `profiles` read                                                                                                                     |
| `GET /api/v1/auth/session` (bearer)                      | `200` with the same session                                                                                | **JWKS verification of a live Supabase token**                                                                                                                                    |
| `POST /api/v1/auth/refresh`                              | `200`, a new access _and_ refresh token                                                                    | Refresh works                                                                                                                                                                     |
| `POST /api/v1/auth/refresh` (garbage token)              | `422 unprocessable_entity`                                                                                 | Invalid material is distinguishable from a valid session                                                                                                                          |
| `POST /api/v1/auth/sign-out`                             | `204`                                                                                                      | Revocation                                                                                                                                                                        |
| `POST /api/v1/auth/sign-up` (address already registered) | `201` with a user object and **no** `tokens`                                                               | Supabase's anti-enumeration answer is passed through as the documented "awaiting confirmation" success                                                                            |

One disposable probe account (`phase3b-probe@example.com`) was created confirmed,
with the Supabase admin API, to exercise the authenticated paths above. It is
signed out and holds no data or role. Delete it from **Authentication → Users**
when it is no longer useful.

Two behaviours that look like defects and are not:

- **After `sign-out`, the access token still reads the session until it expires.**
  Access tokens are verified statelessly against the project's JWKS, so
  revocation ends the _refresh_ chain rather than rewriting an issued JWT. This
  is why the client must not keep a token past its expiry.
- **Replaying a refresh token is accepted even after the response handed back a
  new one.** See the gap below.

## Known gap: refresh-token rotation is off in this Supabase project

Measured on 2026-10-08: the same refresh token was accepted by
`POST /api/v1/auth/refresh` repeatedly, including **60 seconds** after the first
rotation — long past Supabase's 10-second reuse interval (the default that exists
to tolerate client retries). Refresh-token **rotation is therefore disabled for
this project**, which is a Supabase Auth setting, not a code path: the service
does exactly what it is told and there is no Go change that can turn it on.

The consequence is worth stating plainly, because the code used to assume the
opposite: a stolen refresh token stays usable for its whole lifetime, and reuse
is not detected. Enable **refresh token rotation** in the Supabase dashboard
(Authentication → Sessions / attack protection) so that each refresh invalidates
its predecessor. Until then, treat a refresh token as a long-lived credential.

## Still not verified

- **No Vercel build log has been read.** The deployment succeeded and every route
  above behaves as designed, but the log line naming the detected services was
  never inspected, so _why_ the routing works is documented behaviour rather than
  an observation. It matters only if a future change makes a service disappear:
  a service that is not detected does not error, it simply stops existing.
- **Deployment Protection for previews.** Only production was exercised, so
  whether an outside `curl` to a preview URL is answered by the protection wall
  is untested here.
- **The rate limiter under Vercel's instance model.** `AUTH_RATE_LIMIT_*` is
  in-process, so it is per instance; asserting a `429` in production would depend
  on which instance answered. It is covered by the test suite and by a local run
  that observed the `429` and its `Retry-After`, which is the strongest claim
  available without a shared store.
- **Vercel Services is still in Beta.** If the platform later rejects a
  configuration detail (a `root`, a `framework` slug, or a binding on a
  container service), the fix belongs in `vercel.json`; nothing in the Go code
  depends on it.
