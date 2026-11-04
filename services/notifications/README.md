# services/notifications

Three things reach a player outside the page they are on: the game-release digest
email below, [in-app notifications](#in-app-notifications) and
[web push](#web-push), which share one source.

## In-app notifications

Database triggers create them (`supabase/migrations/20261210120000_notification_triggers.sql`),
so a follow, a comment or a score from any path is covered:

| Happens | Who is told | Settings toggle | Limit |
| --- | --- | --- | --- |
| A follow | The player followed | `notify_followers` | Once a day per follower, so re-following can't spam |
| A reply | The comment's author | `notify_comments` | None |
| A comment on a game | Its owner, unless it is Unbored's own game | `notify_comments` | None |
| A new personal best | The players it overtook | `notify_beats` | The ten closest, and once per game every six hours per player |

Nobody is told about their own action, nothing crosses a block in either direction,
and a player off the leaderboards neither triggers nor receives a beaten-score
notification. The app words each row from its kind, so rows are translated.

## Web push

`POST /api/v1/cron/push-dispatch` (`push.go`) sends the notifications above to the
devices that opted in. The toggles above decide what is sent; the switch in Settings
decides whether it comes to this device.

1. A browser subscribes and calls `register_push_subscription`. Its endpoint must be
   a real push service, enforced by a constraint and again before sending: the server
   posts to that URL, so anything else would let a player aim it at an internal address.
2. A new notification for someone with a subscription fires `wake_push_dispatch`,
   which calls the route through pg_net after commit.
3. The route reads `claim_push_batch`, encrypts each message for its device and sends
   it. A subscription the push service says is gone is deleted.

Delivery is at most once: a failed send is not retried, because the notification is
still in the inbox. A notification older than a day is not sent.

**Browser support:** Chrome, Edge, Firefox and Safari on desktop; Android browsers; on
iPhone and iPad only once Unbored is added to the Home Screen (iOS 16.4 or later). The
native apps in `apps/` are not built yet, and this doesn't cover them.

### Turning it on

Nothing is sent until all of this is done, and nothing breaks before it is.

1. Generate a VAPID key pair once. Changing it later stops every existing subscription.

   ```bash
   npx web-push generate-vapid-keys
   ```

2. Set these in the Vercel project, then redeploy:

   | Variable | Value |
   | --- | --- |
   | `VITE_VAPID_PUBLIC_KEY` | The public key. It is built into the page, so a redeploy is needed |
   | `VAPID_PUBLIC_KEY` | The same public key |
   | `VAPID_PRIVATE_KEY` | The private key. Server-only: never `VITE_` |
   | `VAPID_SUBJECT` | Optional: `mailto:` or `https://`. Defaults to the site URL |

   `CRON_SECRET` and `SUPABASE_SECRET_KEY` are already set for the digest.

3. Apply the migrations, then store the wake-up details in Supabase Vault (SQL editor).
   Use the same value as `CRON_SECRET`, and check that the `pg_net` extension is on:

   ```sql
   select vault.create_secret('https://unbored.lol/api/v1/cron/push-dispatch', 'push_dispatch_url');
   select vault.create_secret('<CRON_SECRET>', 'push_dispatch_secret');
   ```

To check it, turn the switch on in Settings and have another account follow you. Calls
pg_net made are in `net._http_response`.

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
