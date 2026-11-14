# .github/workflows

| Workflow | Triggers on | Does |
| --- | --- | --- |
| [web.yml](web.yml) | `src/**`, `public/**`, web config | `bun install --frozen-lockfile`, typecheck, lint, unit tests, sitemap drift check, production build, `bun audit --audit-level=high` |
| [go.yml](go.yml) | `services/**`, `packages/go/**`, `go.work` | `gofmt` check, `go vet`, `go test -race` on both modules, a build of all 15 service binaries, `govulncheck` |
| [database.yml](database.yml) | `supabase/**`, `tests/security/**`, `scripts/test-rls.sh` | Applies every migration to an empty Postgres 16, runs the RLS suite, proves the seed is idempotent |
| [api-contract.yml](api-contract.yml) | `packages/api-contracts/**`, `services/internal/apiroutes/**` | Routing/contract drift check, `redocly lint` |
| [security.yml](security.yml) | every push, every pull request, weekly | `gitleaks` over the full history, dependency review on pull requests, workflow hygiene (pinned actions, read-only tokens) |
| [cron.yml](cron.yml) | daily 09:00 and 10:00 UTC, manual dispatch | Wakes the Render API, then calls `/api/v1/cron/game-digests` or `/api/v1/cron/feedback-emails` with `CRON_SECRET` (secrets `API_ORIGIN`, `CRON_SECRET`; skipped without `API_ORIGIN`) |

## Conventions for new workflows

* Declare `permissions:` at the top level with the least privilege needed
  (`contents: read` for everything here). `security.yml` fails the build when a
  workflow omits it or asks for write access.
* Pin every `uses:` to a major version tag or a commit SHA — never `@main` or
  `@latest`. Also enforced by `security.yml`.
* Use `paths:` filters so a Go change does not rebuild the web app, and set
  `concurrency` with `cancel-in-progress` so a force-push does not queue duplicate
  runs.
* CI never deploys and never touches a hosted database. Cloudflare and Render each
  deploy from Git on their own. The one workflow that reaches production is
  `cron.yml`, which calls the API's cron routes daily with `CRON_SECRET`.
* A new check belongs in the workflow for the thing it checks, not in a catch-all
  job.
