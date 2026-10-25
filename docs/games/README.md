# Games

How Unbored's games work: the rules, who is allowed to decide a score, and how a
game earns the right to be called playable.

Ten games are implemented today: **Stack 10**, **Chain** (Don't Break the
Chain), **Memory Flash**, **One Move**, **Color Merge**, **Don't Touch the Black**,
**7 Second**, **Queens**, **Zip** and **8 Puzzle**. Nine of them — all but 7 Second
— are endless, with no final tile, round, pattern, board, slide or row. Every catalogue record is playable, and each one names the runtime that plays
it; the "no runtime yet" screen remains for any future entry that is published
before its runtime ships.


## Ending a run

Every game can be ended by the player, and ending a run **saves it**: the run is
submitted as it stands, verified like any other, and its score recorded. A run
has an End run control on its board, and the play screen's quit button asks to
end and save a live run rather than leaving without a score.

Every verifier accepts a run that stops while it is still live, because in every
game the score only grows: cutting a line short can never raise a score, only
stop the run earlier. Stack 10, Chain, Memory Flash, One Move and Color Merge
learned this in `supabase/migrations/20261107120000_end_run_saves_score.sql`
(their `@2` rules; the retired `@1` rules still require a complete run); the
other games accepted it from the start.

## Stack 10

Place the numbered tiles the game deals into four columns. A column that adds up to
**exactly ten** clears and scores. A column that goes **past ten** ends the run.
**There is no final tile**: the first sixty are the retired deck, and from there
the tiles arrive heavier and heavier until the board, not a deck, ends the run.

### The board

| Thing     | Value                                                                     |
| --------- | ------------------------------------------------------------------------- |
| Columns   | 4                                                                         |
| Tile face | 1–9                                                                       |
| Opening   | The retired sixty-tile deck, unchanged                                    |
| Run       | Endless in principle — no deck, no final tile                             |
| Limits    | 4096 tiles per submission; that is a request ceiling, not an ending        |
| Rules     | `stack-10@2` (endless); `stack-10@1` (the retired sixty-tile game)        |
| Runtime   | `stack-10` (the catalogue's `games.runtime` value)                        |

### The deck and the pressure ramp

The tiles are not random at play time: they are a function of the run's seed, which
the **server** chooses when it issues the session. The client must produce exactly
the same sequence or its submission is refused, so the generator is written out in
full rather than described:

```
state₀ = ((seed mod 2³²) + 2³²) mod 2³²        // the seed is a bigint, reduced to 32 bits
if state₀ = 0 then state₀ = 2654435769         // 0x9E3779B9: a zero state would be degenerate
stateₙ = (stateₙ₋₁ × 1664525 + 1013904223) mod 2³²
base(n)    = (stateₙ mod 9) + 1                // 1..9, the retired deck's draw
roll(n)    = (stateₙ >> 16) mod 100            // the promotion roll
percent(n) = 0                                 if n < 60
           = min(60, floor((n − 60) / 4))      otherwise
weight(n)  = 1 + floor(n / 240)                // no cap
tileₙ     = min(9, base(n) + weight(n))        if roll(n) < percent(n)
          = base(n)                            otherwise
```

`n` is the number of tiles already placed, so tile sixty-one is the first the ramp
can promote. The tile a move places depends only on `n`, never on which column it
goes into. That is why the board can show the next tile before the player chooses —
and why `tileAt(seed, n)` in the client is a pure function. The roll is read from
bits 16 and above, not the low bits, for the same reason the other games do: this
generator's low bits cycle with a period of two to the power of their width, so a
roll read from them would repeat whatever the seed.

### Difficulty

The ramp is two curves, both functions of the tile index alone, so every player
meets the same difficulty at the same point and the verifier does not simulate
anything to know how hard a board was.

**Promotion chance** — how often a draw arrives heavier:

| Tile | Chance |
| ---- | ------ |
| 1–60 | 0%     |
| 64   | 1%     |
| 100  | 10%    |
| 200  | 35%    |
| 240  | 45%    |
| 300+ | 60%    |

**Promoted weight** — what a promoted tile gains:

| Tile          | Weight |
| ------------- | ------ |
| 0–239         | +1     |
| 240–479       | +2     |
| 480–719       | +3     |
| …             | +1 every 240 tiles, no cap |

The chance ceiling is not where difficulty stops. Once most draws are promoted,
the weight keeps climbing, so the board keeps receiving the heaviest tiles it can
hold: a 1–9 face clamps at nine, and a board fed nines needs exact ones to clear.
The first sixty tiles are never promoted at all, so the opening of an endless run
is exactly the game that shipped — the former endpoint is where the pressure
begins, not where the run ends.

A run therefore ends by the player's own columns filling up, not by a counter:
there is no tile number at which the rules stop dealing.

The seed is a `bigint` column: the database's default draws from the full 2⁶³ range.
It therefore travels as a **decimal string** and is reduced with integer arithmetic on
both sides. Parsing it as a double would round it, draw a different deck, and reject
every honest run — see the test that pins this.

### A move

A move is a **column index, 0–3**. The game deals the next tile, the column's total
rises, and then exactly one of three things happens:

1. **The column totals exactly ten** → it clears: the tiles disappear, the column
   resets to zero, and the move scores.
2. **The column totals more than ten** → the run is over. The move is still part of
   the run and is still submitted; it is a legal move that loses, not an invalid one.
3. **Otherwise** the column keeps its tiles and the run continues.

### Scoring

A clear scores **10, plus 5 for every tile the column was stacked with beyond the
first**:

```
clear score = 10 + 5 × (tiles cleared − 1)
```

| Tiles in the clear | Score | Example                                            |
| ------------------ | ----- | -------------------------------------------------- |
| 1                  | 10    | unreachable with a 1–9 deck, and still spelled out |
| 2                  | 15    | `4+6`, `1+9`                                       |
| 3                  | 20    | `1+7+2`, `3+4+3`                                   |
| 4                  | 25    | `3+2+1+4`                                          |

Stacking is what scores: a column that clears in three is worth twice one that
clears in one, and it is also the riskier play, because the tiles sitting in it are
columns the player cannot use for the next tile.

Failing to place anything is impossible — a single tile is at most 9 — so every run
has at least one move.

### How a run ends

| Outcome | Reason     | When                                                                       |
| ------- | ---------- | -------------------------------------------------------------------------- |
| `over`  | `overflow` | A column passed ten. The only ending the game has.                         |
| `over`  | `limit`    | The 4096-tile submission bound was reached. A request ceiling, not a level. |

The old `cleared` outcome belongs to `stack-10@1` and is never produced under
`stack-10@2`: a run that places the retired deck's sixty tiles simply keeps
playing. The score already earned is kept, and every tile of the run must be
submitted: a submission that stops while the board can still take a tile is
refused, so a player cannot discard the move that ended their run.

### Verified scores

**The database decides the score.** The client's number is a claim that is compared,
never trusted — see
[ADR 0012](../decisions/0012-server-verified-scores.md) for why, and
`supabase/migrations/20261013120000_play_sessions.sql` for the code:

- `public.start_game_session(slug, rules, client)` issues the run: it picks the seed,
  fixes the rules version and the expiry, and reads the caller's identity from their
  token — never from an argument. It refuses an unpublished, unplayable or
  unknown game identically (`not_playable`).
- `public.complete_stack10_run(session, actions, score, duration)` replays the action
  list from the session's seed under the version the session pinned — `stack-10@1`
  with its sixty-tile deck, or `stack-10@2` with the pressure ramp — derives the
  score, compares it with the claim, and only then closes the session and records
  it. `stack10_rules_version()`, `stack10_pressure_percent(n)`,
  `stack10_heavy_bonus(n)` and `stack10_max_tiles()` are the ramp as data, so the
  client, the verifier and this document can be compared without replaying a game.
- A submission carries at most 4096 tiles (`stack10_max_tiles()`). That bound caps
  a request, not a run.
- Only a finished board can be submitted under `stack-10@2`. A short submission is
  `invalid_actions`, not a partial run: without a deck there is nothing that makes
  a prefix of a run complete.

Outcomes the API maps onto HTTP:

| Verifier outcome                      | HTTP | What it means to the player                                                   |
| ------------------------------------- | ---- | ----------------------------------------------------------------------------- |
| `recorded`                            | 200  | Verified and saved.                                                           |
| `duplicate`                           | 200  | The same run, submitted again — a retry. Safe, and it never scores twice.     |
| `not_found`                           | 404  | No such run, or somebody else's — deliberately the same answer.               |
| `expired`, `abandoned`, `closed`      | 409  | The run can no longer be submitted; start a new one.                          |
| `wrong_rules`                         | 409  | The session was pinned to rules this server does not implement.               |
| `invalid_actions`, `invalid_duration` | 422  | The sequence is not one the rules can produce.                                |
| `score_mismatch`                      | 422  | The replay disagrees with the claimed score. The replayed number is returned. |

A guest can play. Their run is verified and closed exactly like a signed-in
player's, and it is never ranked: `scores.user_id` is `NOT NULL`, so there is no row
for it to become. The same run cannot later be claimed by a signed-in caller.

### Test vectors

Five vectors pin the rules to the database's own arithmetic; each is asserted by
both the SQL suite and the client engine, so if either side drifts one of the two
fails.

1. **Seed 1's deck** — `1, 7, 9, 2, 2, 5, 4, 6, 7, 8, 3, 4, 3, 5, …`
2. **Seed 1, the greedy line** `0,0,1,0,0,0,2,2,2,3,0,0,0,0` — 14 tiles, three clears
   (`1+7+2` = 20, `4+6` = 15, `3+4+3` = 20), **55 points**, and a run that ends when
   the fourteenth tile (a 5) takes a column holding 7 to 12.
3. **Seed 1, the retired deck** — the same sixty tiles, for **420 points**:
   twenty-five clears, none deeper than three tiles, and one tile left on the board.
   It was the perfect `stack-10@1` run. Under `stack-10@2` the same line leaves the
   run **open at sixty tiles**, with a 9 as the next tile: there is no final tile to
   reach, and a submission that stops there is refused as partial. Under the legacy
   version the database still ends it as `cleared`, which is how the two rulesets are
   compared.
4. **Seed 1, past the old ending** — the retired deck plus `0,2,3,0,1,0,1`: 67 tiles,
   one more clear worth 15, **435 points**, ending on the game's own ending — a
   column past ten. The client engine and the SQL suite both replay this line, and
   the SQL suite submits it.
5. **Seed 1, one tile past the deck** — the retired line plus a single move on
   column two: 61 tiles, **420 points**, ended by that tile overflowing the column.
   It is recorded, which is the proof that the sixty-tile deck no longer ends
   anything: the shortest run past the old endpoint is a real, verifiable run.

6. **The ramp** — promotion chance is 0% for
the first sixty tiles, 1% at tile 64, 10% at 100, 35% at 200 and 60% from 300 on,
while the weight of a promoted tile is +1 for the first 240 tiles, +2 from 240, +3
from 480 and so on without cap. The client and the SQL helpers are asserted against
the same table.

7. **A full-width seed** — `9223372036854775807` deals `6, 2, 9, 4, 5, 3, 6, 1, …`,
which is what catches a client that rounded the seed to a double.

### Changing the rules

The rules version is data, not a comment. A session pins the version it was issued
under, and the verifier only replays versions it implements, so:

1. add a new rules version string (`stack-10@3`),
2. add the new verifier function rather than editing `complete_stack10_run`,
3. update the client engine, the vectors above and this document,
4. sessions pinned to `stack-10@1` or `stack-10@2` keep being verified by the branch
   that implements them.

That is how the endless game shipped: `20261029120000_endless_stack10.sql` added
`stack-10@2` and its ramp, and left `stack-10@1` exactly as it was, so every open
session and every stored score from the sixty-tile game still replays to the number
it was graded with. Editing `stack-10@1` in place would instead have silently
re-graded all of them.

## Chain

Watch the flashing sequence, then tap the pads back in the same order. Each round
shows one symbol more than the last; a wrong tap breaks the chain and ends the run.
**There is no final round**: the sequence is infinite, so a run lasts as long as the
player's memory does.

### The board

| Thing   | Value                                                       |
| ------- | ----------------------------------------------------------- |
| Pads    | 4                                                           |
| Rounds  | Endless — no final round, no complete run                   |
| Taps    | Unbounded; the score is the correct taps a run earned       |
| Rules   | `chain@2` (endless); `chain@1` (the retired ten-round game) |
| Runtime | `chain` (the catalogue's `games.runtime` value)             |

### Difficulty

Difficulty is a function of the round alone, so it is deterministic and identical
for every player at the same point:

| Round | Step lit | Gap between steps |
| ----- | -------- | ----------------- |
| 1     | 440 ms   | 200 ms            |
| 2     | 422 ms   | 190 ms            |
| 10    | 278 ms   | 110 ms            |
| 13    | 224 ms   | 100 ms            |
| 14+   | 220 ms   | 100 ms            |

Both values fall linearly — by 18 ms and 10 ms per round — and then hold at their
floor: a step shorter than 220 ms stops being readable, so tightening further would
make a round unfair rather than harder. The floors are not the end of progression.
Round r always shows r symbols, so the sequence keeps growing by one tap a round for
as long as the run lasts; once the beat reaches its floor, memory is the whole of the
difficulty. The client's `chainTempo(round)` is the same curve the board's timers
use, and `chain.test.ts` pins both the curve and its floors.

### The sequence

The symbols are not random at play time: they are a function of the run's seed, which
the **server** chooses when it issues the session. The client must reproduce exactly
the same sequence or its submission is refused, so the generator is written out in
full rather than described:

```
state₀ = ((seed mod 2³²) + 2³²) mod 2³²        // the seed is a bigint, reduced to 32 bits
if state₀ = 0 then state₀ = 2654435769         // 0x9E3779B9: a zero state would be degenerate
stateₙ = (stateₙ₋₁ × 1664525 + 1013904223) mod 2³²
symbolₙ = (stateₙ >> 16) mod 4                 // 0..3
```

The state progression is the same LCG Stack 10's deck uses; only the digit read out
of each state differs, and deliberately so: the low two bits of this generator
advance by a constant, so reading them would deal every seed one of four rotations
of the same pattern (`0,3,2,1,…`) and round five would teach nothing round one had
not. The higher bits have the full period, so each seed deals its own sequence — and
because the generator is infinite, so is the sequence.

The seed travels as a **decimal string** for the same reason Stack 10's does: it is a
`bigint` column, and parsing it as a double would round it, deal a different
sequence, and reject every honest run.

### A move

A move is a **pad index, 0–3**. Round r shows the run's first r symbols, and the
player taps r pads — so a tap is checked against the symbol at its position _within
its round_, not at its absolute position: the third tap of round three must equal the
sequence's third symbol, the way the verifier replays it. Exactly one of two things
happens:

1. **The tap matches** → the run continues. Completing a round clears it and starts
   the next round, one symbol longer.
2. **The tap does not match** → the chain is broken and the run is over. The losing
   tap is still part of the run and is still submitted; it is a legal tap that
   loses, not an invalid one.

### Scoring

A correct tap scores **1 point**. The score of a run is its correct taps, and there
is no perfect score: 78 for a run that reproduces twelve rounds and then breaks the
chain, 3 for a run that reproduces rounds one and two and then breaks it. Failing to
tap anything is impossible — round one is a single pad — so every run has at least
one move.

### How a run ends

| Outcome | When                                                                      |
| ------- | ------------------------------------------------------------------------- |
| `over`  | A tap broke the chain. The only ending; the score is how far the run got. |

The old `cleared` outcome belongs to `chain@1` and is never produced under
`chain@2`: a run that reproduced all ten old rounds is simply a run that reached
round eleven.

The score already earned is kept. Every tap of the run must be submitted, losing tap
included: a submission that stops early is refused, so a player cannot discard the
tap that broke their chain. Because an endless run has no complete length, a
submission that never lost is refused as partial — the losing tap is what tells the
verifier the run ended.

### Verified scores

**The database decides the score**, under the same rules as Stack 10: see
`supabase/migrations/20261026130000_endless_chain.sql` for the endless branch and
`supabase/migrations/20261014120000_chain_sessions.sql` for the original.

- `public.start_game_session(slug, rules, client)` issues the run with the seed, the
  pinned version and the expiry. Its gate accepts (`stack-10`, `stack-10@1`) or
  (`chain`, `chain@1` or `chain@2`). A `chain@2` session's `tile_count` is 4096: the
  most taps one submission may carry, not a complete-run length, because an endless
  run has no complete length. A legacy `chain@1` session still reports 55. A
  `chain@2` session lives twelve hours instead of two, so a marathon is not cut off
  by the session clock.
- `public.complete_chain_run(session, actions, score, duration)` picks its branch
  from the pinned version. Both replay the same generator and score one point per
  correct tap; `chain@1` draws the ten symbols up front and accepts the 55-tap clear,
  while `chain@2` draws each round's symbols as the replay reaches it and requires
  the run to end with a losing tap. The 4096-tap bound is a request ceiling, not a
  level: it is far past any run a session could still be open for. Its outcome
  vocabulary (`recorded`, `duplicate`, `score_mismatch`, …) and its ledger behaviour
  are identical to Stack 10's, and the Go service maps them onto HTTP the same way —
  routing at the verifier the pinned rules version names.

A guest can play. Their run is verified and closed exactly like a signed-in
player's, and it is never ranked.

### Test vectors

Five vectors pin the rules to the database's own arithmetic. Each is asserted by the
client engine, and every vector that produces a score is also replayed against the
real verifier in `tests/security/rls_test.sql`; if either side drifts, one of the two
suites fails.

1. **Seed 1's sequence** — `0, 0, 2, 3, 0, 0, 2, 2, 0, 1, 1, 0`
2. **Seed 1, the retired ten-round line** — round 1 `[0]`, round 2 `[0,0]`, …, round
   10 the first ten symbols: 55 taps, ten clears, **55 points**. Still accepted by
   `chain@1`; under `chain@2` it is refused as a partial endless run, because it
   never loses.
3. **Seed 1, twelve rounds and a loss** — the same line continued through rounds
   eleven and twelve, then one wrong pad: 78 correct taps, twelve clears, **78
   points**, 79 taps submitted. Asserted in
   [`tests/security/rls_test.sql`](../../tests/security/rls_test.sql) and in
   [`src/lib/games/chain.test.ts`](../../src/lib/games/chain.test.ts).
4. **Seed 1, the broken chain** — `0, 0, 0, 1`: rounds one and two reproduced, then
   the wrong tap. **3 points**, 4 taps placed, 2 rounds cleared. Asserted in both
   suites.
5. **A full-width seed** — `9223372036854775807` deals `1, 3, 3, 3, 1, 0, 1, 0, …`,
   which is what catches a client that rounded the seed to a double.

## Memory Flash

Watch the pattern light, then tap the same cells back **in any order**. Each round
shows one cell more than the last; a tap outside the pattern — or a second tap on a
cell already lit — ends the run. There is no final pattern.

### The board

| Thing   | Value                                                        |
| ------- | ------------------------------------------------------------ |
| Board   | 4×4, growing by a row and a column every eight rounds        |
| Rounds  | none — the pattern grows by one cell until the run ends      |
| Taps    | 4096 at most in one submission: a request bound, not a level |
| Rules   | `memory-flash@2`                                             |
| Runtime | `memory-flash` (the catalogue's `games.runtime` value)       |

The retired game — `memory-flash@1`, still verified for sessions opened under it —
was ten patterns on a fixed 4×4 board, fifty-five taps and a `cleared` ending.
Everything else about it is the game that still runs; only the ending was artificial.

### The patterns

The cells are not random at play time: they are a function of the run's seed, which
the **server** chooses when it issues the session. The client must produce exactly
the same patterns or its submission is refused, so the generator is written out in
full rather than described:

```
side(r) = 4 + floor((r - 1) / 8)               // 4 for rounds 1–8, 5 for 9–16, …
state₀ = ((seed mod 2³²) + 2³²) mod 2³²        // the seed is a bigint, reduced to 32 bits
if state₀ = 0 then state₀ = 2654435769         // 0x9E3779B9: a zero state would be degenerate
stateₙ = (stateₙ₋₁ × 1664525 + 1013904223) mod 2³²
cellₙ  = (stateₙ >> 16) mod side(r)²           // 0 .. side(r)²-1
```

Round `r` lights exactly `r` **distinct** cells: the generator is advanced until
`r` cells the round does not already hold have been drawn, and the rejection is
part of the rules rather than a drawing detail. The state carries across rounds —
round two starts drawing where round one stopped — so the patterns are one
sequence, not independent draws.

The board a round is played on is part of the rules, because it is part of the
draw: the same state is reduced modulo sixteen on a 4×4 board and modulo
twenty-five on a 5×5 one. Rounds 1–8 are therefore the patterns the retired game
showed, cell for cell, and round nine is where an endless run parts company with
it. `side(r)² ≥ r` holds at every round, so a pattern always fits the board it is
drawn for.

The state progression is the same LCG Stack 10's deck uses; only the digit read out
of each state differs. Cells are read from bits 16 and above, deliberately not from
the low bits: this LCG's low bits advance with a period of two to the power of
their width, so `state % cells` would flash a slice of one repeated cycle and a
later round would teach nothing an earlier one had not. Bits 16+ have the full
period, so each seed flashes its own patterns.

The seed travels as a **decimal string** for the same reason Stack 10's does: it is
a `bigint` column, and parsing it as a double would round it, flash different
patterns, and reject every honest run.

### Difficulty

Three levers, each a function of the round, so every player meets the same
challenge at the same point and none of them runs out:

| Lever   | Progression                                                           |
| ------- | --------------------------------------------------------------------- |
| Cells   | Round `r` lights `r` cells — one more than the round before, for ever |
| Board   | A row and a column every eight rounds: 4×4, 5×5, 6×6, …, for ever     |
| Flash   | 700 ms at round one, 12 ms less each round, floor 400 ms              |
| Lead-in | 250 ms before the flash, 5 ms less each round, floor 120 ms           |

The pattern never stops growing, which is the lever that keeps climbing after the
flash reaches its floor; the board growing is what keeps a longer pattern possible
rather than repeating cells. Neither floor is an ending: at round twenty-six the
pattern is still one cell longer than round twenty-five's, and the board still
follows it.

### A move

A move is a **cell index on the current round's board**: 0–15 on the 4×4 board,
0–24 on the 5×5 board. Round `r` has `r` cells lit, and a tap is correct when it
is one of those cells that has not been entered yet. The order does not matter —
the pattern is a set — but a tap outside the set, or a repeat, is a mistake:

1. **A cell in the pattern, not yet entered** → it stays lit, and the round
   continues. Entering the last cell clears the round.
2. **A cell outside the pattern, or one already entered** → the run is over. The
   tap is still part of the run and is still submitted; it is a legal tap that
   loses, not an invalid one.
3. **A cell that does not exist on the round's board** → the submission is
   impossible and is refused. The board only offers cells it has, so this is a
   claim no honest client can make.

### Scoring

A cleared pattern scores **10 points**. A pattern is all-or-nothing: a round with
four of its five cells entered and then a mistake scores nothing for that round.
There is no maximum score, because there is no last round; the score is ten times
the number of patterns cleared.

### How a run ends

| Outcome        | When                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| `over`         | A tap was outside the pattern or repeated a lit cell. The ordinary ending. |
| `over` (bound) | The submission reached 4096 taps. A request bound, not a final round.      |

`cleared` does not exist under `memory-flash@2`: a run that rebuilt every pattern
it was shown has not finished, it has merely reached the end of its submission.

The score already earned is kept. Every tap of the run must be submitted, losing
tap included: a submission that stops early is refused, so a player cannot discard
the tap that broke their pattern. Tapping nothing is impossible — round one is a
single cell — so every run has at least one move.

### Verified scores

**The database decides the score**, under the same rules as the other verifiers: see
`supabase/migrations/20261030120000_endless_memory_flash.sql` for the code, and
`20261020120000_memory_flash_sessions.sql` for the game before it.

- `public.memory_flash_endless_pattern(seed, round)` draws one round's pattern on
  that round's board, and `public.memory_flash_side(round)` /
  `public.memory_flash_cells_at(round)` are the board it is drawn on. They are
  internals: execute is not granted to a client, because a player already holds the
  seed their own board draws from, and the verifier is the only caller.
- `public.start_game_session(slug, rules, client)` issues the run with the seed, the
  pinned version and the expiry. Its gate is a pair per runtime — for Memory Flash,
  (`memory-flash`, `memory-flash@1` or `memory-flash@2`) — and anything else is
  `unsupported_runtime`. A `memory-flash@2` session's `tile_count` is 4096: the
  field counts the moves a complete run holds, and an endless run has no complete
  length.
- `public.complete_memory_flash_run(session, actions, score, duration)` replays the
  tap list pattern by pattern, derives the score, compares it with the claim, and
  only then closes the session and records it. The session's pinned version chooses
  the branch: `memory-flash@1` replays ten patterns on the 4×4 board and can still
  end `cleared`, while `memory-flash@2` grows the board and has no last pattern. Its
  outcome vocabulary (`recorded`, `duplicate`, `score_mismatch`, …) and its ledger
  behaviour are identical to the other verifiers, and the Go service maps them onto
  HTTP the same way — routing at the verifier the pinned rules version names and
  accepting cell indexes up to 224, the 15×15 board the submission bound can reach.
- An endless session lives twelve hours rather than two: a marathon should end when
  the board ends it, not when the clock does.

A guest can play. Their run is verified and closed exactly like a signed-in
player's, and it is never ranked.

### Test vectors

Each vector is asserted by both the SQL suite and the client engine; if either side
drifts, one of the two suites fails.

1. **Seed 1's rounds one to eight** — `[8]`, `[8,6]`, `[3,0,8]`, `[6,2,8,5]`,
   `[13,0,7,1,8]`, `[3,14,15,13,7,2]`, `[15,2,11,14,8,10,0]`,
   `[11,2,1,10,5,12,3,13]`. These are the retired game's patterns exactly, which is
   what proves an endless run opens with the game that shipped.
2. **Seed 1's rounds nine to twelve** — `[22,15,5,18,6,21,4,11,7]`,
   `[4,3,20,22,6,13,19,10,5,16]`, `[3,16,6,12,22,0,21,8,4,2,15]`,
   `[19,3,23,15,24,21,6,7,11,17,9,22]`. Drawn modulo twenty-five on the 5×5 board:
   cell 22 does not exist on the retired board, which is why these are the proof the
   board grows.
3. **Seed 1, the endless line** — all twelve patterns in order, 78 taps: twelve
   cleared rounds, **120 points**, round thirteen dealt, still `playing`. This passes
   the retired game's tenth pattern and its fifty-fifth tap. Asserted in
   [`tests/security/rls_test.sql`](../../tests/security/rls_test.sql) and in
   [`src/lib/games/memory-flash.test.ts`](../../src/lib/games/memory-flash.test.ts).
4. **Seed 1, the broken pattern** — `8, 0`: round one rebuilt, then a cell round
   two does not light. **10 points**, 2 taps placed, 1 round cleared. Asserted in
   both suites.
5. **A full-width seed** — `9223372036854775807` flashes `[5]`, `[7,3]`,
   `[15,5,4]`, `[5,0,2,11]`, … which is what catches a client that rounded the seed
   to a double.

## One Move

Every board is a checkerboard with exactly one move already made. Find the cell
that restores it; any other tap ends the run. **There is no final board**: every
four boards the grid grows by a row and a column, and the space to search keeps
growing with it.

### The board

| Thing   | Value                                                          |
| ------- | -------------------------------------------------------------- |
| Board   | 3×3, growing by a row and a column every four levels           |
| Levels  | none — the grid keeps growing until the run ends               |
| Taps    | 4096 at most in one submission: a request bound, not a level   |
| Rules   | `one-move@2`                                                   |
| Runtime | `one-move` (the catalogue's `games.runtime` value)             |

The retired game — `one-move@1`, still verified for sessions opened under it — was
twelve boards on 3×3, 4×4 and 5×5 grids, twelve taps and a `cleared` ending.
Everything else about it is the game that still runs; only the ending was
artificial.

### The boards

The winning cells are not random at play time: they are a function of the run's
seed, which the **server** chooses when it issues the session. The client must
produce exactly the same cells or its submission is refused, so the generator is
written out in full rather than described:

```
side(n) = 3 + floor((n - 1) / 4)               // 3 for levels 1–4, 4 for 5–8, …
state₀ = ((seed mod 2³²) + 2³²) mod 2³²        // the seed is a bigint, reduced to 32 bits
if state₀ = 0 then state₀ = 2654435769         // 0x9E3779B9: a zero state would be degenerate
stateₙ = (stateₙ₋₁ × 1664525 + 1013904223) mod 2³²
centerₙ = (stateₙ >> 16) mod side(n)²          // the winning cell of board n
```

The state advances once per board, so board two draws from the second state and
not the first. Cells are read from bits 16 and above rather than the low bits for
the same reason Memory Flash reads them there: this LCG's low bits cycle with a
period of two to the power of the bit width. The cell count changes with the
board, so the value is reduced modulo the current board's cells, not modulo 16.

The board a level is played on is part of the rules, because it is part of the
draw: the same state is reduced modulo twenty-five on a 5×5 board and modulo
thirty-six on a 6×6 one. Levels 1–12 are therefore the retired game's boards, cell
for cell, and level 13 is where an endless run parts company with it.

The seed travels as a **decimal string** for the same reason Stack 10's does: it
is a `bigint` column, and parsing it as a double would win on different cells and
reject every honest run.

A **solved board is a checkerboard**: a cell is dark when `row + col` is even.
Board `n` is that solved board with one cross flipped, where the cross of cell `c`
is `c` itself plus the cells above, below, left and right that exist — three cells
at a corner, four at an edge, five in the middle. The winning cell is the centre of
that cross.

It is the board's **only** winning move. Tapping another cell flips a different
cross, and two different crosses are different sets, so their symmetric difference
is non-empty and the board cannot come back solved. Both engine copies derive the
same cell, and both the winning-cell vector and the uniqueness property are tested.

### Difficulty

One lever, a function of the level, and it never stops:

| Level | Board | Cells to search |
| ----- | ----- | --------------- |
| 1–4   | 3×3   | 9               |
| 5–8   | 4×4   | 16              |
| 9–12  | 5×5   | 25              |
| 13–16 | 6×6   | 36              |
| 17–20 | 7×7   | 49              |
| 21–24 | 8×8   | 64              |
| …     | …     | the next square |

The question never changes — exactly one cell restores the checkerboard — while
the space to search grows quadratically. That is what keeps the curve rising after
the retired game stopped: there is no level at which the board stops growing. The
client keeps the cells at a tappable size and lets the board scroll past 12×12
rather than shrinking the targets; growth is not capped to fit a phone.

### A move

A move is a **cell index on the current board**. Exactly one of two things happens:

1. **The cell is the board's winning cell** → the checkerboard is restored, the
   board scores ten points, and the next board is drawn — one row and one column
   larger every four levels, and never the last one.
2. **Any other cell** → the run is over. The tap is still part of the run and is
   still submitted; it is a legal move that loses, not an invalid one.

A cell that does not exist on the current board is not a move at all: the
submission is impossible and is refused. The board only offers cells it has, so
this is a claim no honest client can make.

### Scoring

Each restored board scores **10 points**. A board is all-or-nothing: the wrong tap
that ends a run scores nothing for that board. There is no maximum score, because
there is no last board; the score is ten times the number of boards restored.

### How a run ends

| Outcome        | When                                                                  |
| -------------- | --------------------------------------------------------------------- |
| `over`         | A tap was not the board's winning cell. The ordinary ending.          |
| `over` (bound) | The submission reached 4096 taps. A request bound, not a final board. |

`cleared` does not exist under `one-move@2`: a run that restored every board it
was shown has not finished, it has merely reached the end of its submission.

The score already earned is kept. Every tap of the run must be submitted, losing
tap included: a submission that stops early is refused, so a player cannot discard
the tap that ended their run. Tapping nothing is impossible — board one has a
winning cell — so every run has at least one move.

### Verified scores

**The database decides the score**, under the same rules as the other verifiers:
see `supabase/migrations/20261031120000_endless_one_move.sql` for the code, and
`20261021120000_one_move_sessions.sql` for the game before it.

- `public.one_move_endless_center(seed, level)` draws one board's winning cell on
  that level's board, and `public.one_move_side(level)` /
  `public.one_move_cells_at(level)` are the board it is drawn on. They are
  internals: execute is not granted to a client, because a player already holds
  the seed their own boards draw from, and the verifier is the only caller. The
  retired `one_move_center` still draws the twelve-board game's cells.
- `public.start_game_session(slug, rules, client)` issues the run with the seed, the
  pinned version and the expiry. Its gate is a pair per runtime — for One Move,
  (`one-move`, `one-move@1` or `one-move@2`) — and anything else is
  `unsupported_runtime`. A `one-move@2` session's `tile_count` is 4096: the field
  counts the moves a complete run holds, and an endless run has no complete length.
- `public.complete_one_move_run(session, actions, score, duration)` replays the tap
  list board by board, derives the score, compares it with the claim, and only then
  closes the session and records it. The session's pinned version chooses the
  branch: `one-move@1` replays twelve boards up to 5×5 and can still end `cleared`,
  while `one-move@2` grows the board and has no last one. Its outcome vocabulary
  (`recorded`, `duplicate`, `score_mismatch`, …) and its ledger behaviour are
  identical to the other verifiers, and the Go service maps them onto HTTP the same
  way — routing at the verifier the pinned rules version names and accepting cell
  indexes up to 1,052,675, the 1026×1026 board the submission bound can reach.
- An endless session lives twelve hours rather than two: a long run should end when
  its board ends it, not when the clock does.

A guest can play. Their run is verified and closed exactly like a signed-in
player's, and it is never ranked.

### Test vectors

Each vector is asserted by both the SQL suite and the client engine; if either side
drifts, one of the two suites fails.

1. **Seed 1's levels one to twelve** — `7, 8, 7, 7, 0, 8, 6, 2, 5, 18, 13, 5`.
   These are the retired game's winning cells exactly, which is what proves an
   endless run opens with the game that shipped.
2. **Seed 1's levels thirteen to twenty** — `11, 21, 33, 20` on the first 6×6
   board, then `20, 9, 47, 39` on the first 7×7 board. Cells 33, 47 and 39 do not
   exist on the retired 5×5 maximum, which is why these are the proof the board
   grows.
3. **Seed 1, the endless line** — those twenty cells in order, then cell `0` on
   board twenty-one: twenty restored boards, **200 points**, twenty-one taps. This
   passes the retired game's twelfth board and its twelfth tap. Asserted in
   [`tests/security/rls_test.sql`](../../tests/security/rls_test.sql) and in
   [`src/lib/games/one-move.test.ts`](../../src/lib/games/one-move.test.ts).
4. **Seed 1, the retired perfect line** — the first twelve cells: twelve restored
   boards, **120 points**, and the `one-move@1` verifier still records it.
5. **Seed 1, the missed move** — `7, 0`: board one restored, then a tap that is not
   board two's winning cell. **10 points**, 2 taps placed, 1 board restored.
   Asserted in both suites.
6. **A full-width seed** — `9223372036854775807` wins on
   `1, 8, 6, 6, 5, 4, 5, 0, 24, 13, 3, 7, 20, 0, 2, 20, 35, 25, 13, 32`, which is
   what catches a client that rounded the seed to a double.

## Queens

LinkedIn's Queens puzzle as an endless run. Every board is an N×N grid split into
N coloured regions: place exactly one Queen in each row, each column and each
region, with no two Queens touching — not even diagonally. Every board has exactly
one solution. Solve it and the next one is dealt; **there is no final board**.

### The board

| Thing    | Value                                                              |
| -------- | ------------------------------------------------------------------ |
| Board    | 5×5, growing to 9×9 by level eleven, then 9×9 for every board      |
| Levels   | none — boards keep coming until the run ends                       |
| Mistakes | 3 per run: the third Queen placed off the solution ends the run    |
| Taps     | 8192 at most in one submission: a request bound, not a level       |
| Rules    | `queens@1`                                                         |
| Runtime  | `queens` (the catalogue's `games.runtime` value)                   |

### How the real game works, and what this one keeps

LinkedIn's daily Queens is the "one star" variant of Star Battle. Its rules are
the ones above; a tap cycles a cell through an X (a note), a Queen and empty;
clashing Queens are highlighted rather than refused; and there is an optional
automatic X that fills in the cells a Queen rules out. Its boards are mostly 7×7
to 10×10, hand-checked to have one solution that can be reached by deduction.

Unbored keeps the rules, the tap cycle and the automatic X — shown as faint Xs,
a display aid rather than state, so it changes no tap. It changes one thing: a
Queen placed off the solution is a **mistake**, not a clash to fix later. A daily
puzzle can let a player shuffle Queens freely because nothing is ranked; an
endless, ranked run needs a way to end and a skill a replay can measure, and a
wrong Queen is both. With a unique solution, "off the solution" and "breaks the
rules eventually" are the same thing, so the mistake rule only makes the board say
so at once. Because a wrong Queen is refused, two Queens on the board can never
clash, which is why there is no clash highlight.

### The boards

A board is drawn in two steps from one random stream, both functions of the
run's seed, which the **server** chooses:

1. **The solution** — a placement of N Queens, one per row and column, none
   touching. This is what the verifier needs, so it is written out in full:

   ```
   side(n) = 5, 6, 6, 7, 7, 7, 8, 8, 8, 8, then 9      // levels 1, 2–3, 4–6, 7–10, 11+
   state₀ = ((seed mod 2³²) + 2³²) mod 2³²            // the seed is a bigint, reduced to 32 bits
   if state₀ = 0 then state₀ = 2654435769             // 0x9E3779B9: a zero state would be degenerate
   stateₙ = (stateₙ₋₁ × 1664525 + 1013904223) mod 2³²  // advanced once per level
   t = stateₙ                                         // board n's inner stream starts here
   draw() = t ← (t × 22695477 + 1) mod 2³²; t >> 16   // a second LCG, high sixteen bits
   repeat:
     columns = [0, 1, …, side − 1]
     for i = side − 1 down to 1: swap columns[i], columns[draw() mod (i + 1)]
   until no two neighbouring rows' columns differ by less than 2
   ```

   The outer LCG and its seed handling are One Move's. A board draws from a
   second LCG started at the outer state, because drawing from the outer sequence
   itself would walk into the next board's starting state, and two neighbouring
   boards would share their draws. About one shuffle in eight passes, at every
   size.

2. **The regions** — grown outwards from the solution's Queens, region _r_ holding
   row _r_'s Queen. Each step picks a random unassigned cell that touches a region
   (in board order, `draw() mod count`) and joins it to one of the regions it
   touches. Large regions touch more cells, so they grow faster and leave a mix of
   large and small regions, the way a hand-made board does. A fresh layout usually
   has several solutions, so the generator **repairs** it: a row-by-row solver
   finds another solution, the generator takes a cell where that solution has a
   Queen the planted one does not, and hands the cell to a neighbouring region
   (keeping its old region connected). That solution now has two Queens in one
   region and is gone; the planted solution is untouched, because none of its
   Queens moved. The loop ends when the solver finds exactly one solution, and a
   layout that runs out of repairs is regrown. Growth plus repair produces a
   unique 9×9 board in a few milliseconds on average; a fallback that is always
   unique (every Queen but the last alone in its region) exists so the generator
   is total, and has never been needed.

Only the client grows regions. The verifier needs only the solution: a Queen is
right exactly when it sits on it, and no region a client could draw changes which
Queens are mistakes. That keeps the database's copy to a shuffle.

The seed travels as a **decimal string**, as every game's does.

### Difficulty

| Level | Board | Points for solving it |
| ----- | ----- | --------------------- |
| 1     | 5×5   | 50                    |
| 2–3   | 6×6   | 60                    |
| 4–6   | 7×7   | 70                    |
| 7–10  | 8×8   | 80                    |
| 11+   | 9×9   | 90                    |

The board stops growing at 9×9. Past that, growing and repairing a unique board
takes long enough to stall a phone (10×10 averaged about 90 ms and peaked near two
seconds in testing), and the real game's boards sit in the same range. From level
eleven on the difficulty comes from the layouts, which differ every board.

### A move

A move is a **cell index on the current board**. The cell cycles:

1. **Empty → X.** A note. Free.
2. **X → Queen.** If the cell is on the solution, the Queen stays. If not, it is a
   **mistake**: the cell is ruled out and locked, and the third mistake of the run
   ends it.
3. **Queen → empty.**

The board's last Queen solves it: it scores ten points a row and the next board is
dealt, empty. Mistakes carry from board to board. A tap on a ruled-out cell, a cell
off the board, or a tap after the run ended is not a move: the submission is
impossible and is refused.

### Scoring

Each solved board scores **ten points per row** — 50 for a 5×5 board, 90 for a
9×9. Larger boards take far longer, and the score says so; within a size, every
board is worth the same. An unsolved board scores nothing, and there is no maximum.

### How a run ends

| Outcome        | When                                                                  |
| -------------- | --------------------------------------------------------------------- |
| `over`         | The third mistake.                                                    |
| `over` (ended) | The player pressed End run. The score so far is kept.                 |
| `over` (bound) | The submission reached 8192 taps.                                     |

Ending a run is always allowed, and the verifier therefore accepts **any prefix
of a legal line**. That is safe because a run never loses points: cutting a line
short can only drop boards the player did not solve, and cannot avoid a mistake —
the session is closed once the run is submitted.

### Verified scores

**The database decides the score**: see
`supabase/migrations/20261104120000_queens_sessions.sql`.

- `public.queens_solution(seed, level)` draws one board's solution and
  `public.queens_side(level)` its size. Internals: execute is not granted to a
  client, and the verifier is the only caller.
- `public.start_game_session(slug, rules, client)` accepts the pair (`queens`,
  `queens@1`). A Queens session reports `tile_count` 8192 — the submission bound —
  and lives twelve hours, like every endless run.
- `public.complete_queens_run(session, actions, score, duration)` replays the taps
  cell by cell as above, derives the score, compares it with the claim, and only
  then closes the session and records it. Its outcome vocabulary and ledger
  behaviour are the other verifiers'. The Go service routes `queens@` runs to it
  and accepts up to 8192 taps on cells 0 to 80, the 9×9 board.
- `20261104120100_queens_playable.sql` inserts the catalogue record — published,
  official, playable, runtime `queens`, category Logic — and is applied after the
  deployment carrying the runtime is live.

A guest can play. Their run is verified and closed exactly like a signed-in
player's, and it is never ranked.

### Test vectors

Each vector is asserted by both the SQL suite and the client engine.

1. **Seed 1's first four solutions** — `[1,3,0,4,2]`, `[4,1,3,0,5,2]`,
   `[0,3,5,1,4,2]`, `[0,6,1,4,2,5,3]` (the Queen's column in each row).
2. **A full-width seed** — `9223372036854775807` draws `[4,1,3,0,2]` on board one
   and `[5,8,3,0,2,6,1,4,7]` on board eleven, which is what catches a client that
   rounded the seed to a double.
3. **The zero-state fallback** — seed `0` draws the same boards as `2654435769`.
4. **Seed 1, a mistaken line** —
   `1,1,8,8,10,10,19,19,22,22,4,4,4,0,0,1,1,2,2`: board one solved (each Queen an
   X, then a Queen), cell 4 of board two cycled back to empty, then three Queens
   off the solution. **50 points**, 19 taps, 1 board solved, and the third mistake
   ends the run. Asserted in
   [`tests/security/rls_test.sql`](../../tests/security/rls_test.sql) and in
   [`src/lib/games/queens.test.ts`](../../src/lib/games/queens.test.ts).
5. **Seed 1, an ended line** —
   `1,1,8,8,10,10,19,19,22,22,4,4,7,7,15,15,18,18,29,29,32,32`: boards one and two
   solved, then the player ends the run. **110 points**, 22 taps.

## Zip

LinkedIn's Zip puzzle as an endless run against a clock. Every board is an N×N
grid with numbered checkpoints and sometimes walls: draw one path that starts on
1, passes through the numbers in order, visits every cell exactly once and ends on
the highest number, moving up, down, left or right and never through a wall.
Every board has exactly one solution.

### The board

| Thing   | Value                                                                   |
| ------- | ----------------------------------------------------------------------- |
| Board   | 5×5 for levels 1–2, 6×6 for 3–8, then 7×7 for every board               |
| Clock   | 60 s to start, +5 s per row of every solved board                       |
| Slack   | 20 s: how late after its clock a run may still reach the server         |
| Cells   | 8192 at most in one submission: a request bound, not a level            |
| Rules   | `zip@1`                                                                 |
| Runtime | `zip` (the catalogue's `games.runtime` value)                           |

### How the real game works, and what this one keeps

LinkedIn's Zip (designed with Grandmaster Puzzles) has exactly these rules; walls
appear on some boards as a design theme. The player can only draw the path — no
notes — and undoes by going back over it. Nothing ever ends a daily puzzle: it is
a race against the timer, and that is what this version keeps. A ranked endless
run needs an ending the server can check, so a run is one clock: it starts at
sixty seconds, every solved board adds five seconds per row, and the run is over
when the clock reaches zero (or when the player ends it).

### The boards

A board is drawn in two steps from one random stream, a function of the run's
seed, which the **server** chooses:

1. **The solution** — a random path through every cell. This is what the verifier
   needs, so it is written out in full:

   ```
   side(n) = 5 for levels 1–2, 6 for 3–8, then 7
   state₀ = ((seed mod 2³²) + 2³²) mod 2³²            // as One Move and Queens
   if state₀ = 0 then state₀ = 2654435769
   stateₙ = (stateₙ₋₁ × 1664525 + 1013904223) mod 2³²  // advanced once per level
   t = stateₙ; draw() = t ← (t × 22695477 + 1) mod 2³²; t >> 16
   path = the serpentine: row 0 left→right, row 1 right→left, …
   repeat 8 × side² times:                            // backbite moves
     tail = draw() mod 2 = 1; dir = draw() mod 4       // up, down, left, right
     end = the path's last cell if tail else its first
     next = end's neighbour in dir; skip if off the board
     j = next's index on the path
     if tail:  skip if j = side² − 2, else reverse path[j + 1 … side² − 1]
     else:     skip if j = 1,         else reverse path[0 … j − 1]
   ```

   A backbite joins an end of the path to one of its neighbours and reverses the
   stretch between them, so every step still covers the board; eight per cell
   leave no trace of the serpentine.

2. **The checkpoints and walls** — 1 on the path's first cell, the highest number
   on its last, and a checkpoint about every four cells along it (jittered by a
   cell either way). A solver then looks for a second solution. While one exists,
   the generator adds one constraint that rules it out and leaves the planted path
   valid: usually a checkpoint that the other path would reach out of order,
   otherwise a wall across a step the other path takes and the planted one does
   not. The solver is a depth-first search that, after every step, requires the
   unvisited cells to stay one connected piece and no cell to be left with too few
   open sides. A unique 7×7 board averages a few milliseconds and peaked around
   75 ms in testing; 8×8 took seconds, which is why the board stops at 7×7.

Only the client places checkpoints and walls. Because the solution is unique, a
drawn path that covers the board is solved exactly when it *is* the solution, so
the verifier needs only step 1.

### A move

A move is a **cell index on the current board**, as the path is dragged or tapped:

1. With no path yet, the cell must be the one numbered 1.
2. A cell already on the path cuts the path back to it (that is how a player
   undoes). The head itself is not a move.
3. Any other cell extends the path, if it is a neighbour of the head — and not
   once the head is the highest number.

The board adds its own two rules and never sends a move that breaks them: no step
through a wall, and no number reached before the one it follows. The verifier
does not check those two, because it does not know where the checkpoints are; the
moves it receives are always a subset of what it accepts, so the two agree on
every score.

When the path covers the board and is the solution, the board is solved: **ten
points per row** (50 for 5×5, 70 for 7×7), its clock bonus is added, and the next
board starts with no path.

### How a run ends, and the server's clock

| Outcome        | When                                     |
| -------------- | ---------------------------------------- |
| `over` (time)  | The clock reached zero.                  |
| `over` (ended) | The player pressed End run.              |
| `over` (bound) | The submission reached 8192 cells.       |

Any prefix of a legal line is a valid submission: the score never goes down.

The clock is enforced with the **server's** time. Every other game issues its
session when the play screen opens; Zip issues it when the player presses Start,
so the session's `started_at` is the start of the run. The verifier refuses a run
that reaches it more than `zip_budget_ms(boards solved) + zip_slack_ms()` after
that (`out_of_time`, a `422`). A client that ignored its own clock would only
reach the server too late.

The cost: a submission whose first send never reached the server, retried by hand
long after the clock ran out, is refused too. The client retries a failed request
on its own straight away, and the error screen says that a Zip run has to arrive
soon after its clock ends.

### Verified scores

**The database decides the score**: see
`supabase/migrations/20261105120000_zip_sessions.sql`.

- `public.zip_path(seed, level)`, `public.zip_side(level)` and
  `public.zip_budget_ms(cleared)` are the solution, the board and the clock.
  `zip_path` is internals; execute is not granted to a client.
- `public.start_game_session` accepts (`zip`, `zip@1`); the session reports
  `tile_count` 8192 and lives twelve hours.
- `public.complete_zip_run(session, actions, score, duration)` replays the cells
  as above, derives the score, compares it with the claim, checks the clock, and
  only then records it. The Go service routes `zip@` runs to it, accepts up to
  8192 cells on 0 to 48 (the 7×7 board), and maps `out_of_time` to `422`.
- `20261105120100_zip_playable.sql` inserts the catalogue record (Puzzle), applied
  after the deployment carrying the runtime is live.

### Test vectors

Each vector is asserted by both the SQL suite and the client engine.

1. **Seed 1's first two solution paths** (5×5) —
   `8,7,6,5,10,15,20,21,16,11,12,17,22,23,24,19,18,13,14,9,4,3,2,1,0` and
   `20,15,10,5,0,1,6,11,12,7,2,3,4,9,8,13,14,19,18,17,16,21,22,23,24`.
2. **A full-width seed** — `9223372036854775807`'s first board starts
   `0,1,2,3,4,9,14,…` and its ninth (7×7) starts `8,7,14,15,22,…`.
3. **Seed 1, a stopped line** — board one's path, then `20,15,10,5,15,10`: board
   two started, cut back once, and the run ended. **50 points**, 31 cells.
4. **Seed 1, two boards** — both paths in order: **100 points**, 50 cells.
5. **The clock** — a session started two minutes earlier: board one alone (85 s
   earned + 20 s slack) is `out_of_time`; both boards (110 s + 20 s) are on time.

## 8 Puzzle

The classic sliding puzzle as an endless run against a clock: eight numbered tiles
and one gap on a 3×3 board. Slide a tile next to the gap into it, until the tiles
read 1 to 8 in reading order with the gap in the bottom-right corner.

### The board

| Thing    | Value                                                           |
| -------- | --------------------------------------------------------------- |
| Board    | 3×3, always                                                     |
| Scramble | 10 gap steps on board one, +3 a board, up to 80                 |
| Clock    | 60 s to start, +15 s per solved board; 20 s of slack            |
| Slides   | 8192 at most in one submission: a request bound, not a level    |
| Rules    | `eight-puzzle@1`                                                |
| Runtime  | `eight-puzzle` (the catalogue's `games.runtime` value; slug `8-puzzle`) |

### The boards

Half of all arrangements of the tiles cannot be solved, so a board is never a
random arrangement: it is the solved board scrambled by a **random walk of the
gap**, which only reaches boards that can be solved.

```
side = 3; solved = 1 2 3 / 4 5 6 / 7 8 _
state₀ = ((seed mod 2³²) + 2³²) mod 2³²            // as One Move, Queens and Zip
if state₀ = 0 then state₀ = 2654435769
stateₙ = (stateₙ₋₁ × 1664525 + 1013904223) mod 2³²  // advanced once per level
t = stateₙ; draw() = t ← (t × 22695477 + 1) mod 2³²; t >> 16
steps(n) = min(80, 10 + 3 × (n − 1))
repeat steps(n) times, then until the board is not solved:
  options = the gap's moves in the order up, down, left, right,
            leaving out the board's edges and the move straight back
  move the gap by options[draw() mod |options|]
```

The walk never steps straight back, so its length is a real measure of the
scramble. The fewest slides that solve a board are never more than its scramble,
and never more than 31 (the hardest 3×3 boards). Eighty steps is as good as a
uniformly random solvable board.

The screen shows each board's **par**, the fewest slides that solve it, found by
iterative-deepening A* with the Manhattan distance (a few milliseconds). The
score does not use it.

### A slide, scoring and the clock

A slide is the **cell of a tile next to the gap**; that tile moves into the gap.
The gap itself, a cell off the board, or a tile not next to the gap is not a move.
Tapping a tile slides it, and the arrow keys slide the tile on the far side of the
gap (ArrowUp moves the tile below the gap up).

A slide that leaves the board solved scores **ten points**, adds fifteen seconds
to the clock and deals the next board, scrambled three steps more. The run ends
when the clock reaches zero or the player ends it; any prefix of a legal line is
valid, because the score never goes down.

The clock works exactly as Zip's: the session is issued when the player presses
Start, and the verifier refuses a run that reaches it more than
`eight_puzzle_budget_ms(boards solved) + eight_puzzle_slack_ms()` after the
session started (`out_of_time`, a `422`).

### Verified scores

**The database decides the score**: see
`supabase/migrations/20261106120000_eight_puzzle_sessions.sql`.

- `public.eight_puzzle_board(seed, level)` draws a level's board;
  `eight_puzzle_scramble(level)` and `eight_puzzle_budget_ms(cleared)` are the
  scramble and the clock. The board generator is internals.
- `public.start_game_session` accepts (`eight-puzzle`, `eight-puzzle@1`); the
  session reports `tile_count` 8192 and lives twelve hours.
- `public.complete_eight_puzzle_run(session, actions, score, duration)` replays the
  slides, derives the score, compares it with the claim, checks the clock and only
  then records it. The Go service routes `eight-puzzle@` runs to it and accepts up
  to 8192 slides on cells 0 to 8.
- `20261106120100_eight_puzzle_playable.sql` inserts the catalogue record
  (Puzzle), applied after the deployment carrying the runtime is live.

### Test vectors

Each vector is asserted by both the SQL suite and the client engine.

1. **Seed 1's first two boards** — `1 6 _ / 5 3 2 / 4 7 8` and
   `4 1 2 / _ 7 3 / 8 5 6`, solved in 10 and 9 slides by sliding the tiles on
   cells `5,4,1,2,5,4,3,6,7,8` and `4,7,6,3,0,1,2,5,8`.
2. **A full-width seed** — `9223372036854775807`'s first board is
   `2 3 6 / 1 _ 8 / 7 4 5` and its thirtieth `1 3 7 / 6 _ 4 / 8 5 2`.
3. **Seed 1, a stopped line** — board one's slides, then `4,7`: **10 points**,
   twelve slides. Both boards' slides: **20 points**, nineteen slides.
4. **The clock** — a session started a hundred seconds earlier: board one alone
   (75 s + 20 s) is `out_of_time`; both boards (90 s + 20 s) are on time.

## Color Merge

Slide a 4×4 board of shades. Two equal tiles that meet merge into the next shade
and score the tile they create. **There is no final slide**: a run ends only when
the board locks — every cell full and no two neighbours equal — because the tiles
that arrive keep getting harder to pair.

### The board

| Thing   | Value                                                                    |
| ------- | ------------------------------------------------------------------------ |
| Board   | 4×4, sixteen cells                                                       |
| Tile    | A shade: `1` shows 2, `2` shows 4, `3` shows 8, and so on                 |
| Opening | Two tiles, dealt from the seed                                           |
| Run     | Endless in principle — no deck, no final slide                           |
| Limits  | 4096 slides per submission; that is a request ceiling, not an ending     |
| Rules   | `color-merge@2` (endless); `color-merge@1` (the retired forty-eight deck) |
| Runtime | `color-merge` (the catalogue's `games.runtime` value)                    |

A tile's **value** is `2 ** shade`, which is the number on its face. Shades are
what the rules merge; values are what the player reads and what the score counts.

### The generator and the spawn ramp

The tiles are not random at play time: their cells and shades are a function of
the run's seed, which the **server** chooses when it issues the session. The
client must deal exactly the same board or its submission is refused, so the
generator is written out in full:

```
state₀ = ((seed mod 2³²) + 2³²) mod 2³²        // the seed is a bigint, reduced to 32 bits
if state₀ = 0 then state₀ = 2654435769         // 0x9E3779B9: a zero state would be degenerate
stateₙ = (stateₙ₋₁ × 1664525 + 1013904223) mod 2³²

// spawn k, 1-based: advance k times to pick the cell, once more for the shade
cell(k)      = empties[stateₖ mod count(empties)]   // empties are in board order
percent(k)   = min(60, 10 + floor(k / 5))           // the promotion chance
promote(k)   = 2 + floor(k / 120)                   // the shade it arrives at
shade(k)     = promote(k) if stateₖ₊₁ mod 100 < percent(k) else 1
```

Spawn `k` is a pure function of the seed and `k`, rather than a mutable generator
both sides must advance in step, so the verifier can reach spawn twenty without
replaying nineteen and neither copy can drift by one draw. The run opens with
spawns 1 and 2, and slide `n` deals spawn `n + 2`.

### Difficulty

The ramp is two curves, both functions of the spawn index alone, so every player
meets the same difficulty at the same point and the verifier does not have to
simulate anything to know how hard a board was.

**Promotion chance** — how often a dealt tile arrives already promoted:

| Spawn | Chance |
| ----- | ------ |
| 1     | 10%    |
| 5     | 11%    |
| 50    | 20%    |
| 120   | 34%    |
| 250+  | 60%    |

**Promoted shade** — what a promoted tile becomes:

| Spawn   | Shade | Face value |
| ------- | ----- | ---------- |
| 1–119   | 2     | 4          |
| 120–239 | 3     | 8          |
| 240–359 | 4     | 16         |
| …       | +1 every 120 spawns, no cap | … |

The chance ceiling is not where difficulty stops. Once every spawn is likely to
be promoted, the shade a promoted tile arrives at keeps climbing by one every 120
spawns: a board fed 32s and 64s has almost nothing to merge, so the space a run
can keep free shrinks and the next lock arrives sooner. The cap on the chance
makes the ramp readable; the shade is what keeps it rising.

A run therefore ends by the player's own board filling up, not by a counter:
there is no slide number at which the rules stop dealing.

The seed travels as a **decimal string** for the same reason the other games' do:
it is a `bigint` column, and parsing it as a double would deal a different board
and reject every honest run.

### A slide

A slide is a **direction, 0–3**: up, right, down, left. Every line of the board is
read in the direction of travel, compacted toward that edge, and its equal
neighbours merge into the next shade. A tile merges **at most once per slide** —
four 2s become two 4s, never one 8.

A direction that would not change the board is **not a move**: it is not
recorded, nothing is dealt, and nothing scores. That is why the verifier refuses
an action list containing one — the submitted list is exactly the play.

### Scoring

Each merge scores the value of the tile it created: two 2s make a 4 and score 4,
two 4s make an 8 and score 8. A dealt tile scores nothing until it merges.
Merging preserves the board's total value, so the score is **not** a difference in
what the board is worth — it is the sum of the merges, which is the conventional
score for this game and the number the verifier derives.

### How a run ends

| Outcome | Reason   | When                                                                      |
| ------- | -------- | ------------------------------------------------------------------------- |
| `over`  | `locked` | The board is full and no two neighbours match, so no slide can change it. |
| `over`  | `limit`  | The 4096-slide submission bound was reached. A request ceiling, not a level. |

Every slide of the run must be submitted: a submission that stops while the board
can still move is refused, so a player cannot discard the slide that locked it.
The retired `color-merge@1` deck still ends at its forty-eighth slide, and a
session pinned to that version is verified exactly as it shipped — including its
`deck` ending and its 10%-to-shade-2 spawn.

### Verified scores

**The database decides the score**, under the same rules as the other four: see
`supabase/migrations/20261022120000_color_merge_sessions.sql` for the legacy
rules and `supabase/migrations/20261028120000_endless_color_merge.sql` for the
endless ones.

- `public.color_merge_board_endless(seed)` deals the opening two tiles, and
  `public.color_merge_spawn_endless(seed, k, board)` deals spawn `k` on the ramp.
  The legacy `public.color_merge_board`/`color_merge_spawn` remain, because a
  `color-merge@1` session must still replay. All four are internals: execute is
  not granted to a client, because a player already holds the seed their own
  board grows from, and the verifier is the only caller.
- `public.color_merge_spawn_percent(k)` and `public.color_merge_spawn_shade(k)`
  are the ramp itself, exported so the SQL suite can assert the curve instead of
  trusting the numbers inside a spawn.
- `public.color_merge_slide(board, direction)` compacts and merges every line, and
  `public.color_merge_gain(board, direction)` reports the points the same slide
  earns. They share one line function, so the board and the score cannot disagree.
- `public.color_merge_can_move(board)` is the lock test: an empty cell, or two
  equal neighbours.
- `public.start_game_session(slug, rules, client)` issues the run with the seed,
  the pinned version and the expiry. Its gate is a pair — (`stack-10`,
  `stack-10@1`), (`chain`, `chain@1` or `chain@2`), (`memory-flash`, `memory-flash@1`
  or `memory-flash@2`), (`one-move`, `one-move@1` or `one-move@2`) or
  (`color-merge`, `color-merge@1` or `color-merge@2`) — and anything else is
  `unsupported_runtime`. An endless Color Merge session's `tile_count` is 4096, the
  submission bound; a legacy
  session still reports 48, the slides its deck holds.
- `public.complete_color_merge_run(session, actions, score, duration)` replays the
  direction list from the seed, deals the tiles, derives the score, compares it
  with the claim, and only then closes the session and records it. Its outcome
  vocabulary (`recorded`, `duplicate`, `score_mismatch`, …) and its ledger
  behaviour are identical to the other four verifiers, and the Go service maps
  them onto HTTP the same way — routing at the verifier the pinned rules version
  names and accepting directions 0–3.

A guest can play. Their run is verified and closed exactly like a signed-in
player's, and it is never ranked.

### Test vectors

Each vector is asserted by both the SQL suite and the client engine; if either side
drifts, one of the two suites fails.

1. **Seed 1's opening board** — two shade-1 tiles at cells 12 and 13:
   `0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0`. Seed `9223372036854775807` opens with a
   shade-1 tile at cell 2 and a shade-1 tile at cell 8 under the endless rule,
   which is what catches a client that rounded the seed to a double — and, because
   the legacy rule deals a shade-2 tile at cell 8, what catches a client that
   applied the wrong ruleset.
2. **Seed 1's endless line** — the first legal direction in the order down, left,
   right, up, played until the board locks: **sixty-four slides**, sixteen past
   the retired deck:

   ```
   3,1,3,2,2,2,2,2,2,2,3,3,2,3,2,2,2,2,2,3,2,2,2,3,2,3,2,1,2,2,2,2,
   3,2,2,2,2,2,2,2,2,3,2,2,2,2,3,2,3,1,3,2,3,2,2,2,2,3,3,2,3,1,3,2
   ```

   It scores **468** and leaves `2,3,1,2,1,4,3,1,2,1,4,3,6,4,2,1` with no move
   left. Asserted in [`tests/security/rls_test.sql`](../../tests/security/rls_test.sql)
   and in [`src/lib/games/color-merge.test.ts`](../../src/lib/games/color-merge.test.ts).
   The first forty-eight of those slides are *not* the legacy line: the ramp deals
   different shades, and the SQL suite submits the legacy deck to an endless
   session to prove it is now a partial run.
3. **Seed 15's endless line** — the first legal direction in the order right, left,
   up, down, fifty-two slides, scoring **292** and leaving a full board with no
   matching neighbours:

   ```
   1,2,4,2,4,1,2,3,2,3,5,2,1,2,1,4
   ```

   This is the vector that pins the lock ending: the run stops long after the old
   deck would have, and the verifier must record it rather than call it partial.
   Asserted in both suites.
4. **The retired deck, still verified** — seed 1's `color-merge@1` line is the
   same forty-eight slides that scored **272** and left
   `1,0,0,0,2,1,0,0,4,3,2,1,5,4,3,3`; seed 15's legacy line locks after forty-two
   slides for **184**. Both remain in the SQL suite, because a session issued
   before this release can still be completed and must be verified under the
   rules it was issued with.
5. **The ramp** — `spawn_percent` is 10 at spawns 1–4, 11 at 5, 20 at 50 and 60
   from 250; `spawn_shade` is 2 until spawn 119, 3 at 120, 4 at 240, and still
   climbing (1002 at spawn 120,000). Asserted in both suites.

## Don't Touch the Black

Rows of tiles rise to a line. Tap the white ones; touch a black one and the run is
over. **There is no final row**: the conveyor keeps coming, getting faster and
blacker, until the player slips or chooses to stop.

### The board

| Thing   | Value                                                                  |
| ------- | ---------------------------------------------------------------------- |
| Rows    | Endless — no final row, no complete deck                               |
| Lanes   | 3 per row                                                              |
| Cells   | 4095 addressable — the most taps one submission can carry              |
| Tile    | White (safe, 10 points) or black (ends the run)                        |
| Rules   | `dont-touch@2` (endless); `dont-touch@1` (the retired twenty-row deck) |
| Runtime | `dont-touch` (the catalogue's `games.runtime` value)                   |

A cell is addressed by its index on the conveyor, in board order: row one's lanes
are cells 0–2, row two's are 3–5, and so on. That index is the move — no column of
the UI ever reaches the verifier.

### Difficulty

Two curves make the game harder, and both are functions of the row alone, so they
are deterministic and identical for every player at the same point.

**Speed** — how long a row stays at the line before the next one takes its place:

| Row | Window  |
| --- | ------- |
| 1   | 1600 ms |
| 11  | 1150 ms |
| 21  | 700 ms  |
| 31  | 697 ms  |
| 61  | 689 ms  |

The first twenty-one rows shorten linearly by 45 ms each. After that the window
eases toward a 650 ms floor and never reaches it: below 650 ms three lanes cannot be
scanned fairly on a phone, so the floor bounds readability, not progression. The
client's `rowWindow(row)` is the same curve the board's timers use.

**Density** — the share of black tiles in a row:

| Rows  | Black                   |
| ----- | ----------------------- |
| 1–10  | 25%                     |
| 11–20 | 26%                     |
| …     | +1 point every ten rows |
| 201+  | 45%                     |

The ramp caps at 45% where a row still usually has a white to take (55% of its cells
are white), while missing whites costs real points. Density is what keeps the game
getting harder after the beat has reached its readable floor, and a row may be all
black — that is a row to let pass, not a trap, because missing whites is a lost
opportunity rather than a loss.

Neither curve ever steps backwards, so the conveyor never slows down, and no two
players face a different beat at the same row.

### The conveyor

The colours are not random at play time: they are a function of the run's seed,
which the **server** chooses when it issues the session. The client must deal exactly
the same conveyor or its submission is refused, so the generator is written out in
full:

```
state₀ = ((seed mod 2³²) + 2³²) mod 2³²        // the seed is a bigint, reduced to 32 bits
if state₀ = 0 then state₀ = 2654435769         // 0x9E3779B9: a zero state would be degenerate
stateₙ = (stateₙ₋₁ × 1664525 + 1013904223) mod 2³²

// cell k, 0-based: advance k + 1 times, then read
draw(k)  = state >> 16
black(k) = (draw(k) mod 100) < blackPercent(k / 3)
```

The colour is read from bits 16 and above rather than the low bits on purpose: this
LCG's low bits cycle with a period of two to the power of the bit width, so a colour
read from them would repeat a fixed pattern regardless of the seed. The shift is
shared with the retired rules, which read `draw(k) mod 4 = 0`; the endless rules read
the same draw modulo 100 against the row's density. Because the generator is
infinite, so is the conveyor.

The seed travels as a **decimal string** for the same reason the other games' do: it
is a `bigint` column, and parsing it as a double would colour a different conveyor
and reject every honest run.

### A tap

A tap is a **cell number**. A white tile clears and scores ten points; a black tile
ends the run, and the tap that touched it is part of the submission so the verifier
replays the ending rather than being told about it. A cell can be touched once, a
cell past the conveyor is not a cell, and a tap after the black tile is impossible
play.

The rules deliberately do not know about time. The conveyor decides _when_ a row is
in reach — that is the screen's job — while the submitted list says only which cells
were touched. Whether a player saw every row is a fact about the conveyor's clock,
not about the action list.

### Scoring and endings

Each white tile is worth **10 points**; a black tile is worth nothing, because its
cost is the run. A run ends in one of two ways:

| Ending  | When                                                         |
| ------- | ------------------------------------------------------------ |
| Black   | A black tile was touched. The tap is submitted and replayed. |
| Stopped | The player ended the run. The cleared whites are the score.  |

An endless game has no natural last row, so stopping is the ordinary way out of a
good run, and it cannot inflate a score: the score is the whites already cleared.
The first twenty-row `dont-touch@1` deck also ended when its last row passed; that
ending belongs to the retired rules and is never produced under `dont-touch@2`.

### Verified scores

**The database decides the score**, under the same rules as the other six: see
`supabase/migrations/20261027120000_endless_dont_touch.sql` for the endless branch and
`supabase/migrations/20261023120000_dont_touch_sessions.sql` for the original.

- `public.dont_touch_black(seed, cell)` is the colour of one cell under the retired
  rules, and `public.dont_touch_black_endless(seed, cell)` is the colour under the
  endless ones. Both are internals: execute is not granted to a client, because a
  player already holds the seed their own conveyor grows from, and the verifier is
  the only caller.
- `public.start_game_session(slug, rules, client)` issues the run with the seed, the
  pinned version and the expiry. Its gate accepts (`dont-touch`, `dont-touch@1` or
  `dont-touch@2`) and refuses anything else as `unsupported_runtime`. A `dont-touch@2`
  session's `tile_count` is 4095: the most taps one submission may carry, not a
  complete-run length, because an endless run has no complete length. A legacy
  `dont-touch@1` session still reports 60.
- `public.complete_dont_touch_run(session, actions, score, duration)` picks its branch
  from the pinned version, replays the taps from the seed, derives the score, compares
  it with the claim, and only then closes the session and records it. The 4095-cell
  bound is a request ceiling, not a level: at the 650 ms floor it is more than a
  quarter of an hour of perfect play. Its outcome vocabulary (`recorded`,
  `duplicate`, `score_mismatch`, …) and its ledger behaviour are identical to the
  other six verifiers, and the Go service maps them onto HTTP the same way — routing
  at the verifier the pinned rules version names and accepting cells 0–4094.

A guest can play. Their run is verified and closed exactly like a signed-in
player's, and it is never ranked.

### Test vectors

Each vector is asserted by both the SQL suite and the client engine; if either side
drifts, one of the two suites fails.

1. **Seed 1's retired deck** — the sixty cells of `dont-touch@1`, `B` for black and
   `.` for white:

   ```
   BB..BB..B..B...B..........B.B......B........B.BBBBB..B..B.B.
   ```

   Nineteen of the sixty cells are black, so a careful run has 41 whites to clear.
   The old generator is still asserted exactly, which is what proves a session issued
   before the endless release replays to the same score.

2. **Seed 1's opening rows, endless** — rows 1–12 on the `dont-touch@2` conveyor:

   ```
   .B. .BB ... .B. B.B .BB ... .B. B.B ..B .B. ..B
   ```

   The endless rules do not reproduce the retired deck: the colour is read modulo
   100 against the row's density rather than modulo 4, and the ramp begins at row
   eleven. Asserted in
   [`tests/security/rls_test.sql`](../../tests/security/rls_test.sql) and in
   [`src/lib/games/dont-touch.test.ts`](../../src/lib/games/dont-touch.test.ts).

3. **Seed 1's twenty-five rows** — the whites of rows one to twenty-five in board
   order: `0,2,3,6,…,74`, **56 whites, 560 points**, and cells 60–74 are past the old
   deck. The run is still playing when it stops, which is the point: the conveyor did
   not end at twenty rows. Asserted in both suites.

4. **Seed 1's opening loss** — `0,2,1`: clear the row's two whites, then touch the
   black tile at cell 1. It scores **20**, and the black tap is recorded as the ending
   rather than scored. Asserted in both suites.

5. **Seed 0, density** — cell 41 (row fourteen) draws 25: white at the opening 25%,
   black from the moment that row's density is 26%. This is the vector that catches a
   client whose ramp never reaches the verifier. Asserted in both suites.

## 7 Second

The daily game. **Seven seconds** on the clock, one arithmetic challenge at a time,
three answers to choose from. A right answer buys time and scores; a wrong one
costs time. Everyone plays the same deck on the same UTC day, and a signed-in
player gets **one ranked attempt per day**.

### The board

| Thing    | Value                                                     |
| -------- | --------------------------------------------------------- |
| Clock    | 7.0 seconds, plus 1.5 per right answer, minus 2 per wrong |
| Answers  | 3 per challenge — one right, two wrong                    |
| Cap      | 60 answers per submission                                 |
| Score    | 10 points per right answer                                |
| Rules    | `seven-second@1`                                          |
| Runtime  | `seven-second` (the catalogue's `games.runtime` value)    |
| Category | Daily                                                     |

### The daily deck

The seed is **the UTC date**, hashed once:

```
seed = (days since 1970-01-01) × 2654435761 + 7
```

That makes the deck a property of the day rather than of the player: every run
started on 24 October 2026 receives the same seed, so two scores measure the same
challenges. It is also why the daily limit works — `start_game_session` compares a
completed session's seed with today's seed, not two wall-clock timestamps.

From there the generator is the same 32-bit LCG the other games use:

```
state₀ = ((seed mod 2³²) + 2³²) mod 2³²
if state₀ = 0 then state₀ = 2654435769
stateₙ = (stateₙ₋₁ × 1664525 + 1013904223) mod 2³²

// challenge k, 0-based: advance k + 1 times, then read one state
left     = 2 + ((state >> 8)  mod 18)      // 2..19
right    = 1 + ((state >> 16) mod 9)       // 1..9
minus    = ((state >> 24) mod 2) = 0       // subtraction when set
if minus and right > left then swap        // never pose a negative answer
answer   = minus ? left - right : left + right

offset₁  = 1 + ((state >> 4)  mod 5)       // 1..5
offset₂  = offset₁ + 1 + ((state >> 12) mod 4)
correct  = state mod 3                     // the button the answer sits on
options  = [answer + offset₁, answer + offset₂] with `answer` inserted at `correct`
```

Both wrong answers are therefore above the right one and distinct, which is enough
to stop the answer being found by shape rather than arithmetic. The right button
moves because its position is the state modulo three, so mashing one position is
not a strategy.

### A run

The screen starts the clock when the player presses Start, not when the session
arrives — reading the rules must not cost seven seconds. Each press is an answer
button index, 0–2:

- **right** → 10 points, and 1.5 seconds go back on the clock. The next challenge
  appears.
- **wrong** → nothing, and 2 seconds come off. The next challenge appears.
- **clock at zero** → the run ends and the answers already given are submitted.
  That is the ordinary ending; a run with no answers is valid and scores zero.
- **sixty answers** → the run ends too. It is the contract's cap and a real
  ending, not a number the UI invented.

The rules deliberately do not know about time: the screen decides _when_ a run is
over, while the submitted list says only which buttons were pressed. A press after
the clock empties is not recorded, so what is replayed is exactly what was played.

Because the clock is not replayed, a modified client could submit sixty correct
answers without waiting. The answer cap makes that score **600**, the same ceiling
a perfect run reaches, and the server still checks every answer — so the cheat is
bounded to the score the game already awards, never beyond it.

### Verified scores

**The database decides the score**, under the same rules as the other six: see
`supabase/migrations/20261024120000_seven_second_sessions.sql`.

- `public.seven_second_seed()` is today's seed. It is stable rather than immutable,
  and clients never call it: the seed arrives with the session.
- `public.seven_second_correct(seed, index)` is the right button for one challenge.
  It is an internal; execute is not granted to clients, because a player already
  holds the seed their deck grows from.
- `public.start_game_session(slug, rules, client)` issues the run with the daily
  seed, the pinned version and the expiry. Its gate is a pair — the six earlier
  pairs plus (`seven-second`, `seven-second@1`) — and anything else is
  `unsupported_runtime`. A 7 Second session's `tile_count` is 60, the answer cap.
  For a signed-in caller it also answers `already_played` when a completed session
  exists for today's seed, and issues nothing.
- `public.complete_seven_second_run(session, actions, score, duration)` replays the
  answers from the seed, scores ten per right one, compares the total with the
  claim, and only then closes the session and records it. Its outcome vocabulary
  (`recorded`, `duplicate`, `score_mismatch`, …) and ledger behaviour are identical
  to the other six verifiers, and the Go service maps them onto HTTP the same way —
  routing `seven-second@1` to this verifier, accepting choices 0–2, and answering
  `409` for `already_played`.

  The ledger keeps the daily rule on its own: if two sessions of the same day's
  deck reach completion — a start and a completion can race — the second is
  refused with `already_played` rather than becoming a second score. The race can
  cost a run; it cannot put two entries on the board.

A guest can play, and can play again: their run is verified and closed exactly like
a signed-in player's, and it is never ranked, so repeated practice cannot put a
score on a board. The daily limit is the rule that makes the daily board a
comparison of the same deck, and it applies to the ranked attempt.

### Test vectors

Each vector is asserted by both the SQL suite and the client engine; if either side
drifts, one of the two suites fails.

1. **Seed 1's first four challenges** — prompts, options, and the right button:

   ```
   0: 11 − 8  → [3, 5, 7]   right = 0
   1:  9 − 5  → [4, 6, 7]   right = 0
   2: 13 + 8  → [26, 27, 21] right = 2
   3: 16 − 8  → [9, 8, 13]  right = 1
   ```

   Asserted in
   [`tests/security/rls_test.sql`](../../tests/security/rls_test.sql) and in
   [`src/lib/games/seven-second.test.ts`](../../src/lib/games/seven-second.test.ts).

2. **Seed 1's answer line `0,1,2,1`** — right, wrong, right, right: **three
   correct, 30 points**, submitted as four answers. Asserted in both suites.

3. **The zero-state fallback** — seed `2654435769` draws the same deck as a seed of
   `0`; its first six right buttons are `1,0,0,2,1,2`. Asserted in both.

4. **A perfect sixty-answer run** on seed 42 scores **600** and ends itself at the
   cap. Asserted in the client engine; the verifier accepts any line from zero to
   sixty answers, so the line is valid play and the score is its replay.
