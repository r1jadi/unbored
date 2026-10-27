# Google sign-in (Supabase OAuth, PKCE)

Code implements the full flow; the provider credentials and dashboard switch
must be done manually by the owner. Nothing is simulated and no secret lives in
the frontend.

## How it works in code

- Entry: `Continue with Google` on login/signup and `Connect` in
  Settings → Connected accounts redirect to
  `<SUPABASE>/auth/v1/authorize?provider=google&redirect_to=<SITE>/auth/callback?next=…&apikey=<PUBLISHABLE>&code_challenge=…&code_challenge_method=s256`
  with a fresh PKCE verifier in `sessionStorage` (`googleAuthorizeUrl` in
  `src/lib/auth/session.ts`). The `apikey` is required because a redirect
  carries no headers; the S256 challenge is what makes Supabase return a
  `?code=` instead of an implicit fragment.
- Callback: `/auth/callback` exchanges `?code` via
  `POST <SUPABASE>/auth/v1/token?grant_type=pkce` with the stored verifier,
  then verifies the tokens through `POST /api/v1/auth/session` before adopting
  them. Cancellation (`?error=access_denied`) and missing verifiers show
  specific messages. Parameters are stripped from the URL.
- Completion: the callback only proves _who_ the visitor is. A Google account
  that has never finished an Unbored sign-up lands with
  `session.onboarded === false`; the root gate in `src/routes/__root.tsx`
  routes it to `/signup`, which runs the remaining steps (name + terms)
  without asking for a credential again. Finishing writes
  `profiles.onboarded_at` exactly once — the display name through
  `PATCH /api/v1/users/me`, the marker through a conditional Data API write
  with the caller's own token (`src/lib/users/registration.ts`) — so a
  resumed or repeated completion is a no-op, never a duplicate account.
- Accounts that predate the completion flow (created before
  `2026-10-17 17:11:09 UTC`) never read as unfinished even when the marker is
  null: the auth service derives that from `auth.users.created_at`, which the
  caller cannot influence, and repairs the marker on the first session read
  with the caller's own token. An existing Google identity therefore signs in
  directly, whether or not the grandfathering migration was applied.
- Profiles: OAuth users get a row from the existing `handle_new_user` trigger;
  no email-based auto-linking is performed, so Google cannot take over an
  address it does not own.
- Connected state: Settings → Connected accounts reads live identities from
  `GET <SUPABASE>/auth/v1/user` (`fetchLinkedProviders`). Google shows
  connected only when the provider is linked.

## Manual setup (owner)

### 1. Google Cloud console (one OAuth client)

1. APIs & Services → Credentials → Create Credentials → OAuth client ID →
   Application type **Web application**.
2. Authorized JavaScript origins:
   - `https://unbored.lol`
   - `https://trrwaftksifjaiaxfmiu.supabase.co`
3. Authorized redirect URIs (exact, Supabase callback):
   - `https://trrwaftksifjaiaxfmiu.supabase.co/auth/v1/callback`
4. Keep the client secret in the Google console; it is entered in Supabase, not
   in this repo.

### 2. Supabase dashboard

1. Authentication → Providers → Google → Enable.
2. Paste the Google **Client ID** and **Client secret**.
3. Authentication → URL Configuration → Site URL:
   `https://unbored.lol`.
4. Redirect URLs: add `https://unbored.lol/auth/callback`
   (and preview variants as needed).

### 3. Verify

- Click Continue with Google, complete consent:
  - an account with no finished sign-up: `/auth/callback` → `/signup`
    (name + terms) → `/account-created`, with exactly one
    `profiles.onboarded_at` write;
  - an account that already finished: `/auth/callback` → `/`.
- Cancel at Google, expect the cancelled message, no session.
- Settings → Connected accounts must show Google connected afterwards.

## Not done

- Apple sign-in is removed; there is no Apple button, row, or flow left to
  configure.
- Production Google login must not be claimed as enabled until the steps above
  are completed and verified in production (local tests only prove the code
  paths).
