# services/notifications

The game-release digest. In-app notifications and push delivery are still the
scaffolded routes in `cmd/notifications`; the implemented piece is the email a
player receives after five new games have been published.

## What triggers it

`vercel.json` schedules a daily request to
`GET /api/v1/cron/game-digests`. Vercel Cron sends
`Authorization: Bearer $CRON_SECRET`, and the route answers `401` otherwise. With
`CRON_SECRET` unset the route answers `503`: there is no open mail trigger.

The route is served by the `notifications` package mounted in the **games**
deployment, not by a deployment of its own. That deployment already holds
`SUPABASE_SECRET_KEY` for the admin bridge, and Vercel's Go preset has no
remaining entrypoint slot for another service. The local
`services/notifications/cmd/notifications` binary mounts the same package.

## How a digest is assembled

The database does the selection:

* `claim_game_release_digest()` returns the open digest, or creates one from the
  five oldest published games that no digest has ever announced. Fewer than five
  answers `NULL`, which the endpoint reports as `idle`. Its advisory lock makes
  two overlapping cron runs safe.
* `game_release_digest_games(id)` returns each game's slug, title and
  `instructions` (how to play), in publication order.
* `game_release_digest_recipients(id, limit)` returns confirmed, unsuspended
  accounts with `user_preferences.notify_new_games = true` and no delivery row
  for this digest.
* `record_game_release_digest_delivery(id, user, failure)` records one outcome,
  once. `close_game_release_digest(id)` stamps `sent_at` only when no recipient
  is left.

A game can belong to at most one digest, enforced by a unique index, so
republishing an old game never sends it again. The catalogue that existed when
the migration shipped sits in one closed baseline digest and is never emailed.

Each message contains the five game names, their how-to-play instructions, a
link to `/play/<slug>`, and a link to `/settings/notifications` where the player
can turn the digest off. One Resend idempotency key per digest and recipient
keeps a retry from sending a second copy within Resend's window.

## Limits

One invocation sends to at most 25 recipients, inside the service's request
budget. An unfinished digest stays open and the next daily run continues it;
recipients already handled are skipped. A failed address is recorded as failed
rather than retried forever, so one bad mailbox cannot hold the queue.

## Configuration

| Variable | Why |
| --- | --- |
| `SUPABASE_URL` | Data API origin |
| `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) | Runs the service-role RPCs; never a client key |
| `RESEND_API_KEY` | Sending. Without it the route answers `503` |
| `EMAIL_FROM` | Verified Resend sender, e.g. `Unbored <hello@unbored.lol>` |
| `PUBLIC_SITE_URL` | Play and preferences links. Falls back to `https://unbored.lol` |
| `CRON_SECRET` | Shared secret Vercel Cron presents. Unset disables the route |

Set `CRON_SECRET` in the Vercel project (Production and Preview are independent).
Resend must have `unbored.lol` verified, as described in
[docs/development/analytics-and-email.md](../../docs/development/analytics-and-email.md).

## Local checks

```bash
cd services
go test ./notifications/...
go build ./...
```

The handler tests use a fake database and a fake mailer, so they send nothing and
need no credentials. `../../scripts/test-rls.sh` proves the digest tables and
functions are service-only and that consent is honoured.
