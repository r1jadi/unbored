# Production: Cloudflare (website) + Render (API)

Since 2026-11-13 the product runs on two hosts instead of one Vercel project
(see [decisions/0016](../decisions/0016-cloudflare-and-render-hosting.md)):

| Piece | Host | Address | Free-plan limits |
|---|---|---|---|
| Website (TanStack Start SSR + static assets) | Cloudflare Workers | `https://unbored.lol` (`www.` redirects to it) | 100k dynamic requests/day; static files unlimited |
| API (auth, users, catalogue, play sessions, admin, crons — one process, `services/cmd/standalone`) | Render free web service `unbored-api-eu`, Frankfurt | `https://api.unbored.lol/api/v1` | 750 h/month (one always-on service); sleeps after 15 min idle |
| Daily crons | GitHub Actions ([`.github/workflows/cron.yml`](../../.github/workflows/cron.yml)) | — | free |
| Domain and DNS | Cloudflare (free plan) | `unbored.lol` | — |
| Database, Auth, Storage | Supabase (unchanged) | `eu-west-1` | — |

|                 |                                                                                         |
| --------------- | --------------------------------------------------------------------------------------- |
| API config      | [`render.yaml`](../../render.yaml) (Render Blueprint) + [`infrastructure/docker/api.Dockerfile`](../../infrastructure/docker/api.Dockerfile) |
| Website config  | Nitro's `cloudflare_module` preset, the default in [`vite.config.ts`](../../vite.config.ts); Cloudflare's Git integration builds and deploys |
| Health          | `https://api.unbored.lol/healthz` (plain `ok`) and `https://api.unbored.lol/api/v1/health` |
| Local API       | `http://localhost:8080/api/v1` — the gateway in front of the services (`scripts/dev-stack.mjs`), or `go run ./cmd/standalone` from `services/` for the production shape |

The API is in Frankfurt because the Supabase database is in Ireland: a US region
added a transatlantic round trip to every query. The website reaches it through
`api.unbored.lol`, a DNS-only CNAME, so moving the API again only changes DNS, not
the website build.

## What changed compared with Vercel

- **Two origins.** The site is `unbored.lol`, the API `api.unbored.lol`. Browser
  calls are now cross-origin, so `CORS_ALLOWED_ORIGINS` must list both
  `https://unbored.lol` and `https://www.unbored.lol` (it does, in `render.yaml`).
  The session is a bearer token from `localStorage`, not a cookie, so nothing else
  is needed for cross-origin auth.
- **One API process.** `services/cmd/standalone` mounts every route group that
  Vercel split across three deployments (`services/main.go`, `services/cmd/server`,
  `services/cmd/api` — still in the repository and built in CI, but no longer
  deployed). Routing between groups is now the in-process router, not rewrites.
  The in-process rate limiter is exact again, because there is one instance.
- **Caching.** Vercel's CDN read `Vercel-CDN-Cache-Control`; nothing on Render
  does, and `api.unbored.lol` is DNS-only, so Cloudflare does not cache it either.
  Guest catalogue reads (`/games`, `/games/{slug}`, `/categories`) are cached for
  60 s in memory by `services/internal/apicache` instead. `cdncache` still sets the
  Vercel header; it is inert.
- **Crons.** `vercel.json`'s `crons` are gone; GitHub Actions calls the same routes
  with the same `CRON_SECRET` bearer token (09:00 and 10:00 UTC).
- **Cold starts.** A free Render instance sleeps after 15 idle minutes, and the
  first request then takes up to a minute. An uptime monitor keeps it awake (below),
  and the cron workflow wakes it before calling a job.
- **Analytics.** Vercel Analytics and Speed Insights only work on Vercel and were
  removed; PostHog (consent-gated) is the only product analytics.
- **Redirects.** The old game slugs (`queens`, `zip`, `tango`) are redirected by
  Nitro route rules (`renamedGameRedirects` in `vite.config.ts`), not `vercel.json`.
- **Static-file headers.** `nosniff` and the same-site
  `Access-Control-Allow-Origin` on icons, the manifest, `sw.js` and `/assets/*`
  are Nitro route rules too (`staticFileHeaders`), which the build writes into
  `.output/public/_headers` for Cloudflare.

## 1. API on Render

1. render.com → sign up with GitHub → **New → Blueprint** → pick this repo. It reads `render.yaml`.
2. Fill the secret values it asks for: `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `ADMIN_EMAILS`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
3. Wait for the deploy, then open `https://api.unbored.lol/healthz` → `ok`.
4. Keep it awake: a free monitor (UptimeRobot or cron-job.org) hitting `/healthz` every 10 minutes. One service always on is ~720 h, inside the 750 h.

Render rebuilds only when `services/**`, `packages/go/**` or the Dockerfile change
(`buildFilter` in `render.yaml`); a website-only commit does not redeploy the API.

## 2. Website on Cloudflare Workers

1. dash.cloudflare.com → **Workers & Pages → Create → Import a repository** → this repo.
2. Build command: `bun install && bun run build` · Deploy command: `npx wrangler deploy`.
3. Build variables (all public, plain text):
   - `VITE_API_BASE_URL` = `https://api.unbored.lol/api/v1`
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_PUBLIC_SITE_URL` (`https://unbored.lol`), `VITE_PUBLIC_POSTHOG_KEY`, `VITE_PUBLIC_POSTHOG_HOST`, `VITE_VAPID_PUBLIC_KEY`
   - `NITRO_PRESET` = `cloudflare_module` is optional now that it is the default in `vite.config.ts`.
4. Deploy and test the `*.workers.dev` address.

`VITE_*` values are baked in at build time: change one → redeploy.

## 3. Domain

1. Cloudflare → **Add a domain** → `unbored.lol` (Free plan). It copies the existing DNS records — check the Resend/email ones (MX, TXT, CNAME) are there.
2. At the registrar, replace the old nameservers with the two Cloudflare shows. Takes minutes to a few hours.
3. Worker → **Settings → Domains & Routes → Add custom domain** → `unbored.lol` and `www.unbored.lol`.
4. API: DNS → add `CNAME api → unbored-api-eu.onrender.com`, **DNS only** (grey cloud). Render issues the certificate for `api.unbored.lol`.
5. SSL/TLS → Edge Certificates → **Always Use HTTPS** on; Rules → Redirect Rules → `https://www.unbored.lol/*` → `https://unbored.lol/${1}` (301, keep query string).

## 4. Crons

GitHub repo → Settings → Secrets and variables → Actions → add `API_ORIGIN` (`https://api.unbored.lol`) and `CRON_SECRET` (the same value Render has). Test with Actions → cron → Run workflow.

| Schedule (UTC) | Route |
|---|---|
| 09:00 daily | `GET /api/v1/cron/game-digests` |
| 10:00 daily | `GET /api/v1/cron/feedback-emails` |

Without `CRON_SECRET` on the API, both routes answer `503` rather than becoming an
open mail trigger.

## Environment variables

### Website — Cloudflare build variables (public, compiled into the bundle)

| Name | Production value |
|---|---|
| `VITE_API_BASE_URL` | `https://api.unbored.lol/api/v1` |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the publishable key (`sb_publishable_…`) |
| `VITE_PUBLIC_SITE_URL` | `https://unbored.lol` |
| `VITE_PUBLIC_POSTHOG_KEY`, `VITE_PUBLIC_POSTHOG_HOST` | PostHog project key and host |
| `VITE_VAPID_PUBLIC_KEY` | the public half of the VAPID pair |

Only `VITE_`-prefixed names reach the browser, so a secret never gets that prefix.
`src/lib/config.ts` reads `VITE_API_BASE_URL` and falls back to same-origin
`/api/v1`, which is wrong in production now — the variable must be set.

### API — Render environment (`render.yaml`)

Plain values are committed in `render.yaml`; `sync: false` ones are entered on the
Render dashboard and never committed.

| Name | Value | Why |
|---|---|---|
| `ENVIRONMENT` | `production` | Selects `config.Validate`'s hardening rules (`*` CORS rejected, rate limiting forced on) |
| `CORS_ALLOWED_ORIGINS` | `https://unbored.lol,https://www.unbored.lol` | Required, now that the API is a different origin. A wrong value shows up in the browser as a network failure, never as an auth error |
| `PUBLIC_SITE_URL` | `https://unbored.lol` | Origin the auth service gives Supabase as `emailRedirectTo` (`…/auth/callback`); must be allowlisted in Supabase redirect URLs |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` | The JWKS URL and the Auth/Data API base are derived from it |
| `SUPABASE_JWT_AUDIENCE` | `authenticated` | Expected `aud` of Supabase access tokens |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` (dashboard) | Auth and Data API calls; public, but set under this name for the Go services |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` (dashboard) | Admin bridge, digests, username lookup at sign-in, avatar publish. Without it those answer `503`. Legacy name `SUPABASE_SERVICE_ROLE_KEY` is accepted |
| `ADMIN_EMAILS` | comma-separated emails (dashboard) | The single source of administrator access, matched per request |
| `OPENAI_API_KEY` | `sk-…` (dashboard) | Moderation of new profile pictures; uploads fail closed (`503`) without it |
| `RESEND_API_KEY` | `re_…` (dashboard) | Digest and feedback mail |
| `EMAIL_FROM` | `Unbored <hello@unbored.lol>` | Verified Resend sender |
| `CRON_SECRET` | long random value (dashboard) | Bearer token GitHub Actions sends to `/api/v1/cron/*`; unset disables the routes |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | from `npx web-push generate-vapid-keys` (dashboard) | Web push; see [services/notifications](../../services/notifications/README.md#turning-it-on) |
| `RATE_LIMIT_*`, `AUTH_RATE_LIMIT_*` | see `render.yaml` | Global and credential-endpoint limits |

The Dockerfile sets `SERVICE_NAME=api`, `LOG_FORMAT=json` and `LOG_LEVEL=info`;
Render shows the JSON logs under the service's **Logs** tab.

Deliberately **not** set:

- `SUPABASE_JWT_SECRET` — tokens are verified against the project's JWKS.
- `HTTP_ADDR` — Render injects `PORT`, which the config reads.
- `UPSTREAM_*_URL` — only the local gateway reads them.
- `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER` — derived from `SUPABASE_URL`.

## Health, liveness and readiness

| Route | Purpose | Answers |
|---|---|---|
| `GET /api/v1/health` | Published liveness probe, for uptime checks | `200 {"status":"ok","version":"…"}`; `503 {"status":"draining"}` while shutting down |
| `GET /healthz` | Same signal, plain text — Render's `healthCheckPath` and the keep-awake monitor | `200 ok` |
| `GET /readyz` | **Readiness**: runs the registered dependency checks | `200 {"status":"ready",…}` or `503 {"status":"not_ready",…}` |

None of them needs Supabase, and they are exempt from the rate limiter.

## Verifying a deploy

```bash
API=https://api.unbored.lol
curl -sS "$API/healthz"                               # ok
curl -sS "$API/api/v1"                                # {"apiVersion":"v1",...}
curl -sS -o /dev/null -w '%{http_code}\n' "$API/api/v1/auth/session"   # 401 — the auth group, token-less
curl -sS -o /dev/null -w '%{http_code}\n' "$API/api/v1/users/me"       # 401 — the users group
curl -sS -o /dev/null -w '%{http_code}\n' "$API/api/v1/scores"         # 503 — a group with no service yet
curl -sS "$API/api/v1/categories" | head -c 200       # real categories with counts
curl -sSI -X OPTIONS "$API/api/v1/auth/sign-in" \
  -H 'Origin: https://unbored.lol' -H 'Access-Control-Request-Method: POST' \
  | grep -i access-control-allow-origin               # exactly one, https://unbored.lol
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://unbored.lol/games/queens   # 301 …/games/crowns
```

Then sign in on `https://unbored.lol` and open `/profile`: a real display name
proves the browser → API → Supabase chain.

## Rolling back

- **API:** Render → `unbored-api-eu` → **Events** → pick an earlier deploy →
  **Rollback**. Or revert the commit; Render redeploys on push.
- **Website:** Cloudflare → the Worker → **Deployments** → an earlier version →
  **Rollback**.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Every API call fails with a CORS error in the browser | `CORS_ALLOWED_ORIGINS` does not list the page's origin | Add it on Render (both `unbored.lol` and `www.unbored.lol`; a `*.workers.dev` preview needs its own entry) |
| API calls go to `https://unbored.lol/api/v1/…` and 404 | The website was built without `VITE_API_BASE_URL` | Set it in the Cloudflare build variables and redeploy |
| First request after a while takes ~1 minute | The free Render instance was asleep | Check the uptime monitor hitting `/healthz` every 10 minutes |
| A group answers `503 This API is not available in this environment yet.` | The group has no service yet (`apiroutes.Unavailable`) | Expected for scaffolded groups |
| `/api/v1/auth/*` credential endpoints answer `503` | `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` missing on Render | Set them and redeploy |
| `/api/v1/users/me` answers `403 permission denied for table profiles` | A query asked for a column the SELECT grant excludes | Name the projection; see [services/users/README.md](../../services/users/README.md#how-it-talks-to-supabase) |
| The cron workflow is skipped | No `API_ORIGIN` repository secret | Add `API_ORIGIN` and `CRON_SECRET` |
| The cron workflow fails with `503` | `CRON_SECRET` unset on Render, or the two values differ | Set the same value in both places |

## Known gap: refresh-token rotation is off in this Supabase project

Measured on 2026-10-08: the same refresh token was accepted by
`POST /api/v1/auth/refresh` repeatedly, including **60 seconds** after the first
rotation — long past Supabase's 10-second reuse interval. Refresh-token
**rotation is therefore disabled for this project**, which is a Supabase Auth
setting, not a code path. A stolen refresh token stays usable for its whole
lifetime. Enable **refresh token rotation** in the Supabase dashboard
(Authentication → Sessions / attack protection). Until then, treat a refresh token
as a long-lived credential. This is independent of the host and carried over from
the [Vercel guide](archive/vercel.md#known-gap-refresh-token-rotation-is-off-in-this-supabase-project).

## Still not verified

- **The client IP behind Render's proxy.** `httpx.ClientKey` buckets anonymous
  requests by the first `X-Forwarded-For` entry, which was right behind Vercel.
  Whether Render's proxy overwrites or appends to a client-supplied
  `X-Forwarded-For` has not been checked; if it appends, an anonymous caller can
  pick its own rate-limit bucket. It is never an authorization input.
- **The production checks above** have not been recorded against the new hosts
  the way the Vercel ones were in [archive/vercel.md](archive/vercel.md#verified-against-production).
