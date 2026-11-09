/**
 * Sumdoku (runtime `sumdoku`) — the game, as a pure deterministic state machine.
 *
 * Mini Sudoku's 6×6 grid with cages: fill it so that every row, every column and
 * every 2×3 box holds the digits 1 to 6 once each, and the digits in every dashed
 * cage add up to the small total in its corner, with no digit repeated inside a
 * cage. Few or no cells start filled; the totals are the clues. Every board has
 * exactly one solution.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_sumdoku_run`
 * (`supabase/migrations/20261221120000_sumdoku_sessions.sql`) replays the
 * submitted moves from the session's seed and derives the score itself. The
 * boards and scored lines in `sumdoku.test.ts` are the ones
 * `tests/security/verifier_vectors.sql` asserts.
 *
 * ## The boards
 *
 * Every board comes from a bank of 120 cage puzzles (`sumdoku-bank.ts`). The level
 * picks the tier — boards 1–2 **gentle** (small cages, six givens), 3–5 **easy**
 * (three givens), 6–9 **medium** (no givens) and from 10 **hard** (bigger cages, no
 * givens) — and the seed picks a puzzle in it and one of the grid's four mirrors.
 * Relabelling digits or shuffling rows (as Mini Sudoku does) would change cage
 * totals or tear cages apart; a mirror keeps both, and the boxes, so the board
 * stays unique.
 *
 * A board is solved when it is **full and obeys the rules** — with one solution,
 * that is the solution.
 *
 * ## A move, and the endless game
 *
 * As Mini Sudoku: a move is `cell × 10 + digit`, 0 clearing the cell. A run has
 * no clock to lose to: it ends only when the player ends it. Every solved board
 * scores ten points a row, and every board has a par time, more for the harder
 * tiers. A run ahead of its par earns a bonus when it ends (`speed.ts`), timed by
 * the server from the session's start.
 */

import { conflicts as sudokuConflicts, peers, unitsOf, units } from "@/lib/games/mini-sudoku";
import { SUMDOKU_BANK, SUMDOKU_PER_TIER, SUMDOKU_TIERS } from "@/lib/games/sumdoku-bank";

export { peers, unitsOf, units };

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const SUMDOKU_RUNTIME = "sumdoku";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const SUMDOKU_RULES_VERSION = "sumdoku@1";

/** The board is always 6×6, in boxes two rows tall and three columns wide. */
export const SUMDOKU_SIDE = 6;
export const SUMDOKU_BOX_ROWS = 2;
export const SUMDOKU_BOX_COLS = 3;

/** The most moves one submission may carry: a request ceiling, not a final board. */
export const SUMDOKU_MAX_ACTIONS = 8192;

/** A board's par time in ms, by tier. */
export const SUMDOKU_PAR_MS = [75_000, 90_000, 120_000, 150_000] as const;

/** Ten points per row of a solved board. */
export const SUMDOKU_POINTS_PER_BOARD = 10 * SUMDOKU_SIDE;

const CELLS = SUMDOKU_SIDE * SUMDOKU_SIDE;
const DIGITS = [1, 2, 3, 4, 5, 6] as const;

/** A cell: 0 when empty, otherwise its digit. */
export const EMPTY = 0;
export type SumdokuDigit = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type SumdokuTier = (typeof SUMDOKU_TIERS)[number];

// The generators every endless puzzle shares: One Move's outer LCG advanced once
// per level, and a second LCG started at that state to draw the board.
const SEED_MODULUS = 4294967296n;
const ZERO_STATE_FALLBACK = 2654435769;
const OUTER_MULTIPLIER = 1664525;
const OUTER_INCREMENT = 1013904223;
const INNER_MULTIPLIER = 22695477;
const INNER_INCREMENT = 1;

export type SumdokuEnding = "stopped" | "bound";
export type SumdokuOutcome = "playing" | "over";

/** A cage: its cells in reading order, and the total its digits make. */
export type SumdokuCage = { readonly cells: readonly number[]; readonly total: number };

/** A board as it is drawn. */
export type SumdokuBoard = {
  readonly solution: readonly SumdokuDigit[];
  /** The cells that start filled, with their digits; 0 elsewhere. */
  readonly start: readonly SumdokuDigit[];
  /** Each cell's cage, as an index into `cages`. */
  readonly cageOf: readonly number[];
  readonly cages: readonly SumdokuCage[];
  readonly tier: SumdokuTier;
};

/** One run, as this module knows it. */
export type SumdokuRun = {
  readonly seed: string;
  readonly rulesVersion: string;
  /** Every move, as `cell × 10 + digit`, in order. This *is* the submission. */
  readonly moves: readonly number[];
  /** The board being played, 1-based. */
  readonly level: number;
  /** The current board's cells, givens included. */
  readonly cells: readonly SumdokuDigit[];
  readonly levelsCleared: number;
  readonly score: number;
  readonly outcome: SumdokuOutcome;
  readonly ending: SumdokuEnding | null;
};

// ── Seeds and generators ────────────────────────────────────────────────────

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new TypeError("a Sumdoku seed must be a whole number");
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Sumdoku seed must be a decimal integer string");
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
    throw new RangeError("a Sumdoku level must be a whole number from 1");
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

export function tierOf(level: number): SumdokuTier {
  return SUMDOKU_TIERS[tierIndex(level)];
}

/** The par time of the board at `level`. */
export function boardParMs(level: number): number {
  return SUMDOKU_PAR_MS[tierIndex(level)];
}

/** The par time of the first `levelsCleared` boards, in ms. */
export function parMs(levelsCleared: number): number {
  let total = 0;
  for (let level = 1; level <= levelsCleared; level += 1) total += boardParMs(level);
  return total;
}

// ── A board ─────────────────────────────────────────────────────────────────

/**
 * Draws a board: a puzzle from the level's tier (`draw() mod 30`), then a mirror
 * (`draw() mod 4`: bit 1 turns it top to bottom, bit 2 left to right) — in that
 * order, as `public.sumdoku_board` draws them.
 */
function draw(seed: string | number | bigint, level: number): SumdokuBoard {
  const next = boardStream(seed, level);
  const puzzle = SUMDOKU_BANK[tierIndex(level) * SUMDOKU_PER_TIER + (next() % SUMDOKU_PER_TIER)];
  const mirror = next() % 4;
  const flipRows = (mirror & 1) !== 0;
  const flipColumns = (mirror & 2) !== 0;

  const solution: SumdokuDigit[] = [];
  const start: SumdokuDigit[] = [];
  const rawCage: number[] = [];
  for (let row = 0; row < SUMDOKU_SIDE; row += 1) {
    for (let column = 0; column < SUMDOKU_SIDE; column += 1) {
      const from =
        (flipRows ? SUMDOKU_SIDE - 1 - row : row) * SUMDOKU_SIDE +
        (flipColumns ? SUMDOKU_SIDE - 1 - column : column);
      const digit = Number(puzzle[from]) as SumdokuDigit;
      solution.push(digit);
      rawCage.push(parseInt(puzzle[CELLS + from], 36));
      start.push(puzzle[2 * CELLS + from] === "1" ? digit : EMPTY);
    }
  }

  // Cages numbered in order of their first cell on this board.
  const renumber = new Map<number, number>();
  const cageOf = rawCage.map((id) => {
    if (!renumber.has(id)) renumber.set(id, renumber.size);
    return renumber.get(id)!;
  });
  const cages: { cells: number[]; total: number }[] = [];
  cageOf.forEach((id, cell) => {
    cages[id] ??= { cells: [], total: 0 };
    cages[id].cells.push(cell);
    cages[id].total += solution[cell];
  });

  return { solution, start, cageOf, cages, tier: tierOf(level) };
}

const boardCache = new Map<string, SumdokuBoard>();

/** The board a level shows: its givens, cages, one solution and tier. Cached. */
export function board(seed: string | number | bigint, level: number): SumdokuBoard {
  const key = `${toBigInt(seed).toString()}:${level}`;
  const cached = boardCache.get(key);
  if (cached) return cached;
  const drawn = draw(seed, level);
  if (boardCache.size > 64) boardCache.clear();
  boardCache.set(key, drawn);
  return drawn;
}

export function solution(seed: string | number | bigint, level: number): SumdokuDigit[] {
  return [...board(seed, level).solution];
}

export function startCells(seed: string | number | bigint, level: number): SumdokuDigit[] {
  return [...board(seed, level).start];
}

// ── The rules on a board ────────────────────────────────────────────────────

/**
 * The cells the screen marks: a digit repeated in a row, column, box or cage, and
 * every cell of a cage whose digits already add up to more than its total, or
 * that is full and adds up to less. The run does not count them.
 */
export function conflicts(drawn: SumdokuBoard, cells: readonly SumdokuDigit[]): Set<number> {
  const marked = sudokuConflicts(cells);
  for (const cage of drawn.cages) {
    for (const digit of DIGITS) {
      const holding = cage.cells.filter((cell) => cells[cell] === digit);
      if (holding.length > 1) holding.forEach((cell) => marked.add(cell));
    }
  }
  for (const cage of badCages(drawn, cells)) cage.cells.forEach((cell) => marked.add(cell));
  return marked;
}

/** The cages whose sum is already wrong: over the total, or full and under it. */
export function badCages(drawn: SumdokuBoard, cells: readonly SumdokuDigit[]): SumdokuCage[] {
  return drawn.cages.filter((cage) => {
    const sum = cageSum(cage, cells);
    const full = cage.cells.every((cell) => cells[cell] !== EMPTY);
    return sum > cage.total || (full && sum !== cage.total);
  });
}

/** What the digits placed in a cage add up to so far. */
export function cageSum(cage: SumdokuCage, cells: readonly SumdokuDigit[]): number {
  return cage.cells.reduce((sum, cell) => sum + cells[cell], 0);
}

/** Whether a board is solved: full, and the one solution. */
export function isSolved(drawn: SumdokuBoard, cells: readonly SumdokuDigit[]): boolean {
  return cells.every((value, cell) => value !== EMPTY && value === drawn.solution[cell]);
}

/**
 * The digits an empty cell could take: nothing its row, column, box or cage
 * already holds, and nothing that would push its cage past what it can still make.
 */
export function candidates(
  drawn: SumdokuBoard,
  cells: readonly SumdokuDigit[],
  cell: number,
): SumdokuDigit[] {
  const taken = new Set(peers(cell).map((other) => cells[other]));
  const cage = drawn.cages[drawn.cageOf[cell]];
  const used = new Set<number>();
  let sum = 0;
  let open = 0;
  for (const other of cage.cells) {
    if (cells[other] !== EMPTY) {
      used.add(cells[other]);
      sum += cells[other];
    } else if (other !== cell) open += 1;
  }
  return DIGITS.filter((digit) => {
    if (taken.has(digit) || used.has(digit)) return false;
    const left = cage.total - sum - digit;
    if (open === 0) return left === 0;
    const free = DIGITS.filter((d) => d !== digit && !used.has(d));
    if (free.length < open) return false;
    const low = free.slice(0, open).reduce((a, b) => a + b, 0);
    const high = free.slice(-open).reduce((a, b) => a + b, 0);
    return left >= low && left <= high;
  });
}

// ── A run ───────────────────────────────────────────────────────────────────

export function encodeMove(cell: number, digit: number): number {
  return cell * 10 + digit;
}

/** A fresh run on board one. */
export function createRun(seed: string | number | bigint): SumdokuRun {
  const normalised = toBigInt(seed).toString();
  return {
    seed: normalised,
    rulesVersion: SUMDOKU_RULES_VERSION,
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
export function isEditable(run: SumdokuRun, cell: number): boolean {
  if (run.outcome !== "playing") return false;
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return false;
  return board(run.seed, run.level).start[cell] === EMPTY;
}

/** Whether a move is legal: an editable cell, a digit from 0 to 6, and a change. */
export function canPlace(run: SumdokuRun, cell: number, digit: number): boolean {
  if (run.moves.length >= SUMDOKU_MAX_ACTIONS) return false;
  if (!Number.isInteger(digit) || digit < 0 || digit > SUMDOKU_SIDE) return false;
  return isEditable(run, cell) && run.cells[cell] !== digit;
}

/**
 * Puts a digit in a cell, or clears it with 0. A move that solves the board scores
 * sixty points and starts the next. An impossible move returns the same run.
 */
export function place(run: SumdokuRun, cell: number, digit: number): SumdokuRun {
  if (!canPlace(run, cell, digit)) return run;
  const moves = [...run.moves, encodeMove(cell, digit)];
  const atBound = moves.length >= SUMDOKU_MAX_ACTIONS;
  const cells = [...run.cells];
  cells[cell] = digit as SumdokuDigit;

  if (isSolved(board(run.seed, run.level), cells)) {
    const level = run.level + 1;
    return {
      ...run,
      moves,
      level,
      cells: startCells(run.seed, level),
      levelsCleared: run.levelsCleared + 1,
      score: run.score + SUMDOKU_POINTS_PER_BOARD,
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

/** Ends the run where it stands: the player stopped. */
export function finish(run: SumdokuRun): SumdokuRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stopped" };
}

export type SumdokuSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  readonly tapsPlaced: number;
  readonly levelsCleared: number;
};

export function submission(run: SumdokuRun): SumdokuSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.moves,
    score: run.score,
    tapsPlaced: run.moves.length,
    levelsCleared: run.levelsCleared,
  };
}

/** The run these moves make, from the seed: how a saved run comes back. */
export function replay(seed: string | number | bigint, actions: readonly number[]): SumdokuRun {
  return actions.reduce(
    (run: SumdokuRun, action) => place(run, Math.floor(action / 10), action % 10),
    createRun(seed),
  );
}
