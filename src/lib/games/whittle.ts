/**
 * Whittle (runtime `whittle`) — the game, as a pure deterministic state machine.
 *
 * A 5×5 grid with a number in every cell, and a target beside every row and under
 * every column. Cross numbers out until what is left in each row and each column
 * adds up to its target.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_whittle_run`
 * (`supabase/migrations/20261224120000_whittle_sessions.sql`) replays the
 * submitted moves from the session's seed and derives the score itself. The
 * boards and scored lines in `whittle.test.ts` are the ones
 * `tests/security/verifier_vectors.sql` asserts.
 *
 * ## The boards
 *
 * A board is drawn from the seed, not from a bank: every cell draws a number, then
 * whether it is one of the numbers to cross out (two chances in five). The targets
 * are what the numbers left standing add up to, so every board can be solved. The
 * level picks the tier — boards 1–3 **easy** (numbers 1 to 9), 4–7 **medium**
 * (1 to 14) and from 8 **hard** (1 to 19).
 *
 * A board can have more than one answer. It is solved when **every row and every
 * column adds up to its target**, whichever numbers were crossed out to get there.
 *
 * ## A move, and the endless game
 *
 * A move is `cell × 10 + mark`: 0 clears the cell's mark, 1 crosses the number
 * out, 2 circles it as one to keep. A circle is the player's note — a circled
 * number counts exactly as an unmarked one — but it is a move like any other, so a
 * saved run comes back with its circles. A run has no clock to lose to: it ends
 * only when the player ends it. Every solved board scores ten points a row, and
 * every board has a par time, more for the harder tiers. A run ahead of its par
 * earns a bonus when it ends (`speed.ts`), timed by the server from the session's
 * start.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const WHITTLE_RUNTIME = "whittle";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const WHITTLE_RULES_VERSION = "whittle@1";

/** The board is always 5×5. */
export const WHITTLE_SIDE = 5;

/** The most moves one submission may carry: a request ceiling, not a final board. */
export const WHITTLE_MAX_ACTIONS = 8192;

export const WHITTLE_TIERS = ["easy", "medium", "hard"] as const;
export type WhittleTier = (typeof WHITTLE_TIERS)[number];

/** The biggest number a tier's cells can hold. */
export const WHITTLE_MAX_NUMBER = [9, 14, 19] as const;

/** A board's par time in ms, by tier. */
export const WHITTLE_PAR_MS = [60_000, 75_000, 90_000] as const;

/** Ten points per row of a solved board. */
export const WHITTLE_POINTS_PER_BOARD = 10 * WHITTLE_SIDE;

const CELLS = WHITTLE_SIDE * WHITTLE_SIDE;

/** A cell's mark: none, crossed out, or circled to keep. */
export const UNMARKED = 0;
export const CROSSED = 1;
export const CIRCLED = 2;
export type WhittleMark = 0 | 1 | 2;

// The generators every endless puzzle shares: One Move's outer LCG advanced once
// per level, and a second LCG started at that state to draw the board.
const SEED_MODULUS = 4294967296n;
const ZERO_STATE_FALLBACK = 2654435769;
const OUTER_MULTIPLIER = 1664525;
const OUTER_INCREMENT = 1013904223;
const INNER_MULTIPLIER = 22695477;
const INNER_INCREMENT = 1;

export type WhittleEnding = "stopped" | "bound";
export type WhittleOutcome = "playing" | "over";

/** A board as it is drawn. */
export type WhittleBoard = {
  /** The number in each cell, in reading order. */
  readonly numbers: readonly number[];
  /** What each row's remaining numbers must add up to, top to bottom. */
  readonly rowTargets: readonly number[];
  /** What each column's remaining numbers must add up to, left to right. */
  readonly columnTargets: readonly number[];
  /** The answer the board was drawn from: true where the number is crossed out. */
  readonly crossed: readonly boolean[];
  readonly tier: WhittleTier;
};

/** One run, as this module knows it. */
export type WhittleRun = {
  readonly seed: string;
  readonly rulesVersion: string;
  /** Every move, as `cell × 10 + mark`, in order. This *is* the submission. */
  readonly moves: readonly number[];
  /** The board being played, 1-based. */
  readonly level: number;
  /** The current board's marks. */
  readonly marks: readonly WhittleMark[];
  readonly levelsCleared: number;
  readonly score: number;
  readonly outcome: WhittleOutcome;
  readonly ending: WhittleEnding | null;
};

// ── Seeds and generators ────────────────────────────────────────────────────

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new TypeError("a Whittle seed must be a whole number");
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Whittle seed must be a decimal integer string");
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
    throw new RangeError("a Whittle level must be a whole number from 1");
  }
}

function boardStream(seed: string | number | bigint, level: number): () => number {
  assertLevel(level);
  let state = initialState(seed);
  for (let current = 1; current <= level; current += 1) {
    state = (Math.imul(state, OUTER_MULTIPLIER) + OUTER_INCREMENT) >>> 0;
  }
  return () => {
    state = (Math.imul(state, INNER_MULTIPLIER) + INNER_INCREMENT) >>> 0;
    return state >>> 16;
  };
}

/** The tier a level's board is drawn in, by index: boards 1–3, 4–7, then the rest. */
export function tierIndex(level: number): number {
  assertLevel(level);
  return level <= 3 ? 0 : level <= 7 ? 1 : 2;
}

export function tierOf(level: number): WhittleTier {
  return WHITTLE_TIERS[tierIndex(level)];
}

/** The par time of the board at `level`. */
export function boardParMs(level: number): number {
  return WHITTLE_PAR_MS[tierIndex(level)];
}

/** The par time of the first `levelsCleared` boards, in ms. */
export function parMs(levelsCleared: number): number {
  let total = 0;
  for (let level = 1; level <= levelsCleared; level += 1) total += boardParMs(level);
  return total;
}

// ── A board ─────────────────────────────────────────────────────────────────

const rowOf = (cell: number) => Math.floor(cell / WHITTLE_SIDE);
const columnOf = (cell: number) => cell % WHITTLE_SIDE;

/** The cells of a row, left to right. */
export function rowCells(row: number): number[] {
  return Array.from({ length: WHITTLE_SIDE }, (_, column) => row * WHITTLE_SIDE + column);
}

/** The cells of a column, top to bottom. */
export function columnCells(column: number): number[] {
  return Array.from({ length: WHITTLE_SIDE }, (_, row) => row * WHITTLE_SIDE + column);
}

/**
 * Draws a board, as `public.whittle_board` draws it:
 *
 *   1. each cell in reading order draws its number (`draw() mod max + 1`), then
 *      whether it is crossed out (`draw() mod 5 < 2`);
 *   2. for i = 0..4, if row i or column i has nothing left standing, the cell
 *      where they meet (i, i) stands — so no target is zero;
 *   3. if nothing at all is crossed out, the second cell is — so a board never
 *      starts solved.
 */
function draw(seed: string | number | bigint, level: number): WhittleBoard {
  const next = boardStream(seed, level);
  const max = WHITTLE_MAX_NUMBER[tierIndex(level)];
  const numbers: number[] = [];
  const crossed: boolean[] = [];
  for (let cell = 0; cell < CELLS; cell += 1) {
    numbers.push((next() % max) + 1);
    crossed.push(next() % 5 < 2);
  }
  for (let i = 0; i < WHITTLE_SIDE; i += 1) {
    if (
      rowCells(i).every((cell) => crossed[cell]) ||
      columnCells(i).every((cell) => crossed[cell])
    ) {
      crossed[i * WHITTLE_SIDE + i] = false;
    }
  }
  if (!crossed.includes(true)) crossed[1] = true;
  return boardFrom(numbers, crossed, tierOf(level));
}

/** A board from its numbers and one answer: the targets are what is left standing. */
export function boardFrom(
  numbers: readonly number[],
  crossed: readonly boolean[],
  tier: WhittleTier = "easy",
): WhittleBoard {
  const standing = (cells: number[]) =>
    cells.reduce((sum, cell) => sum + (crossed[cell] ? 0 : numbers[cell]), 0);
  const lines = Array.from({ length: WHITTLE_SIDE }, (_, i) => i);
  return {
    numbers,
    crossed,
    rowTargets: lines.map((row) => standing(rowCells(row))),
    columnTargets: lines.map((column) => standing(columnCells(column))),
    tier,
  };
}

const boardCache = new Map<string, WhittleBoard>();

/** The board a level shows: its numbers, targets, one answer and tier. Cached. */
export function board(seed: string | number | bigint, level: number): WhittleBoard {
  const key = `${toBigInt(seed).toString()}:${level}`;
  const cached = boardCache.get(key);
  if (cached) return cached;
  const drawn = draw(seed, level);
  if (boardCache.size > 64) boardCache.clear();
  boardCache.set(key, drawn);
  return drawn;
}

/** A board as the verifier vectors write it: 25 numbers, 5 row targets, 5 column targets. */
export function boardCode(drawn: WhittleBoard): string {
  return [...drawn.numbers, ...drawn.rowTargets, ...drawn.columnTargets].join(",");
}

// ── The rules on a board ────────────────────────────────────────────────────

/** What a row's numbers add up to, leaving out the crossed ones. */
export function rowSum(drawn: WhittleBoard, marks: readonly WhittleMark[], row: number): number {
  return rowCells(row).reduce(
    (sum, cell) => sum + (marks[cell] === CROSSED ? 0 : drawn.numbers[cell]),
    0,
  );
}

/** What a column's numbers add up to, leaving out the crossed ones. */
export function columnSum(
  drawn: WhittleBoard,
  marks: readonly WhittleMark[],
  column: number,
): number {
  return columnCells(column).reduce(
    (sum, cell) => sum + (marks[cell] === CROSSED ? 0 : drawn.numbers[cell]),
    0,
  );
}

/** Whether a board is solved: every row and every column adds up to its target. */
export function isSolved(drawn: WhittleBoard, marks: readonly WhittleMark[]): boolean {
  for (let i = 0; i < WHITTLE_SIDE; i += 1) {
    if (rowSum(drawn, marks, i) !== drawn.rowTargets[i]) return false;
    if (columnSum(drawn, marks, i) !== drawn.columnTargets[i]) return false;
  }
  return true;
}

/**
 * Every answer a board has, up to `limit`, each as 25 flags (true: crossed out).
 * The answer the board was drawn from comes first. Rows are tried one at a time
 * against the column targets, so this is quick.
 */
export function solutions(drawn: WhittleBoard, limit = 64): boolean[][] {
  const { numbers, rowTargets, columnTargets } = drawn;
  // Each row's ways of keeping cells (a bit per column) that make its target.
  const rowWays = rowTargets.map((target, row) => {
    const ways: number[] = [];
    for (let kept = 0; kept < 1 << WHITTLE_SIDE; kept += 1) {
      let sum = 0;
      for (let column = 0; column < WHITTLE_SIDE; column += 1) {
        if (kept & (1 << column)) sum += numbers[row * WHITTLE_SIDE + column];
      }
      if (sum === target) ways.push(kept);
    }
    return ways;
  });

  const found: boolean[][] = [[...drawn.crossed]];
  const drawnKey = drawn.crossed.join();
  const chosen: number[] = [];
  const sums = Array.from({ length: WHITTLE_SIDE }, () => 0);

  const search = (row: number) => {
    if (found.length >= limit) return;
    if (row === WHITTLE_SIDE) {
      if (sums.some((sum, column) => sum !== columnTargets[column])) return;
      const answer = Array.from(
        { length: CELLS },
        (_, cell) => (chosen[rowOf(cell)] & (1 << columnOf(cell))) === 0,
      );
      if (answer.join() !== drawnKey) found.push(answer);
      return;
    }
    for (const kept of rowWays[row]) {
      let fits = true;
      for (let column = 0; column < WHITTLE_SIDE; column += 1) {
        if (kept & (1 << column)) sums[column] += numbers[row * WHITTLE_SIDE + column];
        if (sums[column] > columnTargets[column]) fits = false;
      }
      if (fits) {
        chosen[row] = kept;
        search(row + 1);
      }
      for (let column = 0; column < WHITTLE_SIDE; column += 1) {
        if (kept & (1 << column)) sums[column] -= numbers[row * WHITTLE_SIDE + column];
      }
    }
  };
  search(0);
  return found;
}

// ── A run ───────────────────────────────────────────────────────────────────

export function encodeMove(cell: number, mark: number): number {
  return cell * 10 + mark;
}

const freshMarks = (): WhittleMark[] => Array.from({ length: CELLS }, () => UNMARKED);

/** A fresh run on board one. */
export function createRun(seed: string | number | bigint): WhittleRun {
  return {
    seed: toBigInt(seed).toString(),
    rulesVersion: WHITTLE_RULES_VERSION,
    moves: [],
    level: 1,
    marks: freshMarks(),
    levelsCleared: 0,
    score: 0,
    outcome: "playing",
    ending: null,
  };
}

/** Whether a move is legal: a live run, a cell on the board, a mark, and a change. */
export function canMark(run: WhittleRun, cell: number, mark: number): boolean {
  if (run.outcome !== "playing" || run.moves.length >= WHITTLE_MAX_ACTIONS) return false;
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return false;
  if (!Number.isInteger(mark) || mark < UNMARKED || mark > CIRCLED) return false;
  return run.marks[cell] !== mark;
}

/**
 * Sets a cell's mark. A move that solves the board scores fifty points and starts
 * the next. An impossible move returns the same run.
 */
export function mark(run: WhittleRun, cell: number, to: number): WhittleRun {
  if (!canMark(run, cell, to)) return run;
  const moves = [...run.moves, encodeMove(cell, to)];
  const atBound = moves.length >= WHITTLE_MAX_ACTIONS;
  const marks = [...run.marks];
  marks[cell] = to as WhittleMark;
  const bound = {
    outcome: atBound ? "over" : "playing",
    ending: atBound ? "bound" : null,
  } as const;

  if (isSolved(board(run.seed, run.level), marks)) {
    return {
      ...run,
      moves,
      level: run.level + 1,
      marks: freshMarks(),
      levelsCleared: run.levelsCleared + 1,
      score: run.score + WHITTLE_POINTS_PER_BOARD,
      ...bound,
    };
  }
  return { ...run, moves, marks, ...bound };
}

/** The mark a tap gives a cell: none, then crossed out, then circled, then none. */
export function nextMark(current: WhittleMark): WhittleMark {
  return ((current + 1) % 3) as WhittleMark;
}

/** Ends the run where it stands: the player stopped. */
export function finish(run: WhittleRun): WhittleRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stopped" };
}

export type WhittleSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  readonly tapsPlaced: number;
  readonly levelsCleared: number;
};

export function submission(run: WhittleRun): WhittleSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.moves,
    score: run.score,
    tapsPlaced: run.moves.length,
    levelsCleared: run.levelsCleared,
  };
}

/** The run these moves make, from the seed: how a saved run comes back. */
export function replay(seed: string | number | bigint, actions: readonly number[]): WhittleRun {
  return actions.reduce(
    (run: WhittleRun, action) => mark(run, Math.floor(action / 10), action % 10),
    createRun(seed),
  );
}
