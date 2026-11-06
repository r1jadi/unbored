# Conventions

## Git

* Branches: `main` is deployable. Work happens on a branch and lands through a
  pull request.
* **Never rewrite published history.** Force pushing, rebasing, amending or squashing
  commits that are already pushed breaks everyone else's copy. Add a new commit instead.
* Commit messages describe the *why*, not the file list. Keep the branch in a
  working state: CI (web, go, database, api-contract, security) runs on every push.
* One logical change per commit. Do not reformat unrelated files in a change —
  in particular never commit a repo-wide Prettier run as part of a feature.
* Never commit a secret. `gitleaks` scans the full history in CI.

## Go

* Services are `services/<name>/cmd/<name>/main.go` and contain almost nothing:
  a `servicekit.MustRun` call with a `Register` function. Configuration, logging,
  middleware, probes and shutdown come from the kit, so a service cannot drift
  into a weaker posture than its neighbours.
* Shared code belongs in `packages/go/platform` only when at least two services
  need it. Prefer duplicating a small helper over inventing a framework.
* Errors: return a typed error from `apierr` when the caller should see a
  specific code, and anything else when they should not — the platform maps
  unknown errors to `500 internal` with a generic message. Never include an
  internal detail in a user-facing message.
* Logging is `slog` with structured attributes. Log the request id, the user id
  when known, and never a token, a cookie or a raw request body. Use
  `logging.RedactHeaders` if headers must be logged.
* SQL: parameterised queries only. The platform does not build SQL strings, and
  neither should a service.
* Every handler validates its input explicitly. `httpx.DecodeJSON` rejects
  unknown fields, enforces the size limit and checks the content type; range,
  format and ownership checks are the handler's job.
* Ownership always comes from the verified identity
  (`identity.FromContext`), never from a body or query parameter.
* A new endpoint needs a test for its tier boundary: unauthenticated is `401`,
  insufficient role is `403`, and a valid caller is allowed.

## TypeScript / React

* Match the existing style: function components, named exports, `@/` path alias,
  Tailwind classes from the token set. Prettier and ESLint decide formatting;
  `bun run format` before committing.
* **Do not change the UI.** The design is approved: colors, typography, spacing,
  layout, navigation, cards, glass effects, icons, animations. Infrastructure work
  adds code behind the existing UI, never a restyle.
* Server state goes through `src/lib/api/client.ts` (`apiFetch`); do not call
  Supabase's REST API for domain data (see
  [decisions/0008](../decisions/0008-browser-data-access.md)).
* Configuration comes from `src/lib/config.ts`, which documents the public/secret
  split. A component never reads `import.meta.env` directly.
* Accessible markup is required, not optional: one `h1` per page, real `button`
  elements, labels tied to inputs, and no interactive `div`.
* Tests live next to the code as `*.test.ts(x)` and cover logic, not snapshots.

## SQL and migrations

* Migrations are append-only, named `<timestamp>_<description>.sql`, and reviewed
  like code: they are the schema's only history.
* Every table that the Data API can reach needs: RLS enabled, an explicit grant
  (column level where useful), and policies for each verb a role may attempt.
* Prefer a database constraint for an invariant that must always hold; prefer a
  policy for a rule that depends on who is asking.
* A migration that drops or rewrites data needs a documented backfill and a
  deploy in two steps (expand, migrate, contract).

## Documentation

* Every decision worth defending has an ADR in `docs/decisions`. Write the ADR in
  the same pull request as the decision, not later.
* Keep the docs in `docs/` in step with reality: a claim in a document that no
  longer holds is a defect, and "not implemented yet" is a perfectly good thing
  for a document to say.
