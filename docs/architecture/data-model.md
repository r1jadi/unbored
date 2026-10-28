# Data model

## Where the schema lives

`supabase/migrations/*.sql`, applied in filename order. That is the only way the
schema changes; there is no manual production change. `supabase db reset` applies
every migration and then `supabase/seed.sql`.

| Migration | Contents |
| --- | --- |
| `20261005120000_core_schema.sql` | Enums, tables, constraints, indexes, `updated_at` and auth triggers. |
| `20261005120100_rls_and_grants.sql` | Role helpers, grants (column level where it matters), RLS policies, integrity triggers. |
| `20261005120200_storage_buckets.sql` | Buckets with size/MIME limits and path-ownership policies. |

Migrations are append-only: never edit one that has been applied anywhere. To
change a column, add a new migration.

## Tables

All tables live in `public` and are reachable only through the Data API roles
(`anon`, `authenticated`) or the server-side `service_role`.

| Table | Owner column | Purpose |
| --- | --- | --- |
| `profiles` | `id` (= `auth.users.id`) | Public profile: username, display name, bio, avatar path, suspension flag. |
| `user_roles` | `user_id` | Role assignment (`user`, `moderator`, `admin`). Separate table on purpose — see below. |
| `categories` | — | Reference data. |
| `games` | `owner_id` | Catalogue entries and their lifecycle (`draft` → `review` → `published`). |
| `game_sessions` | `user_id` (nullable — a guest run has none) | One play attempt: the server's seed, the rules version it is played under, its lifecycle and its expiry, and the verified score and submission fingerprint once it closes. The precondition for a score. |
| `scores` | `user_id` | Immutable score records, one per completed session, written only by the verifier. |
| `comments` | `author_id` | Comments on published games, `is_hidden` for moderation. |
| `likes` | `user_id` | `(user_id, target_kind, target_id)` — no duplicates by primary key. |
| `follows` | `follower_id` | Directed follow edges; self-follow is a constraint violation. |
| `reports` | `reporter_id` | User reports with a status workflow. |
| `moderation_actions` | `moderator_id` | Append-only record of moderator decisions. |
| `notifications` | `user_id` | Per-user inbox. |
| `game_release_digests` | — | One five-new-games email batch, its games and one delivery row per recipient. Service-owned; no client grant at all. |
| `analytics_events` | `user_id` (nullable) | Append-only product events; no Data API grant at all. |

## Ownership rules

The model encodes three rules that the application layer cannot talk its way out
of:

1. **Roles are not a profile field.** `user_roles` is a separate table with no
   write grant for `authenticated`, so no profile update — by a user, a handler
   bug or a future feature — can grant a role. Role changes require the
   `service_role` key (the admin service).
2. **Privileged columns are not granted.** `profiles.is_suspended` and
   `comments.is_hidden` have no `UPDATE` grant for `authenticated`. Postgres
   column grants are additive, so a column granted "for staff" would be granted
   to everyone; hiding a comment is therefore a moderation service action using
   `service_role`. (`profiles.username` is the deliberate exception: it is
   granted, owner-scoped by the update policy, and uniqueness is enforced by
   the citext index.)
3. **Scores are the database's arithmetic.** `scores` has no `INSERT` grant for
   `authenticated`, and no service holds a key that could write one either:
   `public.complete_stack10_run` replays the submitted run from the session's seed
   and inserts the score it derives. The game-sessions service validates the request
   shape and carries the caller's token; it cannot name a score. See
   [0012](../decisions/0012-server-verified-scores.md).
4. **Runs are issued, not created.** The `INSERT` grant on `game_sessions` was
   revoked as well: a client-writable session row is a client-chosen seed, and every
   "verified" score would then be verified against a stacked deck.
   `public.start_game_session` is the only path in, and it reads the caller from
   `auth.uid()`.

## Access matrix

The full matrix, including the denied cases, is in
[security/data-access.md](../security/data-access.md). Summary:

| Table | anon | authenticated | service_role |
| --- | --- | --- | --- |
| `games` | select published | select visible, insert/update/delete own (draft/review only) | all |
| `profiles` | select public columns | select public columns, update own presentation columns | all |
| `user_roles` | — | select own + staff select all | all |
| `game_sessions` | — | select own (no insert) | all |
| `scores` | select visible | select visible | all (writes) |
| `game_stats` (view) | select aggregates | select aggregates | all |
| `comments` | select visible | select visible, insert/delete own, update own body | all |
| `likes`, `follows` | select | select, insert/delete own | all |
| `reports` | — | insert own, select own, staff select/update | all |
| `notifications` | — | select/update own `read_at` | all |
| `game_release_digests` (+ games, deliveries) | — | — (no grant) | all |
| `analytics_events` | — | — (no grant) | all |

## Integrity rules enforced in the database

Not every rule belongs in a policy, and some cannot be expressed as one:

* `games.owner_id` is immutable (trigger), so staff moderation cannot reassign a
  game and a creator cannot hand one over.
* `games.status = 'published'` stamps `published_at` in the database; unpublishing
  clears it.
* A creator can hold a game only in `draft`/`review`: self-publishing is blocked
  by policy, so publishing is always a moderation decision.
* `reports.resolved_by`/`resolved_at` are stamped from `auth.uid()` when a report
  is resolved, so the resolver cannot be forged.
* A comment must belong to a published game and cannot be parented to itself.
* `profiles.username` is `citext` (case-insensitive unique) with a format check.
* A closed session carries both the verified score and the fingerprint of the
  submission that produced it, or neither: `(completed_at is null) = (verified_score
  is null) = (verified_digest is null)`.
* A session's expiry is after its start (`expires_at > started_at`), and a session
  is either open, completed or abandoned — a retry is recognised by the stored
  fingerprint rather than by inserting a second score.
* Trigger-created profiles mean every auth user has a profile and a `user` role
  row from their first request.

## Indexes

Indexes exist for the access patterns the features will use, not speculatively:
`games(status, published_at desc)`, `scores(game_id, score desc, created_at)`,
`comments(game_id, created_at desc) where not is_hidden`,
`notifications(user_id, created_at desc)` plus a partial index for unread,
`reports(status, created_at)` for the moderation queue,
`game_sessions(user_id, started_at desc)`, plus two the play path needs:
`game_sessions(game_id, user_id)` where the run is open (finding the run to abandon
when a new one starts) and `scores(game_id, created_at desc)` (windowed boards).

## Storage

| Bucket | Public | Limit | MIME allowlist |
| --- | --- | --- | --- |
| `avatars` | yes | 2 MiB | png, jpeg, webp |
| `game-assets` | yes | 10 MiB | png, jpeg, webp, avif |
| `game-builds` | no | 50 MiB | zip, json, html, javascript, css |

Objects must live under a folder named after the uploader's user id, and only the
owner may write there. Objects are served as static bytes and never executed;
there is no scanning yet, which is recorded as remaining work in
[security/threat-model.md](../security/threat-model.md).

## Seed data

`supabase/seed.sql` contains reference categories only, and is idempotent (CI
applies it three times to prove it). Users are created through Supabase Auth,
never by inserting into `auth.users` in a seed file.
