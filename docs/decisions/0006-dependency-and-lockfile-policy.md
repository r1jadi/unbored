# 0006 — bun.lock is authoritative, and no dependency is added without updating it

* Status: accepted (2026-11-13: the site now builds on Cloudflare Workers with `bun install`, see [0016](0016-cloudflare-and-render-hosting.md); the lockfile rule is unchanged)
* Date: 2026-10-05

## Context

This repository is deployed to Vercel. Its JavaScript
lockfile is `bun.lock`; `bunfig.toml` sets a 24-hour supply-chain guard on new
package versions. Vercel detects the lockfile and installs with bun, which in a CI
environment (`CI=1`) defaults to `--frozen-lockfile`: a `package.json` that
disagrees with `bun.lock` **fails the install**, and therefore the deployment.

During this phase the platform did not have bun installed. `npm` 10.9.2 also
crashes on this dependency graph (`Cannot read properties of null (reading
'edgesOut')` in arborist's peer-set resolution), so `npm install` only worked with
`--legacy-peer-deps` and produced a `package-lock.json` that does not belong in
this repository.

The obvious next step — add `@supabase/supabase-js` for the auth foundation — would
have meant editing `package.json` without being able to regenerate `bun.lock`
correctly. That is exactly the change that breaks the production build.

## Decision

* `bun.lock` is the only lockfile. A `package-lock.json` must never be committed,
  and one generated locally is deleted.
* No dependency is added to `package.json` unless the lockfile is updated in the
  same change with the same tool (bun). If bun is unavailable, the dependency is
  not added — and the missing capability is documented instead of guessed at.
* Therefore this phase added **zero** frontend dependencies. The API client
  (`src/lib/api/client.ts`), the config module and the SEO helpers are written
  against `fetch`, `URL` and the platform's own primitives, and need nothing.
* `bun install --frozen-lockfile` is what CI runs, so a mismatch fails a pull
  request instead of a deployment.
* Adding a dependency is a deliberate act: check whether the platform already does
  it, prefer a smaller dependency, and record why in the pull request.

## Consequences

* The production build and the Vercel deployment are untouched by this phase; the
  client bundle is the same size as before.
* Connecting the login screens to Supabase needs one command in an environment
  that has bun (`bun add @supabase/supabase-js`) as the first step of that task,
  with `bun.lock` updated in the same commit. That task also owns the session
  storage decision (in-memory with refresh, or the SDK's default persistence).
* The Go side has the same rule with `go.mod`/`go.sum`: `go mod tidy` is part of
  the change that adds a dependency, and CI builds every binary so a missing sum
  entry fails fast.
* Two lockfiles for two ecosystems, both verified by CI, instead of one ecosystem
  with an unverifiable install.
