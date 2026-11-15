/**
 * Then & Now (runtime `then-and-now`) — six events a day, put in the order they
 * happened, as a pure deterministic state machine.
 *
 * The events arrive shuffled. Swap them into the order you think is right and
 * submit: every event in its right place locks in, and the rest stay to be moved.
 * Four tries to get all six.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_then_and_now_run` in
 * `supabase/migrations/20270106120000_then_and_now_sessions.sql` replays the tries
 * and decides the score. `then-and-now.test.ts` and
 * `tests/security/verifier_vectors.sql` pin the two together.
 *
 * ## The day
 *
 * A session's seed is the player's day number, and day `d` plays puzzle `d mod n`
 * of `THEN_AND_NOW_PUZZLES`. Every puzzle lists its events oldest first, so event
 * id `i` belongs in place `i`: the verifier needs no bank. The board's first order
 * is shuffled from the day, for the screen only.
 *
 * ## A move
 *
 * A move is one try: the order submitted, as `Σ id at place p × 6^p`. A try that is
 * not an order of all six ids, that moves an event already locked in, that repeats
 * an earlier try, or that comes after the run is over is not a move.
 *
 * ## The score
 *
 * Every event in its right place after the last try is worth 10. Getting all six
 * adds 20 for every try left: 60 + 20 × (4 − tries), so all six on the first try is
 * 120 (1,200 on screen). A run that ends early keeps 10 a placed event.
 */

import { THEN_AND_NOW_PUZZLES, type ThenAndNowPuzzle } from "@/lib/games/then-and-now-bank";

export const THEN_AND_NOW_RUNTIME = "then-and-now";
export const THEN_AND_NOW_RULES_VERSION = "then-and-now@1";

export const EVENTS = 6;
export const MAX_TRIES = 4;
export const PLACED_POINTS = 10;
export const TRY_LEFT_POINTS = 20;

export type ThenAndNowEnding = "solved" | "out" | "stopped";

export type ThenAndNowRun = {
  readonly day: number;
  readonly rulesVersion: string;
  readonly puzzle: number;
  /** Every try so far, as codes, in order. This *is* the submission. */
  readonly tries: readonly number[];
  /** The places whose event is locked in: right in some try. */
  readonly locked: readonly boolean[];
  readonly outcome: "playing" | "over";
  readonly ending: ThenAndNowEnding | null;
};

export function puzzleIndexForDay(day: number, count = THEN_AND_NOW_PUZZLES.length): number {
  return ((day % count) + count) % count;
}

export function puzzleOf(run: Pick<ThenAndNowRun, "puzzle">): ThenAndNowPuzzle {
  return THEN_AND_NOW_PUZZLES[run.puzzle]!;
}

/** An order as a code: `Σ order[p] × 6^p`. */
export function encode(order: readonly number[]): number {
  return order.reduce((sum, id, p) => sum + id * EVENTS ** p, 0);
}

/** A code as an order, or null when it is not an order of all six ids. */
export function decode(code: number): number[] | null {
  if (!Number.isInteger(code) || code < 0 || code >= EVENTS ** EVENTS) return null;
  const order: number[] = [];
  let rest = code;
  for (let p = 0; p < EVENTS; p += 1) {
    order.push(rest % EVENTS);
    rest = Math.floor(rest / EVENTS);
  }
  return new Set(order).size === EVENTS ? order : null;
}

export function createRun(
  day: string | number,
  rulesVersion = THEN_AND_NOW_RULES_VERSION,
): ThenAndNowRun {
  const d = Number(day);
  return {
    day: d,
    rulesVersion,
    puzzle: puzzleIndexForDay(d),
    tries: [],
    locked: Array.from({ length: EVENTS }, () => false),
    outcome: "playing",
    ending: null,
  };
}

/** Why a try cannot be made, or null when it can. */
export function refusal(
  run: ThenAndNowRun,
  code: number,
): "over" | "invalid" | "moved" | "repeat" | null {
  if (run.outcome !== "playing") return "over";
  const order = decode(code);
  if (!order) return "invalid";
  if (run.locked.some((on, p) => on && order[p] !== p)) return "moved";
  return run.tries.includes(code) ? "repeat" : null;
}

/** Submits an order. A refused try returns the same run object. */
export function submit(run: ThenAndNowRun, code: number): ThenAndNowRun {
  if (refusal(run, code) !== null) return run;
  const order = decode(code)!;
  const locked = order.map((id, p) => id === p);
  const tries = [...run.tries, code];
  const ending: ThenAndNowEnding | null = locked.every(Boolean)
    ? "solved"
    : tries.length >= MAX_TRIES
      ? "out"
      : null;
  return { ...run, tries, locked, outcome: ending ? "over" : "playing", ending };
}

/** Stops: the run ends with the events it has placed. */
export function stop(run: ThenAndNowRun): ThenAndNowRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stopped" };
}

export function placedCount(run: ThenAndNowRun): number {
  return run.locked.filter(Boolean).length;
}

export function scoreOf(run: ThenAndNowRun): number {
  const placed = placedCount(run) * PLACED_POINTS;
  return run.ending === "solved"
    ? placed + TRY_LEFT_POINTS * (MAX_TRIES - run.tries.length)
    : placed;
}

export type ThenAndNowSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: ThenAndNowRun): ThenAndNowSubmission {
  return { rulesVersion: run.rulesVersion, actions: run.tries, score: scoreOf(run) };
}

export function replay(day: string | number, actions: readonly number[]): ThenAndNowRun {
  return actions.reduce((run, code) => submit(run, code), createRun(day));
}

/**
 * The order the board first shows: the six ids shuffled by a small LCG seeded with
 * the day, never already in order and never with more than two in place.
 */
export function startOrder(day: number): number[] {
  let state = (Math.abs(Math.trunc(day)) * 2246822519 + 7) >>> 0;
  for (;;) {
    const ids = Array.from({ length: EVENTS }, (_, i) => i);
    for (let i = ids.length - 1; i > 0; i -= 1) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      const j = state % (i + 1);
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    if (ids.filter((id, p) => id === p).length <= 2) return ids;
  }
}

/** A year for the screen: "1969", "44 BC", "AD 80". */
export function yearLabel(year: number): string {
  if (year < 0) return `${-year} BC`;
  if (year < 500) return `AD ${year}`;
  return String(year);
}
