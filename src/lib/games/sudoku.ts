/**
 * Sudoku (runtime `sudoku`) — the game, as a pure deterministic state machine.
 *
 * Fill a 9×9 grid so that every row, every column and every 3×3 box holds the
 * digits 1 to 9 once each. Some cells start filled, and every board has exactly
 * one solution.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_sudoku_run` (latest in
 * `supabase/migrations/20261115120000_sudoku_bank.sql`) replays the submitted
 * moves from the session's seed and derives the score itself. The copy is pinned
 * like every other game's: the rules version (`sudoku@2`) is data, the state
 * machine is total and pure, and the boards and scored lines in `sudoku.test.ts`
 * are the ones `tests/security/rls_test.sql` asserts.
 *
 * ## The boards
 *
 * Every board comes from a bank of 200 puzzles (`sudoku-bank.ts`), each with
 * exactly one solution and graded by the hardest technique a logical solver
 * needs. The level picks the grade — boards 1–2 are **gentle** (the last place for
 * a digit in a box is all they need), 3–5 **easy** (singles in any row, column or
 * box), 6–9 **medium** (pair and line eliminations) and from 10 **hard** — and the
 * seed picks a puzzle in it and disguises it: the digits relabelled, rows and
 * columns shuffled within their bands and stacks, the bands and stacks shuffled.
 * None of that changes how many solutions a puzzle has, so the board stays
 * unique, and the database mirrors it with cheap draws.
 *
 * A board is solved when it is **full and obeys the rules** — with one solution,
 * that is the solution.
 *
 * ## A move
 *
 * A move is one number, `cell × 10 + digit`: it puts `digit` (1–9) in `cell`
 * (0–80), or clears the cell when `digit` is 0. A cell that started filled, or a
 * move that leaves the cell as it was, is not a move.
 *
 * ## The endless game, against the clock
 *
 * A run is a race: one clock that starts at six minutes, timed by the server from
 * the session's start. Every solved board scores ten points a row and adds the
 * next board's allowance — more for the harder tiers. A wrong digit never ends a
 * run: the player fixes it, and the clock is what is spent.
 *
 * Storage rule: nothing here is persisted. A score only exists once the server has
 * verified it.
 */

import { SUDOKU_BANK, SUDOKU_PER_TIER, SUDOKU_TIERS } from "@/lib/games/sudoku-bank";

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const SUDOKU_RUNTIME = "sudoku";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const SUDOKU_RULES_VERSION = "sudoku@2";

/** The board is always 9×9, in 3×3 boxes. */
export const SUDOKU_SIDE = 9;
export const SUDOKU_BOX = 3;

/** The most moves one submission may carry: a request ceiling, not a final board. */
export const SUDOKU_MAX_ACTIONS = 8192;

/** The clock a run starts with. */
export const SUDOKU_START_MS = 360_000;

/** The time a board of each tier is given: what solving the board before it adds. */
export const SUDOKU_ALLOWANCE_MS = [240_000, 300_000, 480_000, 600_000] as const;

/** How late after its clock ran out the server still accepts a run. */
export const SUDOKU_SLACK_MS = 20_000;

/** Ten points per row of a solved board. */
export const SUDOKU_POINTS_PER_BOARD = 10 * SUDOKU_SIDE;

const CELLS = SUDOKU_SIDE * SUDOKU_SIDE;

/** A cell: 0 when empty, otherwise its digit. */
export const EMPTY = 0;
export type SudokuDigit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** A tier of the bank: how hard a board is. */
export type SudokuTier = (typeof SUDOKU_TIERS)[number];

// The same generators as Queens, Zip, 8 Puzzle and Sun & Moon: One Move's outer
// LCG advanced once per level, and a second LCG started at that state to draw
// the board.
const SEED_MODULUS = 4294967296n;
const ZERO_STATE_FALLBACK = 2654435769;
const OUTER_MULTIPLIER = 1664525;
const OUTER_INCREMENT = 1013904223;
const INNER_MULTIPLIER = 22695477;
const INNER_INCREMENT = 1;

export type SudokuEnding = "time" | "stopped" | "bound";
export type SudokuOutcome = "playing" | "over";

/** A board as it is drawn. */
export type SudokuBoard = {
  /** The board's one solution, in board order. */
  readonly solution: readonly SudokuDigit[];
  /** The cells that start filled, with their digits; 0 elsewhere. */
  readonly start: readonly SudokuDigit[];
  readonly tier: SudokuTier;
};

/** One run, as this module knows it. */
export type SudokuRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /** Every move, as `cell × 10 + digit`, in order. This *is* the submission. */
  readonly moves: readonly number[];
  /** The board being played, 1-based. */
  readonly level: number;
  /** The current board's cells, givens included. */
  readonly cells: readonly SudokuDigit[];
  readonly levelsCleared: number;
  readonly score: number;
  readonly outcome: SudokuOutcome;
  readonly ending: SudokuEnding | null;
};

// ── Seeds and generators ────────────────────────────────────────────────────

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new TypeError("a Sudoku seed must be a whole number");
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Sudoku seed must be a decimal integer string");
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
    throw new RangeError("a Sudoku level must be a whole number from 1");
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

/** The tier a level's board is drawn from, by index: boards 1–2, 3–5, 6–9, then the rest. */
export function tierIndex(level: number): number {
  assertLevel(level);
  return level <= 2 ? 0 : level <= 5 ? 1 : level <= 9 ? 2 : 3;
}

/** The tier a level's board is drawn from. */
export function tierOf(level: number): SudokuTier {
  return SUDOKU_TIERS[tierIndex(level)];
}

/** The time the board at `level` is given. */
export function allowanceMs(level: number): number {
  return SUDOKU_ALLOWANCE_MS[tierIndex(level)];
}

/**
 * The clock a run has earned once `levelsCleared` boards are solved, in ms: six
 * minutes, plus the allowance of the board after each one solved.
 */
export function budgetMs(levelsCleared: number): number {
  let total = SUDOKU_START_MS;
  for (let level = 1; level <= levelsCleared; level += 1) total += allowanceMs(level + 1);
  return total;
}

/** Fisher–Yates in place, from the last index down: the order the verifier draws in. */
function shuffle<T>(next: () => number, items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = next() % (index + 1);
    [items[index], items[swap]] = [items[swap], items[index]];
  }
  return items;
}

/**
 * Lines in a shuffled order that keeps a grid valid: the three bands (or stacks)
 * shuffled, then the three lines within each band, band by band in its new order.
 */
function shuffledLines(next: () => number): number[] {
  const bands = shuffle(next, [0, 1, 2]);
  return bands.flatMap((band) => shuffle(next, [0, 1, 2]).map((line) => band * SUDOKU_BOX + line));
}

/**
 * Draws a board's starting cells: a puzzle from the level's tier, then the digits
 * relabelled, then the rows and the columns shuffled — in that order, as
 * `public.sudoku_start` draws them.
 */
function drawStart(seed: string | number | bigint, level: number): SudokuDigit[] {
  const next = boardStream(seed, level);
  const puzzle = SUDOKU_BANK[tierIndex(level) * SUDOKU_PER_TIER + (next() % SUDOKU_PER_TIER)];
  const digits = shuffle(next, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const rows = shuffledLines(next);
  const columns = shuffledLines(next);
  const start: SudokuDigit[] = [];
  for (let row = 0; row < SUDOKU_SIDE; row += 1) {
    for (let column = 0; column < SUDOKU_SIDE; column += 1) {
      const digit = Number(puzzle[rows[row] * SUDOKU_SIDE + columns[column]]);
      start.push((digit === EMPTY ? EMPTY : digits[digit - 1]) as SudokuDigit);
    }
  }
  return start;
}

const boardCache = new Map<string, SudokuBoard>();

/** The board a level shows: its starting cells, its one solution and its tier. Cached. */
export function board(seed: string | number | bigint, level: number): SudokuBoard {
  const key = `${toBigInt(seed).toString()}:${level}`;
  const cached = boardCache.get(key);
  if (cached) return cached;
  const start = drawStart(seed, level);
  const solved = solve(start);
  if (!solved) throw new Error("a Sudoku bank puzzle has no solution");
  const drawn: SudokuBoard = { solution: solved, start, tier: tierOf(level) };
  if (boardCache.size > 64) boardCache.clear();
  boardCache.set(key, drawn);
  return drawn;
}

/** A level's solution. */
export function solution(seed: string | number | bigint, level: number): SudokuDigit[] {
  return [...board(seed, level).solution];
}

/** The cells a level's board starts with filled; 0 elsewhere. */
export function startCells(seed: string | number | bigint, level: number): SudokuDigit[] {
  return [...board(seed, level).start];
}

/** How many cells a level's board starts with. */
export function givenCount(seed: string | number | bigint, level: number): number {
  return board(seed, level).start.filter((digit) => digit !== EMPTY).length;
}

// ── The rules on a board ────────────────────────────────────────────────────

/** The 27 units — nine rows, nine columns, nine boxes — as lists of cells. */
const UNITS: readonly (readonly number[])[] = (() => {
  const units: number[][] = [];
  for (let line = 0; line < SUDOKU_SIDE; line += 1) {
    units.push(Array.from({ length: SUDOKU_SIDE }, (_, index) => line * SUDOKU_SIDE + index));
    units.push(Array.from({ length: SUDOKU_SIDE }, (_, index) => index * SUDOKU_SIDE + line));
    const top = Math.floor(line / SUDOKU_BOX) * SUDOKU_BOX;
    const left = (line % SUDOKU_BOX) * SUDOKU_BOX;
    units.push(
      Array.from(
        { length: SUDOKU_SIDE },
        (_, index) =>
          (top + Math.floor(index / SUDOKU_BOX)) * SUDOKU_SIDE + left + (index % SUDOKU_BOX),
      ),
    );
  }
  return units;
})();

/** The row, column and box of a cell, in that order. */
export function unitsOf(cell: number): {
  row: readonly number[];
  column: readonly number[];
  box: readonly number[];
} {
  const row = Math.floor(cell / SUDOKU_SIDE);
  const column = cell % SUDOKU_SIDE;
  const box = Math.floor(row / SUDOKU_BOX) * SUDOKU_BOX + Math.floor(column / SUDOKU_BOX);
  return { row: UNITS[row * 3], column: UNITS[column * 3 + 1], box: UNITS[box * 3 + 2] };
}

/** Every unit: rows, columns and boxes, interleaved as row 0, column 0, box 0, row 1… */
export function units(): readonly (readonly number[])[] {
  return UNITS;
}

const PEERS: readonly (readonly number[])[] = Array.from({ length: CELLS }, (_, cell) => {
  const seen = new Set<number>();
  for (const unit of UNITS) {
    if (unit.includes(cell)) unit.forEach((other) => other !== cell && seen.add(other));
  }
  return [...seen];
});

/** The cells that share a row, column or box with `cell`, itself excluded. */
export function peers(cell: number): number[] {
  return [...PEERS[cell]];
}

/**
 * The cells whose digit appears twice in one of their units. The screen marks
 * them; the run does not count them.
 */
export function conflicts(cells: readonly SudokuDigit[]): Set<number> {
  const marked = new Set<number>();
  for (const unit of UNITS) {
    for (let digit = 1; digit <= SUDOKU_SIDE; digit += 1) {
      const holding = unit.filter((cell) => cells[cell] === digit);
      if (holding.length > 1) holding.forEach((cell) => marked.add(cell));
    }
  }
  return marked;
}

/** Whether a board is solved: every cell filled, and every unit holds 1 to 9. */
export function isSolved(cells: readonly SudokuDigit[]): boolean {
  if (cells.some((value) => value === EMPTY)) return false;
  return UNITS.every((unit) => new Set(unit.map((cell) => cells[cell])).size === SUDOKU_SIDE);
}

/** The digits an empty cell could take without clashing with what its peers hold. */
export function candidates(cells: readonly SudokuDigit[], cell: number): SudokuDigit[] {
  const taken = new Set(PEERS[cell].map((other) => cells[other]));
  return ([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).filter((digit) => !taken.has(digit));
}

/**
 * A way to fill every empty cell so the grid obeys the rules — searching the most
 * constrained cell first — or null when there is none. The board uses it to know
 * its solution; the hints use it to say a digit leads nowhere. It never decides a
 * score.
 */
export function solve(cells: readonly SudokuDigit[]): SudokuDigit[] | null {
  if (conflicts(cells).size > 0) return null;
  const grid = [...cells];
  const search = (): boolean => {
    let best = -1;
    let options: SudokuDigit[] = [];
    for (let cell = 0; cell < CELLS; cell += 1) {
      if (grid[cell] !== EMPTY) continue;
      const fits = candidates(grid, cell);
      if (fits.length === 0) return false;
      if (best < 0 || fits.length < options.length) {
        best = cell;
        options = fits;
        if (fits.length === 1) break;
      }
    }
    if (best < 0) return true;
    for (const digit of options) {
      grid[best] = digit;
      if (search()) return true;
    }
    grid[best] = EMPTY;
    return false;
  };
  return search() ? grid : null;
}

/** Whether the cells can still be completed into a solved grid. */
export function canFinish(cells: readonly SudokuDigit[]): boolean {
  return solve(cells) !== null;
}

// ── A run ───────────────────────────────────────────────────────────────────

/** A move as the submission carries it. */
export function encodeMove(cell: number, digit: number): number {
  return cell * 10 + digit;
}

/** A fresh run on board one. */
export function createRun(seed: string | number | bigint): SudokuRun {
  const normalised = toBigInt(seed).toString();
  return {
    seed: normalised,
    rulesVersion: SUDOKU_RULES_VERSION,
    moves: [],
    level: 1,
    cells: startCells(normalised, 1),
    levelsCleared: 0,
    score: 0,
    outcome: "playing",
    ending: null,
  };
}

/** Whether a cell can be edited at all: the run is live, and it did not start filled. */
export function isEditable(run: SudokuRun, cell: number): boolean {
  if (run.outcome !== "playing") return false;
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return false;
  return board(run.seed, run.level).start[cell] === EMPTY;
}

/** Whether a move is legal: an editable cell, a digit from 0 to 9, and a change. */
export function canPlace(run: SudokuRun, cell: number, digit: number): boolean {
  if (run.moves.length >= SUDOKU_MAX_ACTIONS) return false;
  if (!Number.isInteger(digit) || digit < 0 || digit > SUDOKU_SIDE) return false;
  return isEditable(run, cell) && run.cells[cell] !== digit;
}

/**
 * Puts a digit in a cell, or clears it with 0. A move that leaves the board full
 * and within the rules solves it: ninety points, and the next board starts. An
 * impossible move returns the same run object.
 */
export function place(run: SudokuRun, cell: number, digit: number): SudokuRun {
  if (!canPlace(run, cell, digit)) return run;
  const moves = [...run.moves, encodeMove(cell, digit)];
  const atBound = moves.length >= SUDOKU_MAX_ACTIONS;
  const cells = [...run.cells];
  cells[cell] = digit as SudokuDigit;

  if (isSolved(cells)) {
    const level = run.level + 1;
    return {
      ...run,
      moves,
      level,
      cells: startCells(run.seed, level),
      levelsCleared: run.levelsCleared + 1,
      score: run.score + SUDOKU_POINTS_PER_BOARD,
      outcome: atBound ? "over" : "playing",
      ending: atBound ? "bound" : null,
    };
  }
  return {
    ...run,
    moves,
    cells,
    outcome: atBound ? "over" : "playing",
    ending: atBound ? "bound" : null,
  };
}

/** Ends the run where it stands: the clock ran out, or the player stopped. */
export function finish(run: SudokuRun, ending: "time" | "stopped"): SudokuRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending };
}

export type SudokuSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  readonly tapsPlaced: number;
  readonly levelsCleared: number;
};

export function submission(run: SudokuRun): SudokuSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.moves,
    score: run.score,
    tapsPlaced: run.moves.length,
    levelsCleared: run.levelsCleared,
  };
}
