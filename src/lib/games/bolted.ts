/**
 * Bolted — the game, as a pure deterministic state machine.
 *
 * The nut-and-bolt sorting puzzle: bolts of stacked coloured nuts, four to a
 * bolt. Move the top nut — and every nut of its colour right under it, as many
 * as fit — onto another bolt, until every bolt holds one colour. A move lands on
 * an empty bolt or on a nut of the same colour. Two twists make it its own game:
 *
 * - **A full bolt locks.** Four nuts of one colour are done; they cannot be
 *   moved again.
 * - **Nuts start hidden.** From board three, every nut below the top of a dealt
 *   bolt is face down until the nuts above it have been moved off. Hiding only
 *   changes what the screen shows: the rules, and the server, know every nut.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_bolted_run` in
 * `supabase/migrations/20261205120000_bolted_sessions.sql` replays the submitted
 * actions from the session's seed and derives the score itself. See
 * `docs/games/README.md`.
 *
 * ## The run
 *
 * As in Decant: one clock that the server times, seventy-five seconds to start,
 * and every solved board adds five seconds per colour (`clock.ts` tapers it) and
 * scores one point per colour (shown ×10: 30 for a three-colour board).
 * Undo, restart and the one extra bolt a board allows are actions too.
 */

import { taperedBonusMs } from "@/lib/games/clock";

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const BOLTED_RUNTIME = "bolted";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const BOLTED_RULES_VERSION = "bolted@1";

/** Nuts a bolt holds. */
export const BOLTED_DEPTH = 4;

/** Empty bolts on every board as it is dealt. */
export const BOLTED_SPARE_BOLTS = 2;

/** The most colours a board reaches. */
export const BOLTED_MAX_COLOURS = 8;

/** Boards from this one on are dealt with their nuts hidden. */
export const BOLTED_HIDDEN_FROM = 3;

/** The most actions one submission may carry: a request ceiling, not a last board. */
export const BOLTED_MAX_ACTIONS = 8192;

export const BOLTED_START_MS = 75_000;
export const BOLTED_BONUS_MS_PER_COLOUR = 5_000;
/** What the extra bolt costs. */
export const BOLTED_EXTRA_BOLT_MS = 15_000;
/** How late after its clock ran out the server still accepts a run. */
export const BOLTED_SLACK_MS = 20_000;

/** Actions: a move is `from × 16 + to`; these three are the board's own controls. */
export const BOLTED_EXTRA_BOLT = 253;
export const BOLTED_UNDO = 254;
export const BOLTED_RESTART = 255;

const SEED_MODULUS = 4294967296n;
const ZERO_STATE_FALLBACK = 2654435769;
/** Mixed into the seed, so Bolted never deals Decant's boards from the same seed. */
const SEED_MIX = 0x85ebca6b;
const OUTER_MULTIPLIER = 1664525;
const OUTER_INCREMENT = 1013904223;
const INNER_MULTIPLIER = 22695477;
const INNER_INCREMENT = 1;

/** A bolt, bottom first. Colours are 1 to 8. */
export type Bolt = readonly number[];

export type BoltedEnding = "time" | "stopped" | "bound";
export type BoltedOutcome = "playing" | "over";

export type BoltedRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /** Every action, in order. This *is* the submission. */
  readonly actions: readonly number[];
  /** The board being played, 1-based. */
  readonly level: number;
  readonly bolts: readonly Bolt[];
  /** How many nuts at the bottom of each bolt are still face down. Screen only. */
  readonly hidden: readonly number[];
  /** The current board's earlier states, for undo. Not part of the submission. */
  readonly history: readonly (readonly Bolt[])[];
  /** Whether the extra bolt was added on this board. */
  readonly extraBolt: boolean;
  /** Extra bolts added over the whole run: each one cost clock. */
  readonly extraBolts: number;
  /** Moves made on the current board (undo takes one back). */
  readonly moves: number;
  readonly levelsCleared: number;
  readonly score: number;
  readonly outcome: BoltedOutcome;
  readonly ending: BoltedEnding | null;
};

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new TypeError("a Bolted seed must be a whole number");
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Bolted seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

function initialState(seed: string | number | bigint): number {
  const reduced = Number(((toBigInt(seed) % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS);
  const mixed = (reduced ^ SEED_MIX) >>> 0;
  return mixed === 0 ? ZERO_STATE_FALLBACK : mixed;
}

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError("a Bolted level must be a whole number from 1");
  }
}

/** A level's colours: 3, one more every second board, up to 8. */
export function coloursFor(level: number): number {
  assertLevel(level);
  return Math.min(BOLTED_MAX_COLOURS, 3 + Math.floor((level - 1) / 2));
}

/**
 * The clock a run has earned, in ms: seventy-five seconds, five more per colour
 * of every solved board as the taper shrinks it, less fifteen per extra bolt.
 */
export function budgetMs(levelsCleared: number, extraBolts = 0): number {
  let ms = BOLTED_START_MS - BOLTED_EXTRA_BOLT_MS * extraBolts;
  for (let level = 1; level <= levelsCleared; level += 1) {
    ms += taperedBonusMs(BOLTED_BONUS_MS_PER_COLOUR * coloursFor(level), level);
  }
  return ms;
}

export function topColour(bolt: Bolt): number {
  return bolt.length ? bolt[bolt.length - 1] : 0;
}

/** How many nuts of the top colour sit together at the top of a bolt. */
export function topRun(bolt: Bolt): number {
  const colour = topColour(bolt);
  let run = 0;
  for (let i = bolt.length - 1; i >= 0 && bolt[i] === colour; i -= 1) run += 1;
  return run;
}

/** Whether a bolt is locked: full of one colour. */
export function isLocked(bolt: Bolt): boolean {
  return bolt.length === BOLTED_DEPTH && topRun(bolt) === BOLTED_DEPTH;
}

/** Whether every bolt is empty or locked. */
export function isSolved(bolts: readonly Bolt[]): boolean {
  return bolts.every((bolt) => bolt.length === 0 || isLocked(bolt));
}

/** How many nuts a move from `from` to `to` carries; 0 when it is not allowed. */
export function moveAmount(bolts: readonly Bolt[], from: number, to: number): number {
  if (from === to) return 0;
  const source = bolts[from];
  const target = bolts[to];
  if (!source || !target || source.length === 0 || target.length >= BOLTED_DEPTH) return 0;
  if (isLocked(source)) return 0;
  if (target.length > 0 && topColour(target) !== topColour(source)) return 0;
  return Math.min(topRun(source), BOLTED_DEPTH - target.length);
}

function moved(bolts: readonly Bolt[], from: number, to: number): Bolt[] {
  const amount = moveAmount(bolts, from, to);
  const colour = topColour(bolts[from]);
  return bolts.map((bolt, index) =>
    index === from
      ? bolt.slice(0, bolt.length - amount)
      : index === to
        ? [...bolt, ...Array.from({ length: amount }, () => colour)]
        : bolt,
  );
}

/**
 * The board a level is dealt: Decant's deal over Bolted's own seed. Every nut,
 * colour by colour, shuffled by a Fisher–Yates pass from the last nut down —
 * each swap partner the next draw modulo the nuts left — then four to a bolt,
 * bottom first, and two empty bolts.
 */
export function board(seed: string | number | bigint, level: number): Bolt[] {
  assertLevel(level);
  let state = initialState(seed);
  for (let current = 1; current <= level; current += 1) {
    state = (Math.imul(state, OUTER_MULTIPLIER) + OUTER_INCREMENT) >>> 0;
  }
  const next = () => {
    state = (Math.imul(state, INNER_MULTIPLIER) + INNER_INCREMENT) >>> 0;
    return state >>> 16;
  };
  const colours = coloursFor(level);
  const nuts: number[] = [];
  for (let colour = 1; colour <= colours; colour += 1) {
    for (let nut = 0; nut < BOLTED_DEPTH; nut += 1) nuts.push(colour);
  }
  for (let i = nuts.length - 1; i > 0; i -= 1) {
    const j = next() % (i + 1);
    [nuts[i], nuts[j]] = [nuts[j], nuts[i]];
  }
  const bolts: Bolt[] = [];
  for (let bolt = 0; bolt < colours; bolt += 1) {
    bolts.push(nuts.slice(bolt * BOLTED_DEPTH, (bolt + 1) * BOLTED_DEPTH));
  }
  for (let spare = 0; spare < BOLTED_SPARE_BOLTS; spare += 1) bolts.push([]);
  return bolts;
}

/** Which nuts a freshly dealt board hides: all but the top of each bolt, from board three. */
function dealtHidden(level: number, bolts: readonly Bolt[]): number[] {
  return bolts.map((bolt) => (level >= BOLTED_HIDDEN_FROM ? Math.max(0, bolt.length - 1) : 0));
}

/** Hidden nuts never outnumber the nuts under the top: a nut on top is face up for good. */
function uncover(hidden: readonly number[], bolts: readonly Bolt[]): number[] {
  return bolts.map((bolt, i) => Math.min(hidden[i] ?? 0, Math.max(0, bolt.length - 1)));
}

/** A fresh run on board one. */
export function createRun(seed: string | number | bigint): BoltedRun {
  const normalised = toBigInt(seed).toString();
  const bolts = board(normalised, 1);
  return {
    seed: normalised,
    rulesVersion: BOLTED_RULES_VERSION,
    actions: [],
    level: 1,
    bolts,
    hidden: dealtHidden(1, bolts),
    history: [],
    extraBolt: false,
    extraBolts: 0,
    moves: 0,
    levelsCleared: 0,
    score: 0,
    outcome: "playing",
    ending: null,
  };
}

/** A move's action number. */
export function encodeMove(from: number, to: number): number {
  return from * 16 + to;
}

function withAction(run: BoltedRun, action: number, changes: Partial<BoltedRun>): BoltedRun {
  const actions = [...run.actions, action];
  const atBound = actions.length >= BOLTED_MAX_ACTIONS;
  return {
    ...run,
    ...changes,
    actions,
    outcome: atBound ? "over" : "playing",
    ending: atBound ? "bound" : null,
  };
}

/** Whether a move is allowed now. */
export function canMove(run: BoltedRun, from: number, to: number): boolean {
  return run.outcome === "playing" && moveAmount(run.bolts, from, to) > 0;
}

/**
 * Moves the top nuts of `from` onto `to`. A move that solves the board scores
 * ten points per colour and deals the next board. A move that is not allowed
 * returns the same run object.
 */
export function move(run: BoltedRun, from: number, to: number): BoltedRun {
  if (!canMove(run, from, to)) return run;
  const bolts = moved(run.bolts, from, to);
  if (isSolved(bolts)) {
    const level = run.level + 1;
    const next = board(run.seed, level);
    return withAction(run, encodeMove(from, to), {
      level,
      bolts: next,
      hidden: dealtHidden(level, next),
      history: [],
      extraBolt: false,
      moves: 0,
      levelsCleared: run.levelsCleared + 1,
      score: run.score + coloursFor(run.level),
    });
  }
  return withAction(run, encodeMove(from, to), {
    bolts,
    hidden: uncover(run.hidden, bolts),
    history: [...run.history, run.bolts],
    moves: run.moves + 1,
  });
}

/**
 * Takes back the last move on this board. A nut that was uncovered stays face
 * up: undo puts nuts back, not secrets.
 */
export function undo(run: BoltedRun): BoltedRun {
  if (run.outcome !== "playing" || run.history.length === 0) return run;
  const bolts = run.history[run.history.length - 1];
  return withAction(run, BOLTED_UNDO, {
    bolts,
    hidden: uncover(run.hidden, bolts),
    history: run.history.slice(0, -1),
    moves: run.moves - 1,
  });
}

/** Puts this board back as it was dealt — with the extra bolt, if one was added. */
export function restart(run: BoltedRun): BoltedRun {
  if (run.outcome !== "playing" || run.moves === 0) return run;
  const dealt = board(run.seed, run.level);
  const bolts = run.extraBolt ? [...dealt, []] : dealt;
  return withAction(run, BOLTED_RESTART, {
    bolts,
    hidden: uncover(run.hidden, bolts),
    history: [],
    moves: 0,
  });
}

/** Adds an empty bolt to this board, once, for fifteen seconds of clock. */
export function addBolt(run: BoltedRun): BoltedRun {
  if (run.outcome !== "playing" || run.extraBolt) return run;
  return withAction(run, BOLTED_EXTRA_BOLT, {
    bolts: [...run.bolts, []],
    hidden: [...run.hidden, 0],
    history: [],
    moves: 0,
    extraBolt: true,
    extraBolts: run.extraBolts + 1,
  });
}

/** Applies one submitted action: how a run is replayed. */
export function apply(run: BoltedRun, action: number): BoltedRun {
  if (action === BOLTED_EXTRA_BOLT) return addBolt(run);
  if (action === BOLTED_UNDO) return undo(run);
  if (action === BOLTED_RESTART) return restart(run);
  return move(run, Math.floor(action / 16), action % 16);
}

/** Ends the run where it stands: the clock ran out, or the player stopped. */
export function finish(run: BoltedRun, ending: "time" | "stopped"): BoltedRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending };
}

export type BoltedSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: BoltedRun): BoltedSubmission {
  return { rulesVersion: run.rulesVersion, actions: run.actions, score: run.score };
}

/**
 * A solution for a board, as moves `[from, to]`, or null when there is none (or
 * the search gives up): a depth-first search over arrangements, bolt order
 * ignored, that never moves a one-colour bolt onto an empty one. The tests use it
 * to prove boards solvable.
 */
export function solve(start: readonly Bolt[], limit = 200_000): [number, number][] | null {
  const seen = new Set<string>();
  const key = (bolts: readonly Bolt[]) =>
    bolts
      .map((bolt) => bolt.join(""))
      .sort()
      .join("|");
  const path: [number, number][] = [];
  const search = (bolts: readonly Bolt[]): boolean | null => {
    if (isSolved(bolts)) return true;
    const here = key(bolts);
    if (seen.has(here)) return false;
    seen.add(here);
    if (seen.size > limit) return null;
    for (let from = 0; from < bolts.length; from += 1) {
      for (let to = 0; to < bolts.length; to += 1) {
        if (!moveAmount(bolts, from, to)) continue;
        if (bolts[to].length === 0 && topRun(bolts[from]) === bolts[from].length) continue;
        path.push([from, to]);
        const found = search(moved(bolts, from, to));
        if (found !== false) return found;
        path.pop();
      }
    }
    return false;
  };
  const result = search(start);
  return result ? [...path] : null;
}
