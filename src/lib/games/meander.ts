/**
 * Meander (runtime `meander`) — one theme a day, its words wound through a 5 × 5
 * grid of letters, as a pure deterministic state machine.
 *
 * The day's words are hidden: the board shows only the theme and how long each
 * word is. Every word runs through side-by-side cells (up, down, left or right,
 * turning as it goes), and together they use every letter in the grid exactly
 * once. Trace a word and, if it is one of the day's, it is placed on the cells you
 * traced. A word can often be traced along more than one route, and the wrong one
 * walls in letters another word needs: lift it and try again.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_meander_run` in
 * `supabase/migrations/20270113120000_meander_sessions.sql` replays the moves on
 * the day's grid and decides the score. `meander.test.ts` and
 * `tests/security/verifier_vectors.sql` pin the two together.
 *
 * ## The day
 *
 * A session's seed is the player's day number, and day `d` plays puzzle `d mod n`
 * of `MEANDER_PUZZLES`.
 *
 * ## A move
 *
 * - `0` asks for a hint: the first word, in the day's order, that is neither placed
 *   nor already hinted is shown with its first cell. Three at most.
 * - `1 + i` lifts word `i` off the grid.
 * - A trace is `start + 25 × length + 400 × Σ direction_k × 4^k`, `k` from 0 for
 *   each step after the first cell, direction 0 up, 1 right, 2 down, 3 left, and
 *   length 4 to 8. It is placed when it stays on the grid, touches no cell twice
 *   and no placed word, and spells a day's word not yet placed.
 *
 * Anything else, a move after the run is over, or a move past the 256th is not a
 * move.
 *
 * ## The score
 *
 * Every word on the grid is worth 10. Filling the grid adds 50, and 25 for every
 * hint not taken: a clean five-word day is 175 (1,750 on screen). A run that stops
 * early keeps 10 a placed word.
 */

import { MEANDER_PUZZLES, type MeanderPuzzle } from "@/lib/games/meander-bank";

export const MEANDER_RUNTIME = "meander";
export const MEANDER_RULES_VERSION = "meander@1";

export const SIZE = 5;
export const CELLS = SIZE * SIZE;
export const MIN_LENGTH = 4;
export const MAX_LENGTH = 8;
export const MAX_HINTS = 3;
export const MAX_MOVES = 256;
export const WORD_POINTS = 10;
export const SOLVE_POINTS = 50;
export const HINT_POINTS = 25;

export const HINT = 0;

/** A step's direction: up, right, down, left. */
const STEPS = [-SIZE, 1, SIZE, -1] as const;

export type MeanderEnding = "solved" | "stopped";

export type Placement = { readonly word: number; readonly cells: readonly number[] };

export type MeanderRun = {
  readonly day: number;
  readonly rulesVersion: string;
  readonly puzzle: number;
  /** The words on the grid, in the order they were placed. */
  readonly placed: readonly Placement[];
  /** The words a hint has shown, in order. */
  readonly hinted: readonly number[];
  /** Every move so far, as codes. This *is* the submission. */
  readonly moves: readonly number[];
  readonly outcome: "playing" | "over";
  readonly ending: MeanderEnding | null;
};

export function puzzleIndexForDay(day: number, count = MEANDER_PUZZLES.length): number {
  return ((day % count) + count) % count;
}

export function puzzleOf(run: Pick<MeanderRun, "puzzle">): MeanderPuzzle {
  return MEANDER_PUZZLES[run.puzzle]!;
}

/** The grid's letters, cell by cell. */
export function lettersOf(puzzle: MeanderPuzzle): string[] {
  return puzzle.rows.join("").split("");
}

/** Whether two cells share a side. */
export function adjacent(a: number, b: number): boolean {
  const ra = Math.floor(a / SIZE);
  const rb = Math.floor(b / SIZE);
  if (ra === rb) return Math.abs(a - b) === 1;
  return Math.abs(ra - rb) === 1 && a % SIZE === b % SIZE;
}

/** A trace as a move, or null when it is not a path of 4 to 8 side-by-side cells. */
export function encodeTrace(cells: readonly number[]): number | null {
  if (cells.length < MIN_LENGTH || cells.length > MAX_LENGTH) return null;
  if (new Set(cells).size !== cells.length) return null;
  if (cells.some((cell) => !Number.isInteger(cell) || cell < 0 || cell >= CELLS)) return null;
  let dirs = 0;
  for (let k = cells.length - 2; k >= 0; k -= 1) {
    const from = cells[k]!;
    const to = cells[k + 1]!;
    if (!adjacent(from, to)) return null;
    dirs = dirs * 4 + STEPS.indexOf((to - from) as (typeof STEPS)[number]);
  }
  return cells[0]! + 25 * cells.length + 400 * dirs;
}

/** A move as a trace's cells, or null when it is not a trace that stays on the grid. */
export function decodeTrace(code: number): number[] | null {
  if (!Number.isInteger(code) || code < 100) return null;
  const start = code % 25;
  const length = Math.floor(code / 25) % 16;
  let dirs = Math.floor(code / 400);
  if (length < MIN_LENGTH || length > MAX_LENGTH || dirs >= 4 ** (length - 1)) return null;
  const cells = [start];
  for (let k = 1; k < length; k += 1) {
    const dir = dirs % 4;
    dirs = Math.floor(dirs / 4);
    const from = cells[k - 1]!;
    const r = Math.floor(from / SIZE);
    const c = from % SIZE;
    if ((dir === 0 && r === 0) || (dir === 1 && c === SIZE - 1)) return null;
    if ((dir === 2 && r === SIZE - 1) || (dir === 3 && c === 0)) return null;
    const to = from + STEPS[dir]!;
    if (cells.includes(to)) return null;
    cells.push(to);
  }
  return cells;
}

export function liftCode(word: number): number {
  return 1 + word;
}

export function createRun(day: string | number, rulesVersion = MEANDER_RULES_VERSION): MeanderRun {
  const d = Number(day);
  return {
    day: d,
    rulesVersion,
    puzzle: puzzleIndexForDay(d),
    placed: [],
    hinted: [],
    moves: [],
    outcome: "playing",
    ending: null,
  };
}

/** Which word owns each cell, or -1. */
export function owners(run: Pick<MeanderRun, "placed">): number[] {
  const owner: number[] = Array(CELLS).fill(-1);
  for (const { word, cells } of run.placed) for (const cell of cells) owner[cell] = word;
  return owner;
}

export function isPlaced(run: Pick<MeanderRun, "placed">, word: number): boolean {
  return run.placed.some((p) => p.word === word);
}

/** The word a hint would show next, or null when there is none to take. */
export function hintTarget(run: MeanderRun, puzzle: MeanderPuzzle = puzzleOf(run)): number | null {
  if (run.hinted.length >= MAX_HINTS) return null;
  for (let word = 0; word < puzzle.words.length; word += 1) {
    if (!isPlaced(run, word) && !run.hinted.includes(word)) return word;
  }
  return null;
}

/** The unplaced word a trace spells, or null. */
export function wordFor(
  run: MeanderRun,
  cells: readonly number[],
  puzzle: MeanderPuzzle = puzzleOf(run),
): number | null {
  const letters = lettersOf(puzzle);
  const spelled = cells.map((cell) => letters[cell]).join("");
  for (let word = 0; word < puzzle.words.length; word += 1) {
    if (puzzle.words[word] === spelled && !isPlaced(run, word)) return word;
  }
  return null;
}

export type MeanderRefusal = "over" | "full" | "invalid" | "taken" | "unknown" | "nothing";

/** Why a move cannot be made, or null when it can. */
export function refusal(
  run: MeanderRun,
  move: number,
  puzzle: MeanderPuzzle = puzzleOf(run),
): MeanderRefusal | null {
  if (run.outcome !== "playing") return "over";
  if (run.moves.length >= MAX_MOVES) return "full";
  if (!Number.isInteger(move) || move < 0) return "invalid";
  if (move === HINT) return hintTarget(run, puzzle) === null ? "nothing" : null;
  if (move <= MAX_LENGTH) {
    const word = move - 1;
    return word < puzzle.words.length && isPlaced(run, word) ? null : "nothing";
  }
  const cells = decodeTrace(move);
  if (!cells) return "invalid";
  const owner = owners(run);
  if (cells.some((cell) => owner[cell] !== -1)) return "taken";
  return wordFor(run, cells, puzzle) === null ? "unknown" : null;
}

/**
 * Makes a move. A refused move returns the same run object. The puzzle is the
 * day's; only the feed preview, which plays a grid of its own, passes another.
 */
export function move(
  run: MeanderRun,
  m: number,
  puzzle: MeanderPuzzle = puzzleOf(run),
): MeanderRun {
  if (refusal(run, m, puzzle) !== null) return run;
  const moves = [...run.moves, m];
  if (m === HINT) {
    return { ...run, hinted: [...run.hinted, hintTarget(run, puzzle)!], moves };
  }
  if (m <= MAX_LENGTH) {
    return { ...run, placed: run.placed.filter((p) => p.word !== m - 1), moves };
  }
  const cells = decodeTrace(m)!;
  const placed = [...run.placed, { word: wordFor(run, cells, puzzle)!, cells }];
  const solved = placed.length === puzzle.words.length;
  return {
    ...run,
    placed,
    moves,
    outcome: solved ? "over" : "playing",
    ending: solved ? "solved" : null,
  };
}

/** Stops: the run ends with the words it has placed. */
export function stop(run: MeanderRun): MeanderRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stopped" };
}

export function scoreOf(run: MeanderRun): number {
  const words = run.placed.length * WORD_POINTS;
  return run.ending === "solved"
    ? words + SOLVE_POINTS + HINT_POINTS * (MAX_HINTS - run.hinted.length)
    : words;
}

/** The best a puzzle can score: every word, no hints. */
export function maxScore(puzzle: MeanderPuzzle): number {
  return puzzle.words.length * WORD_POINTS + SOLVE_POINTS + HINT_POINTS * MAX_HINTS;
}

export type MeanderSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: MeanderRun): MeanderSubmission {
  return { rulesVersion: run.rulesVersion, actions: run.moves, score: scoreOf(run) };
}

export function replay(day: string | number, actions: readonly number[]): MeanderRun {
  return actions.reduce((run, m) => move(run, m), createRun(day));
}

/** The moves that solve a puzzle along its own paths, for tests and the preview. */
export function solution(puzzle: MeanderPuzzle): number[] {
  return puzzle.paths.map((path) => encodeTrace(path)!);
}
