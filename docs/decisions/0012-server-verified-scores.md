# 0012 — Scores are verified by the database, and the session service holds no master key

* Status: accepted
* Date: 2026-10-13

## Context

The catalogue has been real since Phase 4B, but no game was playable: the play
screen was a prototype that added `10 + random(15)` to a number on every tap, and the
results, leaderboard and game-detail screens showed ranks, play counts and personal
bests that came from fixtures. Presenting a fabricated rank is the worst thing this
product could do, because a rank looks like a measurement.

Making Stack 10 playable therefore needed two things at once: a real game, and a
score that means something. A score is only meaningful if the server, not the
browser, decides it. The browser is the attacker here — it owns the code, the clock
and the request — so "the client says it scored 420" is not evidence of anything.

Three ways to verify a run were considered and two rejected:

* **Trust the client, with plausibility checks.** Rejected outright: a claimed score
  with no way to reproduce it is a fabricated number with extra steps, and the
  checks (duration, rate of play) narrow the forged range rather than the trust.
* **Verify in Go, with the `service_role` key.** The games service would recompute
  the replay and write the score with a credential that bypasses every policy in the
  project. That key is a much larger thing to hand out than a function: it can read
  and write every table, including other people's rows, and it would be the first
  credential in the platform whose theft is a full compromise. It also splits the
  rules across two languages *and* leaves the ledger writable by the service rather
  than derived by the database.
* **Verify in the database.** The rules live beside the rows they score, in one
  `security definer` function; the caller's own token is the only credential needed;
  RLS and the column grants still decide everything else.

A fourth option — a Supabase Edge Function — was set aside as a third runtime to
deploy and monitor for no gain over a function the database can already run.

## Decision

**The rules are database code and the score is the database's arithmetic.**

* `public.start_game_session(slug, rules_version, client)` is the only way a session
  comes into existence. It picks the seed, pins the rules version and the expiry,
  reads the caller from `auth.uid()` — never from an argument — and refuses a game
  that is unpublished, unplayable, unknown or unverifiable with the same answer
  (`not_playable`), so nothing can be probed by slug.
* **Clients cannot write a session.** The `authenticated` INSERT grant and its policy
  are revoked by
  `supabase/migrations/20261013120000_play_sessions.sql`. A client-writable session
  row would let a client choose its own seed, and every "verified" score would then be
  verified against a deck the player stacked.
* `public.complete_stack10_run(session, actions, score, duration)` locks the session,
  replays the action list from the session's seed, derives the score, compares it with
  the claim, and only then closes the session and records it. Impossible sequences,
  expired sessions, abandoned sessions, foreign sessions, altered scores and partial
  runs are all refused, each with its own outcome.
* **A retry is a fingerprint, not a second score.** The submission's
  `md5(rules|seed|actions|score)` is stored on the session, so a repeated body is
  recognised as the run already recorded (`duplicate`) and anything else is refused
  (`closed`) rather than replacing it. A dropped connection is safe to repeat.
* **The service holds no master key.** `services/game-sessions` validates request
  shape, maps the verifier's outcome onto HTTP, and forwards the caller's own access
  token to the Data API. There is no `SUPABASE_SECRET_KEY` or `service_role` key in
  its configuration, and its handler cannot change a score it did not compute.
* **Plays are counted, not claimed.** `public.game_stats` exposes completed sessions
  as an aggregate (counts, not rows), and it is the only shape of `game_sessions` the
  public may see. One play is one *completed* session: an opened tab is not a play, a
  guest's finished run is, and a retry cannot add a second.
* **A guest run is real and unranked.** `scores.user_id` is `NOT NULL`, so a run with
  no verified identity is replayed and closed and cannot become a score row — and
  cannot later be claimed by a signed-in caller, because the completion function
  refuses to match an anonymous session to a signed-in one.
* **A rules change is a version, not an edit.** Sessions pin `stack-10@1`; the
  verifier implements the versions it knows and refuses the rest, so a changed
  ruleset cannot retroactively re-grade stored scores. The rules, the generator and
  the test vectors are documented in [docs/games](../games/README.md).

## Consequences

* **The rules exist in three places**: the SQL verifier (authority), the TypeScript
  engine the player actually plays, and the document. They are pinned by shared test
  vectors — seed 1's deck, the 14-tile run that scores 55, the perfect run that scores
  420 — which the SQL suite and the client suite both assert. Drift fails a test
  instead of producing a rejected run in production.
* **The client can be wrong without being dangerous.** If the TypeScript engine
  disagreed with the verifier, the run would be refused with `score_mismatch` and the
  replayed number returned. The failure mode is a lost run, never a wrong score.
* **The failure is at the point of use.** A browser calling the Data API directly with
  the publishable key gets exactly the verification the API's path gives, because the
  rules and the ledger share one boundary. There is no second, weaker door to the same
  score.
* **Score writes are impossible for clients** — `public.scores` has no INSERT grant for
  `authenticated` or `anon` — and a signed-in player can read only their own session
  rows.
* **The service boundary is smaller, and the deployment is unchanged.** `/api/v1/sessions`
  is served by the `games` deployment (Vercel's Go preset offers one remaining
  entrypoint, and a second container service at the same root was measured not to be
  detected — see [deployment/archive/vercel.md](../deployment/archive/vercel.md)). Two packages, one
  deployment, one binding.
* **Cost of reversing**: moving verification into Go means adding a master credential
  to the platform, granting the service write access to the ledger, and porting the
  replay — and it would still have to be the same rules, since stored scores were
  produced under them. The SQL functions would become dead code rather than the
  authority.
* **What is still not real**: ratings, comments, saves and average session time remain
  absent from every response, because no service records them. `plays` and the
  per-game leaderboard are the only activity the API reports, and both come from
  persisted, verified runs.
