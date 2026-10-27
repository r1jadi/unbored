# docs/development

How to get a working checkout and how to work in this repository.

| Document | Contents |
| --- | --- |
| [local-setup.md](local-setup.md) | Prerequisites, the web app, the database (Supabase CLI or the Docker harness), the Go services, and how to add a service. |
| [environments.md](environments.md) | development / preview / staging / production, the public-vs-secret split, where values are set, fail-fast configuration, and the manual actions this phase could not perform. |
| [conventions.md](conventions.md) | Git rules (never rewrite published history), Go conventions, TypeScript/React conventions, SQL/migration rules, the UI freeze. |
| [testing.md](testing.md) | Every suite and command, the database suite's assertion helpers, how to add tests, and an explicit list of what is not covered. |
| [analytics-and-email.md](analytics-and-email.md) | PostHog analytics in the web app and Resend for Supabase Auth mail and Go-sent email: configuration, setup steps, usage. |

Quick reference:

```bash
bun run dev            # web app on :8081
bun run typecheck      # tsc --noEmit
bun run test           # vitest
bun run build          # the command Vercel runs
./scripts/test-rls.sh  # migrations + 50+ RLS assertions on throwaway Postgres
cd services && go test ./...
```
