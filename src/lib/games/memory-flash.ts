/**
 * Memory Flash — the game, as a pure deterministic state machine.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_memory_flash_run` in
 * `supabase/migrations/20261030120000_endless_memory_flash.sql` replays the
 * submitted tap list from the session's seed and derives the score itself. Two
 * copies of one ruleset is a real risk, so the copy is pinned in three ways:
 *
 *   - **The rules version is data.** A session carries the version it was started
 *     under (`memory-flash@2`), the server refuses to verify a version it does not
 *     implement, and this module declares the same string. A change to the rules
 *     is a change to the version, not an edit in place. The retired ten-pattern
 *     `memory-flash@1` game is still verified by the server for sessions opened
 *     before this version, but no new run pins it.
 *   - **The state machine is total and pure.** `tap` takes a run and a cell and
 *     returns a run — no clock, no randomness, no I/O — so the same inputs produce
 *     the same run on both sides.
 *   - **It is tested against the database's own numbers.** The vectors in
 *     `memory-flash.test.ts` are the ones `tests/security/rls_test.sql` asserts
 *     (seed 1's patterns, the endless line past the retired tenth pattern, and a
 *     broken line). See `docs/games/README.md`.
 *
 * ## The endless game
 *
 * The shipped game ended after ten patterns. That was the only artificial ending
 * it had: the rules themselves stop at nothing. This version removes it and keeps
 * every failure condition the game always had — a tap outside the pattern, or a
 * second tap on a cell already entered, ends the run.
 *
 * Difficulty is a function of the round, so every player meets the same challenge
 * at the same point:
 *
 *   - **The pattern grows by one cell every round.** Round `r` lights `r`
 *     distinct cells; that never stops, which is the difficulty that keeps
 *     climbing after every other lever has reached its floor.
 *   - **The board grows when the pattern outgrows it.** A 4×4 board holds sixteen
 *     cells, so it can only pose sixteen rounds of distinct cells. Every eight
 *     rounds the board gains a row and a column, which is what keeps a longer
 *     pattern possible; the pattern never needs more cells than the board has.
 *   - **The flash shortens.** The pattern is shown for 700 ms at round one and
 *     12 ms less each round, to a 400 ms floor — a floor, not an ending: the
 *     pattern keeps getting longer underneath it.
 *
 * The submission bound is not a level. A run may carry at most 4096 taps, a
 * request and replay ceiling far past any run a session is still open for, and it
 * ends a run that reaches it rather than describing one.
 *
 * The client cannot invent a score even if this file is wrong: a wrong replay
 * produces a number the server's replay disagrees with, and the submission is
 * refused with `score_mismatch`. What the module must get right is *agreement*, and
 * the failure mode of disagreement is a rejected run rather than a wrong one.
 *
 * Storage rule: nothing here is persisted. A run lives in React state for as long
 * as the screen is open; losing it costs the player one run and never a score,
 * because a score only exists once the server has verified it.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const MEMORY_FLASH_RUNTIME = "memory-flash";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const MEMORY_FLASH_RULES_VERSION = "memory-flash@2";

/** The board starts at 4×4 and gains a row and a column every growth step. */
export const MEMORY_FLASH_START_SIDE = 4;

/**
 * How many rounds one board size serves. The pattern for round `r` needs `r`
 * cells, so a 4×4 board runs out after sixteen; growing every eight rounds keeps
 * the pattern comfortably inside the board at every point (`side² ≥ round`).
 */
export const MEMORY_FLASH_GROWTH_ROUNDS = 8;

/**
 * The most taps one submission may carry. A request ceiling, not a final round:
 * clearing ninety patterns would take 4095 taps, and no session stays open that
 * long.
 */
export const MEMORY_FLASH_MAX_ACTIONS = 4096;

/** A cleared pattern is worth ten points, as it always was. */
const ROUND_SCORE = 10;

// The flash ramp. Round one is shown for exactly the 700 ms the shipped game
// used, so the opening of an endless run is the game that shipped; from there it
// shortens to a floor. The lead-in is the beat before the pattern lights.
const SHOW_BASE_MS = 700;
const SHOW_STEP_MS = 12;
const SHOW_FLOOR_MS = 400;
const LEAD_IN_BASE_MS = 250;
const LEAD_IN_STEP_MS = 5;
const LEAD_IN_FLOOR_MS = 120;

// The generator, state for state as `complete_memory_flash_run` advances it: the
// same 32-bit LCG Stack 10's deck uses (see `src/lib/games/stack10.ts`), with the
// same zero-state fallback and the same decimal-string seed handling, because a
// seed that differs by one bit flashes a different pattern.
//
// A cell is read from bits 16 and above (`(state >> 16) % cells`) rather than the
// low bits, and deliberately so: this LCG's low bits cycle with a period of two to
// the power of the bit width, so `state % 16` would repeat a fixed sixteen-draw
// cycle. Every pattern would be a slice of that cycle, and round seven would show
// something round one already taught. Bits 16–19 have the full period, so each
// seed flashes its own patterns. Chain reads the same bits two at a time; the
// games are unrelated.
const SEED_MODULUS = 4294967296n;
const LCG_MULTIPLIER = 1664525n;
const LCG_INCREMENT = 1013904223n;
// 0x9E3779B9. The verifier substitutes it for a zero state, which would otherwise
// produce a constant sequence; mirrored so both sides treat a degenerate seed the
// same way.
const ZERO_STATE_FALLBACK = 2654435769n;
const CELL_SHIFT = 16n;

/**
 * How a run ended.
 *
 * `over` — a tap was not part of the pattern, repeated a cell already lit, or the
 * submission bound was reached. There is no `cleared`: the patterns do not end.
 */
export type MemoryFlashOutcome = "playing" | "over";

/** One run, as this module knows it. */
export type MemoryFlashRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /**
   * Every cell tapped, in order, including the tap that broke the pattern. This
   * *is* the submission: the server replays this list and nothing else, so a run
   * is verifiable exactly when this is the list that produced it.
   */
  readonly taps: readonly number[];
  /**
   * The cells correctly rebuilt in the current round, in the order they were
   * tapped. The round is a set, not a sequence: the pattern must be reproduced in
   * any order, which is what makes this game memory rather than reaction.
   */
  readonly entered: readonly number[];
  /** Rounds cleared so far. Each one is worth ten points. */
  readonly roundsCleared: number;
  /** The round being played, 1-based. It has no upper bound. */
  readonly round: number;
  /** The score this run earns under the rules, as the server computes it too. */
  readonly score: number;
  readonly outcome: MemoryFlashOutcome;
  /** True when the player ended the run, rather than the game ending it. */
  readonly stopped?: true;
};

/**
 * Normalises a seed to the 32-bit state the generator starts from.
 *
 * It mirrors the verifier's own expression — including its handling of a negative
 * or zero seed — because a state that differs by one bit flashes a different
 * pattern, and the run would be rejected as a run the rules cannot produce.
 */
function initialState(seed: string | number | bigint): bigint {
  const value = toBigInt(seed);
  const reduced = ((value % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS;
  return reduced === 0n ? ZERO_STATE_FALLBACK : reduced;
}

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) {
      throw new TypeError("a Memory Flash seed must be a whole number");
    }
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Memory Flash seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

function assertRound(round: number): void {
  if (!Number.isInteger(round) || round < 1) {
    throw new RangeError("a Memory Flash round must be a whole number from 1");
  }
}

/**
 * The side of the board a round is played on: 4 for rounds 1–8, 5 for 9–16, 6 for
 * 17–24, and one more every eight rounds after that, without cap.
 *
 * The growth is what makes an endless pattern possible: round `r` needs `r`
 * distinct cells, and `side² ≥ round` holds at every step, so the board can always
 * hold the pattern it is asked to show.
 */
export function boardSide(round: number): number {
  assertRound(round);
  return MEMORY_FLASH_START_SIDE + Math.floor((round - 1) / MEMORY_FLASH_GROWTH_ROUNDS);
}

/** How many cells that board holds. */
export function boardCells(round: number): number {
  const side = boardSide(round);
  return side * side;
}

/**
 * How long the pattern is shown, in milliseconds.
 *
 * Round one gets the shipped 700 ms; each round removes 12 ms to a 400 ms floor.
 * The floor is not where difficulty stops — the pattern keeps growing underneath
 * it — it is where the exposure stops being shorter than the pattern can be read at
 * all.
 */
export function showMs(round: number): number {
  assertRound(round);
  return Math.max(SHOW_FLOOR_MS, SHOW_BASE_MS - SHOW_STEP_MS * (round - 1));
}

/** The beat before the pattern lights, shortening to a 120 ms floor. */
export function leadInMs(round: number): number {
  assertRound(round);
  return Math.max(LEAD_IN_FLOOR_MS, LEAD_IN_BASE_MS - LEAD_IN_STEP_MS * (round - 1));
}

/** Advances the generator once and returns the cell it produced, on a board of `cells`. */
function draw(state: bigint, cells: number): { state: bigint; cell: number } {
  const next = (state * LCG_MULTIPLIER + LCG_INCREMENT) % SEED_MODULUS;
  return { state: next, cell: Number((next >> CELL_SHIFT) % BigInt(cells)) };
}

/**
 * The pattern of one round, as the cells it lights in draw order.
 *
 * A round `r` lights exactly `r` distinct cells on its own board. The generator is
 * advanced until `r` cells the round does not already hold have been drawn, so a
 * pattern never lights the same cell twice and the rejection is part of the rules
 * the verifier replays. The state carries across rounds: round two starts drawing
 * where round one stopped, exactly as the SQL function does.
 *
 * The verifier draws the same list in SQL (`public.memory_flash_endless_pattern`),
 * one round at a time; this is the client's copy. It is exported because the board
 * needs to know which cells are lit, and a screen must not grow a second copy of
 * the generator.
 */
export function patternAt(seed: string | number | bigint, round: number): number[] {
  assertRound(round);

  let state = initialState(seed);
  let pattern: number[] = [];
  for (let current = 1; current <= round; current += 1) {
    const cells = boardCells(current);
    pattern = [];
    while (pattern.length < current) {
      const next = draw(state, cells);
      state = next.state;
      if (!pattern.includes(next.cell)) pattern.push(next.cell);
    }
  }
  return pattern;
}

/** A fresh run at the start of the first pattern. */
export function createRun(seed: string | number | bigint): MemoryFlashRun {
  const normalized = toBigInt(seed).toString();
  return {
    seed: normalized,
    rulesVersion: MEMORY_FLASH_RULES_VERSION,
    taps: [],
    entered: [],
    roundsCleared: 0,
    round: 1,
    score: 0,
    outcome: "playing",
  };
}

/**
 * Whether a tap is playable: the run is live, there are taps left, and the cell
 * exists on the round's board.
 *
 * The board calls this to decide whether a cell is pressable, so an impossible tap
 * is never offered in the first place — and `tap` checks it again, because a
 * keyboard or programmatic path must not be able to make one either.
 */
export function canTap(run: MemoryFlashRun, cell: number): boolean {
  if (run.outcome !== "playing") return false;
  if (run.taps.length >= MEMORY_FLASH_MAX_ACTIONS) return false;
  return Number.isInteger(cell) && cell >= 0 && cell < boardCells(run.round);
}

/**
 * Taps a cell and returns the resulting run.
 *
 * Every round replays its own pattern, so a correct tap is one of the round's
 * cells that has not been entered yet — the order does not matter. A tap outside
 * the pattern, or on a cell already entered, breaks the pattern and ends the run.
 * That losing tap is still part of the run and is submitted, the way Stack 10's
 * overflowing tile is.
 *
 * Clearing a pattern scores ten and deals the next one, which is one cell larger
 * on a board that has grown if the pattern needs it. There is no final pattern:
 * the only ways a run ends are a mistake or the submission bound.
 *
 * An impossible tap is not a tap: the run comes back unchanged. That is deliberate
 * rather than an exception — a tap that arrives one frame after the run ended must
 * not throw inside a render — and it keeps this function total, which is what makes
 * it testable against every state.
 */
export function tap(run: MemoryFlashRun, cell: number): MemoryFlashRun {
  if (!canTap(run, cell)) return run;

  const taps = [...run.taps, cell];
  const pattern = patternAt(run.seed, run.round);
  if (!pattern.includes(cell) || run.entered.includes(cell)) {
    return { ...run, taps, outcome: "over" };
  }

  const entered = [...run.entered, cell];
  if (entered.length < run.round) {
    // A correct tap can still be the submission's last: at the bound there is no
    // next tap to carry, so the run ends here the way the server's replay ends
    // it, rather than offering a board no tap can reach.
    return {
      ...run,
      taps,
      entered,
      outcome: taps.length >= MEMORY_FLASH_MAX_ACTIONS ? "over" : "playing",
    };
  }

  // The pattern clears: all of its cells are lit, in whatever order they were
  // tapped. Ten points for the round, and the next pattern is one cell larger. The
  // submission bound is the only ceiling, and reaching it ends the run the way the
  // server's replay does.
  return {
    ...run,
    taps,
    // The pattern is complete, so the round's entered set is empty whether the
    // next pattern is about to be shown or the run is over.
    entered: [],
    roundsCleared: run.roundsCleared + 1,
    round: run.round + 1,
    score: run.score + ROUND_SCORE,
    outcome: taps.length >= MEMORY_FLASH_MAX_ACTIONS ? "over" : "playing",
  };
}

/**
 * Ends the run where it stands: the player stopped. The score is kept, and the
 * verifier accepts the line as it is, because the score only ever grows, so
 * stopping early can never earn a point. A run that is already over is returned
 * unchanged.
 */
export function finish(run: MemoryFlashRun): MemoryFlashRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", stopped: true };
}

/**
 * The body of a completion submission.
 *
 * It is assembled from the run rather than accepted from a caller, so the number
 * submitted is the one this engine computed and cannot be edited on the way out.
 */
export type MemoryFlashSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  readonly tapsPlaced: number;
  readonly roundsCleared: number;
};

export function submission(run: MemoryFlashRun): MemoryFlashSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.taps,
    score: run.score,
    tapsPlaced: run.taps.length,
    roundsCleared: run.roundsCleared,
  };
}

/** How far through the run the player is, and how hard the current round is. */
export function progress(run: MemoryFlashRun): {
  taps: number;
  round: number;
  side: number;
  cells: number;
  entered: number;
} {
  return {
    taps: run.taps.length,
    round: run.round,
    side: boardSide(run.round),
    cells: boardCells(run.round),
    entered: run.entered.length,
  };
}
