/**
 * Stack 10 — the game, as a pure deterministic state machine.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_stack10_run` in
 * `supabase/migrations/20261029120000_endless_stack10.sql` replays the submitted
 * action list from the session's seed and derives the score itself. Two copies of
 * one ruleset is a real risk, so the copy is pinned in three ways:
 *
 *   - **The rules version is data.** A session carries the version it was started
 *     under (`stack-10@2`), the server refuses to verify a version it does not
 *     implement, and this module declares the same string. The server still
 *     verifies the retired finite `stack-10@1` runs a session may have pinned. A
 *     change to the rules is a change to the version, not an edit in place.
 *   - **The state machine is total and pure.** `place` takes a run and a column
 *     and returns a run — no clock, no randomness, no I/O — so the same inputs
 *     produce the same tiles on both sides.
 *   - **It is tested against the database's own numbers.** The vectors in
 *     `stack10.test.ts` are the ones `tests/security/rls_test.sql` asserts (seed
 *     1's deck, the greedy line, the retired perfect line and its first move past
 *     the old deck). See `docs/games/README.md`.
 *
 * The client cannot invent a score even if this file is wrong: a wrong replay
 * produces a number the server's replay disagrees with, and the submission is
 * refused with `score_mismatch`. What the module must get right is *agreement*, and
 * the failure mode of disagreement is a rejected run rather than a wrong one.
 *
 * Storage rule: nothing here is persisted. A run lives in React state for as long
 * as the screen is open; losing it costs the player one run and never a score,
 * because a score only exists once the server has verified it.
 *
 * Endless rule: there is no deck. A run ends only when a column passes ten — the
 * game's own ending — or at the representable submission bound. The retired
 * sixty-tile deck is the opening: the first sixty tiles are exactly the tiles that
 * game dealt, and the pressure ramp begins at tile sixty-one. From there a draw can
 * arrive promoted to a heavier value, with a chance and a weight that both climb,
 * so clears get rarer and the next overflow comes sooner. The ramp is a pure
 * function of how many tiles have been placed, mirrored by the verifier.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const STACK10_RUNTIME = "stack-10";

/** The rules the server can verify. Sent with every run, pinned to a session. */
export const STACK10_RULES_VERSION = "stack-10@2";

/** The board: four columns, and the retired deck's sixty tiles. */
export const STACK10_COLUMNS = 4;

/**
 * The retired deck. `stack-10@1` ended after sixty tiles; `stack-10@2` does not,
 * but the number still matters: the first sixty tiles are that deck exactly, and
 * the pressure ramp starts on the sixty-first.
 */
export const STACK10_TILES = 60;

/**
 * The most tiles one submission may carry. This bounds a request, not a run: an
 * endless board has no complete length, and 4096 is far past the point where a
 * session is still open.
 */
export const STACK10_MAX_TILES = 4096;

/** The tile index the pressure ramp starts on: the first tile past the old deck. */
const RAMP_START = STACK10_TILES;

/** A column clears at exactly ten, and scoring is defined by the verifier. */
const CLEAR_TOTAL = 10;
const CLEAR_SCORE = 10;
const STACK_BONUS = 5;

// The pressure ramp. From tile sixty-one, a draw can be promoted to a heavier
// value. The chance rises one point every four tiles to a 60% ceiling; the weight
// a promoted tile gains climbs by one every 240 tiles, without cap. A heavier tile
// is harder to fit — it overshoots ten more often — so the space a run can keep
// alive shrinks as the tile count grows, and the board, not a deck, ends the run.
const RAMP_PERCENT_PER_TILE = 4;
const RAMP_PERCENT_MAX = 60;
const RAMP_WEIGHT_SPAN = 240;

// The generator, digit for digit as `complete_stack10_run` computes it. BigInt
// because the seed is a `bigint` column that can hold values well past
// `Number.MAX_SAFE_INTEGER`: converting one to a float would round it, and a
// rounded seed draws different tiles from the server's, which would reject every
// honest run. The API sends the seed as a decimal string for the same reason.
const SEED_MODULUS = 4294967296n;
const LCG_MULTIPLIER = 1664525n;
const LCG_INCREMENT = 1013904223n;
// 0x9E3779B9. The verifier substitutes it for a zero state, which would otherwise
// produce a constant sequence; mirrored so both sides treat a degenerate seed the
// same way.
const ZERO_STATE_FALLBACK = 2654435769n;
// The promotion roll is read from the high bits, not the low ones: this LCG's low
// bits cycle with a period of two to the power of the bit width, so a roll read
// from them would repeat a fixed pattern whatever the seed.
const PROMOTION_SHIFT = 16n;
const PROMOTION_MODULUS = 100n;

/** One column as the board shows it. */
export type Stack10ColumnState = {
  /** The tiles in this column since it last cleared, oldest first. */
  readonly tiles: readonly number[];
  /** Their total. A column that reaches ten clears; a higher total ends the run. */
  readonly sum: number;
};

/**
 * How a run ended.
 *
 * `over` — the board ended it. `overflow` is a column passing ten (the game's own
 * ending); `limit` is the submission bound, a request ceiling rather than a level.
 * `null` while the run is live.
 *
 * `cleared` belonged to `stack-10@1` and is never produced by these rules: a run
 * that places the retired deck's sixty tiles simply keeps playing.
 */
export type Stack10EndReason = "overflow" | "limit" | null;

export type Stack10Outcome = "playing" | "over";

/** One run, as this module knows it. */
export type Stack10Run = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  readonly columns: readonly Stack10ColumnState[];
  /**
   * Every column a tile has been placed in, in order. This *is* the submission:
   * the server replays this list and nothing else, so a run is verifiable exactly
   * when this is the list that produced it.
   */
  readonly actions: readonly number[];
  /** The score this run earns under the rules, as the server computes it too. */
  readonly score: number;
  readonly clearedColumns: number;
  /**
   * The tile the next move places, or null once the run has ended. The tile is a
   * function of how many tiles have been placed, not of which column they went
   * into, so it is known before the player chooses.
   */
  readonly nextTile: number | null;
  readonly outcome: Stack10Outcome;
  /** True when the player ended the run, rather than the game ending it. */
  readonly stopped?: true;
  readonly endReason: Stack10EndReason;
};

/**
 * Normalises a seed to the 32-bit state the generator starts from.
 *
 * It mirrors the verifier's own expression — including its handling of a negative
 * or zero seed — because a state that differs by one bit produces a different
 * deck, and the run would be rejected as a run the rules cannot produce.
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
      throw new TypeError("a Stack 10 seed must be a whole number");
    }
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Stack 10 seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

/** Advances the generator once and returns its state and base tile. */
function draw(state: bigint): { state: bigint; tile: number } {
  const next = (state * LCG_MULTIPLIER + LCG_INCREMENT) % SEED_MODULUS;
  return { state: next, tile: Number(next % 9n) + 1 };
}

function requirePlaced(placed: number): void {
  if (!Number.isInteger(placed) || placed < 0) {
    throw new RangeError("a tile index must be a whole number of zero or more");
  }
}

/**
 * The chance a tile arrives promoted, as a whole percentage.
 *
 * The first sixty tiles — the retired deck — are never promoted, so the opening
 * of an endless run is the game that shipped. From tile sixty-one the chance rises
 * one point every four tiles and stops at 60%: past that, every draw is more likely
 * promoted than not, and the weight below is what keeps the pressure rising.
 */
export function pressurePercent(placed: number): number {
  requirePlaced(placed);
  if (placed < RAMP_START) return 0;
  return Math.min(RAMP_PERCENT_MAX, Math.floor((placed - RAMP_START) / RAMP_PERCENT_PER_TILE));
}

/**
 * How much a promoted tile gains.
 *
 * One point for the first 240 tiles past the retired deck, then one more every 240,
 * with no cap: the weight is added to a 1–9 draw and clamped at 9, so the board
 * keeps receiving the heaviest tiles it can hold. The chance ceiling is not where
 * the difficulty stops, exactly as the retired deck was not where the run stops.
 */
export function heavyBonus(placed: number): number {
  requirePlaced(placed);
  return 1 + Math.floor(placed / RAMP_WEIGHT_SPAN);
}

/**
 * The tile that the `placed`-th move of a run draws (0-based).
 *
 * It is the generator's base draw, plus the ramp: a promoted tile is heavier, and
 * a tile can never exceed nine, because ten would be unplaceable on a board whose
 * columns clear at ten.
 */
export function tileAt(seed: string | number | bigint, placed: number): number {
  requirePlaced(placed);
  let state = initialState(seed);
  let tile = 0;
  for (let index = 0; index <= placed; index += 1) {
    const next = draw(state);
    state = next.state;
    tile = next.tile;
  }
  const promotionRoll = Number((state >> PROMOTION_SHIFT) % PROMOTION_MODULUS);
  return promotionRoll < pressurePercent(placed) ? Math.min(9, tile + heavyBonus(placed)) : tile;
}

/** A fresh run at the start of the board. */
export function createRun(seed: string | number | bigint): Stack10Run {
  const normalized = toBigInt(seed).toString();
  return {
    seed: normalized,
    rulesVersion: STACK10_RULES_VERSION,
    columns: emptyColumns(),
    actions: [],
    score: 0,
    clearedColumns: 0,
    nextTile: tileAt(seed, 0),
    outcome: "playing",
    endReason: null,
  };
}

function emptyColumns(): Stack10ColumnState[] {
  return Array.from({ length: STACK10_COLUMNS }, () => ({ tiles: [], sum: 0 }));
}

/**
 * Whether a move is playable: the run is live, the submission bound is not spent,
 * and the column exists.
 *
 * The board calls this to decide whether a column is pressable, so an impossible
 * move is never offered in the first place — and `place` checks it again, because a
 * keyboard or programmatic path must not be able to make one either.
 */
export function canPlace(run: Stack10Run, column: number): boolean {
  if (run.outcome !== "playing") return false;
  if (run.actions.length >= STACK10_MAX_TILES) return false;
  return Number.isInteger(column) && column >= 0 && column < STACK10_COLUMNS;
}

/**
 * Places the run's next tile in a column and returns the resulting run.
 *
 * An impossible move is not a move: the run comes back unchanged. That is
 * deliberate rather than an exception — a tap that arrives one frame after the
 * run ended must not throw inside a render — and it keeps this function total,
 * which is what makes it testable against every state.
 */
export function place(run: Stack10Run, column: number): Stack10Run {
  if (!canPlace(run, column)) return run;

  const placed = run.actions.length;
  const tile = tileAt(run.seed, placed);
  const columns = run.columns.map((existing, index) => {
    if (index !== column) return existing;
    const tiles = [...existing.tiles, tile];
    return { tiles, sum: existing.sum + tile };
  });

  const target = columns[column];
  const cleared = target.sum === CLEAR_TOTAL;
  const overflowed = target.sum > CLEAR_TOTAL;

  if (cleared) {
    // Stacking more tiles into a column before it clears is the riskier play —
    // fewer free columns, less room for the next tile — so it is what scores.
    // Identical arithmetic to the verifier's `10 + 5 * (stacks - 1)`.
    columns[column] = { tiles: [], sum: 0 };
  }

  const actions = [...run.actions, column];
  const limit = actions.length >= STACK10_MAX_TILES;
  const outcome: Stack10Outcome = overflowed || limit ? "over" : "playing";

  return {
    ...run,
    columns,
    actions,
    score: cleared ? run.score + CLEAR_SCORE + STACK_BONUS * (target.tiles.length - 1) : run.score,
    clearedColumns: cleared ? run.clearedColumns + 1 : run.clearedColumns,
    nextTile: outcome === "playing" ? tileAt(run.seed, actions.length) : null,
    outcome,
    endReason: overflowed ? "overflow" : limit ? "limit" : null,
  };
}

/**
 * Ends the run where it stands: the player stopped. The score is kept, and the
 * verifier accepts the line as it is, because the score only ever grows, so
 * stopping early can never earn a point. A run that is already over is returned
 * unchanged.
 */
export function finish(run: Stack10Run): Stack10Run {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", stopped: true };
}

/**
 * The body of a completion submission.
 *
 * It is assembled from the run rather than accepted from a caller, so the number
 * submitted is the one this engine computed and cannot be edited on the way out.
 */
export type Stack10Submission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  readonly tilesPlaced: number;
  readonly clearedColumns: number;
};

export function submission(run: Stack10Run): Stack10Submission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.actions,
    score: run.score,
    tilesPlaced: run.actions.length,
    clearedColumns: run.clearedColumns,
  };
}

/**
 * How far through the run the player is, for the progress readout.
 *
 * There is no total because there is no deck. The last two fields are the ramp as
 * it applies to the next tile: how likely it is to arrive promoted, and what a
 * promoted tile gains.
 */
export function progress(run: Stack10Run): {
  placed: number;
  pressurePercent: number;
  heavyBonus: number;
} {
  const placed = run.actions.length;
  return {
    placed,
    pressurePercent: pressurePercent(placed),
    heavyBonus: heavyBonus(placed),
  };
}
