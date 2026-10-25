/**
 * One Move — the game, as a pure deterministic state machine.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_one_move_run` in
 * `supabase/migrations/20261031120000_endless_one_move.sql` replays the submitted
 * tap list from the session's seed and derives the score itself. Two copies of one
 * ruleset is a real risk, so the copy is pinned in three ways:
 *
 *   - **The rules version is data.** A session carries the version it was started
 *     under (`one-move@2`), the server refuses to verify a version it does not
 *     implement, and this module declares the same string. A change to the rules
 *     is a change to the version, not an edit in place. The retired twelve-board
 *     `one-move@1` game is still verified by the server for sessions opened before
 *     this version, but no new run pins it.
 *   - **The state machine is total and pure.** `tap` takes a run and a cell and
 *     returns a run — no clock, no randomness, no I/O — so the same inputs produce
 *     the same run on both sides.
 *   - **It is tested against the database's own numbers.** The vectors in
 *     `one-move.test.ts` are the ones `tests/security/rls_test.sql` asserts (seed
 *     1's winning cells, the endless line past the retired twelfth board, and a
 *     missed move). See `docs/games/README.md`.
 *
 * The client cannot invent a score even if this file is wrong: a wrong replay
 * produces a number the server's replay disagrees with, and the submission is
 * refused with `score_mismatch`.
 *
 * ## The endless game
 *
 * The shipped game ended after twelve boards. That was the only artificial ending
 * it had: each board asks the same question — which one cell restores the
 * checkerboard? — and there was no reason the thirteenth could not be asked.
 * This version removes the twelfth-board ending and keeps every failure condition
 * the game always had: a tap that is not the board's winning cell ends the run.
 *
 * Difficulty is a function of the level, so every player meets the same board at
 * the same point:
 *
 *   - **The board grows every four levels.** 3×3 for levels 1–4, 4×4 for 5–8,
 *     5×5 for 9–12, 6×6 for 13–16, and one more row and column every four levels
 *     after that, without cap. The winning cell is always the centre of the one
 *     flipped cross, so the question stays the same while the space to search
 *     grows quadratically — a 6×6 board has 36 cells to scan, a 10×10 has 100,
 *     and the curve never flattens.
 *
 * The submission bound is not a level. A run may carry at most 4096 taps, a
 * request and replay ceiling far past any run a session is still open for, and it
 * ends a run that reaches it rather than describing one.
 *
 * Storage rule: nothing here is persisted. A run lives in React state for as long
 * as the screen is open; losing it costs the player one run and never a score,
 * because a score only exists once the server has verified it.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const ONE_MOVE_RUNTIME = "one-move";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const ONE_MOVE_RULES_VERSION = "one-move@2";

/** The first board is 3×3; it gains a row and a column every growth step. */
export const ONE_MOVE_START_SIDE = 3;

/** How many levels one board size serves. 3×3 for 1–4, 4×4 for 5–8, and so on. */
export const ONE_MOVE_GROWTH_LEVELS = 4;

/**
 * The most taps one submission may carry. A request ceiling, not a final level:
 * a perfect run places one tap per level, so the bound is unreachable in a
 * session that is still open.
 */
export const ONE_MOVE_MAX_ACTIONS = 4096;

/** A restored board scores, and a board is all-or-nothing. */
const LEVEL_SCORE = 10;

// The generator, state for state as `complete_one_move_run` advances it: the same
// 32-bit LCG Stack 10's deck uses (see `src/lib/games/stack10.ts`), with the same
// zero-state fallback and the same decimal-string seed handling, because a seed
// that differs by one bit wins on a different cell.
//
// The winning cell is read from bits 16 and above (`(state >> 16) % cells`) rather
// than the low bits, and deliberately so: this LCG's low bits cycle with a period
// of two to the power of the bit width, so a small board read from them would
// repeat a fixed cycle. The higher bits have the full period, so each seed has its
// own boards. The cell count changes with the board size, so the value is taken
// modulo the current level's board, not modulo 16.
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
 * `over` — a tap was not the one that restores the board, or the submission bound
 * was reached. There is no `cleared`: the boards do not end.
 */
export type OneMoveOutcome = "playing" | "over";

/** One run, as this module knows it. */
export type OneMoveRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /**
   * Every cell tapped, in order, including the tap that ended the run. This *is*
   * the submission: the server replays this list and nothing else.
   */
  readonly taps: readonly number[];
  /** Boards restored so far. Each one is worth ten points. */
  readonly levelsCleared: number;
  /** The board being played, 1-based. It has no upper bound. */
  readonly level: number;
  /** The score this run earns under the rules, as the server computes it too. */
  readonly score: number;
  readonly outcome: OneMoveOutcome;
  /** True when the player ended the run, rather than the game ending it. */
  readonly stopped?: true;
};

/**
 * Normalises a seed to the 32-bit state the generator starts from.
 *
 * It mirrors the verifier's own expression — including its handling of a negative
 * or zero seed — because a state that differs by one bit wins on a different
 * cell, and the run would be rejected as a run the rules cannot produce.
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
      throw new TypeError("a One Move seed must be a whole number");
    }
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a One Move seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError("a One Move level must be a whole number from 1");
  }
}

/**
 * The side of the board a level is played on.
 *
 * 3 for levels 1–4, 4 for 5–8, 5 for 9–12, then one more every four levels. The
 * width only ever grows, so a cell a player is looking at stays on the board when
 * the next one is drawn, and there is no level at which the growth stops.
 */
export function boardSize(level: number): number {
  assertLevel(level);
  return ONE_MOVE_START_SIDE + Math.floor((level - 1) / ONE_MOVE_GROWTH_LEVELS);
}

/** The number of cells on a level's board. */
export function cellCount(level: number): number {
  const size = boardSize(level);
  return size * size;
}

/** Advances the generator once. */
function advance(state: bigint): bigint {
  return (state * LCG_MULTIPLIER + LCG_INCREMENT) % SEED_MODULUS;
}

/**
 * The cell whose cross was flipped on a level's board — the run's one winning
 * move.
 *
 * The state progresses once per level, so board two is drawn from the second
 * state and not the first, and the verifier reproduces the same cell. It is
 * exported because the board has to know which pattern it is showing, and a
 * screen must not grow a second copy of the generator.
 */
export function winningCell(seed: string | number | bigint, level: number): number {
  assertLevel(level);
  const cells = cellCount(level);
  let state = initialState(seed);
  for (let current = 1; current <= level; current += 1) {
    state = advance(state);
  }
  return Number((state >> CELL_SHIFT) % BigInt(cells));
}

/** Whether a cell is dark on a *solved* board: a checkerboard, in board order. */
export function solvedCell(level: number, cell: number): boolean {
  const size = boardSize(level);
  if (!Number.isInteger(cell) || cell < 0 || cell >= size * size) {
    throw new RangeError("a One Move cell must be on the level's board");
  }
  const row = Math.floor(cell / size);
  const column = cell % size;
  return (row + column) % 2 === 0;
}

/**
 * The cells a move on `cell` flips: the cell itself and its four orthogonal
 * neighbours, truncated at the board's edges.
 *
 * A move at a corner therefore flips three cells and a move in the middle of a
 * 5×5 board flips five. Truncation is part of the rules, not a rendering detail:
 * both engine copies compute the same cross, and the winning cell is unique
 * because two different crosses always differ as sets.
 */
export function crossCells(level: number, cell: number): number[] {
  const size = boardSize(level);
  if (!Number.isInteger(cell) || cell < 0 || cell >= size * size) {
    throw new RangeError("a One Move cell must be on the level's board");
  }
  const row = Math.floor(cell / size);
  const column = cell % size;
  const cells = [cell];
  if (row > 0) cells.push(cell - size);
  if (row < size - 1) cells.push(cell + size);
  if (column > 0) cells.push(cell - 1);
  if (column < size - 1) cells.push(cell + 1);
  return cells;
}

/** A level's board as it is shown before the winning move is made. */
export type OneMoveBoard = {
  readonly size: number;
  readonly center: number;
  /** `true` is a dark cell; `false` is a light one. Indexed in board order. */
  readonly cells: readonly boolean[];
};

/**
 * The board a level shows.
 *
 * It is a solved checkerboard with exactly one cross already flipped. That is why
 * the level has exactly one winning move: tapping any other cell would flip a
 * different cross, and the two crosses cannot cancel to leave the board solved.
 */
export function boardPattern(seed: string | number | bigint, level: number): OneMoveBoard {
  const size = boardSize(level);
  const center = winningCell(seed, level);
  const flipped = new Set(crossCells(level, center));
  const cells = Array.from({ length: size * size }, (_, index) => {
    const solved = solvedCell(level, index);
    return flipped.has(index) ? !solved : solved;
  });
  return { size, center, cells };
}

/** A fresh run at the start of the first board. */
export function createRun(seed: string | number | bigint): OneMoveRun {
  return {
    seed: toBigInt(seed).toString(),
    rulesVersion: ONE_MOVE_RULES_VERSION,
    taps: [],
    levelsCleared: 0,
    level: 1,
    score: 0,
    outcome: "playing",
  };
}

/**
 * Whether a tap is playable: the run is live, there are taps left, and the cell
 * exists on the current board.
 *
 * The board calls this to decide whether a cell is pressable, so an impossible
 * tap is never offered in the first place — and `tap` checks it again, because a
 * keyboard or programmatic path must not be able to make one either.
 */
export function canTap(run: OneMoveRun, cell: number): boolean {
  if (run.outcome !== "playing") return false;
  if (run.taps.length >= ONE_MOVE_MAX_ACTIONS) return false;
  return Number.isInteger(cell) && cell >= 0 && cell < cellCount(run.level);
}

/**
 * Taps a cell and returns the resulting run.
 *
 * Exactly one cell restores the current board: the one the cross was flipped
 * from. Tapping it clears the board and scores ten points; tapping any other
 * cell ends the run. The ending tap is still part of the run and is submitted,
 * the way Stack 10's overflowing tile is. Clearing a board deals the next one —
 * one row and one column larger every four levels — and there is no last board.
 *
 * An impossible tap is not a tap: the run comes back unchanged. That is
 * deliberate rather than an exception — a tap that arrives one frame after the
 * run ended must not throw inside a render — and it keeps this function total.
 */
export function tap(run: OneMoveRun, cell: number): OneMoveRun {
  if (!canTap(run, cell)) return run;

  const taps = [...run.taps, cell];
  if (cell !== winningCell(run.seed, run.level)) {
    return { ...run, taps, outcome: "over" };
  }

  // A correct tap can still be the submission's last: at the bound there is no
  // next tap to carry, so the run ends here the way the server's replay ends it,
  // rather than offering a board no tap can reach.
  return {
    ...run,
    taps,
    levelsCleared: run.levelsCleared + 1,
    level: run.level + 1,
    score: run.score + LEVEL_SCORE,
    outcome: taps.length >= ONE_MOVE_MAX_ACTIONS ? "over" : "playing",
  };
}

/**
 * Ends the run where it stands: the player stopped. The score is kept, and the
 * verifier accepts the line as it is, because the score only ever grows, so
 * stopping early can never earn a point. A run that is already over is returned
 * unchanged.
 */
export function finish(run: OneMoveRun): OneMoveRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", stopped: true };
}

/**
 * The body of a completion submission.
 *
 * It is assembled from the run rather than accepted from a caller, so the number
 * submitted is the one this engine computed and cannot be edited on the way out.
 */
export type OneMoveSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  readonly tapsPlaced: number;
  readonly levelsCleared: number;
};

export function submission(run: OneMoveRun): OneMoveSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.taps,
    score: run.score,
    tapsPlaced: run.taps.length,
    levelsCleared: run.levelsCleared,
  };
}

/** How far through the run the player is, and how large the current board is. */
export function progress(run: OneMoveRun): {
  taps: number;
  total: number;
  level: number;
  side: number;
  cells: number;
} {
  return {
    taps: run.taps.length,
    total: ONE_MOVE_MAX_ACTIONS,
    level: run.level,
    side: boardSize(run.level),
    cells: cellCount(run.level),
  };
}
