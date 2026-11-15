/**
 * Honeycomb (runtime `honeycomb`) — seven letters a day and every word they make,
 * as a pure deterministic state machine.
 *
 * Make words of four or more letters from the seven, always using the centre one;
 * letters can be used again. A four-letter word is worth 1, a longer one a point a
 * letter, and a word that uses all seven letters 7 more. Find as many as you like
 * and stop when you're done; the ranks go up as the score does.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_honeycomb_run` in
 * `supabase/migrations/20270106120100_honeycomb_sessions.sql` replays the words found
 * and decides the score. `honeycomb.test.ts` pins the two together.
 *
 * ## The day
 *
 * A session's seed is the player's day number, and day `d` plays puzzle `d mod n` of
 * `HONEYCOMB_PUZZLES`, generated from a word list by
 * `scripts/generate-honeycomb-bank.ts`.
 *
 * ## A move
 *
 * A move is one word found: its id, its place in the puzzle's sorted word list. An id
 * out of range, a word already found, or a move after the run is over (every word
 * found) is not a move. Typing a word that isn't in the list costs nothing and is not
 * a move: the screen just says so.
 *
 * ## The score
 *
 * The sum of the words found: 1 for four letters, otherwise the length, and 7 more
 * for a word that uses all seven letters.
 */

import { HONEYCOMB_PUZZLES, type HoneycombPuzzle } from "@/lib/games/honeycomb-bank";

export const HONEYCOMB_RUNTIME = "honeycomb";
export const HONEYCOMB_RULES_VERSION = "honeycomb@1";

export const MIN_LENGTH = 4;
export const ALL_SEVEN_BONUS = 7;
/** The most words a puzzle may have: the bound on a submission. */
export const MAX_WORDS = 64;

export type HoneycombEnding = "all" | "stopped";

export type HoneycombRun = {
  readonly day: number;
  readonly rulesVersion: string;
  readonly puzzle: number;
  /** The ids of the words found, in order. This *is* the submission. */
  readonly found: readonly number[];
  readonly outcome: "playing" | "over";
  readonly ending: HoneycombEnding | null;
};

export function puzzleIndexForDay(day: number, count = HONEYCOMB_PUZZLES.length): number {
  return ((day % count) + count) % count;
}

export function puzzleOf(run: Pick<HoneycombRun, "puzzle">): HoneycombPuzzle {
  return HONEYCOMB_PUZZLES[run.puzzle]!;
}

/** Whether a word uses every one of the puzzle's seven letters. */
export function usesAllSeven(puzzle: HoneycombPuzzle, word: string): boolean {
  return [...puzzle.letters].every((letter) => word.includes(letter));
}

/** What a word is worth in a puzzle. */
export function wordPoints(puzzle: HoneycombPuzzle, word: string): number {
  const base = word.length === MIN_LENGTH ? 1 : word.length;
  return base + (usesAllSeven(puzzle, word) ? ALL_SEVEN_BONUS : 0);
}

/** Every word's points, in id order: what the database holds. */
export function pointsList(puzzle: HoneycombPuzzle): number[] {
  return puzzle.words.map((word) => wordPoints(puzzle, word));
}

export function maxScore(puzzle: HoneycombPuzzle): number {
  return pointsList(puzzle).reduce((sum, n) => sum + n, 0);
}

export function createRun(
  day: string | number,
  rulesVersion = HONEYCOMB_RULES_VERSION,
): HoneycombRun {
  const d = Number(day);
  return {
    day: d,
    rulesVersion,
    puzzle: puzzleIndexForDay(d),
    found: [],
    outcome: "playing",
    ending: null,
  };
}

/** Why a word id cannot be found, or null when it can. */
export function refusal(run: HoneycombRun, id: number): "over" | "unknown" | "found" | null {
  if (run.outcome !== "playing") return "over";
  if (!Number.isInteger(id) || id < 0 || id >= puzzleOf(run).words.length) return "unknown";
  return run.found.includes(id) ? "found" : null;
}

/** Finds a word by id. A refused id returns the same run object. */
export function find(run: HoneycombRun, id: number): HoneycombRun {
  if (refusal(run, id) !== null) return run;
  const found = [...run.found, id];
  const all = found.length === puzzleOf(run).words.length;
  return { ...run, found, outcome: all ? "over" : "playing", ending: all ? "all" : null };
}

/** Stops: the run ends with the words it has. */
export function stop(run: HoneycombRun): HoneycombRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stopped" };
}

export function scoreOf(run: HoneycombRun): number {
  const puzzle = puzzleOf(run);
  return run.found.reduce((sum, id) => sum + wordPoints(puzzle, puzzle.words[id]!), 0);
}

export type HoneycombSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: HoneycombRun): HoneycombSubmission {
  return { rulesVersion: run.rulesVersion, actions: run.found, score: scoreOf(run) };
}

export function replay(day: string | number, actions: readonly number[]): HoneycombRun {
  return actions.reduce((run, id) => find(run, id), createRun(day));
}

/** What typing a word means: its id, or why it doesn't count. */
export type Attempt =
  | { readonly kind: "word"; readonly id: number }
  | { readonly kind: "short" | "centre" | "letters" | "unknown" | "found" };

export function attempt(run: HoneycombRun, typed: string): Attempt {
  const puzzle = puzzleOf(run);
  const word = typed.toLowerCase();
  if (word.length < MIN_LENGTH) return { kind: "short" };
  if ([...word].some((ch) => !puzzle.letters.includes(ch))) return { kind: "letters" };
  if (!word.includes(puzzle.letters[0]!)) return { kind: "centre" };
  const id = puzzle.words.indexOf(word);
  if (id < 0) return { kind: "unknown" };
  return run.found.includes(id) ? { kind: "found" } : { kind: "word", id };
}

/**
 * The ranks, by the share of the day's points: the threshold each starts at, in
 * percent. The names are the screen's.
 */
export const RANKS = [
  { name: "Egg", at: 0 },
  { name: "Larva", at: 5 },
  { name: "Worker", at: 15 },
  { name: "Forager", at: 30 },
  { name: "Builder", at: 45 },
  { name: "Guard", at: 60 },
  { name: "Royal", at: 75 },
] as const;

export function rankIndex(run: HoneycombRun): number {
  const max = maxScore(puzzleOf(run));
  const pct = max === 0 ? 0 : (scoreOf(run) * 100) / max;
  let index = 0;
  RANKS.forEach((rank, i) => {
    if (pct >= rank.at) index = i;
  });
  return index;
}

/** The six outer letters in the order the board first shows them. */
export function outerLetters(puzzle: HoneycombPuzzle): string[] {
  return [...puzzle.letters.slice(1)];
}
