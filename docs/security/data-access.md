# Data access and authorization

Two layers guard every exposed table, and they are independent on purpose:

1. **Grants** decide which verbs a role may attempt, at column level where it
   matters. A missing grant is an error (`42501`), not a silent failure.
2. **RLS policies** decide which rows that attempt may touch. A filtered row is
   invisible (`0 rows`), and a rejected write is an error.

A bug in one layer does not open the table. Both are exercised by
`tests/security/rls_test.sql` — see [testing.md](testing.md).

## The roles

| Role                 | Who holds it                                   | Reaches the database                              |
| -------------------- | ---------------------------------------------- | ------------------------------------------------- |
| `anon`               | the publishable key without a session          | yes, with no identity                             |
| `authenticated`      | a signed-in user's access token                | yes, identity from `auth.uid()`                   |
| `service_role`       | the server (Go services, admin tooling)        | yes, bypasses RLS                                 |
| `moderator`, `admin` | not Postgres roles — a `user_roles.role` value | as `authenticated`, with policies that consult it |

Staff status is not a database role. It is a row in `user_roles`, read by the
`security definer` helpers `public.current_role()`, `public.is_staff()` and
`public.is_admin()`, which take **no arguments** and always use `auth.uid()`: a
function parameterised by user id would let anyone probe who is an administrator.

## Matrix

`✓` allowed, `—` no grant, `own` scoped to the caller's row, `staff` requires the
moderator or admin role.

| Table                | anon                                                                              | authenticated                                                                                                            | service_role          |
| -------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `categories`         | select                                                                            | select                                                                                                                   | all                   |
| `games`              | select (published only)                                                           | select (published + own + staff), insert own (draft/review), update own (draft/review), delete own (draft), update staff | all                   |
| `profiles`           | select public columns                                                             | select public columns, update own presentation columns                                                                   | all                   |
| `user_roles`         | —                                                                                 | select own, select staff                                                                                                 | all (the only writer) |
| `game_sessions`      | —                                                                                 | select own (**no insert**: the server issues the row, the seed and the timestamps)                                       | all                   |
| `scores`             | select (visible games)                                                            | select (visible games)                                                                                                   | all (the only writer) |
| `game_stats` (view)  | select aggregates (`slug`, `plays`, `players`, `best_score`, `last_completed_at`) | select aggregates                                                                                                        | all                   |
| `comments`           | select (not hidden)                                                               | select (not hidden + own + staff), insert own (published games), update own body, delete own or staff                    | all (hides comments)  |
| `likes`              | select                                                                            | select, insert own, delete own                                                                                           | all                   |
| `follows`            | select                                                                            | select, insert own, delete own                                                                                           | all                   |
| `reports`            | —                                                                                 | insert own, select own, select/update staff                                                                              | all                   |
| `moderation_actions` | —                                                                                 | select staff, insert staff (as `auth.uid()`)                                                                             | all                   |
| `notifications`      | —                                                                                 | select own, update own `read_at`                                                                                         | all                   |
| `game_release_digests` (+ games, deliveries) | —                                                                      | — (no grant at all)                                                                                                      | all (service RPCs only) |
| `analytics_events`   | —                                                                                 | — (no grant at all)                                                                                                      | all                   |
| `storage.objects`    | select public buckets                                                             | select, insert/update/delete under `<own-user-id>/` in a writable bucket                                                 | all                   |

## Rules the matrix encodes

- **No client-written privilege.** No `INSERT`/`UPDATE` grant on `user_roles` for
  `authenticated`; role changes require the service key.
- **No client-written scores.** No `INSERT` grant on `scores`; the only writer is
  `public.complete_stack10_run`, which inserts a row after replaying the submitted
  run and deriving the score itself. The game-sessions service passes the caller's
  token through and cannot name a score at all — see
  [0012](../decisions/0012-server-verified-scores.md).
- **No client-written sessions.** The `INSERT` grant and policy on `game_sessions`
  were revoked: a client that could write its own session row could choose its own
  seed, and every score would then be verified against a deck the player stacked.
  `public.start_game_session` is `security definer`, reads the caller from
  `auth.uid()`, and is the only path in.
- **Aggregates, not rows, and only granted columns.** `game_stats` is a
  `security definer` view — `game_sessions` is readable only by its owner, so a
  count of everybody's runs cannot come from a view that runs as the caller. It
  exposes counts and the `slug`; `game_id` is deliberately not granted, because the
  uuid is internal everywhere else in this API.
- **No client-written moderation state.** `comments.is_hidden` and
  `profiles.is_suspended` have no `UPDATE` grant for `authenticated`. Postgres
  column grants are additive, so a column granted "for staff" would be granted to
  everyone — hiding a comment or suspending an account is a service action.
- **No client-written lifecycle state.** A creator may hold a game in
  `draft`/`review` only; `published` and `rejected` come from a moderator.
- **Immutable columns.** `games.owner_id` cannot change, for anyone (trigger), so
  moderation cannot silently reassign authorship.
- **Stamped facts.** `games.published_at` and `reports.resolved_by`/`resolved_at`
  are written by database triggers from the database clock and `auth.uid()`, so
  they cannot be forged by a request body.
- **Least data.** `profiles` exposes only public columns to the Data API;
  `analytics_events` is unreachable from the browser; lists are capped.

## The admin surface

The dashboard's reads and moderation writes are `security definer` functions,
not grants, and they are the one place where a function's own check _is_ the
boundary: a definer function runs with the owner's rights and therefore bypasses
Row Level Security.

| Function family                                                                             | anon | authenticated                                                                     | service_role |
| ------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------- | ------------ |
| `admin_identity()`                                                                          | —    | execute (the caller's own row: role, username, suspension state)                  | all          |
| `admin_overview()`, `admin_analytics()`                                                     | —    | execute, then `admin_guard_staff()` re-checks the caller's role                   | all          |
| `admin_*_directory()` (games, users, reports, comments, scores, categories, moderation log) | —    | execute, then `admin_guard_staff()`                                               | all          |
| `admin_set_game_status()`, `admin_set_report_status()`, `admin_set_comment_hidden()`        | —    | execute, then `admin_guard_staff()`; writes the audit row in the same transaction | all          |
| `admin_set_suspension()`                                                                    | —    | execute, then `admin_guard_admin()` — a moderator is refused                      | all          |
| `admin_*_svc()` (privileged wrappers, one per function above)                             | —    | revoked — ordinary tokens answer `permission denied` before any body runs         | execute only |

What those functions guarantee:

- **the caller is never a parameter — except the verified actor on the
  privileged path.** Each row-gated function derives the actor from `auth.uid()`
  through `public.current_role()`; a request body can name the _target_ and
  nothing else, so a body cannot forge an actor or a role. The single exception
  is the `*_svc` wrappers' `p_actor`: they run as the service role (which only
  the Go admin service holds, after its own ADMIN_EMAILS check), so the actor
  they carry is attribution by a trusted server, not proof offered by a client —
  and a stolen key is already a full compromise, not a new capability;
- **a refusal raises `42501`**, the same SQLSTATE a missing grant raises, so a
  refusal cannot be told apart from a table the caller was never granted;
- **the decision and its audit are one write.** Publishing a game, resolving a
  report, hiding a comment and suspending an account each set the state and insert
  the `moderation_actions` row in one transaction, stamped from the token's
  `auth.uid()`;
- **no role can be granted.** `user_roles` still has no `INSERT`/`UPDATE` grant
  for `authenticated`; the admin service cannot write it either, because it holds
  no service key. Granting a role is an operator action — see
  [ADR 0013](../decisions/0013-admin-authorization.md).

## Storage

| Bucket        | Public read | Write             | Limits                       |
| ------------- | ----------- | ----------------- | ---------------------------- |
| `avatars`     | yes         | owner folder only | 2 MiB, png/jpeg/webp         |
| `game-assets` | yes         | owner folder only | 10 MiB, png/jpeg/webp/avif   |
| `game-builds` | no          | owner folder only | 50 MiB, zip/json/html/js/css |

The folder must be the uploader's user id, so guessing a path does not grant
write access to someone else's object. Objects are served as static bytes; a HTML
file inside a private bucket is never executed by the origin.

## The service_role key

It bypasses RLS. Therefore:

- it exists only in server-side environments (Vercel SSR env, the API's secret
  store) — never in a `VITE_` variable, never in a client bundle, never in a log;
- each use should be justified by "a user cannot be trusted to do this";
- **only the admin API's games deployment holds it.** It verifies ADMIN_EMAILS
  first and then calls the `service_role`-only `*_svc` wrappers with the
  verified actor; without it those routes fail closed. Auth, users, games, the
  play sessions and every other caller still pass the _caller's_ token to the
  Data API, so RLS stays the boundary everywhere else; the migrations and an
  operator's SQL console are the only other writers of privileged state;
- leaking it means a full database compromise: rotate it immediately
  (see [env-and-secrets.md](env-and-secrets.md)).

## Changing the model

1. Add a migration; never edit an applied one.
2. Update the grant and the policy in the same migration, so the table is never
   briefly unreachable or briefly open.
3. Add `allow` and `denied`/`blocked` assertions to `tests/security/rls_test.sql`
   for the new behaviour.
4. Update this matrix and `docs/architecture/data-model.md`.
