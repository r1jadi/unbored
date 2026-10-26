/**
 * 8 Puzzle — the game, as a pure deterministic state machine.
 *
 * The classic sliding puzzle: eight numbered tiles and one gap on a 3×3 board.
 * Slide a tile next to the gap into it, until the tiles read 1 to 8 with the gap
 * in the bottom-right corner.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_eight_puzzle_run` in
 * `supabase/migrations/20261106120000_eight_puzzle_sessions.sql` replays the
 * submitted slides from the session's seed and derives the score itself. The copy
 * is pinned like every other game's: the rules version (`eight-puzzle@1`) is data,
 * the state machine is total and pure, and the boards and scored lines in
 * `eight-puzzle.test.ts` are the ones `tests/security/rls_test.sql` asserts.
 *
 * ## The boards
 *
 * Every board is the solved board scrambled by a random walk of the gap, so every
 * board can be solved — half of all tile arrangements cannot, and a walk from the
 * solved board never reaches one of those. The walk never steps straight back, so
 * its length is a real measure of the scramble, and it grows with the level: ten
 * steps on board one, three more on every board after, up to eighty, which is
 * as good as a uniformly random board. Both copies draw the same walk.
 *
 * ## The endless game, against the clock
 *
 * Like Zip, a run is a series of boards against one clock that the server times:
 * sixty seconds to start, fifteen more for every solved board, ten points a board.
 * The session is issued when the player presses Start, and the verifier refuses a
 * run that arrives later than the time its solved boards earned (`out_of_time`).
 * The player may end a run at any time and keep its score.
 *
 * Storage rule: nothing here is persisted. A score only exists once the server has
 * verified it.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const EIGHT_PUZZLE_RUNTIME = "eight-puzzle";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const EIGHT_PUZZLE_RULES_VERSION = "eight-puzzle@1";

/** The board is always 3×3. */
export const EIGHT_PUZZLE_SIDE = 3;

/** The most slides one submission may carry: a request ceiling, not a final board. */
export const EIGHT_PUZZLE_MAX_ACTIONS = 8192;

/** The clock a run starts with, and what every solved board adds. */
export const EIGHT_PUZZLE_START_MS = 60_000;
export const EIGHT_PUZZLE_BONUS_MS = 15_000;

/** How late after its clock ran out the server still accepts a run. */
export const EIGHT_PUZZLE_SLACK_MS = 20_000;

/** Ten points a solved board. */
const POINTS_PER_BOARD = 10;

/** The solved board, in board order: 1 to 8, then the gap (0). */
export const SOLVED: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 0];

const CELLS = EIGHT_PUZZLE_SIDE * EIGHT_PUZZLE_SIDE;

// The same generators as Queens and Zip: One Move's outer LCG advanced once per
// level, and a second LCG started at that state to draw the board.
const SEED_MODULUS = 4294967296n;
const ZERO_STATE_FALLBACK = 2654435769;
const OUTER_MULTIPLIER = 1664525;
const OUTER_INCREMENT = 1013904223;
const INNER_MULTIPLIER = 22695477;
const INNER_INCREMENT = 1;

export type EightPuzzleEnding = "time" | "stopped" | "bound";
export type EightPuzzleOutcome = "playing" | "over";

/** One run, as this module knows it. */
export type EightPuzzleRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /** Every cell slid, in order. This *is* the submission. */
  readonly taps: readonly number[];
  /** The board being played, 1-based. */
  readonly level: number;
  /** The current board's tiles, in board order; 0 is the gap. */
  readonly tiles: readonly number[];
  /** Slides made on the current board. */
  readonly moves: number;
  readonly levelsCleared: number;
  readonly score: number;
  readonly outcome: EightPuzzleOutcome;
  readonly ending: EightPuzzleEnding | null;
};

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new TypeError("an 8 Puzzle seed must be a whole number");
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("an 8 Puzzle seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

function initialState(seed: string | number | bigint): number {
  const value = toBigInt(seed);
  const reduced = Number(((value % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS);
  return reduced === 0 ? ZERO_STATE_FALLBACK : reduced;
}

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError("an 8 Puzzle level must be a whole number from 1");
  }
}

/** The length of a level's scramble: 10, then three more a board, up to 80. */
export function scrambleLength(level: number): number {
  assertLevel(level);
  return Math.min(80, 10 + 3 * (level - 1));
}

/** The clock a run has earned once `levelsCleared` boards are solved, in ms. */
export function budgetMs(levelsCleared: number): number {
  return EIGHT_PUZZLE_START_MS + EIGHT_PUZZLE_BONUS_MS * Math.max(0, levelsCleared);
}

/** Row and column steps of the gap, in the order a direction draw picks them. */
const STEPS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/** The direction that undoes each one: up ↔ down, left ↔ right. */
const REVERSE = [1, 0, 3, 2];

function isSolved(tiles: readonly number[]): boolean {
  return tiles.every((tile, index) => tile === SOLVED[index]);
}

/**
 * The board a level starts on.
 *
 * The gap starts in the bottom-right corner of the solved board and takes
 * `scrambleLength(level)` steps. Each step lists the directions the gap can move —
 * up, down, left, right, in that order — leaving out the board's edges and the
 * step straight back, and picks one with the next draw. A walk that happens to
 * end on the solved board takes more steps until it does not.
 */
export function board(seed: string | number | bigint, level: number): number[] {
  assertLevel(level);
  let state = initialState(seed);
  for (let current = 1; current <= level; current += 1) {
    state = (Math.imul(state, OUTER_MULTIPLIER) + OUTER_INCREMENT) >>> 0;
  }
  const next = () => {
    state = (Math.imul(state, INNER_MULTIPLIER) + INNER_INCREMENT) >>> 0;
    return state >>> 16;
  };

  const tiles = [...SOLVED];
  let gap = CELLS - 1;
  let previous = -1;
  const step = () => {
    const row = Math.floor(gap / EIGHT_PUZZLE_SIDE);
    const column = gap % EIGHT_PUZZLE_SIDE;
    const options: number[] = [];
    STEPS.forEach(([rowStep, columnStep], direction) => {
      const r = row + rowStep;
      const c = column + columnStep;
      if (r < 0 || r >= EIGHT_PUZZLE_SIDE || c < 0 || c >= EIGHT_PUZZLE_SIDE) return;
      if (previous >= 0 && direction === REVERSE[previous]) return;
      options.push(direction);
    });
    const direction = options[next() % options.length];
    const target = gap + STEPS[direction][0] * EIGHT_PUZZLE_SIDE + STEPS[direction][1];
    tiles[gap] = tiles[target];
    tiles[target] = 0;
    gap = target;
    previous = direction;
  };

  for (let index = 0; index < scrambleLength(level); index += 1) step();
  while (isSolved(tiles)) step();
  return tiles;
}

/** A fresh run on board one. */
export function createRun(seed: string | number | bigint): EightPuzzleRun {
  const normalised = toBigInt(seed).toString();
  return {
    seed: normalised,
    rulesVersion: EIGHT_PUZZLE_RULES_VERSION,
    taps: [],
    level: 1,
    tiles: board(normalised, 1),
    moves: 0,
    levelsCleared: 0,
    score: 0,
    outcome: "playing",
    ending: null,
  };
}

/** Whether two cells share an edge. */
function adjacent(a: number, b: number): boolean {
  const rowA = Math.floor(a / EIGHT_PUZZLE_SIDE);
  const rowB = Math.floor(b / EIGHT_PUZZLE_SIDE);
  const sameRow = rowA === rowB && Math.abs(a - b) === 1;
  const sameColumn = a % EIGHT_PUZZLE_SIDE === b % EIGHT_PUZZLE_SIDE && Math.abs(rowA - rowB) === 1;
  return sameRow || sameColumn;
}

/** Whether a cell's tile can slide: the run is live, and the tile is next to the gap. */
export function canTap(run: EightPuzzleRun, cell: number): boolean {
  if (run.outcome !== "playing") return false;
  if (run.taps.length >= EIGHT_PUZZLE_MAX_ACTIONS) return false;
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return false;
  if (run.tiles[cell] === 0) return false;
  return adjacent(cell, run.tiles.indexOf(0));
}

/**
 * Slides the tile on a cell into the gap.
 *
 * A slide that solves the board scores ten points and deals the next board. A
 * slide that is not possible returns the same run object.
 */
export function tap(run: EightPuzzleRun, cell: number): EightPuzzleRun {
  if (!canTap(run, cell)) return run;
  const taps = [...run.taps, cell];
  const atBound = taps.length >= EIGHT_PUZZLE_MAX_ACTIONS;
  const tiles = [...run.tiles];
  const gap = tiles.indexOf(0);
  tiles[gap] = tiles[cell];
  tiles[cell] = 0;

  if (isSolved(tiles)) {
    const level = run.level + 1;
    return {
      ...run,
      taps,
      level,
      tiles: board(run.seed, level),
      moves: 0,
      levelsCleared: run.levelsCleared + 1,
      score: run.score + POINTS_PER_BOARD,
      outcome: atBound ? "over" : "playing",
      ending: atBound ? "bound" : null,
    };
  }
  return {
    ...run,
    taps,
    tiles,
    moves: run.moves + 1,
    outcome: atBound ? "over" : "playing",
    ending: atBound ? "bound" : null,
  };
}

/**
 * The slides a tap on any tile in the gap's row or column stands for.
 *
 * Tapping a tile two cells from the gap slides it and the tile between them
 * together: with the gap at the end of a row, tapping the row's far tile moves
 * both one cell along and leaves the gap where the tapped tile was. That is two
 * ordinary slides, nearest the gap first, so the submission and the verifier are
 * unchanged — each one is a single adjacent slide the rules already accept.
 *
 * A tile next to the gap is the one slide it always was. A tile off the gap's row
 * and column has none. The list stops after a slide that solves the board, since
 * the next board is dealt there and the rest of the line no longer exists.
 */
export function lineTaps(run: EightPuzzleRun, cell: number): number[] {
  if (run.outcome !== "playing") return [];
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS || run.tiles[cell] === 0) return [];
  const gap = run.tiles.indexOf(0);
  const sameRow = Math.floor(gap / EIGHT_PUZZLE_SIDE) === Math.floor(cell / EIGHT_PUZZLE_SIDE);
  const sameColumn = gap % EIGHT_PUZZLE_SIDE === cell % EIGHT_PUZZLE_SIDE;
  if (!sameRow && !sameColumn) return [];

  const step = sameRow ? 1 : EIGHT_PUZZLE_SIDE;
  const direction = cell > gap ? step : -step;
  const taps: number[] = [];
  let current = run;
  for (let next = gap + direction; ; next += direction) {
    const after = tap(current, next);
    if (after === current) return [];
    taps.push(next);
    if (next === cell || after.level !== current.level) return taps;
    current = after;
  }
}

/**
 * The cell whose tile an arrow key slides: the tile on the far side of the gap
 * from the arrow, so ArrowUp moves the tile below the gap up. Null at an edge.
 */
export function cellForArrow(
  run: EightPuzzleRun,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
): number | null {
  const gap = run.tiles.indexOf(0);
  const row = Math.floor(gap / EIGHT_PUZZLE_SIDE);
  const column = gap % EIGHT_PUZZLE_SIDE;
  const [r, c] =
    key === "ArrowUp"
      ? [row + 1, column]
      : key === "ArrowDown"
        ? [row - 1, column]
        : key === "ArrowLeft"
          ? [row, column + 1]
          : [row, column - 1];
  if (r < 0 || r >= EIGHT_PUZZLE_SIDE || c < 0 || c >= EIGHT_PUZZLE_SIDE) return null;
  return r * EIGHT_PUZZLE_SIDE + c;
}

/** Ends the run where it stands: the clock ran out, or the player stopped. */
export function finish(run: EightPuzzleRun, ending: "time" | "stopped"): EightPuzzleRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending };
}

export type EightPuzzleSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  readonly tapsPlaced: number;
  readonly levelsCleared: number;
};

export function submission(run: EightPuzzleRun): EightPuzzleSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.taps,
    score: run.score,
    tapsPlaced: run.taps.length,
    levelsCleared: run.levelsCleared,
  };
}

/**
 * The fewest slides that solve a board. The screen shows it as the board's par;
 * the score does not use it.
 *
 * Iterative-deepening A*: a depth-first search bounded by the slides made so far
 * plus the tiles' total Manhattan distance from home, which never overestimates,
 * so the first solution found is a shortest one. A 3×3 board is never more than
 * 31 slides from solved, and the search takes a few milliseconds.
 */
export function fewestMoves(tiles: readonly number[]): number {
  const board = [...tiles];
  const distance = (tile: number, cell: number) => {
    const home = tile - 1;
    return (
      Math.abs(Math.floor(home / EIGHT_PUZZLE_SIDE) - Math.floor(cell / EIGHT_PUZZLE_SIDE)) +
      Math.abs((home % EIGHT_PUZZLE_SIDE) - (cell % EIGHT_PUZZLE_SIDE))
    );
  };
  let estimate = 0;
  board.forEach((tile, cell) => {
    if (tile !== 0) estimate += distance(tile, cell);
  });
  if (estimate === 0) return 0;

  const FOUND = -1;
  const search = (
    gap: number,
    spent: number,
    bound: number,
    previous: number,
    h: number,
  ): number => {
    const f = spent + h;
    if (f > bound) return f;
    if (h === 0) return FOUND;
    let smallest = Infinity;
    for (let direction = 0; direction < 4; direction += 1) {
      if (previous >= 0 && direction === REVERSE[previous]) continue;
      const r = Math.floor(gap / EIGHT_PUZZLE_SIDE) + STEPS[direction][0];
      const c = (gap % EIGHT_PUZZLE_SIDE) + STEPS[direction][1];
      if (r < 0 || r >= EIGHT_PUZZLE_SIDE || c < 0 || c >= EIGHT_PUZZLE_SIDE) continue;
      const target = r * EIGHT_PUZZLE_SIDE + c;
      const tile = board[target];
      const nextH = h - distance(tile, target) + distance(tile, gap);
      board[gap] = tile;
      board[target] = 0;
      const result = search(target, spent + 1, bound, direction, nextH);
      board[target] = tile;
      board[gap] = 0;
      if (result === FOUND) return FOUND;
      if (result < smallest) smallest = result;
    }
    return smallest;
  };

  for (let bound = estimate; bound <= 31;) {
    const result = search(board.indexOf(0), 0, bound, -1, estimate);
    if (result === FOUND) return bound;
    bound = result;
  }
  return -1;
}
