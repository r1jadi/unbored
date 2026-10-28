# API architecture

## Versioning

Everything is versioned in the path: `/api/v1/...`. There is no version
negotiation in a header, and no unversioned endpoint except the probes
(`/healthz`, `/readyz`), which orchestrators must find without knowing the API
version.

`GET /api/v1` returns the version and build identifiers, so a client can confirm
what it is talking to:

```json
{ "apiVersion": "v1", "version": "0.1.0", "commit": "9f2c1ab" }
```

`GET /api/v1/health` is the versioned liveness probe for deployments and uptime
checks. It needs no token and checks nothing behind the gateway, so it answers
`200` while every backend service is still unimplemented:

```json
{ "status": "ok", "version": "0.1.0" }
```

Readiness — which does run the registered dependency checks — stays at the
unversioned `/readyz`, and `/healthz` remains the plain-text liveness probe for
orchestrators. Deploying both is described in
[../deployment/vercel.md](../deployment/vercel.md).

When a breaking change is unavoidable, `v2` is added alongside `v1` and the old
version is deprecated with a dated removal note in this file. Additive changes
(new optional fields, new endpoints) do not require a version bump.

## Authorization tiers

Every route declares exactly one tier. `authn.Middleware` derives identity from
the token and the router applies the tier middleware.

| Tier          | Router method           | Requirement                                               | Answer when unsatisfied |
| ------------- | ----------------------- | --------------------------------------------------------- | ----------------------- |
| public        | `Public` / `PublicFunc` | none                                                      | —                       |
| optional      | `OptionalAuth`          | no token needed; a valid token personalises the response  | anonymous view          |
| authenticated | `Authenticated`         | verified Supabase access token                            | `401`                   |
| moderator     | `Moderator`             | verified token email in server-side `ADMIN_EMAILS`        | `403`                   |
| admin         | `Admin`                 | verified token email in server-side `ADMIN_EMAILS`        | `403`                   |

Rules that hold everywhere:

- the user id comes from the token — a body or query field naming a user is
  either ignored or rejected, never trusted;
- an unauthenticated request to a protected route is `401`, not `404`;
- a Supabase _project key_ token (`service_role`, `anon`) is rejected on every
  user-facing route, even when its signature is valid: the service role key
  bypasses Row Level Security and the anon key is published in every bundle, so
  neither is a signed-in user;
- when a service has no auth material configured, protected routes answer `503`
  (fail closed) rather than allowing anonymous access.

One group goes further than the tiers. `/api/v1/admin` keeps its tier and then
re-checks the **same allowlist** per request in the service wrapper, so removing
an email takes effect on the caller's next request rather than when a token
expires — no cached session, claim, row or frontend state can keep the
privilege. Token role claims and `public.user_roles` rows never grant access.
Nothing on that surface reads a role, a user id, an email or an admin flag from
a body or query string, and the admin service holds no service-role key. The
row-gated staff functions remain as defense-in-depth on the data path; they are
never consulted for the authorization decision. See
[0013](../decisions/0013-admin-authorization.md) for the retired row-based model.

## Gateway routing

`services/internal/apiroutes/routes.go` is the single source of truth:

| Prefix                                   | Service         | Notes                                                                                                                                                                                                |
| ---------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/v1/auth`                           | auth            | sessions on top of Supabase Auth — **implemented**                                                                                                                                                   |
| `/api/v1/games/{slug}/leaderboard`       | games           | a game's persisted ranking — **implemented** (optional auth: adds `me`)                                                                                                                              |
| `/api/v1/users`                          | users           | the caller's own profile — **implemented** (`GET`/`PATCH /users/me`)                                                                                                                                 |
| `/api/v1/games`                          | games           | the published catalogue — **implemented** (list, search, detail by slug, and per-game leaderboard)                                                                                                   |
| `/api/v1/categories`                     | games           | categories with real published-game counts — **implemented**                                                                                                                                         |
| `/api/v1/sessions`                       | game-sessions   | play sessions; the only door to a score — **implemented** (`POST`, and `POST /{id}/complete`)                                                                                                        |
| `/api/v1/scores`                         | scores          | read-only to clients                                                                                                                                                                                 |
| `/api/v1/leaderboards`                   | leaderboards    | projections over scores                                                                                                                                                                              |
| `/api/v1/feed`                           | feed            | personalised feed                                                                                                                                                                                    |
| `/api/v1/recommendations`                | recommendations | suggestions                                                                                                                                                                                          |
| `/api/v1/comments`, `/follows`, `/likes` | social          | comments, follows, likes                                                                                                                                                                             |
| `/api/v1/notifications`                  | notifications   | in-app and push                                                                                                                                                                                      |
| `/api/v1/search`                         | search          | games, creators, players                                                                                                                                                                             |
| `/api/v1/moderation`                     | moderation      | reports and actions                                                                                                                                                                                  |
| `/api/v1/analytics`                      | analytics       | product analytics                                                                                                                                                                                    |
| `/api/v1/admin`                          | admin           | the operations dashboard's API — **implemented** (staff-gated reads, moderation writes; the `admin` package is served by the games deployment, see [0013](../decisions/0013-admin-authorization.md)) |
| `/api/v1/cron/game-digests`              | games           | the five-new-games email digest — **implemented** (Vercel Cron; `CRON_SECRET`, not a user token)                                                                                                    |

The gateway proxies a group only when its `UPSTREAM_<SERVICE>_URL` is configured.
An unconfigured group answers `503` with the standard envelope; it is never
resolved dynamically, so the gateway cannot be used as an open proxy. Both
directions of that mapping are checked in CI by
`scripts/check-api-contract.mjs`.

Two paths are the gateway's own and are never proxied: `/api/v1` (version
discovery) and `/api/v1/health` (liveness). They keep working in the default
environment, where no upstream is configured — otherwise the first probe after a
deployment would report a healthy gateway as down.

## Error envelope

```json
{
  "error": {
    "code": "forbidden",
    "message": "This area requires an administrator account.",
    "request_id": "9f2c1ab3d4e5",
    "details": [{ "field": "role", "rule": "admin" }]
  }
}
```

- `code` is a stable, machine-readable string, mapped to a status by
  `apierr.Status`.
- `message` is safe to display. It never contains an internal error, a stack
  trace, a SQL fragment or a token.
- An unexpected error becomes `500 internal_error` with a generic message; the
  real error is logged with the same `request_id`.
- `request_id` is echoed in the `X-Request-ID` header and appears in logs. The
  envelope's field is snake_case, like the rest of the JSON; the header keeps its
  conventional spelling.

## Conventions

- `POST` creates, `PATCH` updates a subset, `PUT` replaces, `DELETE` removes;
  `204` means success with no body.
- Request bodies are strict JSON: unknown fields are rejected
  (`DisallowUnknownFields`), and the configured limit is 1 MiB.
- Lists are cursor paginated (`limit`, `cursor`). `limit` is capped (100) and
  defaults to 20; a response never streams an unbounded result set.
- Ids are database-generated UUIDs. A client never sends a primary key it expects
  to be honoured.
- Timestamps are RFC 3339 UTC.

## The contract

`packages/api-contracts/openapi-v1.yaml` is the published contract. Operations
carry `x-status: planned | available`; `available` means the behaviour is
implemented and matches the document, and `planned` means the route exists, is
authorized and is rate limited, and answers `501` until the feature task lands.
Four groups are `available`: `auth` (the session lifecycle), `users` (`/users/me`,
the signed-in user's own profile), `games` (the catalogue, with real play counts)
and `sessions` (starting a run and submitting it for verification). The
`leaderboards` group is available for one operation — a game's board, nested under
the game it ranks — and planned for the rest. The rest of the document is the route
table the remaining services will fill in.

A score is the server's arithmetic, never the client's claim: `POST /sessions/{id}/complete`
replays the submitted run in the database and records what it derives. See
[ADR 0012](../decisions/0012-server-verified-scores.md) and [docs/games](../games/README.md).

`/api/v1/sessions` is served by the **games deployment**, which mounts the
`game-sessions` package beside the catalogue: Vercel's Go preset offers one
remaining entrypoint name at that service root, so two packages share one
deployment while staying separate packages with separate backends. See
[../deployment/vercel.md](../deployment/vercel.md).

CI verifies the contract twice: `redocly lint` for structural validity, and the
drift check that every routed group appears in it (and that nothing documented is
unroutable).

## Adding an endpoint

1. Add the handler to the owning service package (`services/<service>/<service>.go`,
   as `auth` and `users` do), registering it on the correct tier. `cmd/<service>`
   is a local entrypoint and a deployment entrypoint only ever calls
   `servicekit.MustRun(<service>.Options())`; no handler belongs in either.
2. Document it in `packages/api-contracts/openapi-v1.yaml` with `x-status`.
3. Return `httpx.WriteError(w, r, err)` for failures and `httpx.WriteJSON` for
   success; typed errors keep their code, everything else becomes `500`.
4. Reject input you do not need (`DecodeJSON`), validate ranges and formats, and
   derive ownership from the token.
5. Run `go test ./...` in `services`, `node scripts/check-api-contract.mjs`, and
   add at least one test asserting the denied case at the tier boundary.
