# Security testing

Security is checked automatically and continuously; nothing here relies on a
reviewer remembering.

## What runs, and where

| Check | Command | Workflow |
| --- | --- | --- |
| JWT verification (14 cases incl. forged signature, `alg: none`, wrong audience/issuer, expired, unknown `kid`, `service_role` rejection) | `cd packages/go/platform && go test ./...` | `go.yml` |
| Wired service behaviour: probes, `GET /api/v1/health` without auth material, tier boundaries, CORS allowlist, security headers, per-IP and per-user rate limits, fail-closed config | `cd services && go test ./...` | `go.yml` |
| Gateway proxy: routing, header stripping, gateway-owned paths (`/api/v1`, `/api/v1/health`) never proxied or `503`ed, unconfigured group `503`, malformed upstream rejection | `cd services && go test ./...` | `go.yml` |
| Deployment smoke test: the real gateway wiring answers `GET /api/v1/health` with `200 {"status":"ok"}` while an upstream-less group still answers `503` | `cd services && go test ./...` | `go.yml` |
| Data races | `go test -race ./...` | `go.yml` (Linux; needs cgo) |
| Go vulnerabilities | `govulncheck ./...` | `go.yml` |
| Database authorization: 50+ allowed/denied assertions across six roles, on tables and storage | `./scripts/test-rls.sh` | `database.yml` |
| Migration + seed validity on an empty database; seed idempotency | `./scripts/test-rls.sh`, then `seed.sql` twice | `database.yml` |
| Frontend metadata rules: which routes may be indexed, canonical/robots output, JSON-LD serialisation | `bun run test` | `web.yml` |
| API client: envelope mapping, bearer header, `credentials: "omit"`, no token in URL | `bun run test` | `web.yml` |
| Dependency vulnerabilities (JS) | `bun audit --audit-level=high` | `web.yml` |
| Vulnerable or badly licensed new dependencies | `dependency-review-action` | `security.yml` |
| Secrets in the working tree and full history | `gitleaks detect` | `security.yml` |
| Workflow hygiene: pinned actions, least-privilege tokens | shell checks | `security.yml` |
| Contract drift and OpenAPI validity | `node scripts/check-api-contract.mjs`, `redocly lint` | `api-contract.yml` |

## Results from this foundation

| Check | Result |
| --- | --- |
| `gofmt -l`, `go vet`, `go build` (both modules, all 15 service binaries) | clean |
| `go test ./...` (platform + services) | pass — 16 platform cases (token verification, listen address and production configuration), 26 service cases (4 gateway smoke, 7 proxy, 15 wired service) |
| `go test -race` | **not run locally** (needs cgo; no C toolchain on the Windows checkout) — CI runs it |
| `scripts/test-rls.sh` | pass — migrations applied to an empty Postgres 16, 50+ assertions green |
| `vitest run` | pass — 19 tests |
| `tsc --noEmit`, `eslint` on every changed file | clean |
| `npm run build` | pass — the production build path is intact |
| `gitleaks detect` over the full history | no leaks found |
| `node scripts/check-api-contract.mjs` | pass — 16 routed groups documented across 25 paths |
| `redocly lint` on the contract | valid |
| `bun audit`, `govulncheck` | not run locally (no bun; no govulncheck binary) — CI runs both |

## Testing a change by hand

```bash
# 1. The database, including every denied case
./scripts/test-rls.sh

# 2. The API tiers
cd services && go test ./... && go vet ./...

# 3. The web app
bun run typecheck && bun run lint && bun run test && bun run build

# 4. A quick live check of the gateway chain
cd services && ENVIRONMENT=development HTTP_ADDR=:8080 go run ./gateway/cmd/gateway &
curl -s -D- -o /dev/null localhost:8080/healthz                  # 200, no HSTS
curl -s localhost:8080/api/v1                                     # version discovery
curl -s localhost:8080/api/v1/health                              # {"status":"ok",...}
curl -s localhost:8080/readyz                                     # {"status":"ready",...}
curl -s -D- -o /dev/null -H 'Origin: https://evil.example' localhost:8080/api/v1
                                                                 # no CORS headers
curl -s localhost:8080/api/v1/admin/users                         # 503 (no upstream)
```

The deployed equivalent of those four calls, and what each one proves, is in
[deployment/production.md](../deployment/production.md#verifying-a-deploy).

## What is not covered

Repeating the gaps from [testing.md](../development/testing.md) where they matter
for security: no end-to-end browser tests, no load testing, no fuzzing of the
token/JSON decoders, no SBOM, no alerting on `401`/`429` rates, no penetration
test, and no scanning of uploaded content. Until those exist, this document
describes what *is* verified — not a claim that the system has been proven secure.
