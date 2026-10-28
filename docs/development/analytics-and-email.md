# Analytics (PostHog) and email (Resend)

## PostHog

- Code: `src/lib/analytics.ts`, initialised from `src/routes/__root.tsx` after
  hydration. Never runs during SSR or under Vitest.
- Config: `VITE_PUBLIC_POSTHOG_KEY` (public `phc_...` key) and
  `VITE_PUBLIC_POSTHOG_HOST`. No key means analytics is off and nothing is sent.
- Page views are captured automatically on every client-side navigation.
- Identity: a signed-in visitor is identified by their account id (with their
  `role` as a person property), never by email. Signing out calls `reset()`.
  Only identified users get person profiles (`person_profiles: "identified_only"`).
- Session recordings, if turned on in the PostHog project, mask every input.
- Custom events: `import { track } from "@/lib/analytics"; track("game_finished", { gameId })`.
- CSP: when the key is set, `src/lib/csp.ts` allows the ingestion host and its
  `-assets` host in `connect-src`. Scripts PostHog loads are already allowed by
  `'strict-dynamic'`.

Setup: set both variables in Vercel (Production and Preview) and redeploy —
`VITE_` values are inlined at build time.

## Resend

Two paths, one API key:

1. **Supabase Auth mail** (confirmation, password recovery, email change).
   Supabase sends these itself; point it at Resend's SMTP relay in
   Dashboard → Authentication → Emails → SMTP Settings:

   | Field    | Value                         |
   | -------- | ----------------------------- |
   | Host     | `smtp.resend.com`             |
   | Port     | `465`                         |
   | Username | `resend`                      |
   | Password | the Resend API key (`re_...`) |
   | Sender   | `hello@unbored.lol` / Unbored |

   Resend's Supabase integration (Resend → Integrations) fills these in for
   you. Once custom SMTP is on, raise `email_sent` under Authentication → Rate
   Limits, which Supabase caps low for its built-in mailer. Local development
   keeps the built-in mail catcher; `supabase/config.toml` has a commented-out
   block for testing real delivery.

2. **Mail the Go services send** (`services/internal/email`). Reads
   `RESEND_API_KEY` and `EMAIL_FROM`; without a key `Send` returns
   `email.ErrNotConfigured`. Pass an `IdempotencyKey` for anything a retry
   could resend.

   ```go
   sender := email.NewFromEnv()
   id, err := sender.Send(ctx, email.Message{
       To: []string{addr}, Subject: "Welcome to Unbored", HTML: body,
       IdempotencyKey: "welcome/" + userID,
   })
   ```

   Set `RESEND_API_KEY` only on the Vercel service that sends mail — it is a
   secret and never a `VITE_` variable.

3. **Game release digest** (`services/notifications`). After five games have
   been published since the last digest, a daily Vercel Cron calls
   `GET /api/v1/cron/game-digests`, which emails every account with
   `user_preferences.notify_new_games = true`. The message lists each game's
   name, its how-to-play `instructions` and a `/play/<slug>` link, and links to
   `/settings/notifications` to opt out.

   Consent has two doors, both writing the same column: the optional "Product
   updates" checkbox on the sign-up form and the "New games" toggle in Settings.
   Existing accounts start opted out. The catalogue that predates the feature is
   recorded as a closed baseline digest, so it is never mailed retroactively.

   The route is disabled (503) unless `CRON_SECRET` is set; Vercel Cron sends it
   as `Authorization: Bearer <CRON_SECRET>`. Each run sends to at most 25
   recipients and continues an unfinished digest on the next run. Delivery rows
   and a Resend idempotency key per digest/recipient prevent duplicates. See
   [services/notifications/README.md](../../services/notifications/README.md).

Before any of these works, verify `unbored.lol` in Resend → Domains (SPF/DKIM DNS
records), otherwise Resend only delivers to the account owner's address.
