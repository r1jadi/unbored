# tests/smoke

Scripts that exercise a **running** API. They are not part of the unit or database
suites: they need the whole path up — a gateway, the services behind it, and a
database with the migrations applied — and they change real data (they play real
runs, which are then real sessions and real scores).

## `stack10-smoke.mjs`

The Stack 10 play path, end to end: start a session, play a full run, submit it,
and check what the server did with it.

```bash
# Against a local stack (see docs/development/local-setup.md):
API_BASE=http://127.0.0.1:8090/api/v1 node tests/smoke/stack10-smoke.mjs

# Against production, after a deployment:
API_BASE=https://unbored.lol/api/v1 node tests/smoke/stack10-smoke.mjs

# As a signed-in player, which is what makes the run ranked:
API_BASE=... API_TOKEN=<supabase access token> node tests/smoke/stack10-smoke.mjs
```

It asserts, in order:

- a run is issued, with a seed, a rules version and sixty tiles;
- a legitimate run is **accepted**, and the score the server returns is the score
  the script computed — two independent implementations of the rules agreeing;
- a retry of the same run is recognised as a duplicate rather than scored again;
- a different run cannot replace a recorded one (`409`);
- a forged score is refused as a score mismatch (`422`), with the replay's own
  number;
- a partial run, a column off the board, an unplayable game and an unknown game are
  each refused, and an unplayable and unknown game are refused _identically_;
- a ranked run comes back with the player's rank and personal best, and the board
  then places them where they scored;
- a guest's run has no rank, no personal best and no standing on the board;
- the game reports its real play count, and an unplayed game has an empty board
  rather than a missing one.

The rules are reimplemented inside the script on purpose. A script that imported
the web app's engine could pass while that engine and the verifier disagreed; two
implementations reaching the same score is the evidence that matters. The vectors
both are pinned to are in [`docs/games`](../../docs/games/README.md).
