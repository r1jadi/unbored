# 0011 — The users service serves the real profile, deployed privately beside auth

- Status: accepted (amended by [0015](0015-direct-service-routing.md): no binding, no gateway on Vercel; and by [0016](0016-cloudflare-and-render-hosting.md): mounted in the single API process on Render)
- Date: 2026-10-08
- Extends [0010](0010-auth-service-deployment-topology.md)

## Context

Until this decision the signed-in identity in the web app was prototype data:
`src/lib/mock.ts` exported a hardcoded `me` (`username: "rijad"`, `"Rijad Halili"`)
and the settings, profile and leaderboard screens rendered it. A real Supabase
project, real accounts and a real session existed — sign in worked — but the person
on screen was a literal.

The database was already right. `public.profiles` links 1:1 to `auth.users(id)` with
`on delete cascade`, carries the presentation fields the UI needs
(`username`, `display_name`, `bio`, `avatar_path`, `onboarded_at`), and is guarded by
grants that are deliberately narrower than the table:

- `grant select (id, username, display_name, bio, avatar_path, onboarded_at, created_at, updated_at)`
  — `is_suspended` is **not** readable through the Data API at all;
- `grant update (display_name, bio, avatar_path, onboarded_at)` — a client cannot
  write `username`, `is_suspended`, or a timestamp;
- RLS policies allow a caller to read the public projection and to update only
  their own row, and `profiles_touch_updated_at` moves `updated_at` on every write.

So the missing piece was a service, not a schema. Three ways to read the profile
were considered and two rejected:

- **Read Supabase from the browser.** The publishable key is already in the bundle
  and RLS would hold, but it puts the profile's shape, error handling and column
  knowledge in the client, splits the API surface across two origins, and makes the
  browser the place where a column grant turns into a silent `403`.
- **Read it from the auth service.** `auth` already reads `onboarded_at` for the
  session payload. Growing it into the profile service would put credentials and
  presentation in one deployable and one rate limiter, and the `/users` group in
  `services/internal/apiroutes/routes.go` would stay a lie.
- **A users service, deployed the way 0010 deploys auth.** Consistent with the
  route table, the contract and every other service.

## Decision

Implement `services/users` as the owner of `/api/v1/users/*` and deploy it as a
**fourth service of the same Vercel project**, reachable from the gateway by a
second **service binding**.

- `vercel.json` declares `users` with `root: "services/"`, `framework: "go"`,
  `entrypoint: "cmd/api/main.go"`, and adds a second binding to the existing `api`
  service:
  `{ "type": "service", "service": "users", "format": "url", "env": "UPSTREAM_USERS_URL" }`.
  As in 0010 the binding is declared on the **caller**, its value is generated per
  deployment, and it is therefore never set in the dashboard.
- **No rewrite targets `users`.** It is internal, and the public entry stays
  `https://unboredapp.vercel.app/api/v1/users/*` through the gateway.
- **`services/cmd/api/main.go` becomes the users service's deployment entrypoint.**
  Vercel's Go preset detects exactly `main.go`, `cmd/api/main.go` and
  `cmd/server/main.go`, and each is a fixed slot rather than a description. `auth`
  holds `cmd/server`, the gateway deploys as a container image built from
  `services/gateway/cmd/gateway` and needs no preset slot, so the third slot goes to
  `users`. Every entrypoint is still `servicekit.MustRun(<service>.Options())`.
- **Two endpoints, and only these:** `GET /users/me` and `PATCH /users/me`. No
  `/users/{id}` — reading another account's profile is a social feature that does
  not exist yet, and a route for it now would be an unauthenticated-by-accident
  surface.
- **Identity comes from the token, never from the request.** The row is addressed by
  the verified token's subject; no body or query field can name a user.
- **Supabase is called with the caller's own access token and the publishable key**,
  so RLS and the column grants remain the authorization boundary. The service has no
  secret key and cannot read or write another account's row even if a handler is
  wrong.
- **Every query names its projection.** Measured against the live project:
  `select=*` and a bare `Prefer: return=representation` both ask for `is_suspended`,
  which the SELECT grant withholds, and PostgREST fails the whole request with
  `403 42501`. A read sends the explicit column list; a write sends the same list
  with `?select=`.
- **Writes are validated twice, by different layers.** The Go handler rejects
  unknown fields (`username`, `role`, `isSuspended`, timestamps) with
  `400 details[0] = {field, rule: "unknown"}` and validates lengths before any call;
  the database's own check constraints and column grants are the second enforcement.
  A client is refused, never partially accepted.
- **Concurrency is a database filter, not a read-then-write.** `PATCH` accepts an
  optional `expectedUpdatedAt`, which becomes `updated_at=eq.<value>` on the UPDATE;
  the trigger guarantees that column changes on every write. Zero rows matched means
  the row moved on (`409`) or is gone (`404`), and the service reads it back to tell
  those apart.
- **No create path.** `on_auth_user_created` → `handle_new_user()` already creates
  the profile row and the `user` role row with the account, so a missing row is
  reported as `404` and never papered over — with a placeholder identity or with an
  inserted row.
- **The avatars bucket stays the browser's job.** `avatar_path` is a Storage object
  path, and the file is uploaded by the browser with its own token to
  `avatars/<caller id>/<file>` — the shape the bucket policy and the
  `profiles_avatar_path_format` constraint both require (see
  [0008](0008-browser-data-access.md)). `PATCH /users/me` records the path.
- **The web app's identity is real from here on.** `src/lib/users/profile.ts` owns
  the state (loading, signed out, no profile row, failure), holds it in memory like
  the session, and drops it when the session ends; the settings, profile and
  leaderboard surfaces read it, and an edit goes through `PATCH`. No surface falls
  back to `me` on a failure — the states are shown instead.

## Consequences

- The profile can no longer disagree with the database: the response is built from
  the row, field by field, so a column added to `profiles` cannot leak into a
  response by accident either.
- `is_suspended` is unreadable through the Data API, which is a grant, not a
  convention. A handler that asked for the whole row would get a `403` — the failure
  mode is loud and immediate rather than a quiet leak.
- Two production faults now look identical from the outside and are not: a group
  with no binding answers `503 "This API is not available in this environment
yet."`, while a service with no Supabase configuration answers `503 "Profiles are
not available right now."` The deployment doc's troubleshooting table keeps that
  distinction.
- The gateway declares two bindings, so it must stay a container image (0010's
  constraint). A third binding is now a `vercel.json` change plus the upstream's
  `UPSTREAM_<SERVICE>_URL` in the route table — the mechanism does not change again.
- The API's profile is the caller's own row and nothing else: follower counts,
  games played, rankings and public profiles are still prototype data, and the
  screens that show them either omit the fabricated numbers (the profile header, the
  leaderboard's "you" row) or remain mock-backed (another player's page, game
  statistics). Those are the next services' work, not this one's.
- Reversing the decision means removing the `users` service object and binding from
  `vercel.json` and pointing the frontend back at the mock — the Go service and its
  tests are independent of the deployment.
- `services/cmd/api/main.go` no longer starts the gateway. A stale local command
  that used it would run the users service instead; the gateway's own command is
  `services/gateway/cmd/gateway`, and the container image has always built that.
