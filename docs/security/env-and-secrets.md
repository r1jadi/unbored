# Environment variables and secrets

## The one rule

A value is either **public** (safe in the browser bundle, named `VITE_*`) or
**server-only** (never named `VITE_*`, never logged, never returned). Moving a
value between the classes requires a design change, not a rename.

Vite inlines every `VITE_`-prefixed value into the client bundle at build time.
That is why `VITE_SUPABASE_PUBLISHABLE_KEY` is fine — Supabase designs the
publishable key to be public, and RLS is the security boundary — while
`SUPABASE_SECRET_KEY` is not. The legacy names (`VITE_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`) are the same keys under Supabase's old naming and are
deprecated; they are accepted as a fallback, never as a place to put something
new.

The full list, with the reason for each classification, is in
[development/environments.md](../development/environments.md#the-publicsecret-split)
and `.env.example`; the values the Vercel project needs are in
[deployment/vercel.md](../deployment/vercel.md#environment-variables).

## Where secrets live

| Secret | Development | Preview / production |
| --- | --- | --- |
| `SUPABASE_SECRET_KEY` (legacy: `SUPABASE_SERVICE_ROLE_KEY`) | `.env.local`, gitignored | Vercel → Settings → Environment Variables, **Production scope only**; API host secret store |
| `SUPABASE_JWT_SECRET` | `.env.local` | API host secret store; prefer JWKS + asymmetric keys so this value does not exist. The gateway deployment deliberately has none — it verifies against the project JWKS (see [deployment/vercel.md](../deployment/vercel.md)) |
| `RESEND_API_KEY` | `.env.local`, gitignored | Vercel → Settings → Environment Variables, server-side only; the games deployment sends the digest |
| `CRON_SECRET` | `.env.local`, gitignored | Vercel → Settings → Environment Variables; Vercel Cron sends it as a bearer token to the digest route |
| `RAIACCEPT_*` | not set | not set until the payments task; then a secret store, server-side only |
| Database password | the local container's throwaway value | Supabase-managed; never in this repository |

Nothing else in the repository is secret. `.env.example` contains names, defaults
and comments only.

## If a secret is exposed

An exposed key is a live credential. In order:

1. **Rotate first, investigate second.** For Supabase: create a new secret key in
   **Project Settings → API Keys**, move every component to it, then delete the old
   one — deletion is permanent, so wait until you have confirmed that nothing
   still uses it. A legacy
   service role key (or the legacy JWT secret) is deactivated in the same section
   instead, which is reversible. For a payment key: rotate it in the RaiAccept
   dashboard. Assume anything the key could reach has been read.
2. **Contain.** Remove the value from the environment, redeploy, and if the key was
   in a client bundle, invalidate the affected sessions.
3. **Assess.** Use `X-Request-ID` logs, Supabase's auth logs and the database's own
   logs to see what the key was used for. A secret key bypasses RLS, so assume the
   worst for its window of exposure.
4. **Record.** Add an entry to the notes below (date, credential, window, action),
   and if user data was involved, follow the applicable notification obligations.
5. **Prevent.** Add or extend a `gitleaks` rule so the same shape is caught next
   time. `gitleaks` scans the full history in CI, so a value committed and later
   deleted is still treated as leaked — rotating is the only real fix.

```text
# Exposure log
# (date) (credential) (window) (action taken) — none to date.
```

## Why the pipeline is shaped this way

* `.gitignore` excludes `.env`, `.env.*` and `! .env.example`, plus the Supabase
  CLI's local state directories (`supabase/.branches`, `supabase/.temp`) which can
  contain project metadata and tokens.
* Supabase itself revokes a secret key (`sb_secret_…`) that GitHub's secret
  scanning detects in a public repository, and notifies the project owner. That is
  a safety net, not a plan: a secret committed here is already treated as leaked,
  because this repository's history is public to everyone who can read it.
* `security.yml` runs `gitleaks detect` over the whole history on every push and
  weekly, and fails the build on a finding.
* `web.yml` runs `bun audit --audit-level=high`, and `go.yml` runs
  `govulncheck ./...` on both modules.
* `dependency-review-action` blocks a pull request that introduces a vulnerable or
  incompatibly licensed dependency.
* No workflow uses repository secrets for a fork's pull request, and every workflow
  declares `contents: read`.

## Adding a configuration value

1. Decide the class: public (`VITE_*`) or server-only. If unsure, it is
   server-only.
2. Add it to `.env.example` under the correct heading, with a comment explaining
   what it does and what a safe value looks like.
3. Read it through `src/lib/config.ts` (web) or `config.Load` (Go) — not
   `import.meta.env` and not `os.Getenv` scattered through handlers.
4. If it is required for a feature to work, fail with a clear message when it is
   missing (`requireSupabaseConfig()`), rather than silently doing nothing.
5. If it changes security behaviour, add the check to `config.Validate` so an
   unsafe value is a startup error. Anything that weakens security must be
   impossible in production, not merely discouraged.
6. Document it in `development/environments.md` and `.env.example`, and add it to
the environment-variable table in `deployment/vercel.md` if the deployment needs
it.
