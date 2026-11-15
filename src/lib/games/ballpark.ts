/**
 * Ballpark (runtime `ballpark`) — guess the day's price, as a pure deterministic
 * state machine.
 *
 * One product a day, the same for everyone, and six guesses at its price. Every
 * guess says whether the price is higher or lower, and whether you are close —
 * within 25% — or not. Land within 5% and it's yours; fewer guesses score more.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_ballpark_run` in
 * `supabase/migrations/20270104120100_ballpark_sessions.sql` replays the guesses on
 * the day's price and decides the score. `ballpark.test.ts` pins the two together.
 *
 * ## The day
 *
 * A session's seed is the player's day number, and day `d` is product `d mod n` of
 * `BALLPARK_PRODUCTS`.
 *
 * ## A move
 *
 * A move is one guess, in cents: 1 to 99 999 999. Anything else, or a guess after
 * the run is over, is not a move.
 *
 * ## The score
 *
 * Within 5% on guess `k`: `(7 − k) × 10` — sixty for the first guess, ten on the
 * last (the screen shows ten times that). Not within 5% after six guesses, or given
 * up, scores nothing. "Within" is exact integer arithmetic on cents, so the client
 * and the database agree: `|guess − price| × 100 ≤ 5 × price`.
 */

import { BALLPARK_PRODUCTS, type BallparkProduct } from "@/lib/games/ballpark-bank";

export const BALLPARK_RUNTIME = "ballpark";
export const BALLPARK_RULES_VERSION = "ballpark@1";

export const MAX_GUESSES = 6;
export const POINTS_PER_SPARE = 10;
/** The win band, in percent of the price. */
export const WIN_PERCENT = 5;
/** The close band. */
export const CLOSE_PERCENT = 25;
export const MAX_CENTS = 99_999_999;

export type Closeness = "hit" | "close" | "far";
export type Direction = "higher" | "lower" | null;

export type BallparkEnding = "solved" | "out" | "stopped";

export type BallparkRun = {
  readonly day: number;
  readonly rulesVersion: string;
  readonly product: number;
  /** Guesses so far, in cents. This *is* the submission. */
  readonly guesses: readonly number[];
  readonly outcome: "playing" | "over";
  readonly ending: BallparkEnding | null;
};

export function productIndexForDay(day: number, count = BALLPARK_PRODUCTS.length): number {
  return ((day % count) + count) % count;
}

export function productOf(run: BallparkRun): BallparkProduct {
  return BALLPARK_PRODUCTS[run.product]!;
}

export function createRun(
  day: string | number,
  rulesVersion = BALLPARK_RULES_VERSION,
): BallparkRun {
  const d = Number(day);
  return {
    day: d,
    rulesVersion,
    product: productIndexForDay(d),
    guesses: [],
    outcome: "playing",
    ending: null,
  };
}

/** How close a guess is: within 5%, within 25%, or further. */
export function closeness(guess: number, price: number): Closeness {
  const off = Math.abs(guess - price) * 100;
  if (off <= WIN_PERCENT * price) return "hit";
  if (off <= CLOSE_PERCENT * price) return "close";
  return "far";
}

/** Which way the price is from a guess; null on a hit. */
export function direction(guess: number, price: number): Direction {
  if (closeness(guess, price) === "hit") return null;
  return price > guess ? "higher" : "lower";
}

export function validGuess(cents: number): boolean {
  return Number.isInteger(cents) && cents >= 1 && cents <= MAX_CENTS;
}

export function guess(run: BallparkRun, cents: number): BallparkRun {
  if (run.outcome !== "playing" || !validGuess(cents)) return run;
  const guesses = [...run.guesses, cents];
  const solved = closeness(cents, productOf(run).cents) === "hit";
  const out = !solved && guesses.length >= MAX_GUESSES;
  return {
    ...run,
    guesses,
    outcome: solved || out ? "over" : "playing",
    ending: solved ? "solved" : out ? "out" : null,
  };
}

export function giveUp(run: BallparkRun): BallparkRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stopped" };
}

export function scoreOf(run: BallparkRun): number {
  return run.ending === "solved" ? (MAX_GUESSES + 1 - run.guesses.length) * POINTS_PER_SPARE : 0;
}

export function submission(run: BallparkRun) {
  return { rulesVersion: run.rulesVersion, actions: run.guesses, score: scoreOf(run) };
}

export function replay(day: string | number, actions: readonly number[]): BallparkRun {
  return actions.reduce((run, action) => guess(run, action), createRun(day));
}

/**
 * Reads what a player typed as cents: "12", "12.5", "$1,299.99". Null for anything
 * that is not a price.
 */
export function parsePrice(typed: string): number | null {
  const clean = typed.replace(/[$,\s]/g, "");
  if (!/^\d{1,6}(\.\d{0,2})?$/.test(clean) && !/^\.\d{1,2}$/.test(clean)) return null;
  const [whole = "0", fraction = ""] = clean.split(".");
  const cents = Number(whole || "0") * 100 + Number((fraction + "00").slice(0, 2));
  return validGuess(cents) ? cents : null;
}

/** Cents as dollars: 1299 → "$12.99". */
export function dollars(cents: number): string {
  const whole = Math.floor(cents / 100).toLocaleString("en-US");
  return `$${whole}.${String(cents % 100).padStart(2, "0")}`;
}
