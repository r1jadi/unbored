/**
 * Ton Up (runtime `ton-up`) — three darts at exactly one hundred, as a pure
 * deterministic state machine.
 *
 * Every day is one category — chemical elements, US presidents, calling codes —
 * and every answer in it is worth a number: an element its atomic number, a
 * president their number in office. A dart is naming one answer: its number is
 * added to the total. Up to three darts, each answer once. Stand whenever you
 * like and keep the total; go past 100 and you bust, scoring nothing. Exactly 100
 * is a ton, and a ton in fewer darts is worth more.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_ton_up_run` in
 * `supabase/migrations/20270104120000_ton_up_sessions.sql` replays the darts on the
 * day's category and decides the score. `ton-up.test.ts` pins the two together.
 *
 * ## The day
 *
 * A session's seed is the player's day number (days since 1970-01-01 on their own
 * date), and day `d` plays category `d mod n` of `TON_UP_CATEGORIES`.
 *
 * ## A move
 *
 * A move is one dart: the index of the answer in the day's category. An index
 * already thrown, out of range, or thrown after the run is over is not a move.
 * Standing is not a move: the run simply ends where it is.
 *
 * ## The score
 *
 * A bust scores 0. Otherwise the score is the total, and a ton adds 25 for every
 * dart not needed: 100 + 25 × (4 − darts), so 125 in three darts, 150 in two and
 * 175 in one (the screen shows ten times that, as for every game).
 */

import { TON_UP_CATEGORIES, type TonUpAnswer, type TonUpCategory } from "@/lib/games/ton-up-bank";

export const TON_UP_RUNTIME = "ton-up";
export const TON_UP_RULES_VERSION = "ton-up@1";

export const TARGET = 100;
export const MAX_DARTS = 3;
/** What every dart left in hand adds to a ton, counting the one that hit it. */
export const TON_BONUS_PER_DART = 25;

export type TonUpEnding = "ton" | "bust" | "stood";

export type TonUpRun = {
  readonly day: number;
  readonly rulesVersion: string;
  /** The category's index in the bank. */
  readonly category: number;
  /** The darts so far: answer indices, in order. This *is* the submission. */
  readonly darts: readonly number[];
  readonly total: number;
  readonly outcome: "playing" | "over";
  readonly ending: TonUpEnding | null;
};

export function categoryIndexForDay(day: number, count = TON_UP_CATEGORIES.length): number {
  return ((day % count) + count) % count;
}

export function categoryOf(run: TonUpRun): TonUpCategory {
  return TON_UP_CATEGORIES[run.category]!;
}

export function createRun(day: string | number, rulesVersion = TON_UP_RULES_VERSION): TonUpRun {
  const d = Number(day);
  return {
    day: d,
    rulesVersion,
    category: categoryIndexForDay(d),
    darts: [],
    total: 0,
    outcome: "playing",
    ending: null,
  };
}

/** Why a dart cannot be thrown, or null when it can. */
export function refusal(run: TonUpRun, index: number): "over" | "unknown" | "used" | null {
  if (run.outcome !== "playing") return "over";
  const answers = categoryOf(run).answers;
  if (!Number.isInteger(index) || index < 0 || index >= answers.length) return "unknown";
  return run.darts.includes(index) ? "used" : null;
}

/** Throws a dart. A refused dart returns the same run object. */
export function throwDart(run: TonUpRun, index: number): TonUpRun {
  if (refusal(run, index) !== null) return run;
  const total = run.total + categoryOf(run).answers[index]!.value;
  const darts = [...run.darts, index];
  const ending: TonUpEnding | null =
    total > TARGET ? "bust" : total === TARGET ? "ton" : darts.length >= MAX_DARTS ? "stood" : null;
  return { ...run, darts, total, outcome: ending ? "over" : "playing", ending };
}

/** Stands: the run ends on the total it has. */
export function stand(run: TonUpRun): TonUpRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stood" };
}

export function scoreOf(run: TonUpRun): number {
  if (run.ending === "bust" || run.total > TARGET) return 0;
  if (run.total === TARGET) return TARGET + TON_BONUS_PER_DART * (MAX_DARTS + 1 - run.darts.length);
  return run.total;
}

export type TonUpSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: TonUpRun): TonUpSubmission {
  return { rulesVersion: run.rulesVersion, actions: run.darts, score: scoreOf(run) };
}

export function replay(day: string | number, actions: readonly number[]): TonUpRun {
  return actions.reduce((run, action) => throwDart(run, action), createRun(day));
}

/** Folds a name for matching: case, accents, punctuation and spacing do not count. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function names(answer: TonUpAnswer): string[] {
  return [answer.name, ...(answer.aliases ?? [])].map(fold);
}

/**
 * The answers a typed name could mean, best first: an exact name, then names that
 * start with it, then names with a word that starts with it. Up to `limit`.
 */
export function suggestions(
  category: TonUpCategory,
  typed: string,
  limit = 6,
): { index: number; answer: TonUpAnswer }[] {
  const q = fold(typed);
  if (!q) return [];
  const ranked: { index: number; answer: TonUpAnswer; rank: number }[] = [];
  category.answers.forEach((answer, index) => {
    const all = names(answer);
    let rank = Infinity;
    for (const name of all) {
      if (name === q) rank = Math.min(rank, 0);
      else if (name.startsWith(q)) rank = Math.min(rank, 1);
      else if (name.split(" ").some((word) => word.startsWith(q))) rank = Math.min(rank, 2);
    }
    if (rank < Infinity) ranked.push({ index, answer, rank });
  });
  return ranked
    .sort((a, b) => a.rank - b.rank || a.answer.name.localeCompare(b.answer.name))
    .slice(0, limit)
    .map(({ index, answer }) => ({ index, answer }));
}

/** Every way to reach exactly 100 in one to three darts: how hard the day is. */
export function waysToTon(category: TonUpCategory): number {
  const values = category.answers.map((answer) => answer.value);
  let ways = 0;
  for (let a = 0; a < values.length; a += 1) {
    if (values[a] === TARGET) ways += 1;
    for (let b = a + 1; b < values.length; b += 1) {
      if (values[a]! + values[b]! === TARGET) ways += 1;
      for (let c = b + 1; c < values.length; c += 1) {
        if (values[a]! + values[b]! + values[c]! === TARGET) ways += 1;
      }
    }
  }
  return ways;
}
