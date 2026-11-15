/**
 * Only Once (runtime `only-once`) — seven questions, and never the same answer
 * twice, as a pure deterministic state machine.
 *
 * Every day is one kind of thing — countries, US states or chemical elements — and
 * seven questions about it, broad first and narrow last: "Name a country in
 * Europe", then, later, "Name a country that borders Austria". The same answers fit
 * question after question, but each can be given only once, so spending the famous
 * one early can leave you stuck later. A wrong answer, or one already used, is
 * simply turned down; only the clock ends the day — 25 seconds a question.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_only_once_run` in
 * `supabase/migrations/20270104120200_only_once_sessions.sql` replays the answers on
 * the day's puzzle and decides the score. `only-once.test.ts` pins the two together.
 *
 * ## The day
 *
 * A session's seed is the player's day number, and day `d` is puzzle `d mod n` of
 * `ONLY_ONCE_PUZZLES`.
 *
 * ## A move
 *
 * A move is an accepted answer: the id of the thing named, for the question the run
 * is on. Answers the board turned down are not moves; the run only remembers the
 * ones that count. An id that is not a right answer to its question, or that was
 * already given, is not a move.
 *
 * ## The score
 *
 * Ten for every question answered, and thirty more for all seven: 100 for a perfect
 * day (the screen shows ten times that). The clock is the player's own, and is not
 * replayed: as for every game here, the verifier proves a run is legal, not that a
 * person played it.
 */

import {
  KINDS,
  ONLY_ONCE_PUZZLES,
  QUESTIONS_PER_PUZZLE,
  type Kind,
  type Puzzle,
  type Question,
} from "@/lib/games/only-once-bank";
import type { Entity } from "@/lib/games/only-once-data";
import { fold } from "@/lib/games/ton-up";

export const ONLY_ONCE_RUNTIME = "only-once";
export const ONLY_ONCE_RULES_VERSION = "only-once@1";

export const POINTS_PER_ANSWER = 10;
export const SUMMIT_BONUS = 30;
/** Seconds for each question, once it has been read. */
export const SECONDS_PER_QUESTION = 25;
/** The grace before a question's clock starts. */
export const READING_MS = 2000;

export type OnlyOnceEnding = "summit" | "timeout" | "stopped";

export type OnlyOnceRun = {
  readonly day: number;
  readonly rulesVersion: string;
  readonly puzzle: number;
  /** The accepted answers, one per question so far. This *is* the submission. */
  readonly answers: readonly number[];
  readonly outcome: "playing" | "over";
  readonly ending: OnlyOnceEnding | null;
};

export function puzzleIndexForDay(day: number, count = ONLY_ONCE_PUZZLES.length): number {
  return ((day % count) + count) % count;
}

export function puzzleOf(run: OnlyOnceRun): Puzzle {
  return ONLY_ONCE_PUZZLES[run.puzzle]!;
}

export function kindOf(run: OnlyOnceRun): Kind {
  return KINDS[puzzleOf(run).kind]!;
}

/** The question the run is on, or null once it is over. */
export function currentQuestion(run: OnlyOnceRun): Question | null {
  if (run.outcome !== "playing") return null;
  return puzzleOf(run).questions[run.answers.length] ?? null;
}

export function createRun(
  day: string | number,
  rulesVersion = ONLY_ONCE_RULES_VERSION,
): OnlyOnceRun {
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

/** Why an answer is turned down, or null when it counts. */
export function refusal(run: OnlyOnceRun, id: number): "over" | "used" | "wrong" | null {
  const question = currentQuestion(run);
  if (!question) return "over";
  if (run.answers.includes(id)) return "used";
  return question.answers.includes(id) ? null : "wrong";
}

/** Gives an answer. A turned-down answer returns the same run object. */
export function answer(run: OnlyOnceRun, id: number): OnlyOnceRun {
  if (refusal(run, id) !== null) return run;
  const answers = [...run.answers, id];
  const summit = answers.length >= QUESTIONS_PER_PUZZLE;
  return {
    ...run,
    answers,
    outcome: summit ? "over" : "playing",
    ending: summit ? "summit" : null,
  };
}

/** The question's clock ran out: the day ends here. */
export function timeOut(run: OnlyOnceRun): OnlyOnceRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "timeout" };
}

/** The player ends the run where it stands. */
export function stop(run: OnlyOnceRun): OnlyOnceRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stopped" };
}

export function scoreOf(run: OnlyOnceRun): number {
  const n = run.answers.length;
  return n * POINTS_PER_ANSWER + (n >= QUESTIONS_PER_PUZZLE ? SUMMIT_BONUS : 0);
}

export function submission(run: OnlyOnceRun) {
  return { rulesVersion: run.rulesVersion, actions: run.answers, score: scoreOf(run) };
}

export function replay(day: string | number, actions: readonly number[]): OnlyOnceRun {
  return actions.reduce((run, id) => answer(run, id), createRun(day));
}

/**
 * The things a typed name could mean, among every thing of the day's kind — not
 * just the right answers, so the list gives nothing away. Best first.
 */
export function matches(kind: Kind, typed: string, limit = 6): { id: number; entity: Entity }[] {
  const q = fold(typed);
  if (!q) return [];
  const ranked: { id: number; entity: Entity; rank: number }[] = [];
  kind.entities.forEach((entity, id) => {
    let rank = Infinity;
    for (const name of [entity.name, ...(entity.aliases ?? [])].map(fold)) {
      if (name === q) rank = Math.min(rank, 0);
      else if (name.startsWith(q)) rank = Math.min(rank, 1);
      else if (q.length >= 2 && name.split(" ").some((word) => word.startsWith(q))) {
        rank = Math.min(rank, 2);
      }
    }
    if (rank < Infinity) ranked.push({ id, entity, rank });
  });
  return ranked
    .sort((a, b) => a.rank - b.rank || a.entity.name.localeCompare(b.entity.name))
    .slice(0, limit)
    .map(({ id, entity }) => ({ id, entity }));
}
