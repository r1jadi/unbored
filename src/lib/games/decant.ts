/**
 * Decant — the game, as a pure deterministic state machine.
 *
 * The colour-sorting puzzle: tubes of stacked liquid, four units to a tube. Pour
 * the top of one tube onto another until every tube holds a single colour. A pour
 * is allowed onto an empty tube or onto the same colour, and it moves the whole
 * run of that colour from the top — or as much of it as fits.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_decant_run` in
 * `supabase/migrations/20261121120000_decant_sessions.sql` replays the submitted
 * actions from the session's seed and derives the score itself. The copy is pinned
 * like every other game's: the rules version (`decant@1`) is data, the state
 * machine is total and pure, and the boards in `decant.test.ts` are the ones the
 * verifier must reproduce. See `docs/games/README.md`.
 *
 * ## The boards
 *
 * As in the original game: every unit of every colour, shuffled, fills the colour
 * tubes to the brim, and two tubes start empty. A board has three colours to
 * start, one more every second board, up to nine. With two empty tubes a shuffled
 * board is all but always solvable — every one of 1 500 sampled boards from three
 * to nine colours was — and for the rest there is the original's booster: once per
 * board the player may add an empty tube, which costs fifteen seconds of clock.
 *
 * ## The endless game, against the clock
 *
 * Like 8 Puzzle, a run is a series of boards against one clock that the server
 * times: seventy-five seconds to start, and every solved board adds five seconds
 * per colour — more for the first boards, less for later ones (`clock.ts`) — and
 * ten points per colour. The session is issued when the player presses Start, and the
 * verifier refuses a run that arrives later than its clock allowed
 * (`out_of_time`). Undo, restart and the extra tube are actions too, so the server
 * replays them.
 */

import { taperedBonusMs } from "@/lib/games/clock";

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const DECANT_RUNTIME = "decant";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const DECANT_RULES_VERSION = "decant@2";

/** Units a tube holds. */
export const DECANT_DEPTH = 4;

/** Empty tubes on every board as it is dealt. */
export const DECANT_SPARE_TUBES = 2;

/** The most colours a board reaches. */
export const DECANT_MAX_COLOURS = 9;

/** The most actions one submission may carry: a request ceiling, not a last board. */
export const DECANT_MAX_ACTIONS = 8192;

/**
 * The clock a run starts with, and what every solved board adds per colour
 * before the taper (`clock.ts`).
 */
export const DECANT_START_MS = 75_000;
export const DECANT_BONUS_MS_PER_COLOUR = 5_000;
/** What the extra tube costs. */
export const DECANT_EXTRA_TUBE_MS = 15_000;

/** How late after its clock ran out the server still accepts a run. */
export const DECANT_SLACK_MS = 20_000;

/** Actions: a pour is `from × 16 + to`; these three are the board's own controls. */
export const DECANT_EXTRA_TUBE = 253;
export const DECANT_UNDO = 254;
export const DECANT_RESTART = 255;

const SEED_MODULUS = 4294967296n;
const ZERO_STATE_FALLBACK = 2654435769;
const OUTER_MULTIPLIER = 1664525;
const OUTER_INCREMENT = 1013904223;
const INNER_MULTIPLIER = 22695477;
const INNER_INCREMENT = 1;

/** A tube, bottom first. Colours are 1 to 9. */
export type Tube = readonly number[];

export type DecantEnding = "time" | "stopped" | "bound";
export type DecantOutcome = "playing" | "over";

/** One run, as this module knows it. */
export type DecantRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /** Every action, in order. This *is* the submission. */
  readonly actions: readonly number[];
  /** The board being played, 1-based. */
  readonly level: number;
  readonly tubes: readonly Tube[];
  /** The current board's earlier states, for undo. Not part of the submission. */
  readonly history: readonly (readonly Tube[])[];
  /** Whether the extra tube was added on this board. */
  readonly extraTube: boolean;
  /** Extra tubes added over the whole run: each one cost clock. */
  readonly extraTubes: number;
  /** Pours made on the current board (undo takes one back). */
  readonly pours: number;
  readonly levelsCleared: number;
  readonly score: number;
  readonly outcome: DecantOutcome;
  readonly ending: DecantEnding | null;
};

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new TypeError("a Decant seed must be a whole number");
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Decant seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

function initialState(seed: string | number | bigint): number {
  const reduced = Number(((toBigInt(seed) % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS);
  return reduced === 0 ? ZERO_STATE_FALLBACK : reduced;
}

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError("a Decant level must be a whole number from 1");
  }
}

/** A level's colours: 3, one more every second board, up to 9. */
export function coloursFor(level: number): number {
  assertLevel(level);
  return Math.min(DECANT_MAX_COLOURS, 3 + Math.floor((level - 1) / 2));
}

/**
 * The clock a run has earned, in ms: seventy-five seconds, five more per colour of
 * every solved board as the taper shrinks it, less fifteen for every extra tube.
 */
export function budgetMs(levelsCleared: number, extraTubes = 0): number {
  let ms = DECANT_START_MS - DECANT_EXTRA_TUBE_MS * extraTubes;
  for (let level = 1; level <= levelsCleared; level += 1) {
    ms += taperedBonusMs(DECANT_BONUS_MS_PER_COLOUR * coloursFor(level), level);
  }
  return ms;
}

/** The colour on top of a tube, or 0 when it is empty. */
export function topColour(tube: Tube): number {
  return tube.length ? tube[tube.length - 1] : 0;
}

/** How many units of the top colour sit together at the top of a tube. */
export function topRun(tube: Tube): number {
  const colour = topColour(tube);
  let run = 0;
  for (let i = tube.length - 1; i >= 0 && tube[i] === colour; i -= 1) run += 1;
  return run;
}

/** Whether a tube is finished: full of one colour. */
export function isComplete(tube: Tube): boolean {
  return tube.length === DECANT_DEPTH && topRun(tube) === DECANT_DEPTH;
}

/** Whether every tube is empty or full of one colour. */
export function isSolved(tubes: readonly Tube[]): boolean {
  return tubes.every((tube) => tube.length === 0 || isComplete(tube));
}

/** How many units a pour from `from` to `to` moves; 0 when it is not allowed. */
export function pourAmount(tubes: readonly Tube[], from: number, to: number): number {
  if (from === to) return 0;
  const source = tubes[from];
  const target = tubes[to];
  if (!source || !target || source.length === 0 || target.length >= DECANT_DEPTH) return 0;
  if (target.length > 0 && topColour(target) !== topColour(source)) return 0;
  return Math.min(topRun(source), DECANT_DEPTH - target.length);
}

/** The tubes after a pour. Assumes the pour is allowed. */
export function poured(tubes: readonly Tube[], from: number, to: number): Tube[] {
  const amount = pourAmount(tubes, from, to);
  const colour = topColour(tubes[from]);
  return tubes.map((tube, index) =>
    index === from
      ? tube.slice(0, tube.length - amount)
      : index === to
        ? [...tube, ...Array.from({ length: amount }, () => colour)]
        : tube,
  );
}

/**
 * The board a level is dealt.
 *
 * Every unit, colour by colour — four 1s, four 2s, … — is shuffled with a
 * Fisher–Yates pass from the last unit down, each swap partner the next draw
 * modulo the units left; tube `t` then takes units `4t` to `4t + 3`, bottom
 * first, and two empty tubes follow.
 */
export function board(seed: string | number | bigint, level: number): Tube[] {
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
  const units: number[] = [];
  for (let colour = 1; colour <= colours; colour += 1) {
    for (let unit = 0; unit < DECANT_DEPTH; unit += 1) units.push(colour);
  }
  for (let i = units.length - 1; i > 0; i -= 1) {
    const j = next() % (i + 1);
    [units[i], units[j]] = [units[j], units[i]];
  }
  const tubes: Tube[] = [];
  for (let tube = 0; tube < colours; tube += 1) {
    tubes.push(units.slice(tube * DECANT_DEPTH, (tube + 1) * DECANT_DEPTH));
  }
  for (let spare = 0; spare < DECANT_SPARE_TUBES; spare += 1) tubes.push([]);
  return tubes;
}

/** A fresh run on board one. */
export function createRun(seed: string | number | bigint): DecantRun {
  const normalised = toBigInt(seed).toString();
  return {
    seed: normalised,
    rulesVersion: DECANT_RULES_VERSION,
    actions: [],
    level: 1,
    tubes: board(normalised, 1),
    history: [],
    extraTube: false,
    extraTubes: 0,
    pours: 0,
    levelsCleared: 0,
    score: 0,
    outcome: "playing",
    ending: null,
  };
}

/** A pour's action number. */
export function encodePour(from: number, to: number): number {
  return from * 16 + to;
}

function withAction(run: DecantRun, action: number, changes: Partial<DecantRun>): DecantRun {
  const actions = [...run.actions, action];
  const atBound = actions.length >= DECANT_MAX_ACTIONS;
  return {
    ...run,
    ...changes,
    actions,
    outcome: atBound ? "over" : "playing",
    ending: atBound ? "bound" : null,
  };
}

/** Whether a pour is allowed now. */
export function canPour(run: DecantRun, from: number, to: number): boolean {
  return run.outcome === "playing" && pourAmount(run.tubes, from, to) > 0;
}

/**
 * Pours the top of `from` onto `to`. A pour that solves the board scores ten
 * points per colour and deals the next board. A pour that is not allowed returns
 * the same run object.
 */
export function pour(run: DecantRun, from: number, to: number): DecantRun {
  if (!canPour(run, from, to)) return run;
  const tubes = poured(run.tubes, from, to);
  if (isSolved(tubes)) {
    const level = run.level + 1;
    return withAction(run, encodePour(from, to), {
      level,
      tubes: board(run.seed, level),
      history: [],
      extraTube: false,
      pours: 0,
      levelsCleared: run.levelsCleared + 1,
      score: run.score + coloursFor(run.level),
    });
  }
  return withAction(run, encodePour(from, to), {
    tubes,
    history: [...run.history, run.tubes],
    pours: run.pours + 1,
  });
}

/** Takes back the last pour on this board. Nothing to take back returns the same run. */
export function undo(run: DecantRun): DecantRun {
  if (run.outcome !== "playing" || run.history.length === 0) return run;
  return withAction(run, DECANT_UNDO, {
    tubes: run.history[run.history.length - 1],
    history: run.history.slice(0, -1),
    pours: run.pours - 1,
  });
}

/**
 * Puts this board back as it was dealt — with the extra tube, if it was bought.
 * On a board with nothing poured it does nothing.
 */
export function restart(run: DecantRun): DecantRun {
  if (run.outcome !== "playing" || run.pours === 0) return run;
  const dealt = board(run.seed, run.level);
  return withAction(run, DECANT_RESTART, {
    tubes: run.extraTube ? [...dealt, []] : dealt,
    history: [],
    pours: 0,
  });
}

/**
 * Adds an empty tube to this board, once, for fifteen seconds of clock. The
 * pours before it cannot be undone across it.
 */
export function addTube(run: DecantRun): DecantRun {
  if (run.outcome !== "playing" || run.extraTube) return run;
  return withAction(run, DECANT_EXTRA_TUBE, {
    tubes: [...run.tubes, []],
    history: [],
    pours: 0,
    extraTube: true,
    extraTubes: run.extraTubes + 1,
  });
}

/** Applies one submitted action: how a run is replayed. */
export function apply(run: DecantRun, action: number): DecantRun {
  if (action === DECANT_EXTRA_TUBE) return addTube(run);
  if (action === DECANT_UNDO) return undo(run);
  if (action === DECANT_RESTART) return restart(run);
  return pour(run, Math.floor(action / 16), action % 16);
}

/** Ends the run where it stands: the clock ran out, or the player stopped. */
export function finish(run: DecantRun, ending: "time" | "stopped"): DecantRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending };
}

export type DecantSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  /** The run's own summary, shown for an offline practice run the server never saw. */
  readonly tapsPlaced: number;
  readonly levelsCleared: number;
};

export function submission(run: DecantRun): DecantSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.actions,
    score: run.score,
    tapsPlaced: run.pours,
    levelsCleared: run.levelsCleared,
  };
}

/**
 * A solution for a board, as pours `[from, to]`, or null when there is none (or
 * the search gives up). A depth-first search that remembers every arrangement it
 * has seen — tube order does not matter — and never pours a one-colour tube into
 * an empty one, which can only go round in circles. The tests use it to prove
 * boards solvable; the screen uses it for a hint.
 */
export function solve(start: readonly Tube[], limit = 200_000): [number, number][] | null {
  const seen = new Set<string>();
  const key = (tubes: readonly Tube[]) =>
    tubes
      .map((tube) => tube.join(""))
      .sort()
      .join("|");
  const path: [number, number][] = [];
  const search = (tubes: readonly Tube[]): boolean | null => {
    if (isSolved(tubes)) return true;
    const here = key(tubes);
    if (seen.has(here)) return false;
    seen.add(here);
    if (seen.size > limit) return null;
    for (let from = 0; from < tubes.length; from += 1) {
      for (let to = 0; to < tubes.length; to += 1) {
        if (!pourAmount(tubes, from, to)) continue;
        if (tubes[to].length === 0 && topRun(tubes[from]) === tubes[from].length) continue;
        path.push([from, to]);
        const found = search(poured(tubes, from, to));
        if (found !== false) return found;
        path.pop();
      }
    }
    return false;
  };
  const result = search(start);
  return result ? [...path] : null;
}

/** The run these moves make, from the seed: how a saved run comes back. */
export function replay(seed: string | number | bigint, actions: readonly number[]): DecantRun {
  return actions.reduce((run: DecantRun, action) => apply(run, action), createRun(seed));
}
