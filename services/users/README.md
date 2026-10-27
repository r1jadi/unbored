# services/users

The signed-in user's own profile: read it, edit it, nothing else.

This is the service that makes the identity in the web app real. Before it, the
UI drew the signed-in person from `src/lib/mock.ts`. Now the identity comes from
`public.profiles` in Supabase, resolved from a verified access token, so what the
app shows is the row the database actually holds for that account.

What it does **not** do is authorize anything by itself. Every call to Supabase
carries the **caller's own access token**, so Row Level Security and the column
grants of
[`20261005120100_rls_and_grants.sql`](../../supabase/migrations/20261005120100_rls_and_grants.sql)
are the boundary: this service holds no `service_role` key and could not read or
write another account's profile even if a handler were wrong.

## Endpoints

All paths are relative to the gateway's `/api/v1` base. The contract in
[`packages/api-contracts/openapi-v1.yaml`](../../packages/api-contracts/openapi-v1.yaml)
is authoritative and marks both `x-status: available`.

| Method  | Path        | Tier          | Success | Calls Supabase                                                 |
| ------- | ----------- | ------------- | ------- | -------------------------------------------------------------- |
| `GET`   | `/users/me` | authenticated | `200`   | `GET /rest/v1/profiles?select=…&id=eq.<token subject>&limit=1` |
| `PATCH` | `/users/me` | authenticated | `200`   | `PATCH /rest/v1/profiles?select=…&id=eq.<token subject>`       |

`GET` answers with the caller's profile, or `404` when the account has no row —
which is a real state, not something to paper over with a placeholder identity.
`PATCH` answers with the row **as stored**, which is what the client renders
afterwards; an account with no row gets `404` there too, because this service
never invents one.

There is no `/users/{id}`: reading somebody else's profile is a social feature
that does not exist yet, and there is no route for it to be added by accident.

### The response

```json
{
  "id": "<uuid>",
  "username": "player_one",
  "displayName": "Player One",
  "bio": "Puzzles in the morning.",
  "avatarPath": "<uuid>/<file>.png",
  "role": "user",
  "onboardedAt": null,
  "createdAt": "2026-10-01T10:00:00Z",
  "updatedAt": "2026-10-08T09:30:00Z"
}
```

- `role` comes from the **verified token**, not from `user_roles`, so this payload
  and `/api/v1/auth/session` can never disagree about the same token.
- The view is assembled field by field, so a column added to `profiles` later
  cannot appear in a response without being named here. `is_suspended` is absent
  on purpose: the SELECT grant excludes it, so it is not readable through the Data
  API at all.
- Bio and avatar are optional and omitted when null; `onboardedAt` distinguishes
  "not onboarded" (`null`) from "unknown".

### Editing

`PATCH` accepts **only** `displayName`, `username`, `bio`, `avatarPath` and
`expectedUpdatedAt`. Anything else is refused, not ignored: `role` and
`isSuspended` are not writable by a client (the database grants UPDATE on
`username, display_name, bio, avatar_path, onboarded_at` and nothing else), and
the strict decoder answers `400` with `details[0] = {field, rule: "unknown"}`
before the database is ever called. It is refused twice over on purpose — the
message a client gets, and the grant that makes it true.

| Field               | Rule                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `displayName`       | Trimmed; required; at most 60 characters (`422` with `field: "displayName"`)                                                                            |
| `username`          | 3–24 lowercase letters, digits, underscores, unique case-insensitively (`422` with `field: "username"`; a taken name is `409` with `field: "username"`) |
| `bio`               | At most 300 characters; `null` clears it; `""` also clears it                                                                                           |
| `avatarPath`        | `<account id>/<file>`; `null` (or `""`) removes the picture                                                                                             |
| `expectedUpdatedAt` | Optional. The `updatedAt` the client read; the write applies only if the row still holds it                                                             |

An edit naming no fields is refused (`422`), and a body that is not a single JSON
object is refused (`400`) — malformed input never reaches Supabase.

### Concurrency

`expectedUpdatedAt` is optimistic concurrency control, enforced by the database
rather than by a read-then-write in Go: the UPDATE is filtered on
`updated_at = <expected>`, and `profiles_touch_updated_at` guarantees that column
changes on every write. When the filter matches nothing the service reads the row
back to tell two cases apart, because they need different answers:

- the row exists → `409 conflict`, _"This profile changed since you loaded it. Reload and try again."_ — nothing was overwritten;
- the row is gone → `404 not_found`.

Omitting it accepts last-write-wins, which is what the contract documents.

## How it talks to Supabase

- **Data API** — `https://<project>.supabase.co/rest/v1/profiles`, with the
  publishable key in `apikey` **and the caller's access token** in
  `Authorization`. Row Level Security decides what is visible, so the service
  needs no secret key.
- **Every query names its projection.** `select=*` and a bare
  `Prefer: return=representation` both ask for every column, including
  `is_suspended`, which the SELECT grant deliberately withholds — PostgREST
  answers `403` for the whole request. A read therefore sends
  `select=id,username,display_name,bio,avatar_path,onboarded_at,created_at,updated_at`,
  and a write asks for the same list with `?select=`. Requesting the whole row
  here is not a style preference; it is a 403.
- Upstream failures are mapped by SQLSTATE: `42501` → `403`, `23505` → `409`,
  `23514`/`23502`/`23503` → `422`, anything else → logged and answered `503`.
  PostgREST's `message` and `details` can echo caller input or describe the
  schema, so only the machine-readable code is kept — never the body, and never
  the token.

## Where the data comes from

No migration was needed for this service: `public.profiles`, `public.user_roles`
and the `on_auth_user_created` trigger already exist in production and match
[`20261005120000_core_schema.sql`](../../supabase/migrations/20261005120000_core_schema.sql)
and `20261005120100_rls_and_grants.sql`. The trigger (`handle_new_user`) creates
the profile row **and** the `user` role row when the account is created, which is
why this service has no create path: a row appears with the account, and an
account without one is reported as `404` rather than fixed up silently.

## Avatars

The picture itself never travels through this service. `avatar_path` is a Storage
object path (`<account id>/<file>`), and the browser uploads the file straight to
the `avatars` bucket defined by
[`20261005120200_storage_buckets.sql`](../../supabase/migrations/20261005120200_storage_buckets.sql)
using its own access token; the bucket policy only accepts writes inside
`avatars/<caller id>/`, and the `profiles_avatar_path_format` check constraint only
accepts a path of that shape, so the object and the row have to agree. The bucket
is public (a profile picture is public on the web), so rendering is a plain object
URL. `PATCH /users/me` is what records the resulting path.

## Configuration

| Variable                   | Required | Purpose                                                                                               |
| -------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`             | yes      | Project URL. The JWKS URL and issuer are derived from it                                              |
| `SUPABASE_PUBLISHABLE_KEY` | yes      | Presented to the Data API to identify the project. Not a secret — the browser is given the same value |
| `SUPABASE_JWT_AUDIENCE`    | no       | Defaults to `authenticated`                                                                           |

Not needed, and deliberately not read: `SUPABASE_SECRET_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`. Without the URL and the
publishable key the service still boots, serves its probes, and answers `503` on
both endpoints — a diagnosable state rather than a crash loop.

## Running it

```bash
cd services
SERVICE_NAME=users HTTP_ADDR=:8083 go run ./users/cmd/users
```

Reach it through the gateway, which is how production reaches it:

```bash
UPSTREAM_USERS_URL=http://localhost:8083 SERVICE_NAME=gateway HTTP_ADDR=:8080 go run ./gateway/cmd/gateway
curl -sS localhost:8080/api/v1/users/me -H "Authorization: Bearer <access token>"
```

### Entrypoints

There are three ways to start this service, and all three call the same
`servicekit.MustRun(users.Options())` — the service is defined in
`services/users`, and every entrypoint only names it, so there is no second
implementation to drift.

| Entrypoint                 | Used by                                                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `services/users/cmd/users` | local shell (`go run ./users/cmd/users`)                                                                                                                                                                                                                           |
| `services/cmd/api`         | **the deployment** — Vercel's Go framework preset detects `main.go`, `cmd/api/main.go` or `cmd/server/main.go` at the service root; `cmd/server` is the auth service's, and the gateway deploys as a container image, so the Users service takes `cmd/api/main.go` |

The name `cmd/api` is Vercel's, not a description: the gateway's own command is
`services/gateway/cmd/gateway`, which the container image builds directly. See
[deployment/vercel.md](../../docs/deployment/vercel.md).

## Tests

```bash
cd services && gofmt -l . ../packages/go && go vet ./... && go test ./...
```

`users_test.go` runs the real HTTP stack (router, middleware, rate limiter, error
envelope) against a fake profile backend and covers: both verbs, a missing token,
an invalid, forged or expired token, a token that names a _different_ account
(the subject in the token always wins — a query or body can never aim the read),
a missing row, a backend that is not configured (`503`), trimming, clearing with
`null`, unmentioned fields staying untouched, unknown fields (`role`,
`isSuspended`, timestamps, `id`) being refused before the backend is reached,
username renames (valid, invalid, taken as a field-attributed `409`, and unable
to aim another account), over-long and malformed values, an empty patch, a stale
`expectedUpdatedAt` (`409`), a read failure (`503`), a database privilege failure
(`403`), and that neither a token nor `is_suspended` can appear in a response or
a log line.

`internal/supabaseprofile/client_test.go` covers the client against a stub Data
API: the named projection (never `*`), the caller's token in `Authorization`, the
`updated_at` filter, an empty patch never being sent, SQLSTATE mapping, and that
an upstream message is dropped rather than logged.

## Deploying it

`vercel.json` declares it as the `users` service (root `services/`, framework
`go`, entrypoint `cmd/api/main.go`) and grants the gateway internal access with a
service binding on `api`:

```json
{ "type": "service", "service": "users", "format": "url", "env": "UPSTREAM_USERS_URL" }
```

Like the auth service it has no rewrite of its own, so it is never reached from
the internet directly: the public entry stays
`https://unbored.lol/api/v1/users/*` through the gateway. `users`
declares no binding itself and stays on the Go framework preset.

Verification after a deployment:

```bash
BASE=https://unbored.lol
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/api/v1/users/me"
# 401 — the binding resolved and the Users service answered (a 503 means the
#       gateway has no UPSTREAM_USERS_URL; check that the `users` service was
#       detected in the build log).

TOKEN=$(curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"email":"…","password":"…"}' "$BASE/api/v1/auth/sign-in" | jq -r .tokens.accessToken)
curl -sS "$BASE/api/v1/users/me" -H "Authorization: Bearer $TOKEN"
# 200 with the account's real row
```

`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are project-scoped in Vercel, so the
values the auth service already reads cover this service too.
