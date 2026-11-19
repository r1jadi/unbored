/**
 * Dead Reckoning (runtime `dead-reckoning`) — seven rounds of numbers a day, as a
 * pure deterministic state machine.
 *
 * Every round gives a number and thirty seconds. Four rounds ask you to name
 * something from a list (a mountain, a river, a building, a famous person, a
 * country) whose real value is as close to it as you can; three ask you to
 * estimate a number yourself. The nearer, the more points, and the points drain
 * as the clock runs. One round a day is golden and counts double.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_dead_reckoning_run` in
 * `supabase/migrations/20270121120000_dead_reckoning_sessions.sql` replays the
 * moves on the day's puzzle and decides the score. `dead-reckoning.test.ts` and
 * the verifier vectors pin the two together.
 *
 * ## A move
 *
 * One per round, in order: `(answer + 1) × 32 + seconds`, where `seconds` (0–30) is
 * what was left on the clock and `answer` is the entry's index in the round's list,
 * or the estimate (0 to 9 999 999); `answer + 1 = 0` is no answer (the clock ran
 * out). The seconds are the player's own clock and are not replayed: the verifier
 * only bounds them, as Only Once's clock is not replayed.
 *
 * ## The score
 *
 * The error, in thousandths, is `|value − target| × 1000 ÷ span`, where `span` is
 * the target for a quantity and 100 for a year (so a year is 1% of a century). It
 * rates the answer:
 *
 * | Rating | Error within | Points |
 * | ------ | ------------ | ------ |
 * | Dialed | 1%           | 100    |
 * | Sharp  | 3%           | 75     |
 * | Near   | 7%           | 50     |
 * | Warm   | 15%          | 30     |
 * | Rough  | 30%          | 10     |
 * | Miss   | further      | 0      |
 *
 * and the round scores `⌊points × (20 + seconds) ÷ 50⌋`, from 40% of the points
 * at the buzzer to all of them at once, doubled in the golden round. All integer
 * arithmetic, so the client and the database agree. The screen shows ten times it.
 */

import {
  CATEGORIES,
  ESTIMATES,
  MAX_ESTIMATE,
  PUZZLES,
  ROUNDS,
  type Category,
  type Entry,
  type Puzzle,
  type Round,
  type Scale,
} from "@/lib/games/dead-reckoning-bank";

export const DEAD_RECKONING_RUNTIME = "dead-reckoning";
export const DEAD_RECKONING_RULES_VERSION = "dead-reckoning@1";

export const SECONDS_PER_ROUND = 30;
/** What a move's seconds are packed by. */
const SECOND_CODES = 32;

export type Rating = "dialed" | "sharp" | "near" | "warm" | "rough" | "miss";

/** Each rating's ceiling on the error, in thousandths, and its points. */
export const RATINGS: readonly { rating: Rating; within: number; points: number }[] = [
  { rating: "dialed", within: 10, points: 100 },
  { rating: "sharp", within: 30, points: 75 },
  { rating: "near", within: 70, points: 50 },
  { rating: "warm", within: 150, points: 30 },
  { rating: "rough", within: 300, points: 10 },
];

export type Answer = {
  /** The entry's index or the estimate; null when the clock ran out. */
  readonly answer: number | null;
  readonly seconds: number;
};

export type DeadReckoningEnding = "done" | "stopped";

export type DeadReckoningRun = {
  readonly day: number;
  readonly rulesVersion: string;
  readonly puzzle: number;
  readonly answers: readonly Answer[];
  readonly outcome: "playing" | "over";
  readonly ending: DeadReckoningEnding | null;
};

export function puzzleIndexForDay(day: number, count = PUZZLES.length): number {
  return ((day % count) + count) % count;
}

export function puzzleOf(run: DeadReckoningRun): Puzzle {
  return PUZZLES[run.puzzle]!;
}

export function createRun(
  day: string | number,
  rulesVersion = DEAD_RECKONING_RULES_VERSION,
): DeadReckoningRun {
  const d = Number(day);
  return {
    day: d,
    rulesVersion,
    puzzle: puzzleIndexForDay(d),
    answers: [],
    outcome: "playing",
    ending: null,
  };
}

/** What a round shows and measures against. */
export type RoundView = {
  readonly round: Round;
  readonly category: Category | null;
  readonly prompt: string;
  readonly target: number;
  readonly unit: string;
  readonly scale: Scale;
  readonly golden: boolean;
};

export function roundView(puzzle: Puzzle, index: number): RoundView {
  const round = puzzle.rounds[index]!;
  const golden = puzzle.golden === index;
  if (round.kind === "name") {
    const category = CATEGORIES[round.category]!;
    return {
      round,
      category,
      prompt: category.prompt,
      target: round.target,
      unit: category.unit,
      scale: category.scale,
      golden,
    };
  }
  const estimate = ESTIMATES[round.estimate]!;
  return {
    round,
    category: null,
    prompt: estimate.question,
    target: estimate.answer,
    unit: estimate.unit,
    scale: estimate.scale,
    golden,
  };
}

export function currentRound(run: DeadReckoningRun): RoundView | null {
  return run.outcome === "playing" ? roundView(puzzleOf(run), run.answers.length) : null;
}

/** The real value of an answer: the entry's, or the estimate itself. */
export function valueOf(view: RoundView, answer: number): number {
  return view.category ? view.category.entries[answer]!.value : answer;
}

export function rate(value: number, target: number, scale: Scale): Rating {
  const span = scale === "year" ? 100 : target;
  const off = Math.abs(value - target) * 1000;
  return RATINGS.find(({ within }) => off <= within * span)?.rating ?? "miss";
}

export function pointsFor(rating: Rating): number {
  return RATINGS.find((r) => r.rating === rating)?.points ?? 0;
}

/** What one round scored. */
export function roundScore(view: RoundView, given: Answer): number {
  if (given.answer === null) return 0;
  const base = pointsFor(rate(valueOf(view, given.answer), view.target, view.scale));
  const points = Math.floor((base * (20 + given.seconds)) / 50);
  return view.golden ? points * 2 : points;
}

/** The most a round can still score with `seconds` on the clock: its altitude. */
export function ceilingAt(view: RoundView, seconds: number): number {
  return Math.floor((100 * (20 + seconds)) / 50) * (view.golden ? 2 : 1);
}

export function validAnswer(view: RoundView, answer: number): boolean {
  if (!Number.isInteger(answer) || answer < 0) return false;
  return view.category ? answer < view.category.entries.length : answer <= MAX_ESTIMATE;
}

function clampSeconds(seconds: number): number {
  return Math.max(0, Math.min(SECONDS_PER_ROUND, Math.floor(seconds)));
}

function record(run: DeadReckoningRun, given: Answer): DeadReckoningRun {
  const answers = [...run.answers, given];
  const done = answers.length >= ROUNDS;
  return {
    ...run,
    answers,
    outcome: done ? "over" : "playing",
    ending: done ? "done" : null,
  };
}

/** Answers the round in play with `seconds` left. An answer that is not one is ignored. */
export function answer(run: DeadReckoningRun, value: number, seconds: number): DeadReckoningRun {
  const view = currentRound(run);
  if (!view || !validAnswer(view, value)) return run;
  return record(run, { answer: value, seconds: clampSeconds(seconds) });
}

/** The clock ran out on the round in play. */
export function timeOut(run: DeadReckoningRun): DeadReckoningRun {
  if (run.outcome !== "playing") return run;
  return record(run, { answer: null, seconds: 0 });
}

export function stop(run: DeadReckoningRun): DeadReckoningRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stopped" };
}

export function scoreOf(run: DeadReckoningRun): number {
  const puzzle = puzzleOf(run);
  return run.answers.reduce((sum, given, i) => sum + roundScore(roundView(puzzle, i), given), 0);
}

export function encode(given: Answer): number {
  return ((given.answer ?? -1) + 1) * SECOND_CODES + given.seconds;
}

export function decode(move: number): Answer | null {
  if (!Number.isInteger(move) || move < 0) return null;
  const seconds = move % SECOND_CODES;
  if (seconds > SECONDS_PER_ROUND) return null;
  const answer = Math.floor(move / SECOND_CODES) - 1;
  return { answer: answer < 0 ? null : answer, seconds };
}

export function submission(run: DeadReckoningRun) {
  return { rulesVersion: run.rulesVersion, actions: run.answers.map(encode), score: scoreOf(run) };
}

export function replay(day: string | number, moves: readonly number[]): DeadReckoningRun {
  return moves.reduce((run, move) => {
    const given = decode(move);
    if (!given) return run;
    return given.answer === null ? timeOut(run) : answer(run, given.answer, given.seconds);
  }, createRun(day));
}

/** Folds case, accents and punctuation away, for matching what was typed. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The entries that match what was typed, best first: whole name, prefix, then a word. */
export function matches(
  category: Category,
  typed: string,
  limit = 6,
): { id: number; entry: Entry }[] {
  const query = fold(typed);
  if (!query) return [];
  const ranked: { id: number; entry: Entry; rank: number }[] = [];
  category.entries.forEach((entry, id) => {
    let rank = Infinity;
    for (const name of [entry.name, ...(entry.aliases ?? [])].map(fold)) {
      if (name === query) rank = Math.min(rank, 0);
      else if (name.startsWith(query)) rank = Math.min(rank, 1);
      else if (name.split(" ").some((word) => word.startsWith(query))) rank = Math.min(rank, 2);
    }
    if (rank < Infinity) ranked.push({ id, entry, rank });
  });
  return ranked
    .sort((a, b) => a.rank - b.rank || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map(({ id, entry }) => ({ id, entry }));
}

/** The entries nearest a round's target, for the recap: what would have been Dialed. */
export function nearest(view: RoundView, count = 1): Entry[] {
  if (!view.category) return [];
  return [...view.category.entries]
    .sort((a, b) => Math.abs(a.value - view.target) - Math.abs(b.value - view.target))
    .slice(0, count);
}

/** Reads a typed estimate: "1,234", "1 234", "42". Null for anything else. */
export function parseEstimate(typed: string): number | null {
  const clean = typed.replace(/[,\s_']/g, "");
  if (!/^\d{1,7}$/.test(clean)) return null;
  const value = Number(clean);
  return value <= MAX_ESTIMATE ? value : null;
}

/** A value with its unit: "6,190 m", "1879". */
export function withUnit(value: number, unit: string, scale: Scale): string {
  const number = scale === "year" ? String(value) : value.toLocaleString("en-US");
  return unit ? `${number} ${unit}` : number;
}
