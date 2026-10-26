/**
 * Don't Touch the Black — the game, as a pure deterministic state machine.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_dont_touch_run` in
 * `supabase/migrations/20261027120000_endless_dont_touch.sql` replays the
 * submitted taps from the session's seed and derives the score itself. Two copies
 * of one ruleset is a real risk, so the copy is pinned in three ways:
 *
 *   - **The rules version is data.** A session carries the version it was started
 *     under (`dont-touch@2`), the server refuses to verify a version it does not
 *     implement, and this module declares the same string. The server still
 *     verifies the retired finite `dont-touch@1` runs that older sessions pinned.
 *   - **The state machine is total and pure.** `tap` takes a run and a cell and
 *     returns a run — no clock, no randomness, no I/O — so the same inputs produce
 *     the same run on both sides. The conveyor's speed and the black density live
 *     in `rowWindow` and `blackPercent`, which are also pure: time decides when a
 *     row can be touched, never what touching it is worth.
 *   - **It is tested against the database's own numbers.** The vectors in
 *     `dont-touch.test.ts` are the ones `tests/security/rls_test.sql` asserts
 *     (seed 1's endless rows, a run that meets a black tile, a run that is
 *     stopped). See `docs/games/README.md`.
 *
 * The client cannot invent a score even if this file is wrong: a wrong replay
 * produces a number the server's replay disagrees with, and the submission is
 * refused with `score_mismatch`.
 *
 * Endless rule: there is no final row. Rows rise forever; the row at the line is
 * the only one that can be touched, and every white tile cleared scores ten
 * points. A black tile ends the run on the spot. Two curves make it harder as the
 * conveyor goes on:
 *
 *   - **Speed.** The window a row spends at the line starts at 1.6 s and falls to
 *     0.7 s over the first twenty-one rows; after that it keeps easing toward
 *     0.65 s, slowly but without ever stopping. There is no row at which the beat
 *     becomes fixed.
 *   - **Density.** The share of black tiles starts at 25% and rises by a
 *     percentage point every ten rows to 45%. A row may be all black, which is a
 *     row to let pass rather than a trap.
 *
 * A white tile that reaches the top of the line uncleared ends the run (`miss`).
 * That is the screen's call, because only the screen has a clock: it ends the run
 * the same way "End run" does, so the submission is the same list of taps and the
 * server's replay — which never needed a clock — verifies it unchanged. Ending a
 * run early can only lower a score, never raise one.
 *
 * The player can also end a run deliberately (`finish`, the "End run" control).
 * A stopped run is submitted with the whites it cleared; it does not need a black
 * tap, because the score is what was cleared, and stopping cannot add to it.
 *
 * Storage rule: nothing here is persisted. A run lives in React state for as long
 * as the screen is open; losing it costs the player one run and never a score,
 * because a score only exists once the server has verified it.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const DONT_TOUCH_RUNTIME = "dont-touch";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const DONT_TOUCH_RULES_VERSION = "dont-touch@2";

/** The conveyor: three lanes per row, and a row for every step forward. */
export const DONT_TOUCH_LANES = 3;

/**
 * The most taps a submission may carry, and the cells those taps may address.
 *
 * These are request and replay bounds, not a final row: a run that reached them
 * would have been played for many minutes, far past the point where a session is
 * still open. `MAX_ROWS` rows × three lanes is the last full row a cell can name,
 * and no run can tap a cell twice, so the two bounds are the same number.
 */
export const DONT_TOUCH_MAX_ROWS = 1365;
export const DONT_TOUCH_MAX_CELLS = DONT_TOUCH_MAX_ROWS * DONT_TOUCH_LANES;
export const DONT_TOUCH_MAX_ACTIONS = DONT_TOUCH_MAX_CELLS;

/** A cleared white tile is worth ten points; a black one is worth nothing. */
const TILE_SCORE = 10;

// The generator, state for state as `complete_dont_touch_run` advances it: the
// same 32-bit LCG the other games use, with the same zero-state fallback and the
// same decimal-string seed handling, because a seed that differs by one bit
// colours a different conveyor.
//
// The colour is read from bits 16–17 rather than the low bits, and deliberately
// so: this LCG's low bits cycle with a period of two to the power of the bit
// width, and a colour read from them would repeat a fixed pattern regardless of
// the seed. The higher bits have the full period, so each seed gets its own
// conveyor.
const SEED_MODULUS = 4294967296n;
const LCG_MULTIPLIER = 1664525n;
const LCG_INCREMENT = 1013904223n;
// 0x9E3779B9. The verifier substitutes it for a zero state, which would otherwise
// produce a constant sequence; mirrored so both sides treat a degenerate seed the
// same way.
const ZERO_STATE_FALLBACK = 2654435769n;
const COLOUR_SHIFT = 16n;
const PERCENT = 100n;

// The black-density ramp: one percentage point every ten rows, from 25% to 45%.
// 45% is where a row still usually has a white tile to take (55% of cells are
// white, and an all-black row is simply let pass), while missing a white hurts.
const BLACK_PERCENT_START = 25;
const BLACK_PERCENT_STEP_ROWS = 10;
const BLACK_PERCENT_MAX = 45;

// The speed curve. The first twenty-one rows are linear; after that the window
// eases toward its 650 ms floor without reaching it, so the beat never becomes
// static. The floor is a readability limit: below it, three lanes cannot be
// scanned fairly on a phone.
const WINDOW_START_MS = 1600;
const WINDOW_STEP_MS = 45;
const WINDOW_LINEAR_ROWS = 20;
const WINDOW_EASE_MS = 650;
const WINDOW_EASE_SPAN = 7500;

function initialState(seed: string | number | bigint): bigint {
  const value = toBigInt(seed);
  const reduced = ((value % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS;
  return reduced === 0n ? ZERO_STATE_FALLBACK : reduced;
}

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) {
      throw new TypeError("a Don't Touch the Black seed must be a whole number");
    }
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Don't Touch the Black seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

function advance(state: bigint): bigint {
  return (state * LCG_MULTIPLIER + LCG_INCREMENT) % SEED_MODULUS;
}

/**
 * The share of black tiles in a row, as a whole percentage.
 *
 * Row 0 is 25%; every ten rows adds one point, capped at 45% from row 200 on.
 * Black density is what keeps the game getting harder after the row window has
 * reached its readable floor.
 */
export function blackPercent(row: number): number {
  requireRow(row, "a row");
  return Math.min(
    BLACK_PERCENT_MAX,
    BLACK_PERCENT_START + Math.floor(row / BLACK_PERCENT_STEP_ROWS),
  );
}

/**
 * How long a row stays at the line, in milliseconds.
 *
 * Row 0 is 1.6 s; the first twenty-one rows shorten linearly to 0.7 s, then the
 * window eases toward 0.65 s. The curve is deterministic and non-increasing, so
 * the conveyor never slows down and two players at the same row face the same
 * beat.
 */
export function rowWindow(row: number): number {
  requireRow(row, "a row");
  if (row <= WINDOW_LINEAR_ROWS) {
    return WINDOW_START_MS - WINDOW_STEP_MS * row;
  }
  const beyond = row - WINDOW_LINEAR_ROWS;
  return Math.round(WINDOW_EASE_MS + WINDOW_EASE_SPAN / (beyond + 150));
}

/**
 * Whether cell `cell` is black on seed `seed`'s conveyor.
 *
 * Cell k is drawn after k + 1 advances of the generator, so the first cell is the
 * same one the verifier reads and neither copy can drift by one draw. The colour
 * is the state's high bits modulo 100 against the row's black percentage, which
 * makes the density a property of the row rather than of the draw.
 */
export function isBlack(seed: string | number | bigint, cell: number): boolean {
  requireCell(cell);
  let state = initialState(seed);
  for (let drawn = 0; drawn <= cell; drawn += 1) {
    state = advance(state);
  }
  return Number((state >> COLOUR_SHIFT) % PERCENT) < blackPercent(rowOf(cell));
}

/**
 * One row's three colours, in lane order.
 *
 * The runtime asks for the four rows it shows on every step, so this reads the
 * generator once per row rather than three times. It is still a pure function of
 * the seed and the row.
 */
export function rowAt(seed: string | number | bigint, row: number): boolean[] {
  requireRow(row, "a row");
  if (row >= DONT_TOUCH_MAX_ROWS) {
    throw new RangeError(`a Don't Touch the Black row is 0 to ${DONT_TOUCH_MAX_ROWS - 1}`);
  }
  let state = initialState(seed);
  for (let drawn = 0; drawn < row * DONT_TOUCH_LANES; drawn += 1) {
    state = advance(state);
  }
  const percent = blackPercent(row);
  const colours: boolean[] = [];
  for (let lane = 0; lane < DONT_TOUCH_LANES; lane += 1) {
    state = advance(state);
    colours.push(Number((state >> COLOUR_SHIFT) % PERCENT) < percent);
  }
  return colours;
}

/** The row a cell belongs to. */
export function rowOf(cell: number): number {
  return Math.floor(cell / DONT_TOUCH_LANES);
}

/** The lane a cell belongs to. */
export function laneOf(cell: number): number {
  return cell % DONT_TOUCH_LANES;
}

/** The cell at a row and lane. */
export function cellAt(row: number, lane: number): number {
  return row * DONT_TOUCH_LANES + lane;
}

function requireRow(row: number, what: string): void {
  if (!Number.isInteger(row) || row < 0) {
    throw new RangeError(`${what} must be a whole number of zero or more`);
  }
}

function requireCell(cell: number): void {
  if (!Number.isInteger(cell) || cell < 0 || cell >= DONT_TOUCH_MAX_CELLS) {
    throw new RangeError(`a Don't Touch the Black cell is 0 to ${DONT_TOUCH_MAX_CELLS - 1}`);
  }
}

/**
 * How a run ended.
 *
 * `black` — a black tile was touched, which is the ordinary ending. `stop` — the
 * player ended the run deliberately; the whites already cleared still count.
 * `miss` — a white tile passed the line uncleared. `null` while the run is live.
 */
export type DontTouchEndReason = "black" | "miss" | "stop" | null;

export type DontTouchOutcome = "playing" | "over";

/** One run, as this module knows it. */
export type DontTouchRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /**
   * Every cell tapped, in order, including the black cell that ended the run.
   * This *is* the submission: the server replays this list and nothing else.
   */
  readonly taps: readonly number[];
  /** White tiles cleared. Each one is worth ten points. */
  readonly cleared: number;
  /** The score this run earns under the rules, as the server computes it too. */
  readonly score: number;
  readonly outcome: DontTouchOutcome;
  readonly endReason: DontTouchEndReason;
};

/** A fresh run at the top of the conveyor. */
export function createRun(seed: string | number | bigint): DontTouchRun {
  return {
    seed: toBigInt(seed).toString(),
    rulesVersion: DONT_TOUCH_RULES_VERSION,
    taps: [],
    cleared: 0,
    score: 0,
    outcome: "playing",
    endReason: null,
  };
}

/**
 * Whether a tap is playable: the run is live and the cell is on the conveyor and
 * has not been touched already.
 *
 * The screen calls this to decide whether a tile is pressable, so a tile that is
 * above the line or already cleared is never offered — and `tap` checks it again,
 * because a keyboard or programmatic path must not be able to make one either.
 */
export function canTap(run: DontTouchRun, cell: number): boolean {
  if (run.outcome !== "playing") return false;
  if (!Number.isInteger(cell) || cell < 0 || cell >= DONT_TOUCH_MAX_CELLS) return false;
  return !run.taps.includes(cell);
}

/**
 * Taps a cell and returns the resulting run.
 *
 * A white tile clears and scores ten points. A black tile ends the run; the tap
 * that ended it is still part of the run and is submitted, the way the stopping
 * tap of a Chain run is. A tap that is impossible — a cell off the conveyor, or
 * one already tapped — is not a tap: the run comes back unchanged, which keeps
 * this function total and lets a stray event one frame after the run ended be
 * harmless.
 */
export function tap(run: DontTouchRun, cell: number): DontTouchRun {
  if (!canTap(run, cell)) return run;

  const taps = [...run.taps, cell];
  if (isBlack(run.seed, cell)) {
    return { ...run, taps, outcome: "over", endReason: "black" };
  }
  return {
    ...run,
    taps,
    cleared: run.cleared + 1,
    score: run.score + TILE_SCORE,
  };
}

/**
 * Ends the run because the player asked to stop.
 *
 * A stopped run is a real result: it is submitted with the whites it cleared, and
 * the server accepts it without a black tap. It cannot inflate a score — the
 * score is the whites already cleared — and it is the way out of a conveyor that
 * has no natural last row. A run already over is returned unchanged.
 */
export function finish(run: DontTouchRun): DontTouchRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", endReason: "stop" };
}

/**
 * Ends the run because a white tile in row `row` passed the line uncleared.
 *
 * The screen calls this when a row's window closes. A row with no untouched white
 * tile (all black, or every white cleared) is not a miss, and the run comes back
 * unchanged. Like `finish`, it adds no tap, so the submission is exactly the taps
 * that were made.
 */
export function miss(run: DontTouchRun, row: number): DontTouchRun {
  if (run.outcome !== "playing") return run;
  if (!hasUnclearedWhite(run, row)) return run;
  return { ...run, outcome: "over", endReason: "miss" };
}

/** Whether row `row` still has a white tile the run has not cleared. */
export function hasUnclearedWhite(run: DontTouchRun, row: number): boolean {
  requireRow(row, "a row");
  if (row >= DONT_TOUCH_MAX_ROWS) return false;
  const colours = rowAt(run.seed, row);
  return colours.some((black, lane) => !black && !run.taps.includes(cellAt(row, lane)));
}

/**
 * The body of a completion submission.
 *
 * It is assembled from the run rather than accepted from a caller, so the number
 * submitted is the one this engine computed and cannot be edited on the way out.
 */
export type DontTouchSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: DontTouchRun): DontTouchSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.taps,
    score: run.score,
  };
}

/**
 * The progression readout: how many whites were cleared, and how far down the
 * conveyor the run got. There is no `total` because there is no final row.
 */
export function progress(run: DontTouchRun): {
  cleared: number;
  row: number;
} {
  const last = run.taps.at(-1);
  return {
    cleared: run.cleared,
    row: last === undefined ? 0 : rowOf(last) + 1,
  };
}
