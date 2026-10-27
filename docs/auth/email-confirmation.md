# Email confirmation (Supabase link flow)

Supabase sends a verification **link**, not a six-digit code. The app implements
that flow end to end; this note records the wiring and the manual dashboard
steps that code cannot perform.

## How it works in code

- `POST /api/v1/auth/sign-up` (Go auth service) forwards the credential to
  Supabase and proposes `options.emailRedirectTo = <SITE>/auth/callback`
  (`services/auth/internal/supabaseauth/client.go`). The site is resolved from
  `PUBLIC_SITE_URL`, `SITE_URL`, then `VITE_PUBLIC_SITE_URL`, defaulting to
  `https://unbored.lol`. An invalid value is omitted rather than
  sent.
- The username chosen on the same form travels in that request's `data`
  payload (`data.username`). Supabase stores it on the auth user before the
  trigger runs, and `handle_new_user` writes it to the profile in the account's
  own transaction. It is therefore already the account's username while
  confirmation is pending; opening the link does not set or replace it.
- The display name travels the same way (`data.display_name`). With both
  present the trigger also sets `onboarded_at`
  (`20261112120000_signup_display_name.sql`): the form collected the name and
  the accepted terms before the request, so the link signs straight in rather
  than reopening `/signup`.
- The pending screen is `/verify-email` (link instructions, resend via
  Supabase `/auth/v1/resend`, continue to login). It never asks for a code.
- The callback is `/auth/callback` (`src/routes/auth.callback.tsx`):
  `?token_hash&​type` is verified via `POST <SUPABASE>/auth/v1/verify`,
  `?code` is exchanged via PKCE (`/auth/v1/token?grant_type=pkce` with the
  stored verifier), and `#access_token&refresh_token` fragments are adopted.
  Every token is verified by the backend (`POST /auth/session`) before the app
  treats the caller as authenticated. Callback parameters are stripped from the
  URL immediately; failures show a specific message with a resend path.
- If Supabase ignores `emailRedirectTo` (it is not in the allowlist) it sends
  the visitor to the Site URL instead. The root route forwards any landing that
  carries `#access_token`, `?token_hash`, or `/?code` to `/auth/callback`, so
  the account is still signed in — but fix the allowlist below regardless.
- Login (`/login`) keeps the server's message for HTTP responses (unconfirmed
  email, wrong password, rate limit) and reports a connection problem only when
  the fetch itself threw. A `localhost` API URL baked into a production bundle
  is ignored in favour of same-origin (`src/lib/config.ts`), but the deployment
  must still set `VITE_API_BASE_URL` correctly.

## Manual Supabase steps (owner)

1. **Authentication → URL Configuration → Site URL**: `https://unbored.lol`.
2. **Redirect URLs** (allowlist): add
   - `https://unbored.lol/auth/callback`
   - `https://unbored.lol/auth/callback?next=/reset-password`
   - preview origins as needed (`https://unboredapp-*.vercel.app/auth/callback`).
     Without these, Supabase ignores the proposed `emailRedirectTo`.
3. **Authentication → Email templates → Confirm signup**: ensure the button links
   to `{{ .ConfirmationURL }}` (the Supabase verify URL carrying the redirect).
   Do not replace it with a code template.
4. **Authentication → Providers → Email**: confirm signup confirmation is ON
   (the app handles the pending state; do not disable it to make signup look
   instant).
5. **Vercel env (Production)**: `PUBLIC_SITE_URL=https://unbored.lol`,
   `VITE_API_BASE_URL=https://unbored.lol/api/v1`,
   `CORS_ALLOWED_ORIGINS=https://unbored.lol`.

## Verify without touching production data

- Sign up with a disposable address, expect `201` with `user` and no `tokens`.
- Open the newest link, expect a redirect to `/auth/callback` then `/`.
- Reusing the same link must fail with an invalid/expired message, not a login.
