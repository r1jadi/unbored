/**
 * The daily crossword (runtime `crossword`) — the game, as a pure deterministic
 * state machine.
 *
 * One crossword a day, the same for everyone: a 5×5 **mini** on weekdays and a
 * 7×7 **midi** on Saturday and Sunday, from a bank of original puzzles
 * (`crossword-bank.ts`). Faster solves score more; checking the grid or revealing
 * letters costs points.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_crossword_run` in
 * `supabase/migrations/20261116120000_crossword_sessions.sql` replays the moves
 * on the day's grid and decides the score. The copy is pinned like every other
 * game's: the rules version (`crossword@1`) is data, the state machine is total
 * and pure, and the days and lines in `crossword.test.ts` are the ones
 * `tests/security/rls_test.sql` asserts.
 *
 * ## The day
 *
 * A session's seed is the UTC day number — days since 1970-01-01 — so everyone
 * playing on one day gets one puzzle. Day 0 was a Thursday; weekdays walk the
 * minis in order and weekends the midis.
 *
 * ## A move
 *
 *   - `cell × 32 + code` puts a letter (code 1–26, A–Z) in a white cell, or
 *     clears it (code 0). A revealed cell is locked, and a move that changes
 *     nothing is not a move.
 *   - `1600` checks the grid. The wrong letters it marks are the screen's to
 *     show; to the run it is a penalty.
 *   - `1700 + cell` reveals a cell's letter, which locks it.
 *
 * The run is over once the grid matches the solution. A run the player ends
 * unsolved is valid, and scores nothing.
 *
 * ## The score
 *
 * A solve is worth 1000 (mini) or 2000 (midi) for a grace period of 30 or 60
 * seconds, then four points fewer a second, down to a tenth of that; then 50 off a
 * check and 100 off a revealed letter, never below zero. The **database's** clock
 * times the solve, from the session's start to the submission, so the number here
 * is the screen's estimate — the verified score is the server's.
 *
 * Storage rule: nothing here is persisted. A score only exists once the server has
 * verified it.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const CROSSWORD_RUNTIME = "crossword";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const CROSSWORD_RULES_VERSION = "crossword@1";

/** The most moves one submission may carry. */
export const CROSSWORD_MAX_ACTIONS = 2048;

/** The move codes. */
export const LETTER_STRIDE = 32;
export const CHECK_MOVE = 1600;
export const REVEAL_BASE = 1700;

/** What a check and a revealed letter cost. */
export const CHECK_PENALTY = 50;
export const REVEAL_PENALTY = 100;

const DAY_MS = 86_400_000;

export type CrosswordEntry = {
  /** The number printed in its first cell. */
  readonly number: number;
  readonly across: boolean;
  readonly cells: readonly number[];
  readonly answer: string;
};

/** A day's puzzle, as the grid says it: its size, its solution and its entries. */
export type CrosswordPuzzle = {
  readonly day: number;
  /** 5 for a mini, 7 for a midi. */
  readonly side: number;
  /** The solution in reading order, `#` for a black square. */
  readonly solution: string;
  /** The number printed in each cell, or 0. */
  readonly numbers: readonly number[];
  readonly entries: readonly CrosswordEntry[];
};

export type CrosswordEnding = "solved" | "stopped" | "bound";

/** One run, as this module knows it. */
export type CrosswordRun = {
  /** The session's seed: the day number, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  readonly puzzle: CrosswordPuzzle;
  /** Every move, in order. This *is* the submission. */
  readonly moves: readonly number[];
  /** Each cell's letter, "" when empty or black. */
  readonly letters: readonly string[];
  readonly revealed: readonly boolean[];
  readonly checks: number;
  readonly reveals: number;
  readonly outcome: "playing" | "over";
  readonly ending: CrosswordEnding | null;
};

// ── Days ────────────────────────────────────────────────────────────────────

/** The UTC day number of a moment: days since 1970-01-01. */
export function dayNumber(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

/** The weekday of a day number: 0 Sunday … 6 Saturday. Day 0 was a Thursday. */
export function weekdayOf(day: number): number {
  return (day + 4) % 7;
}

/** Whether a day gets a midi: Saturday and Sunday. */
export function isWeekend(day: number): boolean {
  const weekday = weekdayOf(day);
  return weekday === 0 || weekday === 6;
}

/** How many weekend days come before a day, from day 0. */
export function weekendsBefore(day: number): number {
  let weekends = Math.floor(day / 7) * 2;
  for (let index = 0; index < day % 7; index += 1) {
    if ((4 + index) % 7 === 0 || (4 + index) % 7 === 6) weekends += 1;
  }
  return weekends;
}

/** A day's grid from the bank: weekdays walk the minis, weekends the midis. */
export function gridForDay(
  day: number,
  minis: readonly string[],
  midis: readonly string[],
): string {
  if (!Number.isInteger(day) || day < 0) throw new RangeError("a crossword day is zero or more");
  const weekends = weekendsBefore(day);
  return isWeekend(day) ? midis[weekends % midis.length] : minis[(day - weekends) % minis.length];
}

// ── A puzzle ────────────────────────────────────────────────────────────────

/**
 * Reads a grid: its side, its numbering (a cell is numbered when it starts an
 * across or a down entry, in reading order) and its entries.
 */
export function readPuzzle(day: number, solution: string): CrosswordPuzzle {
  const side = Math.round(Math.sqrt(solution.length));
  if (side * side !== solution.length) throw new RangeError("a crossword grid is square");
  const white = (row: number, column: number) =>
    row >= 0 && column >= 0 && row < side && column < side && solution[row * side + column] !== "#";
  const numbers = new Array<number>(solution.length).fill(0);
  const entries: CrosswordEntry[] = [];
  let next = 1;
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      if (!white(row, column)) continue;
      const startsAcross = !white(row, column - 1) && white(row, column + 1);
      const startsDown = !white(row - 1, column) && white(row + 1, column);
      if (!startsAcross && !startsDown) continue;
      const number = next;
      next += 1;
      numbers[row * side + column] = number;
      for (const [across, starts] of [
        [true, startsAcross],
        [false, startsDown],
      ] as const) {
        if (!starts) continue;
        const cells: number[] = [];
        for (let r = row, c = column; white(r, c); across ? (c += 1) : (r += 1)) {
          cells.push(r * side + c);
        }
        entries.push({
          number,
          across,
          cells,
          answer: cells.map((cell) => solution[cell]).join(""),
        });
      }
    }
  }
  entries.sort((a, b) => Number(b.across) - Number(a.across) || a.number - b.number);
  return { day, side, solution, numbers, entries };
}

/** The entries a cell belongs to: its across entry, its down entry. */
export function entriesAt(
  puzzle: CrosswordPuzzle,
  cell: number,
): { across: CrosswordEntry | null; down: CrosswordEntry | null } {
  return {
    across: puzzle.entries.find((entry) => entry.across && entry.cells.includes(cell)) ?? null,
    down: puzzle.entries.find((entry) => !entry.across && entry.cells.includes(cell)) ?? null,
  };
}

// ── The score ───────────────────────────────────────────────────────────────

/**
 * A solve's score after `seconds`: the base holds for the grace period, then
 * falls four points a second to a tenth of the base; then the penalties.
 */
export function scoreFor(side: number, seconds: number, checks: number, reveals: number): number {
  const base = side === 7 ? 2000 : 1000;
  const grace = side === 7 ? 60 : 30;
  const timed = Math.max(base / 10, base - 4 * Math.max(0, Math.floor(seconds) - grace));
  return Math.max(0, timed - CHECK_PENALTY * checks - REVEAL_PENALTY * reveals);
}

// ── A run ───────────────────────────────────────────────────────────────────

function toDay(seed: string | number | bigint): number {
  const text = String(seed).trim();
  if (!/^\d+$/.test(text)) throw new TypeError("a crossword seed is a day number");
  return Number(text);
}

/** A fresh run on the day's grid (`grid` is that day's, from the bank). */
export function createRun(seed: string | number | bigint, grid: string): CrosswordRun {
  const day = toDay(seed);
  const puzzle = readPuzzle(day, grid);
  return {
    seed: String(day),
    rulesVersion: CROSSWORD_RULES_VERSION,
    puzzle,
    moves: [],
    letters: new Array<string>(grid.length).fill(""),
    revealed: new Array<boolean>(grid.length).fill(false),
    checks: 0,
    reveals: 0,
    outcome: "playing",
    ending: null,
  };
}

function isWhite(run: CrosswordRun, cell: number): boolean {
  return (
    Number.isInteger(cell) &&
    cell >= 0 &&
    cell < run.puzzle.solution.length &&
    run.puzzle.solution[cell] !== "#"
  );
}

/** Whether a cell can be written: the run is live, it is white, and not revealed. */
export function canWrite(run: CrosswordRun, cell: number): boolean {
  return (
    run.outcome === "playing" &&
    run.moves.length < CROSSWORD_MAX_ACTIONS &&
    isWhite(run, cell) &&
    !run.revealed[cell]
  );
}

/** Whether the grid matches its solution. */
export function isSolved(run: Pick<CrosswordRun, "letters" | "puzzle">): boolean {
  return [...run.puzzle.solution].every(
    (letter, cell) => letter === "#" || run.letters[cell] === letter,
  );
}

function apply(run: CrosswordRun, move: number, changes: Partial<CrosswordRun>): CrosswordRun {
  const moves = [...run.moves, move];
  const next = { ...run, ...changes, moves };
  if (isSolved(next)) return { ...next, outcome: "over", ending: "solved" };
  if (moves.length >= CROSSWORD_MAX_ACTIONS) return { ...next, outcome: "over", ending: "bound" };
  return next;
}

/**
 * Puts a letter (A–Z) in a cell, or clears it with "". A move that changes
 * nothing, or one the rules refuse, returns the same run object.
 */
export function enter(run: CrosswordRun, cell: number, letter: string): CrosswordRun {
  const value = letter.toUpperCase();
  if (!canWrite(run, cell) || !/^[A-Z]?$/.test(value) || run.letters[cell] === value) return run;
  const letters = [...run.letters];
  letters[cell] = value;
  const code = value ? value.charCodeAt(0) - 64 : 0;
  return apply(run, cell * LETTER_STRIDE + code, { letters });
}

/** Checks the grid: a penalty, and the screen marks what is wrong (`wrongCells`). */
export function check(run: CrosswordRun): CrosswordRun {
  if (run.outcome !== "playing" || run.moves.length >= CROSSWORD_MAX_ACTIONS) return run;
  return apply(run, CHECK_MOVE, { checks: run.checks + 1 });
}

/** Reveals a cell's letter, which locks it: a penalty. */
export function reveal(run: CrosswordRun, cell: number): CrosswordRun {
  if (!canWrite(run, cell)) return run;
  const letters = [...run.letters];
  letters[cell] = run.puzzle.solution[cell];
  const revealed = [...run.revealed];
  revealed[cell] = true;
  return apply(run, REVEAL_BASE + cell, { letters, revealed, reveals: run.reveals + 1 });
}

/** The filled cells whose letter is wrong: what a check marks. */
export function wrongCells(run: CrosswordRun): Set<number> {
  const wrong = new Set<number>();
  run.letters.forEach((letter, cell) => {
    if (letter && letter !== run.puzzle.solution[cell]) wrong.add(cell);
  });
  return wrong;
}

/** Ends the run where it stands, unsolved: it scores nothing. */
export function finish(run: CrosswordRun): CrosswordRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stopped" };
}

/** The run's score after `seconds`, as the screen estimates it. */
export function estimate(run: CrosswordRun, seconds: number): number {
  if (run.outcome === "over" && run.ending !== "solved") return 0;
  return scoreFor(run.puzzle.side, seconds, run.checks, run.reveals);
}

export type CrosswordSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  readonly tapsPlaced: number;
  readonly levelsCleared: number;
};

/** The submission, with the screen's estimate of the score after `seconds`. */
export function submission(run: CrosswordRun, seconds: number): CrosswordSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.moves,
    score: run.ending === "solved" ? estimate(run, seconds) : 0,
    tapsPlaced: run.moves.length,
    levelsCleared: run.ending === "solved" ? 1 : 0,
  };
}
