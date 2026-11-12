# Deploying to Vercel

One Vercel project serves the whole product on one domain: the TanStack Start web
app and three Go services (auth, users, games). There is no second host, no
`api.` subdomain and — since [0015](../decisions/0015-direct-service-routing.md) —
no gateway in between: `vercel.json` routes each `/api/v1` group straight to the
service that owns it.

|                    |                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project            | `unboredapp` → `https://unbored.lol`                                                                                                                                                       |
| Configuration      | [`vercel.json`](../../vercel.json) (services + rewrites; no bindings, no container)                                                                                                        |
| Web service        | `web` — repository root, framework `tanstack-start` (TanStack Start + Vite, SSR through Nitro)                                                                                             |
| Auth service       | `auth` — `services/`, framework `go`, entrypoint `services/cmd/server/main.go`; serves `/api/v1/auth/*`                                                                                    |
| Users service      | `users` — `services/`, framework `go`, entrypoint `services/cmd/api/main.go`; serves `/api/v1/users/*`                                                                                     |
| Games service      | `games` — `services/`, framework `go`, entrypoint `services/main.go`; serves every other `/api/v1` path: the catalogue, the play sessions, the admin API, the crons and the version/health routes |
| Local API          | `http://localhost:8080/api/v1` (the gateway, `go run ./gateway/cmd/gateway`, in front of the same services — see `scripts/dev-stack.mjs`)                                                 |
| Production API     | `https://unbored.lol/api/v1`                                                                                                                                                               |
| Production auth    | `https://unbored.lol/api/v1/auth/*`                                                                                                                                                        |
| Production profile | `https://unbored.lol/api/v1/users/me`                                                                                                                                                      |
| Health             | `https://unbored.lol/api/v1/health`                                                                                                                                                        |

## The four services

| Service | Root        | Built as                     | Public through                                                     |
| ------- | ----------- | ---------------------------- | ------------------------------------------------------------------ |
| `web`   | `./`        | Node (TanStack Start preset) | the catch-all rewrite                                              |
| `auth`  | `services/` | Vercel Go framework preset   | `/api/v1/auth`, `/api/v1/auth/*`                                   |
| `users` | `services/` | Vercel Go framework preset   | `/api/v1/users`, `/api/v1/users/*`                                 |
| `games` | `services/` | Vercel Go framework preset   | `/api/v1`, every other `/api/v1/*`, `/healthz`, `/readyz`          |

Every Go service runs the same `servicekit` middleware chain the gateway ran:
request ids, panic recovery, the security-header baseline, CORS, stripping of
client-supplied identity headers, request logging, the body limit and the rate
limiter — and each verifies the caller's token itself. Routing a group straight at
its service therefore removes a hop, not a protection. The public surface is still
one origin and one versioned path; which process answers a group is a routing
detail.

The three Go services share one root and one framework, and differ only in which of
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
  mean a shim around the router instead of the services that already exist — and
  they are not part of what a Nitro build emits.

### Why there is no gateway on Vercel any more

Until [0015](../decisions/0015-direct-service-routing.md) every API request went
browser → `api` (the gateway, a container image) → service, over service bindings.
The gateway had to be a container because Vercel's bindings are not available to
Go-runtime services. In practice that container accounted for about 75% of the
project's Fluid Active CPU and 96% of its Fluid Provisioned Memory in a 30-day
window, while doing no work of its own: every check it ran, the service behind it
ran again. Removing it cut both metrics to a fraction and took one hop and one cold
start out of every API call. What the gateway did that a service did not is now in
the services:

- **The CDN cache headers** for guest reads: `services/internal/cdncache` turns the
  games handlers' marker into `Vercel-CDN-Cache-Control`. The service is now the hop
  the CDN sees, so the header it sets reaches the CDN.
- **The version route and the `503` for groups nothing deploys yet**: mounted in the
  games deployment (`services/main.go`, `apiroutes.RegisterVersion`,
  `apiroutes.Unavailable`), which is where those paths land.

The gateway stays in the repository as the local entrypoint and as the shape for a
host that runs the services as plain processes.

## Why the web service pins a framework

A service has no dashboard preset of its own, and Vercel refuses to guess: the
first deployment with only `"root": "./"` failed with

> Multiple frameworks detected in project root: TanStack Start, Nitro, Node.
> Specify "framework" explicitly in services.

`tanstack-start` is that explicit value: its build is `vite build`.

The project-wide framework preset must still be **Services**; the per-service
`framework` only replaces the ambiguous auto-detection inside the service.

### Why the entrypoint is `cmd/api/main.go`

Vercel's Go framework preset detects exactly **three** entrypoints at a service
root: `main.go`, `cmd/api/main.go` and `cmd/server/main.go`. Anything else is not
built, and the failure is silent — the service simply does not appear.

That is the only reason the users service is reached through a file called
`cmd/api`: the slot name is Vercel's fixed list, not a description of what the
service does. The mapping follows what each service needs:

| Service | Entrypoint                    | Why that one                                                                                                                                                                                                                |
| ------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`  | `services/cmd/server/main.go` | Built by the Go preset, so it needs one of the three names                                                                                                                                                                  |
| `users` | `services/cmd/api/main.go`    | Also built by the Go preset, so it takes the remaining name                                                                                                                                                                 |
| `games` | `services/main.go`            | The Go preset's third and last name. It sits at the module root because that is where the preset looks; the file is a slot, not a description. It mounts three packages: the catalogue, the play sessions and the admin API |

All three run the same `servicekit.MustRun(<service>.Options())` as their local
`cmd/<name>` binary, so no entrypoint is a second implementation:
`services/users/cmd/users`, `services/auth/cmd/auth` and `services/games/cmd/games`
are the local shells for the same wiring.

## Routing

`vercel.json` routes public traffic with service rewrites. Vercel evaluates them in
order, and routing into a service is final: a request routed to a Go service never
falls back to the web app, whatever path it is.

| Request                                    | Service | Notes                                                                                                  |
| ------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------ |
| `/api/v1/auth`, `/api/v1/auth/…`           | `auth`  | Sign-up, sign-in, refresh, sign-out, session                                                           |
| `/api/v1/users`, `/api/v1/users/…`         | `users` | `/api/v1/users/me` is the profile                                                                      |
| `/api/v1/games/…`, `/api/v1/categories`    | `games` | The public catalogue and each game's leaderboard                                                       |
| `/api/v1/sessions/…`                       | `games` | The play-session routes are mounted in the games deployment                                            |
| `/api/v1/admin/…`                          | `games` | The admin routes are mounted in the games deployment, and stay fully staff-gated                       |
| `/api/v1/cron/…`                           | `games` | Vercel Cron, authenticated with `CRON_SECRET`                                                          |
| `/api/v1`, `/api/v1/health`                | `games` | Version discovery and liveness                                                                         |
| `/api/v1/<group with no deployment>/…`     | `games` | `503 This API is not available in this environment yet.` (`apiroutes.Unavailable`)                     |
| `/healthz`, `/readyz`                      | `games` | The Go probes, so they stay usable in production                                                       |
| everything else                            | `web`   | `/`, `/explore`, `/games/…`, `/categories/…`, `/profile/…`, `/settings`, assets, sitemap               |

A service receives the **original** request path (`/api/v1/auth/sign-in`, not
`/auth/sign-in`), which is why every service's routes are mounted under `/api/v1`
and nothing has to be rewritten in Go. The `auth` and `users` rewrites come before
the `/api/v1/(.*)` catch-all, and each is listed both bare and with `/(.*)` so the
group's own root reaches its service.

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

Every Go service serves these routes, but only the games deployment's are routed
publicly, so `https://unbored.lol/api/v1/health` is always its answer. Reach
the auth or users service's own probes locally.

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

`VITE_API_BASE_URL` is the API's origin. It is the same origin as the app, so
the browser calls it without CORS preflights; the absolute value is used so the
built bundle is explicit about where the API lives rather than depending on the
origin it happens to be served from. For local work the same variable is
`http://localhost:8080/api/v1`. Nothing hardcodes either value: `src/lib/config.ts`
reads the variable and falls back to same-origin `/api/v1`.

### Server-only — never a `VITE_` name

| Name                       | Production value                              | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`              | `production`                                  | Selects `config.Validate`'s hardening rules                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `SUPABASE_URL`             | same URL as `VITE_SUPABASE_URL`               | Both Go services derive `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` from it. Unset, the services fall back to `VITE_SUPABASE_URL` (and the key to `VITE_SUPABASE_PUBLISHABLE_KEY`): both are public, so an environment that only sets the web app's names still works                                                                                                                                                                                                                                                                                                                                                                                                              |
| `SUPABASE_PUBLISHABLE_KEY` | same value as `VITE_SUPABASE_PUBLISHABLE_KEY` | Read by **both** Go services: `auth` calls the Supabase Auth API, `users` calls the Data API. The value is already public, so this is not a secret — it is set twice because the browser and the services read different names                                                                                                                                                                                                                                                              |
| `CORS_ALLOWED_ORIGINS`     | `https://unbored.lol`               | Required in production; `*` is rejected. A wrong value surfaces in the browser as a network failure, never as an auth error — see the troubleshooting row for two-origin CORS errors.                                                                                                                                                                                                                                                                                                       |
| `PUBLIC_SITE_URL`          | `https://unbored.lol`               | Origin the auth service proposes as Supabase `emailRedirectTo` (`…/auth/callback`); must also be allowlisted in Supabase redirect URLs. `SITE_URL` is accepted as a fallback name.                                                                                                                                                                                                                                                                                                          |
| `RATE_LIMIT_ENABLED`       | `1`                                           | Cannot be disabled in production                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ADMIN_EMAILS`             | `admin@example.com,another@example.com`       | Single source of truth for administrator access (server-only, never `VITE_`): comma-separated verified emails, matched case-insensitively per request; missing/empty grants no one; claims never grant, and a `user_roles` row grants the moderator tier at most, never suspension. Set for **Production** and **Preview** (preview needs its own test admins, never production secrets). Takes effect on the next request after deploy; removal revokes with no database cleanup.          |
| `SUPABASE_SECRET_KEY`      | the `games-admin` secret key (`sb_secret_…`)  | Privileged Data API credential for the admin bridge, the game-release digest and the username lookup at sign-in (server-only, never `VITE_`, never logged): after verifying `ADMIN_EMAILS`, the games deployment calls the `service_role`-only `*_svc` database wrappers with the verified actor — this is what serves an allowlisted administrator who holds no `user_roles` row. Without it those callers are answered `503`, and the digest route answers `503`. Set for **Production** and **Preview**. Legacy name `SUPABASE_SERVICE_ROLE_KEY` is accepted. |
| `OPENAI_API_KEY`           | `sk-…` (an OpenAI API key)                   | Screens every new profile picture with OpenAI's free moderation endpoint (`omni-moderation-latest`) before the users service publishes it (`POST /api/v1/users/me/avatar`). The users service also uses `SUPABASE_SECRET_KEY` for that publish. Without either, photo uploads answer `503` — they fail closed and never publish an unscreened picture. Server-only; never a `VITE_` name. Set for **Production** and **Preview**. `OPENAI_MODERATION_MODEL` optionally overrides the model. |
| `RESEND_API_KEY`           | `re_…`                                        | Sends the five-new-games digest through Resend. Without it the digest route answers `503`. Server-only; never a `VITE_` name.                                                                                                                                                                                                                                                                                                                                                                |
| `EMAIL_FROM`               | `Unbored <hello@unbored.lol>`                 | Verified Resend sender. The domain must be verified before delivery works.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `CRON_SECRET`              | a long random value                           | Vercel Cron sends it as `Authorization: Bearer …` to `/api/v1/cron/game-digests`. Unset means the digest route stays disabled. Set it separately for Production and Preview.                                                                                                                                                                                                                                                                                                                  |
| `VITE_VAPID_PUBLIC_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | a pair from `npx web-push generate-vapid-keys` | Web push (the private key is server-only). Unset, Settings says push isn't available and nothing is sent. Full setup in [services/notifications](../../services/notifications/README.md#turning-it-on) |
| `LOG_LEVEL`, `LOG_FORMAT`  | `info`, `json` (defaults)                     | Optional; structured logs are what Vercel captures                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `SERVICE_NAME`             | optional                                      | Appears in log lines; both services log a sensible default already                                                                                                                                                                                                                                                                                                                                                                                                                          |

All three Go services read the server-only names from the same project scope, so
setting them once covers `auth`, `users` and `games`. That is intended: the values
are the same, and the publishable key is not a secret.

The digest route is scheduled in `vercel.json` (`crons`) for 09:00 UTC daily and
is served by the `games` deployment. Vercel injects the `CRON_SECRET` header only
when the variable exists for that environment, so set it before the first
scheduled run; the route is otherwise a 503 rather than an open mail trigger.

Deliberately **not** set:

- `SUPABASE_JWT_SECRET` — both services verify tokens against the project's
  JWKS, so no shared HS256 secret exists to leak or rotate. Setting only
  `SUPABASE_URL` is enough; removing the secret is a security improvement, not a
  missing value.
- `UPSTREAM_*_URL` — only the local gateway reads them. Nothing on Vercel proxies,
  so a value set in the dashboard does nothing; remove any left over from the
  gateway deployment.
- `HTTP_ADDR` — Vercel injects the port; setting `HTTP_ADDR` would override it.
- `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER` — derived from `SUPABASE_URL`.

Vercel environment variables are project-scoped, so the Go services can read the
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
(`web`, `auth`, `users`, `games`), the three Go services as Go builds. If a
service is missing, the cause is the service object in `vercel.json` (root,
`framework`, `entrypoint`), not the Go code — usually an entrypoint name outside the
preset's three.

### 3. Verify the preview

```bash
BASE=https://unboredapp-<hash>.vercel.app
curl -sS "$BASE/api/v1/health"          # {"status":"ok","version":"dev"}
curl -sS "$BASE/api/v1"                 # {"apiVersion":"v1",...}
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/"   # 200 — the web app renders
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/api/v1/scores"   # 503 — a group with no deployment
curl -sSI "$BASE/api/v1/games" | grep -i -E 'x-vercel-cache|^cache-control'
# Repeat the last request: the second answer should be a CDN HIT, which proves the
# games service's Vercel-CDN-Cache-Control reached the CDN.
```

If Deployment Protection is enabled for previews, an outside `curl` is answered
by the protection wall rather than by the service, and the checks then have to run
in a browser signed in to Vercel, or against production.

### 4. Verify the end-to-end auth path in production

`/api/v1/auth/*` is the point of this deployment. Before this change it answered
`503 service_unavailable` with _"This API is not available in this environment
yet."_ — a correct answer for a group with no upstream. After it, the group must
reach the auth service and Supabase:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://unbored.lol/api/v1/auth/session
# 401 — routed to and verified by the auth service. 503 "not available in this
#       environment" means the auth rewrite did not match and the games deployment
#       answered; a 404 HTML page means the `auth` service was not detected.

curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"email":"does-not-exist@example.com","password":"a-long-password"}' \
  https://unbored.lol/api/v1/auth/sign-in
# 401 {"error":{"code":"unauthorized","message":"That email or username and password do not match."}}
# This is Supabase's answer, mapped to the platform envelope. It proves the whole
# chain — Vercel routing, the auth service and the Supabase project —
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
# 401 — routed to the Users service, which verified the absence of a token. A
#       503 naming the group means the users rewrite did not match; 404 from the
#       web app would mean the `users` service was not detected at all.

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
| `/api/v1/*` returns the app's HTML 404                                                                                   | The project is not in services mode, so the rewrites are inert                                                                          | Set the framework preset to **Services**                                                                                                                                                                                                                                   |
| A group answers `503 This API is not available in this environment yet.`                                                 | The request reached the games deployment for a group it does not run                                                                     | Expected for the groups with no service yet. For `auth` or `users`, check that the service exists in the build log and that its rewrites come before `/api/v1/(.*)` in `vercel.json` |
| `/api/v1/auth/*` answers `503` on every credential endpoint, but `/api/v1/auth/session` answers `401`                    | The routing works; the auth service has no Supabase credentials                                                                         | Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for the environment being tested — a preview needs them too                                                                                                                                                              |
| `/api/v1/users/me` answers `503 Profiles are not available right now.`                                                   | The users service is deployed but has no Data API configuration                                                                         | Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. A `503` naming the _group_ (`This API is not available in this environment yet.`) is a different fault: the routing, not the credentials                                                                                |
| `/api/v1/users/me` answers `403 permission denied for table profiles` on a read                                          | A query asked for a column the SELECT grant excludes — `select=*` or a bare `Prefer: return=representation` projects `is_suspended` too | Name the projection. `supabaseprofile.Columns` is the list the grant allows, and both the read and the write use it; see [services/users/README.md](../../services/users/README.md#how-it-talks-to-supabase)                                                               |
| The profile page shows a sign-in prompt immediately after a reload                                                       | No stored session for this browser (first visit, cleared storage, another device) or the server refused the stored one                  | Not a fault. A stored session is restored from `unbored.auth.session.v1` (a session stored before the rename under `onemore.auth.session.v1` is read once and moved forward) and re-validated with `GET /api/v1/auth/session`; a refused pair is cleared, so sign in again |
| Every browser request fails with a CORS error                                                                            | `CORS_ALLOWED_ORIGINS` does not list the origin the page was served from                                                                | Each Go service answers CORS itself from `CORS_ALLOWED_ORIGINS`; set it for the environment being tested (a preview has its own origin)                                                                                                                                     |
| Guest catalogue reads are never a CDN `HIT`                                                                               | The CDN did not receive `Vercel-CDN-Cache-Control`                                                                                     | Check the response of `GET /api/v1/games` without a token: it must carry `Cache-Control: public, max-age=0, must-revalidate`. If it carries `no-store`, `cdncache.Middleware` is not installed (see `games.Options`)                                                        |

## Verified in the repository

Verified in the repository (see [development/testing.md](../development/testing.md)):

> The bullets below were recorded for the gateway topology (see
> [0015](../decisions/0015-direct-service-routing.md)); the container image they
> mention no longer exists.

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

> **Historical.** This section records the gateway topology that
> [0015](../decisions/0015-direct-service-routing.md) replaced: the `api`
> container, the bindings and the gateway's answers are gone. Re-run the checks in
> [Deploying](#deploying) against the current routing.

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
| `POST /api/v1/auth/sign-in` (wrong password)             | `401 "That email or username and password do not match."`                                                  | A live round trip to Supabase, mapped to the platform envelope                                                                                                                    |
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
  configuration detail (a `root`, a `framework` slug or a service rewrite), the
  fix belongs in `vercel.json`; nothing in the Go code depends on it.
