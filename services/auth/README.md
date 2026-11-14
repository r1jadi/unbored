# services/auth

The credential lifecycle for the web app, on top of Supabase Auth.

Supabase is the identity provider: it stores credentials, enforces the password
policy, sends confirmation and recovery email, and issues access and refresh
tokens. This service never stores a password and never holds a Supabase secret
key. What it owns is the _application session_ — sign up, sign in, refresh, sign
out, and "who is this and what may they see" — so the browser talks to one origin
and no Supabase key of any kind has to be embedded in a page.

Access tokens are verified with the same JWKS-based verifier every other service
uses ([`packages/go/platform/authn`](../../packages/go/platform/authn)), so there
is exactly one authentication implementation in the platform. `SUPABASE_JWT_SECRET`
is not used anywhere in this flow.

## Endpoints

All paths are relative to the gateway's `/api/v1` base. The contract in
[`packages/api-contracts/openapi-v1.yaml`](../../packages/api-contracts/openapi-v1.yaml)
is authoritative and marks every one of these `x-status: available`.

| Method | Path                       | Tier                                    | Success | Calls Supabase                                 |
| ------ | -------------------------- | --------------------------------------- | ------- | ---------------------------------------------- |
| `POST` | `/auth/sign-up`            | public                                  | `201`   | `POST /auth/v1/signup`                         |
| `GET`  | `/auth/username-available` | public                                  | `200`   | `GET /rest/v1/profiles` (availability)         |
| `POST` | `/auth/sign-in`            | public                                  | `200`   | `POST /auth/v1/token?grant_type=password`, after `login_email_for_username` when the body names a username |
| `POST` | `/auth/refresh`            | public                                  | `200`   | `POST /auth/v1/token?grant_type=refresh_token` |
| `POST` | `/auth/session`            | public (verifies the token in the body) | `200`   | `GET /rest/v1/profiles` (onboarding state)     |
| `GET`  | `/auth/session`            | authenticated                           | `200`   | `GET /rest/v1/profiles` (onboarding state)     |
| `POST` | `/auth/sign-out`           | authenticated                           | `204`   | `POST /auth/v1/logout`                         |

The three credential endpoints answer with `{ session, tokens?, user? }`. `tokens`
is absent while Supabase still requires email confirmation — that is a success,
not a failure, and the client must not treat it as signed in. The session reads
answer with `{ userId, role, email?, onboarded?, expiresAt? }` and never with a
token.

## How it talks to Supabase

- **Auth API** — `https://<project>.supabase.co/auth/v1/…`, with the publishable
  key in `apikey`. No `Authorization` header: it is the credential being
  verified, not a caller's token.
- **Data API** — `GET /rest/v1/profiles?select=onboarded_at&id=eq.<uuid>&limit=1`
  with the publishable key in `apikey` **and the caller's own access token** in
  `Authorization`. Row Level Security decides what is visible, so the service
  needs no `service_role`/secret key and cannot read another user's profile.
  `onboarded_at` is readable by the `authenticated` role for exactly this reason.
- **Username availability** — `GET /rest/v1/profiles?select=id&username=eq.<name>&limit=1`
  with the publishable key only. The public profile columns are readable by
  `anon`, so the answer needs no account and no secret; only the boolean leaves
  the service. The case-insensitive unique index on `profiles.username` remains
  the authority — the check is advisory, and the sign-up insert re-runs the same
  uniqueness rule, so two concurrent registrations cannot both commit the name.
- Every upstream failure is mapped to a platform error code
  (`unauthorized`, `forbidden`, `conflict`, `unprocessable_entity`,
  `rate_limited`, `service_unavailable`). Supabase's own message is never
  forwarded — it can describe the project's configuration — and the response body
  is never logged or echoed, so a password, an access token or a refresh token
  cannot reach a log line or a client.

## Configuration

| Variable                                                       | Required | Purpose                                                                                                                                               |
| -------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`                                                 | yes      | Project URL. The JWKS URL (`<URL>/auth/v1/.well-known/jwks.json`) and issuer (`<URL>/auth/v1`) are derived from it                                    |
| `SUPABASE_PUBLISHABLE_KEY`                                     | yes      | Presented to the Auth and Data APIs to identify the project. Not a secret — the browser is given the same value — but only the server needs this copy |
| `SUPABASE_JWT_AUDIENCE`                                        | no       | Defaults to `authenticated`                                                                                                                           |
| `AUTH_RATE_LIMIT_REQUESTS_PER_MINUTE`, `AUTH_RATE_LIMIT_BURST` | no       | Credential budget, per client and per account. Defaults `10` and `5`                                                                                  |
| `SUPABASE_SECRET_KEY` (`SUPABASE_SERVICE_ROLE_KEY` legacy)     | no       | Signing in with a username. Used for that one lookup and nothing else. Without it a username sign-in answers `503`, and email sign-in still works     |

Not needed, and deliberately not read: `SUPABASE_JWT_SECRET`. If no publishable
key is configured the service still boots, serves its probes, and answers `503`
on the credential endpoints — a diagnosable state rather than a crash loop.

### Signing in with a username

Supabase Auth only checks a password against an email, so `POST /auth/sign-in`
with `{ username, password }` first resolves the address through
`login_email_for_username`, which only the service role can call. A username is
public and an address is not, so:

- The address goes no further than the password grant. It is never logged, and it
  is never in a response to anyone who has not proved the password.
- A name nobody holds gets the same `401` as a wrong password. How long the answer
  takes can still differ, which gives nothing away: usernames are public anyway.
- An attempt spends the client's bucket, the username's bucket and the account's
  email bucket, so switching between the two buys no extra guesses.

## Running it

```bash
cd services
SERVICE_NAME=auth HTTP_ADDR=:8082 go run ./auth/cmd/auth
```

`GET /api/v1/health` answers immediately. The credential endpoints need
`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the environment.

### Entrypoints

There are three ways to start this service, and all three call the same
`servicekit.MustRun(auth.Options())` — the service is defined in
`services/auth`, and every entrypoint only names it, so there is no second
implementation to drift.

| Entrypoint               | Used by                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/auth/cmd/auth` | local shell (`go run ./auth/cmd/auth`)                                                                                                                                             |
| `services/cmd/standalone` | **production** (Render) — mounts this service with every other route group in one process |
| `services/cmd/server`    | the old Vercel entrypoint (Vercel's Go preset only detected `main.go`, `cmd/api/main.go` or `cmd/server/main.go`); no longer deployed, still built in CI |

The deployed path is described in
[deployment/production.md](../../docs/deployment/production.md); the short version
is that the Render service runs `services/cmd/standalone`, which mounts
`/api/v1/auth` and `/api/v1/auth/*` beside every other group
([0016](../../docs/decisions/0016-cloudflare-and-render-hosting.md)).

Locally the gateway sits in front of it, through `UPSTREAM_AUTH_URL`:

```bash
UPSTREAM_AUTH_URL=http://localhost:8082 SERVICE_NAME=gateway HTTP_ADDR=:8080 go run ./gateway/cmd/gateway
```

With it unset the local gateway answers `503` for `/api/v1/auth/*` — routed, but
not proxied. In production nothing reads it.

## Tests

```bash
cd services && gofmt -l . ../packages/go && go vet ./... && go test ./...
```

`auth_test.go` runs the real HTTP stack (router, middleware, rate limiter, error
envelope) against a fake Supabase, and covers: registration and sign-in, the
chosen-username flow (normalization, pre-flight refusal, a lost race and a failed
availability lookup), the anonymous availability endpoint, invalid credentials,
an unverified account, refresh rotation, an expired, forged,
`anon`-key or `service_role` token, unauthenticated reads, sign-out and its
idempotent retry, malformed bodies, oversized bodies, the credential throttle, a
Supabase outage, and the absence of passwords or tokens from log output.
`internal/supabaseauth/client_test.go` covers the client itself, including the
two sign-up response shapes and that an upstream error keeps only its
machine-readable code.

## Deploying it

In production the service runs inside the single API process on Render
(`services/cmd/standalone`, built from `infrastructure/docker/api.Dockerfile`),
at `https://api.unbored.lol/api/v1/auth/*`. It applies the same CORS,
rate-limiting, header and error-envelope chain as every group, and its own
credential throttle on top.

For it to serve real authentication, **`SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY`** must be set on Render (`render.yaml` and the
dashboard). Without them the service still boots, serves its probes, and answers
`503` on the credential endpoints.

After a deployment, the check that matters is one request to production:

```bash
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"email":"does-not-exist@example.com","password":"a-long-password"}' \
  https://api.unbored.lol/api/v1/auth/sign-in
# 401 with the platform envelope — the whole chain works.
# 503 on a credential endpoint instead — the service has no Supabase configuration.
```

See [deployment/production.md](../../docs/deployment/production.md#verifying-a-deploy)
for the full sequence, the environment tables and the troubleshooting table.
