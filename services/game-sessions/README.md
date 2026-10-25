# services/game-sessions

Play sessions: the only way a run exists, and the only way a score does.

Two endpoints, and both are optional-auth. A guest plays; a signed-in player's run
can also become a ranked score.

| Route                                        | Auth     | What it does                                                                                                                             |
| -------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/sessions`                      | optional | Issues a run of a published, playable game. The server picks the id, the seed, the rules version and the expiry.                         |
| `POST /api/v1/sessions/{sessionID}/complete` | optional | Submits a finished run for verification. The score in the body is a **claim**: the database replays the run and records what it derives. |

`x-status` in [`packages/api-contracts/openapi-v1.yaml`](../../packages/api-contracts/openapi-v1.yaml)
is the authority for the shapes; the rules themselves are in
[`docs/games`](../../docs/games/README.md).

## The service verifies nothing, and that is the design

This is the least obvious thing about the service, so it is worth stating plainly.

The rules live in the database, in `public.complete_stack10_run`,
`public.complete_chain_run`, `public.complete_memory_flash_run`,
`public.complete_one_move_run`, `public.complete_color_merge_run` and
`public.complete_dont_touch_run`
([migration](../../supabase/migrations/20261013120000_play_sessions.sql),
[`20261014120000_chain_sessions.sql`](../../supabase/migrations/20261014120000_chain_sessions.sql),
[`20261020120000_memory_flash_sessions.sql`](../../supabase/migrations/20261020120000_memory_flash_sessions.sql),
[`20261021120000_one_move_sessions.sql`](../../supabase/migrations/20261021120000_one_move_sessions.sql)
and
[`20261022120000_color_merge_sessions.sql`](../../supabase/migrations/20261022120000_color_merge_sessions.sql)
and
[`20261023120000_dont_touch_sessions.sql`](../../supabase/migrations/20261023120000_dont_touch_sessions.sql)
and
[`20261024120000_seven_second_sessions.sql`](../../supabase/migrations/20261024120000_seven_second_sessions.sql)).
The pinned rules version selects which one replays a submission. Each function
replays the submitted action list from the session's seed, derives the
score, compares it with the claim, and only then closes the session and writes
the score row. This service:

- validates the request's _shape_ — a slug, a rules version, an action list within
  the board the rules version plays on (four positions for Stack 10, Chain and
  Color Merge's directions, sixteen cells for Memory Flash, twenty-five for One
  Move, sixty for Don't Touch the Black, three answer buttons for 7 Second,
  eighty-one cells for Queens' 9×9 board), a
  positive duration —
  so a malformed request is a `400` that names the field rather than a `500` from a
  function;
- calls the database **with the caller's own access token**, so `auth.uid()` inside
  those functions _is_ the caller and no body can name a user;
- maps the verifier's outcome onto HTTP and nothing else.

There is no `service_role` key, no `SUPABASE_SECRET_KEY`, and no code path that can
write a score. A handler that decided a score itself would need a credential that
bypasses every policy in the project; there is none to be wrong with. See
[ADR 0012](../../docs/decisions/0012-server-verified-scores.md).

## What each outcome means over HTTP

| Verifier outcome   | HTTP | Why                                                                                                                                                                                                          |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `recorded`         | 200  | Verified and saved.                                                                                                                                                                                          |
| `duplicate`        | 200  | The same run submitted again. The body carries `duplicate: true` and the recorded score: a retry is safe and scored nothing twice.                                                                           |
| `not_found`        | 404  | No such session, or somebody else's. Deliberately indistinguishable, so run ids cannot be probed for existence.                                                                                              |
| `expired`          | 409  | The session stopped being completable. Start a new run.                                                                                                                                                      |
| `abandoned`        | 409  | A newer run of the same game replaced it, so only the open one can be submitted.                                                                                                                             |
| `closed`           | 409  | Already recorded, and a _different_ submission may not replace it.                                                                                                                                           |     | `wrong_rules` | 409 | The session is pinned to a rules version this verifier does not implement. |
| `already_played`   | 409  | 7 Second only: another session of the same day's deck is already recorded, so this one cannot become a second score.                                                                                         |
| `invalid_actions`  | 422  | The sequence is not one the rules can produce — a position off the board, play after the run ended, or a run that stops early. 7 Second ends by its clock, so any answer line up to sixty is a complete run. |
| `invalid_duration` | 422  | The claim is longer than the session has existed.                                                                                                                                                            |
| `score_mismatch`   | 422  | The replay disagrees with the claimed score. The message reports the replayed score; nothing is recorded.                                                                                                    |
| anything else      | 500  | An outcome this service does not know is an unclear run state, and an unclear run is never reported as success.                                                                                              |

Starting a run has one outcome of its own: `already_played` answers `409`. A
signed-in player has already completed today's 7 Second deck, and the next one is
issued at midnight UTC. That is the game's daily rule, not a service failure; the
client renders it as "today's attempt is done" with a route to the board, and does
not offer a retry that could only fail again. Guests are not gated — their runs are
unranked, so practice cannot change a board.

## Guests, and what "unranked" means

`public.scores.user_id` is `NOT NULL`. A run with no verified identity is issued,
played, replayed and closed exactly like any other, and it has no score row to
become — because there is no user to attach one to. The completion function also
refuses to match an anonymous session to a signed-in caller, so a guest's run cannot
later be claimed as somebody's personal best.

The session response reports this as `ranked: false`, and the client shows it rather
than implying a board position.

## Deployment

Served by the **games deployment**, not a deployment of its own. Vercel's Go
framework preset recognises exactly three entrypoint names at a service root
(`main.go`, `cmd/api/main.go`, `cmd/server/main.go`); auth holds `cmd/server` and
users hold `cmd/api`, so [`services/main.go`](../main.go) mounts the catalogue and
these routes together. A second container service at the same root was measured not
to be detected at all — see [docs/deployment/vercel.md](../../docs/deployment/vercel.md).

The boundary is unchanged: separate packages, separate backends, separate route
sets, and a local binary of its own. The gateway reaches the group over the
`UPSTREAM_GAMES_URL` binding, and the public path stays
`https://unboredapp.vercel.app/api/v1/sessions`.

| Variable                            | Needed for                                                  |
| ----------------------------------- | ----------------------------------------------------------- |
| `SUPABASE_URL`                      | the Data API, and the JWKS the verifier derives from it     |
| `SUPABASE_PUBLISHABLE_KEY`          | identifying the project; RLS still decides what may be read |
| `SUPABASE_JWT_AUDIENCE` / `_ISSUER` | optional; derived when empty                                |

No service-only credential is required, and none is read: the caller's token is the
credential for both writes, and it is forwarded, never stored or logged.

Without `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` the service still boots, serves
its probes and answers `503` on both routes — a diagnosable state rather than a crash
loop.

## Running it locally

```bash
cd services
ENVIRONMENT=development \
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_PUBLISHABLE_KEY=<publishable key> \
go run ./game-sessions/cmd/game-sessions      # serves :8080 by default
```

The same service is also reachable from the combined deployment entrypoint
(`go run .`, which runs `services/main.go`), which is what production executes.

## Tests

```bash
cd services && go test ./game-sessions/...
```

The suite covers the request shapes the handlers refuse, the token each call is made
with (the caller's, and no master key), the mapping of every verifier outcome onto a
status and a code, and that a refusal never leaks an upstream message. What cannot be
tested without a database — that the replay refuses a forged run, that a retry does
not score twice, that a guest run stays unranked — is asserted in
[`tests/security/rls_test.sql`](../../tests/security/rls_test.sql), which runs the
real functions against a real Postgres in CI (`bash ./scripts/test-rls.sh`).
