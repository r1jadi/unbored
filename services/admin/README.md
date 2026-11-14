# services/admin

The operations API behind the admin dashboard. It is the only service whose
routes are all staff-gated. Administrator access is decided by the server-side
**`ADMIN_EMAILS` allowlist alone** — never by a token claim or a database row —
while moderator access comes from the caller's own database row.

## The rule this service exists to enforce

**Verified email in `ADMIN_EMAILS` = admin; database moderator row = moderator;
otherwise = not staff.**

The email is taken from the verified Supabase access token on every request and
compared case-insensitively against the allowlist read from the process
environment. Token role claims (`app_metadata.role`) never grant access, and a
database administrator row never promotes: a stale `user_roles` row for an
email outside the allowlist is reported as a plain user. A moderator row grants
the moderator tier only — staff reads and moderation writes, never suspension.
Every admin route therefore checks, in order:

1. the router's tier middleware (authenticated for staff routes, admin-only for
   suspension) verifies the token — a `401` before a handler exists;
2. `service.staff` grants allowlisted emails the admin tier, else reads the
   caller's own role row and grants a moderator row the moderator tier —
   anything else is a `403` before the database is touched for staff work;
3. `suspendUser` re-checks the admin tier, and the database function re-checks
   the role a final time.

Nothing in this service reads a role, a user id, an email or an admin flag from
a request body, query string or header. Removing an email takes effect on the
caller's next request rather than when a token expires, with no database
cleanup and no manual role change.

## The privileged bridge (and its one secret)

An allowlisted administrator may hold no `user_roles` row — and the row-gated
functions would refuse their caller-token calls. This deployment therefore
holds one server-only secret, **`SUPABASE_SECRET_KEY`** (legacy
`SUPABASE_SERVICE_ROLE_KEY` accepted): after the allowlist check, staff
database calls run as the service role against `*_svc` wrappers that only it
may execute, carrying the verified user id as `p_actor` for attribution. The
secret is never a `VITE_` variable, never logged, never returned, and never
sent anywhere but the Data API as the service credential.

Without the secret the service keeps the historical behaviour — the caller's
own token against the row-gated functions — so existing deployments keep
working and the database guards keep deciding. A database refusal of an
already-authorized caller is then answered `503` (a missing bridge, for the
operator to fix), never as success and never as a privilege message.

## Routes

All paths are the public ones, `/api/v1/admin/...`, routed to the games deployment.
The tier column is what the staff wrapper grants; suspension additionally
requires the admin tier at the router, the handler and the database.

| Route                         | Method | Tier          | What it answers                                                                                                                                                                                                            |
| ----------------------------- | ------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/session`              | GET    | authenticated | The caller's own admin state (allowlist-derived) and profile. The one route an ordinary user may call: being able to learn "you are not an admin" is not privileged information, and without it the only answer would be an uninterpretable `403`. |
| `/admin/overview`             | GET    | staff         | Dashboard aggregate: counts, a 14-day series, recent activity, most-played games.                                                                                                                                          |
| `/admin/analytics`            | GET    | staff         | Activity over 7–90 days: totals, daily series, top games, top players.                                                                                                                                                     |
| `/admin/games`                | GET    | staff         | Every game, published or not, with status, owner, real runs, players, best score.                                                                                                                                          |
| `/admin/games/{gameID}`       | PATCH  | staff         | Publish, reject, archive or return a game to review, with a reason; writes the audit row in the same transaction.                                                                                                          |
| `/admin/categories`           | GET    | staff         | Categories with published and total game counts. Read-only: the schema has no admin write path for categories.                                                                                                             |
| `/admin/reports`              | GET    | staff         | The moderation queue, each report joined to its target's title, username or excerpt.                                                                                                                                       |
| `/admin/reports/{reportID}`   | PATCH  | staff         | Start reviewing, resolve, dismiss or reopen a report, with a reason.                                                                                                                                                       |
| `/admin/comments`             | GET    | staff         | Comments including hidden ones, filtered by state and text.                                                                                                                                                                |
| `/admin/comments/{commentID}` | PATCH  | staff         | Hide or restore a comment, with a reason.                                                                                                                                                                                  |
| `/admin/users`                | GET    | staff         | The account directory: profile, email, role, suspension state, real activity counts.                                                                                                                                       |
| `/admin/users/{userID}`       | PATCH  | admin         | Suspend or restore an account, with a reason. Administrators only: moderators are refused at the router, the handler and the database.                                                                                     |
| `/admin/leaderboards`         | GET    | staff         | Verified scores, with the game and the run behind each one.                                                                                                                                                                |
| `/admin/moderation-log`       | GET    | staff         | The audit trail: every decision, its target, its reason and the moderator who made it.                                                                                                                                     |
| `/admin/system/services`      | GET    | staff         | The platform's routing table. It answers which services exist — **not** whether they are healthy, because this deployment collects no metrics.                                                                             |

Lists are paged with `limit` (default 50, max 100) and `offset`, and answer
`{ "items": [...], "hasMore": bool }`. The extra row read is how `hasMore` is
known without a `COUNT`. Filters are validated before the database: an unknown
status, role or state is a `400` naming the field.

## Where the numbers come from

Every figure is a count of persisted rows, computed in one `security definer`
function per screen (`public.admin_overview()`, `admin_analytics()`,
`admin_game_directory()`, …) so that a screen is one round trip and one query plan
rather than an N+1 join written in Go.

A value that cannot be computed is `null`, never zero: `avgRunSeconds` is null
until a run has been completed, and the dashboard renders "not measured yet"
rather than `0s`. There is no comparison against a previous period and no
projection, because the database does not compute either — an invented `+3.1%` is
indistinguishable from a measured one.

## What is deliberately absent

- **No fixture data.** There is no fallback in this service or in the dashboard:
  a failed read is reported as a failure, and a screen with no backend says so.
- **No role writing.** Granting or revoking a role is not an endpoint. It is an
  operator action against `public.user_roles`, and the procedure — including why
  it is not a dashboard button — is in
  [ADR 0013](../../docs/decisions/0013-admin-authorization.md).
- **No health metrics.** `/admin/system/services` reports the routing table with
  `measured: false`. An uptime number invented here would look exactly like a real
  one.
- **No notifications or featured-slot management.** Neither has a data model;
  the dashboard says so instead of showing an editor that would persist nothing.
- **No service-role key, and no Supabase secret of any kind.** See above.

## Configuration

| Variable                                                    | Purpose                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `SUPABASE_URL`                                              | project URL, for the Data API calls                                         |
| `SUPABASE_PUBLISHABLE_KEY`                                  | the same publishable key the browser holds — the token does the authorizing |
| `SUPABASE_JWT_SECRET` / `SUPABASE_JWKS_URL`                 | token verification (derived from `SUPABASE_URL` when unset)                 |
| `ADMIN_EMAILS`                                              | administrator allowlist (server-only): comma-separated verified emails      |
| `SUPABASE_SECRET_KEY` (`SUPABASE_SERVICE_ROLE_KEY` legacy)  | privileged Data API credential (server-only): enables the `*_svc` bridge    |
| `ENVIRONMENT`, `CORS_ALLOWED_ORIGINS`, `RATE_LIMIT_ENABLED` | the platform's shared middleware                                            |

## The ADMIN_EMAILS allowlist

`ADMIN_EMAILS` (exact name, never a `VITE_` variable) grants administrator
access to the accounts it names, managed in the API's environment on Render rather than in SQL:

```dotenv
ADMIN_EMAILS=admin@example.com,another@example.com
```

Rules:

- **Server-only.** Read per request from the process environment by the Go
  API (`packages/go/platform/adminallowlist`). Never inlined into the browser
  bundle, never sent to the client — `GET /admin/session` reports the
  elevated role, never the allowlist itself.
- **Verified email only.** Compared case-insensitively (whitespace ignored)
  against `identity.Identity.Email`, which `authn.Verifier` sets from the
  JWT's `email` claim after signature, audience, issuer and expiry checks. A
  client-supplied email, user id, role or `isAdmin` flag — in a body, query
  string or header — is never trusted (identity headers are stripped, strict
  bodies reject unknown fields).
- **Fail-closed.** Missing or empty grants no one — including database admins
  and admin claims.
- **Immediate.** Read on every request, so removing an address revokes on the
  next call — not when a token expires and not from any client-cached role.
  (On Render an env change restarts the service; the fresh process reads the new value.)
  No database cleanup or manual role change is required.

### How it relates to database roles and RLS

| Caller                                            | Go `staff` wrapper | `GET /admin/session` |
| ------------------------------------------------- | ------------------ | -------------------- |
| Verified email in `ADMIN_EMAILS`                  | admin tier         | admin, staff, admin  |
| Database moderator row, email not allowlisted     | moderator tier     | moderator, staff, not admin |
| Anyone else (any claim, any stale admin row, any body/query) | 403, database never reached for staff work | user, not staff, not admin |

Consequences worth stating plainly:

- The allowlist is the **only** grant of administrator access. Claims never
  grant, and a `user_roles` administrator row for an email outside the
  allowlist grants nothing — removal needs no row demotion for the API, and
  the session reports such a caller as a plain user.
- Moderator access comes from the moderator row, read server-side as the
  caller — the same source the database guards consult. Moderators inherit
  nothing upward: suspension is refused for them at the router, the handler
  and the database.
- It does **not** weaken RLS: no policy was touched, no grant was widened, and
  the row-gated staff functions keep their guards for the moderator path and
  for direct PostgREST calls. The `*_svc` wrappers are executable by
  `service_role` only — an ordinary token answers `permission denied` before
  any body runs — and the database never sees `ADMIN_EMAILS` and never
  authorizes from it.
- `GET /admin/session` reports the decision, never the allowlist itself. The
  dashboard, the nav link and the suspend button all follow that response, so
  no cached session or edited frontend state can keep the privilege.

Missing Data API configuration is not fatal: the service still serves its probes
and answers `503` on the admin routes, which is diagnosable, where a crash loop is
not.

## Running it locally

```bash
cd services
go run ./admin/cmd/admin          # the admin service alone, on the platform port
```

Locally it is normally reached through the gateway, which routes by prefix to the same packages production mounts:

```bash
curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
  http://localhost:8080/api/v1/admin/session
```

`GET` without a token answers `401`; with a token whose row is not staff, `403`
with `This area requires a moderator account.`

## Deployment

The routes are served by the single API process on Render
([`services/cmd/standalone`](../cmd/standalone/main.go)), which mounts this package
beside every other group (see
[docs/deployment/production.md](../../docs/deployment/production.md)). The routing
table lists `/api/v1/admin` under the service that answers it.

Sharing a process shares no privilege beyond what is configured: these routes
verify a token and authorize on every request, exactly as they would in a
deployment of their own. The games deployment additionally holds
`SUPABASE_SECRET_KEY` (server-only) for the privileged bridge; the catalogue
and play-session routes never read it.

## Tests

```bash
cd services && go test ./admin/...
```

`admin_test.go` boots the real router through `httpx.NewRouter` and asserts the
authorization boundary for every route — anonymous `401`, non-allowlisted `403`
(including stale database/claim admins), moderator-tier reads and writes with
suspension refused, allowlisted `200` with no claim or row required — plus body
validation (unknown fields rejected, a malformed id, a missing
`hidden`/`suspended`), pagination bounds, revocation on the next request after
removal, and that a database refusal of an authorized caller is reported as
unavailable, never as success.
`admin_bridge_blocker_test.go` proves the bridge end to end against a stub
PostgREST: an allowlisted administrator with no row loads real data and
moderates through the privileged `*_svc` wrappers with the verified actor
attributed, while the same caller without the secret is answered `503`.
`internal/supabaseadmin/client_test.go` covers the Data API client: the
projection it asks for, the credential it carries on each path (service secret
vs caller token, secret never in the URL), the verified actor it attributes,
and the mapping of a Postgres error back onto the platform's error envelope.

The database half lives in
[tests/security/rls_test.sql](../../tests/security/rls_test.sql): that an ordinary
caller cannot read a staff function's output, that a moderator cannot suspend an
account, that a role cannot be granted through the Data API — and now that no
ordinary token can execute any `*_svc` wrapper while the service role is served
real data with the verified actor attributed.
