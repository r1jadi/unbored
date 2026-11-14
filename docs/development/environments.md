# Environments and configuration

## The four environments

| Environment     | Purpose                     | Web                             | API                                                                           | Database                                                |
| --------------- | --------------------------- | ------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| **development** | a developer's machine       | `npm run dev` on `:8081`        | `go run ./gateway/cmd/gateway` on `:8080`                                     | local Supabase (`supabase start`) or the Docker harness |
| **preview**     | checking a branch           | Cloudflare `*.workers.dev` preview build, if enabled | the production API (add the preview origin to `CORS_ALLOWED_ORIGINS`) | hosted Supabase project |
| **staging**     | pre-production verification | not set up                      | not set up                                                                    | separate Supabase project, once it exists               |
| **production**  | users                       | `https://unbored.lol` (Cloudflare Workers) | `https://api.unbored.lol/api/v1` (Render, Frankfurt) | hosted Supabase project                                 |

`ENVIRONMENT` drives the hardening rules: a wildcard CORS origin, an empty CORS
allowlist, missing auth material, a non-HTTPS JWKS URL and a disabled rate limiter
are all rejected at startup outside development (`config.Validate`).

## The public/secret split

Two classes, and a value never moves between them.

### Public — safe in the browser bundle

| Variable                        | Meaning                                                                                                                                                                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | Supabase project URL                                                                                                                                                                                                                                                         |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_…`), the current name for the anon key. RLS is the security boundary, not secrecy.                                                                                                                                                          |
| `VITE_PUBLIC_SITE_URL`          | Canonical origin for SEO                                                                                                                                                                                                                                                     |
| `VITE_API_BASE_URL`             | API base, empty means same-origin `/api/v1`. A `localhost` absolute URL is ignored on non-localhost pages (fail-safe in `src/lib/config.ts`) but the deployment must still set the correct production value — never bake a local `.env.local` value into a production build. |

Supabase is retiring the legacy `anon` and `service_role` keys in favour of
**publishable** (`sb_publishable_…`) and **secret** (`sb_secret_…`) keys — see
[API keys](https://supabase.com/docs/guides/getting-started/api-keys). Both key
systems work side by side during the migration, so nothing breaks if one surface
is updated before another. `VITE_SUPABASE_ANON_KEY` is still read as a fallback by
`src/lib/config.ts`, but a new environment uses the publishable name.

### Server-only — never in a `VITE_` variable

| Variable                                                                                    | Read by                                                | Why it is secret                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_SECRET_KEY`                                                                       | Go API (admin bridge, digests, username sign-in, avatar publish) | bypasses RLS; the current name for the service role key                                                                                                                                                                      |
| `SUPABASE_JWT_SECRET`                                                                       | Go services                                            | forges tokens in legacy HS256 projects                                                                                                                                                                                       |
| `SUPABASE_JWKS_URL`, `SUPABASE_URL`, `SUPABASE_JWT_AUDIENCE`, `SUPABASE_JWT_ISSUER`         | Go services                                            | project metadata, not secret, but server-side                                                                                                                                                                                |
| `SUPABASE_PUBLISHABLE_KEY`                                                                  | the auth and users services                            | the browser is given the same value, so it is not secret — but only the server needs to make Auth API and Data API calls                                                                                                     |
| `CORS_ALLOWED_ORIGINS`, `RATE_LIMIT_*`, `LOG_*`, `HTTP_ADDR`, `ENVIRONMENT`, `SERVICE_NAME` | Go services                                            | service configuration                                                                                                                                                                                                        |
| `ADMIN_EMAILS`                                                                              | Go API (gateway, games/admin, moderation, analytics)   | single source of truth for admin access: comma-separated verified account emails, compared case-insensitively per request; missing/empty grants no one; token claims and `user_roles` rows never grant; never a `VITE_` name |
| `PUBLIC_SITE_URL` (`SITE_URL` fallback)                                                     | auth service                                           | not secret: origin proposed as Supabase `emailRedirectTo` (`/auth/callback`); the Supabase redirect allowlist decides whether it is honoured                                                                                 |
| `NITRO_PRESET`                                                                              | web build                                              | build preset, not secret: optional — the repo config already defaults Nitro to `cloudflare_module` (Cloudflare Workers); set `node-server` for a Node build                                                                  |
| `UPSTREAM_*_URL`                                                                            | gateway                                                | internal addresses                                                                                                                                                                                                           |
| `RAIACCEPT_*`                                                                               | payments service (later)                               | payment credentials                                                                                                                                                                                                          |

`Vite` inlines every `VITE_`-prefixed value into the client bundle. If a secret
ever needs a `VITE_` name, the design is wrong — put it behind the API instead.

`.env.example` documents every variable and is the only committed env file.
`.env`, `.env.local` and `.env.*.local` are gitignored. `gitleaks` runs in CI over
the full history, so a secret that was committed and deleted is still treated as
leaked — see [security/env-and-secrets.md](../security/env-and-secrets.md).

## Where values are set

| Environment                        | Mechanism                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| development                        | `.env.local` (web), shell environment or a `direnv`-style loader (Go)                                                                                                                                                                                                                                        |
| production web                     | Cloudflare → the Worker → Settings → **Build** variables. Only public `VITE_*` values; they are compiled into the bundle, so a change needs a redeploy. |
| production API                     | Render → `unbored-api-eu` → **Environment**. Plain values are committed in [`render.yaml`](../../render.yaml); secrets are `sync: false` there and entered only on the dashboard. |
| crons                              | GitHub → Settings → Secrets and variables → Actions: `API_ORIGIN` and `CRON_SECRET`. |

The exact set and values are in [deployment/production.md](../deployment/production.md#environment-variables).
The website and the API no longer share one variable store: the browser build
never sees a server secret, because the Worker is never given one.

## How to find each value

The dashboard paths below are the ones that exist today; Supabase has moved keys
from _Settings → API_ to _Settings → API Keys_, and both the Connect dialog and
the API Keys page show the same values.

### Supabase — the same source for both the web and the API

| Value                                | Where a human gets it                                                                                                                                                                                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL` / `SUPABASE_URL` | Dashboard → **Project Settings → API Keys → Project URL**, or the project's **Connect** dialog. Self-hosted or local: `supabase status` → _APIs_ → Project URL.                                                                                                                               |
| `VITE_SUPABASE_PUBLISHABLE_KEY`      | Dashboard → **Project Settings → API Keys → Publishable and secret API keys** tab → the publishable key (`sb_publishable_…`). If the tab offers _Create new API keys_, create them; the anon key keeps working meanwhile. Local: `supabase status` → _Authentication Keys_ → **Publishable**. |
| `SUPABASE_SECRET_KEY`                | Same tab → **secret** key (`sb_secret_…`); create one per backend component so a leak forces a single rotation. Local: `supabase status` → _Authentication Keys_ → **Secret**.                                                                                                                |
| `SUPABASE_PUBLISHABLE_KEY`           | The same publishable key as `VITE_SUPABASE_PUBLISHABLE_KEY` — one value, two names, because the browser reads the `VITE_` copy and the auth service reads this one.                                                                                                                           |
| `SUPABASE_JWKS_URL`                  | Leave empty. `config.go` derives `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, which is public — paste it into a browser to confirm it returns JSON.                                                                                                                                        |
| `SUPABASE_JWT_ISSUER`                | Leave empty; derived as `<SUPABASE_URL>/auth/v1`.                                                                                                                                                                                                                                             |
| `SUPABASE_JWT_AUDIENCE`              | Fixed: `authenticated`.                                                                                                                                                                                                                                                                       |
| `SUPABASE_JWT_SECRET`                | **Legacy only.** Dashboard → **Project Settings → API Keys → JWT signing keys**; _Migrate JWT secret_ imports the old secret into the signing-keys system and creates a rotatable ES256 key. `supabase gen signing-key --algorithm ES256` generates a key you can import instead.             |

`supabase status -o env` prints the local values as `KEY=value` lines
(`PUBLISHABLE_KEY`, `SECRET_KEY`, `API_URL`, `DB_URL`); `npm run env:supabase`
([scripts/env-from-supabase.mjs](../../scripts/env-from-supabase.mjs)) maps them
onto the names in this repository.

### Everything else

| Value                                   | Where a human gets it                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_PUBLIC_SITE_URL`                  | The origin the app is actually served from: `https://unbored.lol` in production.                                                                                                                                                                                                                                                                                                                              |
| `VITE_API_BASE_URL`                     | The API's base URL: `https://api.unbored.lol/api/v1` in production, `http://localhost:8080/api/v1` locally. Empty means same-origin `/api/v1`, which is **wrong** in production now that the API is on its own origin. A localhost value baked into a production build fails every call as a network error; the client ignores it on non-localhost pages but the dashboard value must be correct. |
| `PUBLIC_SITE_URL` (`SITE_URL` fallback) | The origin the auth service proposes for Supabase email-confirmation/recovery links: `https://unbored.lol` in production. Must also be allowlisted in Supabase → Authentication → URL Configuration → Redirect URLs (`…/auth/callback`).                                                                                                                                                                                  |
| `NITRO_PRESET`                          | Optional. Unset, `vite build` emits a Cloudflare worker (`.output/nitro.json` with `"preset": "cloudflare-module"`), which is what production deploys. `node-server` gives a Node build; local `vite dev` does not use it.                                                                                                                                                                                                                                          |
| `ENVIRONMENT`                           | Chosen, not found: `development` locally, `production` on Render, `staging` on a staging host. It selects the hardening rules in `config.Validate`.                                                                                                                                                                                                                                                                                 |
| `SERVICE_NAME`                          | Chosen: the service being run (`gateway`, `auth`, …), used in logs.                                                                                                                                                                                                                                                                                                                                                                 |
| `HTTP_ADDR`                             | Chosen: the port the service listens on. Set `:8080` locally; on Render leave it unset, because the platform injects `PORT` and `config.Load` prefers `HTTP_ADDR`, then `PORT_HTTP`, then `PORT`.                                                                                                                                                                                                                                   |
| `LOG_LEVEL`, `LOG_FORMAT`               | Chosen: `debug`/`info`/`warn`/`error` and `json`/`text`.                                                                                                                                                                                                                                                                                                                                                                            |
| `CORS_ALLOWED_ORIGINS`                  | The exact browser origins the web app is served from — dev server, `https://unbored.lol` and `https://www.unbored.lol`, and any Cloudflare preview origin. Comma-separated, no wildcard outside development.                                                                                                                                                                                                                                                                         |
| `RATE_LIMIT_*`                          | Tuned from observed traffic, not discovered. Defaults suit a single instance; raise them deliberately.                                                                                                                                                                                                                                                                                                                              |
| `AUTH_RATE_LIMIT_*`                     | The credential budget for the auth endpoints, metered per client and per account. Defaults to 10/minute with a burst of 5, deliberately far tighter than `RATE_LIMIT_*` because every attempt can verify a password.                                                                                                                                                                                                                |
| `UPSTREAM_*_URL`                        | The private address of each deployed service. Unset means the gateway answers `503` for that route group, which is the intended state before an API host exists. Only the local gateway reads them: in production every group is mounted in one process ([0016](../decisions/0016-cloudflare-and-render-hosting.md)), so they are never set there. |
| `RAIACCEPT_*`                           | The RaiAccept merchant dashboard, once payments start. Not read by any service today.                                                                                                                                                                                                                                                                                                                                               |
| Database password / connection string   | Supabase dashboard → **Project Settings → Database → Connection string** (or `supabase status` → _Database_ → URL locally). Nothing in this repository stores it: migrations run through the CLI, which keeps its own session.                                                                                                                                                                                                      |

## Local API configuration

A minimal `.env.local` for a developer running the API locally:

```dotenv
ENVIRONMENT=development
SERVICE_NAME=gateway
HTTP_ADDR=:8080
LOG_LEVEL=debug
LOG_FORMAT=text
CORS_ALLOWED_ORIGINS=http://localhost:8081
RATE_LIMIT_REQUESTS_PER_MINUTE=6000
RATE_LIMIT_BURST=600
```

In development a service starts without Supabase auth material; protected routes
then answer `503` with a log line explaining what to set, rather than pretending
to authenticate. To exercise real token verification locally, set
`SUPABASE_URL` (the service derives the JWKS URL) or `SUPABASE_JWT_SECRET`.

To exercise the real endpoints locally, add `SUPABASE_PUBLISHABLE_KEY` (the auth
service calls Supabase Auth with it, the users service calls the Data API) and run
the services themselves:

```bash
# from services/
SERVICE_NAME=auth  HTTP_ADDR=:8082 go run ./auth/cmd/auth
SERVICE_NAME=users HTTP_ADDR=:8083 go run ./users/cmd/users
UPSTREAM_AUTH_URL=http://localhost:8082 UPSTREAM_USERS_URL=http://localhost:8083 \
UPSTREAM_GAMES_URL=http://localhost:8084 \
  SERVICE_NAME=gateway HTTP_ADDR=:8080 go run ./gateway/cmd/gateway
```

The gateway proxies `/api/v1/auth/*` to `UPSTREAM_AUTH_URL`, `/api/v1/users/*` to
`UPSTREAM_USERS_URL` and `/api/v1/games/*` (plus `/api/v1/categories`) to
`UPSTREAM_GAMES_URL`. Locally those values are set by hand. In production there is no
gateway: `services/cmd/standalone` mounts the same groups in one process, so the
routing is the same and only the process boundary differs. `services/auth/README.md`
and `services/users/README.md` list the endpoints and what each one calls at
Supabase.

Point the web app at that gateway, which is the only difference between local and
deployed:

```bash
VITE_API_BASE_URL=http://localhost:8080/api/v1 npm run dev
```

`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` come from `.env.local` and
are used for one thing only: an avatar's public URL and the owner-scoped upload to
the `avatars` bucket. Without them the profile still works; a picture does not.

## Configuration is fail-fast

A service refuses to start on an invalid configuration instead of running with a
weakened default: unknown `LOG_LEVEL`, a body limit outside the supported range,
a CORS origin that is not an absolute http(s) origin, `*` outside development, an
empty CORS allowlist in production, missing auth material in production, a
non-HTTPS JWKS URL in production, and `RATE_LIMIT_ENABLED=0` in production. The
error message names the variable to change.

## Blockers and manual actions

These are outside what a repository change can do — they need a human with
dashboard access:

1. **Supabase project — done, and no migration was needed.** The CLI is installed
   and authenticated, the hosted project is
   `trrwaftksifjaiaxfmiu.supabase.co` (name `unbored`), and the local CLI link
   points at it, so CLI database work targets the right project. The hosted schema
   was inspected directly: `public.profiles` and `public.user_roles` match
   `supabase/migrations/20261005120000_core_schema.sql` and
   `20261005120100_rls_and_grants.sql` column for column, the object policies match
   `20261005120200_storage_buckets.sql`, and the `on_auth_user_created` trigger
   creates both the profile row and the `user` role row for a new account. Grants
   and RLS were exercised with real tokens rather than read off the migration. The
   migrations are therefore **not** reapplied. (`supabase db push` also cannot run
   with CLI 2.120.0: `db.major_version = 16` in `supabase/config.toml` is rejected
   by that version, which is an upstream bug — nothing in this work needs it.)
2. **Hosting — done.** The website is a Cloudflare Worker and the API a Render
   service (`render.yaml`); the setup steps and the checks after a deploy are in
   [deployment/production.md](../deployment/production.md). The website's build
   variables and the API's secrets live in the two dashboards, not the repository.
3. **Keep the API awake.** The free Render instance sleeps after 15 idle minutes.
   An external uptime monitor must hit `https://api.unbored.lol/healthz` every
   10 minutes; without it the first visitor after a quiet spell waits up to a
   minute.
4. **Custom domain — done** (`unbored.lol`). If it ever changes, set
   `VITE_PUBLIC_SITE_URL` and `PUBLIC_SITE_URL`, regenerate the sitemap
   (`npm run sitemap`), update the `Sitemap:` line in `robots.txt`, and update
   `CORS_ALLOWED_ORIGINS` and the Supabase redirect allowlist.
5. **The API needs environment variables, not more hosts.** Every group is mounted
   in the one Render service, so no address has to be chosen or committed. If
   `SUPABASE_URL` or `SUPABASE_PUBLISHABLE_KEY` is missing, `auth` and `users`
   answer `503` from their own handlers and the web app reports the failure
   instead of pretending to sign anyone in. _"This API is not available in this
   environment yet."_ is the different answer of a group with no service at all.
6. **The admin surface needs two migrations applied, and one role granted by
   hand.** `20261013130000_admin_operations.sql` and
   `20261013130100_admin_identity_and_categories.sql` define the staff functions
   and `admin_identity()`; until they are applied, every admin route answers `503`
   from the service (the functions do not exist), which is a diagnosable failure
   rather than a crash. Apply them the same way the earlier ones were applied —
   the dashboard's SQL editor, or the CLI once it can run `db push` again (see the
   note in item 1). Then, and only then, grant a role. **Granting is a two-part,
   operator-only action** — the `public.user_roles` row plus the Supabase Auth
   `app_metadata.role` claim — and the exact SQL, the claim value and the
   verification call are in
   [0013](../decisions/0013-admin-authorization.md#granting-and-revoking-a-role).
   No account is granted a role by this repository, and none is granted
   automatically: the dashboard says "this area requires a moderator account"
   until somebody does it deliberately.
7. **Avatar uploads depend on browser-visible Supabase configuration.** A profile
   picture is uploaded from the browser straight to the `avatars` bucket with the
   caller's own token, so `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
   must be present in the built bundle for the button to work. Everything else about
   the profile works without them.
