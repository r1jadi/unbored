# 0017 — A finished guest run can be saved to the account its player makes

- Status: accepted (amends 0012)
- Date: 2026-11-16
- Deciders: product owner, with Claude Code

## Context

[0012](0012-server-verified-scores.md) made a guest run "real and unranked": it is
replayed and verified, but it has no owner, so it never becomes a score, and the
completion function refuses to match an anonymous session to a signed-in caller.

That left a gap at the exact moment an account matters most. A guest posts a good
score, the end screen says "make an account and your _next_ score counts", and the
score that made them want an account is lost. The rule was about ownership, not
about trust: the run's score was already the database's own arithmetic.

## Decision

Add one narrow way to adopt a guest run: `public.claim_guest_run(session_id)`,
served as `POST /api/v1/sessions/{sessionID}/claim` (authenticated only).

- **No number crosses the wire.** The request names a session; the score row is built
  from the session's `verified_score`. Claiming moves ownership, never a value, so
  0012's central rule ("the database decides the score") is unchanged.
- **The session id is the proof**, exactly as it already is for completing a guest
  run: only the device that started the run was told the id (122 random bits, in the
  start response, in no public read or link). A claim asks for nothing completion
  didn't.
- **Narrow eligibility.** Anonymous, finished and verified, not abandoned, not a
  challenge run, finished within 24 hours (`public.guest_claim_window()`), and claimed
  once — by the first signed-in caller. Everything else answers `not_found` alike.
- **Daily games keep one ranked attempt a day.** A claim of a run on a board the player
  has already finished (same game, same seed) answers `already_played`, under the same
  per-player advisory lock the start gate takes.
- **Downstream sees an ordinary ranked run.** The session gets its owner and the score
  row is inserted the way every verifier inserts one, dated `completed_at` and timed
  `completed_at − started_at`, so boards, streaks, notifications and profiles need no
  special case.
- **The web client stores the id only on request.** A guest's finished run is held in
  memory; it is written to local storage only when they tap "Sign up and save" or
  "Sign in to save", and it is cleared when claimed, refused or lapsed. A root
  component claims it once the account has finished registration.

The second half of 0012's guest bullet ("cannot later be claimed by a signed-in
caller") is superseded by this record; the completion function's own refusal to
complete an anonymous session as a signed-in caller is unchanged.

## Consequences

- A shared device is the residual risk: someone who signs in on the same browser
  within 24 hours, after the guest tapped "save", would receive the guest's run. The
  run must have been explicitly held, and the window is short.
- Offline and archive runs were never issued by the server and still cannot be saved;
  their end screen keeps the "your next score counts" wording.
- Tests: `tests/security/rls_test.sql` (claim section),
  `services/game-sessions/claim_test.go`, `src/lib/games/guest-claim.test.tsx`.
