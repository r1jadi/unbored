/**
 * Pixelock (runtime `pixelock`) — a daily 10 × 10 picture logic puzzle, as a pure
 * deterministic state machine.
 *
 * Every row and column has a clue: the lengths of its runs of filled cells, in
 * order. Fill the cells the clues force and cross out the ones they rule out; the
 * filled cells draw the day's picture. Every move is checked: a wrong one costs one
 * of three lives and the cell is shown as it really is.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_pixelock_run` in
 * `supabase/migrations/20270105120100_pixelock_sessions.sql` replays the moves on
 * the day's picture and decides the score. `pixelock.test.ts` pins the two together.
 *
 * ## The day
 *
 * A session's seed is the player's day number, and day `d` plays picture `d mod n`
 * of `PIXELOCK_PICTURES`. Every picture is solvable line by line, without
 * guessing (`solveByLines`; the bank's test checks each one).
 *
 * ## A move
 *
 * A move is `cell × 2 + mode`: cell `row × 10 + column`, mode 0 to fill and 1 to
 * cross out. A cell already shown, a code out of range, or a move after the run is
 * over is not a move.
 *
 * ## The score
 *
 * Every cell rightly filled is worth 1. Drawing the whole picture adds 50, and 25
 * for every life left: a clean solve of a 50-cell picture is 175 (1,750 on screen).
 * A cell shown by a mistake scores nothing, though it counts towards the picture.
 */

import { PIXELOCK_PICTURES, type PixelockPicture } from "@/lib/games/pixelock-bank";

export const PIXELOCK_RUNTIME = "pixelock";
export const PIXELOCK_RULES_VERSION = "pixelock@1";

export const SIZE = 10;
export const CELLS = SIZE * SIZE;
export const LIVES = 3;
export const SOLVE_POINTS = 50;
export const LIFE_POINTS = 25;

export const FILL = 0;
export const CROSS = 1;
export type Mode = typeof FILL | typeof CROSS;

/** A cell as the board shows it. */
export const UNKNOWN = 0;
export const FILLED = 1;
export const CROSSED = 2;
export type Cell = typeof UNKNOWN | typeof FILLED | typeof CROSSED;

export type PixelockEnding = "solved" | "out" | "stopped";

export type PixelockRun = {
  readonly day: number;
  readonly rulesVersion: string;
  readonly picture: number;
  readonly cells: readonly Cell[];
  /** Cells a mistake revealed, so the board can mark them. */
  readonly revealed: readonly number[];
  /** Every move so far, as codes. This *is* the submission. */
  readonly moves: readonly number[];
  readonly mistakes: number;
  /** Cells rightly filled by a move. */
  readonly fills: number;
  readonly outcome: "playing" | "over";
  readonly ending: PixelockEnding | null;
};

export function pictureIndexForDay(day: number, count = PIXELOCK_PICTURES.length): number {
  return ((day % count) + count) % count;
}

export function pictureOf(run: Pick<PixelockRun, "picture">): PixelockPicture {
  return PIXELOCK_PICTURES[run.picture]!;
}

/** Whether cell `i` of a picture is filled. */
export function inked(picture: PixelockPicture, i: number): boolean {
  return picture.rows[Math.floor(i / SIZE)]![i % SIZE] === "#";
}

/** The run lengths of one line of booleans; [] for an empty line. */
export function runsOf(line: readonly boolean[]): number[] {
  const runs: number[] = [];
  let n = 0;
  for (const on of line) {
    if (on) n += 1;
    else if (n) {
      runs.push(n);
      n = 0;
    }
  }
  if (n) runs.push(n);
  return runs;
}

export function rowLine<T>(cells: readonly T[], r: number): T[] {
  return cells.slice(r * SIZE, r * SIZE + SIZE);
}

export function columnLine<T>(cells: readonly T[], c: number): T[] {
  return Array.from({ length: SIZE }, (_, r) => cells[r * SIZE + c]!);
}

export function inkOf(picture: PixelockPicture): boolean[] {
  return Array.from({ length: CELLS }, (_, i) => inked(picture, i));
}

export type Clues = { readonly rows: number[][]; readonly columns: number[][] };

export function cluesOf(picture: PixelockPicture): Clues {
  const ink = inkOf(picture);
  return {
    rows: Array.from({ length: SIZE }, (_, r) => runsOf(rowLine(ink, r))),
    columns: Array.from({ length: SIZE }, (_, c) => runsOf(columnLine(ink, c))),
  };
}

export function inkCount(picture: PixelockPicture): number {
  return inkOf(picture).filter(Boolean).length;
}

export function createRun(
  day: string | number,
  rulesVersion = PIXELOCK_RULES_VERSION,
): PixelockRun {
  const d = Number(day);
  return {
    day: d,
    rulesVersion,
    picture: pictureIndexForDay(d),
    cells: Array.from({ length: CELLS }, () => UNKNOWN),
    revealed: [],
    moves: [],
    mistakes: 0,
    fills: 0,
    outcome: "playing",
    ending: null,
  };
}

export function code(cell: number, mode: Mode): number {
  return cell * 2 + mode;
}

/** Why a move cannot be made, or null when it can. */
export function refusal(run: PixelockRun, move: number): "over" | "unknown" | "shown" | null {
  if (run.outcome !== "playing") return "over";
  if (!Number.isInteger(move) || move < 0 || move >= CELLS * 2) return "unknown";
  return run.cells[move >> 1] !== UNKNOWN ? "shown" : null;
}

/** Whether a move would be right: filling ink, or crossing out blank. */
export function isRight(run: PixelockRun, move: number): boolean {
  return inked(pictureOf(run), move >> 1) === ((move & 1) === FILL);
}

/** Makes a move. A refused move returns the same run object. */
export function move(run: PixelockRun, m: number): PixelockRun {
  if (refusal(run, m) !== null) return run;
  const picture = pictureOf(run);
  const cell = m >> 1;
  const ink = inked(picture, cell);
  const right = isRight(run, m);
  const cells = [...run.cells];
  cells[cell] = ink ? FILLED : CROSSED;
  const mistakes = right ? run.mistakes : run.mistakes + 1;
  const fills = right && ink ? run.fills + 1 : run.fills;
  const revealed = right ? run.revealed : [...run.revealed, cell];
  const solved = cells.every((c, i) => c === FILLED || !inked(picture, i));
  const ending: PixelockEnding | null = solved ? "solved" : mistakes >= LIVES ? "out" : null;
  return {
    ...run,
    cells,
    revealed,
    moves: [...run.moves, m],
    mistakes,
    fills,
    outcome: ending ? "over" : "playing",
    ending,
  };
}

/** Stops: the run ends with the cells it has. */
export function stop(run: PixelockRun): PixelockRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stopped" };
}

export function scoreOf(run: PixelockRun): number {
  return run.ending === "solved"
    ? run.fills + SOLVE_POINTS + LIFE_POINTS * (LIVES - run.mistakes)
    : run.fills;
}

export type PixelockSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: PixelockRun): PixelockSubmission {
  return { rulesVersion: run.rulesVersion, actions: run.moves, score: scoreOf(run) };
}

export function replay(day: string | number, actions: readonly number[]): PixelockRun {
  return actions.reduce((run, m) => move(run, m), createRun(day));
}

/** Whether a line's filled cells are all shown: its clue can be dimmed. */
export function lineDone(run: PixelockRun, kind: "row" | "column", index: number): boolean {
  const ink = inkOf(pictureOf(run));
  const take = kind === "row" ? rowLine : columnLine;
  const shown = take(run.cells, index);
  return take(ink, index).every((on, i) => !on || shown[i] === FILLED);
}

// ── The line solver ───────────────────────────────────────────────────────────

/** Every way to lay a clue's runs on a line that agrees with what is known. */
function placements(clue: readonly number[], known: readonly (boolean | null)[]): boolean[][] {
  const n = known.length;
  const out: boolean[][] = [];
  const line: boolean[] = Array(n).fill(false);
  function place(k: number, from: number) {
    if (k === clue.length) {
      for (let i = from; i < n; i += 1) if (known[i] === true) return;
      out.push([...line]);
      return;
    }
    const len = clue[k]!;
    const rest = clue.slice(k + 1).reduce((s, x) => s + x + 1, 0);
    for (let start = from; start + len + rest <= n; start += 1) {
      if (known[start - 1] === true && start > from) break;
      let ok = true;
      for (let i = start; i < start + len; i += 1) if (known[i] === false) ok = false;
      if (start + len < n && known[start + len] === true) ok = false;
      for (let i = from; i < start; i += 1) if (known[i] === true) ok = false;
      if (!ok) continue;
      for (let i = start; i < start + len; i += 1) line[i] = true;
      place(k + 1, start + len + 1);
      for (let i = start; i < start + len; i += 1) line[i] = false;
    }
  }
  place(0, 0);
  return out;
}

/**
 * Solves a picture from its clues alone, a line at a time: a cell is decided only
 * when every arrangement of its row (or column) agrees on it. Returns the grid
 * (true, false, or null where line logic could not decide).
 */
export function solveByLines(clues: Clues): (boolean | null)[] {
  const grid: (boolean | null)[] = Array(CELLS).fill(null);
  let changed = true;
  while (changed) {
    changed = false;
    for (const kind of ["row", "column"] as const) {
      for (let k = 0; k < SIZE; k += 1) {
        const index = (i: number) => (kind === "row" ? k * SIZE + i : i * SIZE + k);
        const known = Array.from({ length: SIZE }, (_, i) => grid[index(i)]!);
        const ways = placements(kind === "row" ? clues.rows[k]! : clues.columns[k]!, known);
        if (ways.length === 0) return grid;
        for (let i = 0; i < SIZE; i += 1) {
          if (known[i] !== null) continue;
          const first = ways[0]![i]!;
          if (ways.every((w) => w[i] === first)) {
            grid[index(i)] = first;
            changed = true;
          }
        }
      }
    }
  }
  return grid;
}
