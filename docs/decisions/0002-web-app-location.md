# 0002 — The web app stays at the repository root, with a path to apps/web

> **Update, 2026-11-06:** the project is no longer connected to Lovable. The Lovable
> constraints below no longer apply; the Vercel, lockfile and CI work of a move still does.

* Status: accepted
* Date: 2026-10-05

## Context

The target monorepo layout puts the web app in `apps/web`, and it does:
`apps/web` exists as a placeholder. The working application, however, is not a
Next.js project that was scaffolded into `apps/`; it is a TanStack Start app
(Lovable-connected, deployed on Vercel, UI approved and frozen) that lives at the
repository root, with `src/`, `public/`, `vite.config.ts`, `vitest.config.ts`,
`eslint.config.js` and `tsconfig.json` at the top level, and a `bun.lock` that
Vercel's build depends on.

Moving it means: rewriting Vercel's root directory and build settings, moving the
lockfile, updating every CI path, and re-establishing the Lovable integration's
expectations — all for a directory name. The explicit instruction for this phase
was not to break the working application for structural tidiness.

## Decision

Keep the web app where it works, and record the migration path:

* Do not move files. Do not add a second web app. Do not migrate to Next.js.
* The web app remains the repository-root project; `.github/workflows/web.yml`
  and the documentation all name it as such.
* A future move to `apps/web` happens only as part of a deliberate migration task
  with its own verification: create `apps/web`, move the app's files in a single
  commit, update `vite.config.ts`/`tsconfig` paths, update Vercel's root
  directory, update every workflow path filter, and re-verify the production
  build and the deployed preview before deleting anything.

## Consequences

* The repository is "monorepo-shaped but not monorepo-aligned" for the web app.
  Everything else (`services/`, `packages/`, `supabase/`, `docs/`) already follows
  the target layout.
* Anything that assumes `apps/web` (a future `turbo.json`, a root workspace
  configuration) must account for the root project until the move happens.
* The approved UI, the Vercel deployment and the Lovable connection are untouched
  by this phase, which was the priority.
* The cost of reversing this decision later is one bounded migration commit plus a
  Vercel setting; the cost of doing it now was an outage risk to a live deployment.
