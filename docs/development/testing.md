# Testing

## What runs today

| Suite                 | Command                                    | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web unit tests        | `bun run test`                             | SEO indexability rules and metadata, the API client's envelope/auth/URL behaviour, app routing, the Stack 10 engine against the shared rules vectors, the play-session client, the play screen's guest, ranked and failed-verification paths, and the admin console (the role gate, a failed read with no fallback, confirmation-then-write, and the screens that have no backend)                                                              |
| Web type check        | `bun run typecheck`                        | The whole app and the scripts' TypeScript surface                                                                                                                                                                                                                                                                                                                                                                                               |
| Web lint              | `bun run lint`                             | ESLint + Prettier                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Web build             | `bun run build`                            | The production bundle Cloudflare ships                                                                                                                                                                                                                                                                                                                                                                                                              |
| Sitemap drift         | `bun run sitemap:check`                    | `public/sitemap.xml` matches the SEO allowlist                                                                                                                                                                                                                                                                                                                                                                                                  |
| Contract drift        | `node scripts/check-api-contract.mjs`      | OpenAPI paths vs the gateway routing table                                                                                                                                                                                                                                                                                                                                                                                                      |
| Go unit + integration | `cd services && go test ./...`             | The wired service (probes incl. `GET /api/v1/health`, tiers, CORS, headers, rate limits, fail-closed config), the catalogue and play-session services, the admin service (every route's tier boundary, body validation, paging bounds, and a refusal that must never read as success), the gateway proxy (routing, gateway-owned paths, header stripping, SSRF safety), and a gateway smoke test that boots the real wiring the deployment runs |
| Go platform tests     | `cd packages/go/platform && go test ./...` | Token verification and JWKS key handling, listen-address resolution (`PORT` before `HTTP_ADDR`'s absence) and production configuration validation                                                                                                                                                                                                                                                                                               |
| Go static checks      | `go vet ./...`, `gofmt -l` (both modules)  | Correctness and formatting                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Database security     | `./scripts/test-rls.sh`                    | Migrations, seed idempotency and 50+ RLS assertions (allowed **and** denied) across six roles                                                                                                                                                                                                                                                                                                                                                   |
| Live API smoke        | `node tests/smoke/stack10-smoke.mjs`       | A real gateway and database: a full Stack 10 run played, submitted, verified and ranked, plus the refusals. Needs a running stack — see [tests/smoke/README.md](../../tests/smoke/README.md)                                                                                                                                                                                                                                                    |
| Go vulnerabilities    | `govulncheck ./...` (CI)                   | Known CVEs in the dependency graph                                                                                                                                                                                                                                                                                                                                                                                                              |
| Secret scanning       | `gitleaks` (CI)                            | No credential in the working tree or history                                                                                                                                                                                                                                                                                                                                                                                                    |

CI mirrors all of it: `.github/workflows/web.yml`, `go.yml`, `database.yml`,
`api-contract.yml`, `security.yml`.

The deployed site and API are their own verification step, because nothing local
can prove the hosts' configuration (DNS, CORS, environment): see
[deployment/production.md](../deployment/production.md#verifying-a-deploy).

## The database suite in detail

`tests/security/rls_test.sql` runs in one transaction and rolls back, so it is
safe to run repeatedly. Each assertion is one of:

- `ok(condition, message)` — a boolean that must hold;
- `allow(statement, message)` — the statement must succeed and affect ≥1 row;
- `denied(statement, message)` — the statement must be rejected (`42501`);
- `rejected(statement, message)` — the statement must fail on a constraint;
- `blocked(statement, message)` — the statement must silently affect 0 rows;
- `visible(statement, expected, message)` — the statement must return exactly
  `expected` rows.

It asserts, among others: anon sees only published games; the admin functions
refuse a non-staff caller and a moderator cannot suspend an account; a hidden comment is
invisible to anon but visible to its author; a player cannot read another player's
sessions, notifications, reports or storage folder; roles cannot be granted or
self-promoted through the Data API; scores cannot be written by a client; a game's
ownership is immutable; a creator cannot publish their own game; a suspended
account cannot write; staff can triage and resolve reports, and the resolver is
stamped from the token; the `service_role` can write scores, hide comments and
grant roles.

Run it before and after any change to `supabase/migrations`.

## Adding tests

- **Frontend logic** → a `*.test.ts` next to the code. Tests assert behaviour
  (what a function returns for given input), not markup snapshots.
- **A new endpoint** → a Go test that boots the service through `servicekit.New`
  and exercises the tier boundary: no token is `401`, wrong role is `403`, valid
  caller is allowed. The helpers in `services/internal/servicekit/servicekit_test.go`
  are the template.
- **A new policy or table** → at least one `allow` and one `denied`/`blocked`
  assertion in `tests/security/rls_test.sql`.
- **A new public route** → add it to `INDEXABLE_PATHS` in `src/lib/seo.ts`, run
  `bun run sitemap`, and extend the indexability tests in `src/lib/seo.test.ts`.

## Not covered yet

Stated plainly so nobody assumes otherwise:

- **No end-to-end browser tests.** `tests/e2e/` is empty; Playwright is the
  intended tool. The play screen is covered by a component test that renders it
  against a stubbed API, and the live path by the smoke script, but nothing drives
  a real browser through a run.
- **No load or performance tests.** `tests/load/` is empty.
- **No contract tests against a running service.** The drift check compares
  documents, not responses; `tests/smoke/stack10-smoke.mjs` calls a live stack but
  is hand-written and covers one game, so a generated client from the OpenAPI spec
  plus a response-shape test is still the next step.
- **No fuzzing.** `go test -fuzz` is a good fit for the token and JSON decoders
  once they gain more parsing surface.
- **No dependency scanning for the Go modules beyond govulncheck**, and no SBOM.
- **`-race` cannot run on a Windows/Git Bash checkout** (it needs cgo); CI runs it
  on Linux in `go.yml`.
- **Retries, timeouts and upstream failure modes** for the proxy are tested for
  error mapping, not for sustained flakiness.
