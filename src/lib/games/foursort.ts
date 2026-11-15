/**
 * Foursort (runtime `foursort`) — sixteen words, four hidden groups of four, as a
 * pure deterministic state machine.
 *
 * Pick four words you think belong together and submit them. Right, and the
 * group is locked in and its link shown; wrong, and it costs one of four
 * mistakes. Find all four groups to win; the fourth mistake ends the day.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_foursort_run` in
 * `supabase/migrations/20270105120000_foursort_sessions.sql` replays the guesses
 * and decides the score. `foursort.test.ts` and `tests/security/verifier_vectors.sql`
 * pin the two together.
 *
 * ## The day
 *
 * A session's seed is the player's day number, and day `d` plays puzzle
 * `d mod n` of `FOURSORT_PUZZLES`. A word's id is `4 × group + place`, so a group
 * is always the same four ids and the verifier needs no bank. The board shows the
 * words in an order shuffled from the day; the order is the screen's, not a rule.
 *
 * ## A move
 *
 * A move is one guess: the 16-bit mask of the four word ids picked (bit `i` for
 * id `i`). A mask that does not have exactly four bits, that touches a group
 * already found, that repeats an earlier guess, or that comes after the run is
 * over is not a move.
 *
 * ## The score
 *
 * Every group found is worth 15. Finding all four adds 10 for every mistake left:
 * 60 + 10 × (4 − mistakes), so a perfect day is 100 (1,000 on screen). A run that
 * ends early, or on the fourth mistake, keeps 15 a group.
 */

import { FOURSORT_PUZZLES, type FoursortPuzzle } from "@/lib/games/foursort-bank";

export const FOURSORT_RUNTIME = "foursort";
export const FOURSORT_RULES_VERSION = "foursort@1";

export const GROUPS = 4;
export const GROUP_SIZE = 4;
export const WORDS = GROUPS * GROUP_SIZE;
export const MAX_MISTAKES = 4;
export const GROUP_POINTS = 15;
export const MISTAKE_LEFT_POINTS = 10;
/** The most guesses one run can make: three right and four wrong before the last. */
export const MAX_GUESSES = GROUPS + MAX_MISTAKES - 1;

export type FoursortEnding = "solved" | "out" | "stopped";

export type FoursortRun = {
  readonly day: number;
  readonly rulesVersion: string;
  readonly puzzle: number;
  /** Every guess so far, as masks, in order. This *is* the submission. */
  readonly guesses: readonly number[];
  /** The groups found, in the order they were found. */
  readonly found: readonly number[];
  readonly mistakes: number;
  readonly outcome: "playing" | "over";
  readonly ending: FoursortEnding | null;
};

export function puzzleIndexForDay(day: number, count = FOURSORT_PUZZLES.length): number {
  return ((day % count) + count) % count;
}

export function puzzleOf(run: Pick<FoursortRun, "puzzle">): FoursortPuzzle {
  return FOURSORT_PUZZLES[run.puzzle]!;
}

export function wordOf(puzzle: FoursortPuzzle, id: number): string {
  return puzzle.groups[Math.floor(id / GROUP_SIZE)]!.words[id % GROUP_SIZE]!;
}

/** The mask of group `g`'s four ids. */
export function groupMask(g: number): number {
  return 0xf << (GROUP_SIZE * g);
}

export function maskOf(ids: readonly number[]): number {
  return ids.reduce((mask, id) => mask | (1 << id), 0);
}

export function idsOf(mask: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < WORDS; i += 1) if (mask & (1 << i)) ids.push(i);
  return ids;
}

function bits(mask: number): number {
  let n = 0;
  for (let m = mask; m; m &= m - 1) n += 1;
  return n;
}

export function createRun(
  day: string | number,
  rulesVersion = FOURSORT_RULES_VERSION,
): FoursortRun {
  const d = Number(day);
  return {
    day: d,
    rulesVersion,
    puzzle: puzzleIndexForDay(d),
    guesses: [],
    found: [],
    mistakes: 0,
    outcome: "playing",
    ending: null,
  };
}

/** The group a mask is exactly, or -1. */
export function groupOfMask(mask: number): number {
  for (let g = 0; g < GROUPS; g += 1) if (mask === groupMask(g)) return g;
  return -1;
}

/** The most words of one group a guess holds: 3 is "one away". */
export function bestOverlap(mask: number): number {
  let best = 0;
  for (let g = 0; g < GROUPS; g += 1) best = Math.max(best, bits(mask & groupMask(g)));
  return best;
}

/** Why a guess cannot be made, or null when it can. */
export function refusal(
  run: FoursortRun,
  mask: number,
): "over" | "size" | "found" | "repeat" | null {
  if (run.outcome !== "playing") return "over";
  if (!Number.isInteger(mask) || mask <= 0 || mask >= 1 << WORDS || bits(mask) !== GROUP_SIZE) {
    return "size";
  }
  if (run.found.some((g) => (mask & groupMask(g)) !== 0)) return "found";
  return run.guesses.includes(mask) ? "repeat" : null;
}

/** Makes a guess. A refused guess returns the same run object. */
export function guess(run: FoursortRun, mask: number): FoursortRun {
  if (refusal(run, mask) !== null) return run;
  const guesses = [...run.guesses, mask];
  const g = groupOfMask(mask);
  const found = g >= 0 ? [...run.found, g] : run.found;
  const mistakes = g >= 0 ? run.mistakes : run.mistakes + 1;
  const ending: FoursortEnding | null =
    found.length === GROUPS ? "solved" : mistakes >= MAX_MISTAKES ? "out" : null;
  return { ...run, guesses, found, mistakes, outcome: ending ? "over" : "playing", ending };
}

/** Stops: the run ends with the groups it has. */
export function stop(run: FoursortRun): FoursortRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stopped" };
}

export function scoreOf(run: FoursortRun): number {
  const base = run.found.length * GROUP_POINTS;
  return run.found.length === GROUPS
    ? base + MISTAKE_LEFT_POINTS * (MAX_MISTAKES - run.mistakes)
    : base;
}

export type FoursortSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: FoursortRun): FoursortSubmission {
  return { rulesVersion: run.rulesVersion, actions: run.guesses, score: scoreOf(run) };
}

export function replay(day: string | number, actions: readonly number[]): FoursortRun {
  return actions.reduce((run, action) => guess(run, action), createRun(day));
}

/**
 * The day's words in the order the board first shows them: the sixteen ids
 * shuffled by a small LCG seeded with the day, so everyone sees the same board.
 */
export function boardOrder(day: number): number[] {
  const ids = Array.from({ length: WORDS }, (_, i) => i);
  let state = (Math.abs(Math.trunc(day)) * 2654435761 + 12345) >>> 0;
  for (let i = ids.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    const j = state % (i + 1);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids;
}
