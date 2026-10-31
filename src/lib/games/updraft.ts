/**
 * Updraft — the game, as a pure deterministic state machine.
 *
 * A glider hangs in the air and falls. Tap and it lifts. Columns scroll in from
 * the right with a gap in each; thread the gap and score, touch a column or the
 * ground and the run is over. There is no last column: the field speeds up and
 * the gaps narrow until the player slips or chooses to stop.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_updraft_run` in
 * `supabase/migrations/20261120120000_updraft_sessions.sql` replays the
 * submitted flaps from the session's seed, tick by tick, and derives the score
 * itself. The two copies are pinned the way every other game's are: the rules
 * version is data (`updraft@1`), the physics is whole numbers only — no float can
 * round differently in the browser and in Postgres — and the vectors in
 * `updraft.test.ts` (seed 1's column tops, its 33-tick fall) are the ones the
 * verifier must reproduce. See `docs/games/README.md`.
 *
 * Time is part of these rules, unlike the other games': the world advances in
 * fixed ticks, sixty a second, and a flap is the tick it lands on. The screen's
 * clock decides only how many ticks have happened, never what one does.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const UPDRAFT_RUNTIME = "updraft";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const UPDRAFT_RULES_VERSION = "updraft@1";

/** Ticks per second. A tick is the world's only unit of time. */
export const UPDRAFT_TICK_RATE = 60;
export const UPDRAFT_TICK_MS = 1000 / UPDRAFT_TICK_RATE;

/**
 * The most ticks one run may last: thirty minutes. A submission bound, not a
 * level — a run that reaches it ends as if the player stopped.
 */
export const UPDRAFT_MAX_TICKS = 30 * 60 * UPDRAFT_TICK_RATE;

/** The most actions one submission may carry. */
export const UPDRAFT_MAX_ACTIONS = 8192;

// ── The field, in world units ────────────────────────────────────────────────
// Everything is a whole number. The field is 75 000 wide and 100 000 tall, with
// y growing downwards; the screen scales it to fit, so these are proportions,
// not pixels.

export const UPDRAFT_WIDTH = 75_000;
export const UPDRAFT_HEIGHT = 100_000;
/** The ground's top edge. Touching it ends the run. */
export const UPDRAFT_GROUND = 88_000;

/** The glider: a circle at a fixed x. */
export const UPDRAFT_GLIDER_X = 22_000;
export const UPDRAFT_GLIDER_RADIUS = 3_200;
export const UPDRAFT_START_Y = 44_000;

/** Velocities are world units per tick; gravity is units per tick per tick. */
export const UPDRAFT_GRAVITY = 75;
export const UPDRAFT_FLAP = -1_400;
export const UPDRAFT_MAX_FALL = 2_200;

/** Columns: their width, the spacing between them and where the first stands. */
export const UPDRAFT_COLUMN_WIDTH = 13_000;
export const UPDRAFT_SPACING = 42_000;
export const UPDRAFT_FIRST_COLUMN = 90_000;

/** The gap's top edge stays this far below the top of the field… */
export const UPDRAFT_MIN_TOP = 10_000;
/** …its bottom edge this far above the ground… */
export const UPDRAFT_BOTTOM_MARGIN = 10_000;
/** …and it moves at most this far from one column to the next. */
export const UPDRAFT_MAX_SHIFT = 24_000;

/**
 * The scroll speed, in units per tick: 400 to start, four more for every column
 * passed, capped at 560 from the fortieth on.
 */
export function speedFor(passed: number): number {
  return Math.min(560, 400 + 4 * passed);
}

/**
 * The height of column `k`'s gap: 30 000 for the first, 200 less for each column
 * after, never under 23 000 (from column 35 on) — still three and a half glider
 * heights, so the narrowest gap is tight rather than unfair.
 */
export function gapFor(k: number): number {
  return Math.max(23_000, 30_000 - 200 * k);
}

/** One column: the world x of its left edge, and its gap. */
export type UpdraftColumn = {
  readonly x: number;
  /** The gap's top edge. */
  readonly top: number;
  /** The gap's height: its bottom edge is `top + gap`. */
  readonly gap: number;
};

export type UpdraftEndReason = "crash" | "limit" | null;
export type UpdraftOutcome = "playing" | "over";

/** One run, as this module knows it. */
export type UpdraftRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /** Ticks simulated so far. The next tick to run is this one. */
  readonly tick: number;
  readonly y: number;
  readonly vy: number;
  /** How far the field has scrolled: a column's screen x is `x − distance`. */
  readonly distance: number;
  /** Columns cleared. This is the score. */
  readonly passed: number;
  /** Whether a flap is queued for the next tick. */
  readonly flapping: boolean;
  /**
   * Every action, in order: `2 × tick` for a flap on that tick, and
   * `2 × tick + 1` for a run the player stopped before that tick. This *is* the
   * submission.
   */
  readonly actions: readonly number[];
  readonly score: number;
  readonly outcome: UpdraftOutcome;
  /** True when the player ended the run, rather than the game ending it. */
  readonly stopped?: true;
  readonly endReason: UpdraftEndReason;
};

// The generator: the same 32-bit LCG and seed handling every other game uses
// (see `src/lib/games/stack10.ts`), because a seed that differs by one bit lays
// out different columns.
const SEED_MODULUS = 4294967296n;
const LCG_MULTIPLIER = 1664525n;
const LCG_INCREMENT = 1013904223n;
const ZERO_STATE_FALLBACK = 2654435769n;

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new TypeError("an Updraft seed must be a whole number");
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("an Updraft seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

function initialState(seed: string | number | bigint): bigint {
  const reduced = ((toBigInt(seed) % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS;
  return reduced === 0n ? ZERO_STATE_FALLBACK : reduced;
}

function advance(state: bigint): bigint {
  return (state * LCG_MULTIPLIER + LCG_INCREMENT) % SEED_MODULUS;
}

/**
 * The columns are laid out lazily and remembered per seed: each one's gap
 * depends on the one before, so column `k` needs every column under it. The
 * cache is a convenience; the layout is a pure function of the seed.
 */
const layouts = new Map<string, { state: bigint; columns: UpdraftColumn[] }>();

/**
 * Column `k` of the seed's field. One draw per column, read from bit 16 up as
 * the other games do: the first column's gap top falls anywhere it fits, and
 * every later one within `UPDRAFT_MAX_SHIFT` of the column before.
 */
export function columnAt(seed: string | number | bigint, k: number): UpdraftColumn {
  if (!Number.isInteger(k) || k < 0) throw new RangeError("an Updraft column index starts at zero");
  const key = toBigInt(seed).toString();
  let layout = layouts.get(key);
  if (!layout) {
    layout = { state: initialState(key), columns: [] };
    if (layouts.size > 16) layouts.clear();
    layouts.set(key, layout);
  }
  while (layout.columns.length <= k) {
    const index = layout.columns.length;
    layout.state = advance(layout.state);
    const draw = Number(layout.state >> 16n);
    const gap = gapFor(index);
    const highest = UPDRAFT_GROUND - UPDRAFT_BOTTOM_MARGIN - gap;
    const previous = layout.columns[index - 1];
    const lo = previous
      ? Math.max(UPDRAFT_MIN_TOP, previous.top - UPDRAFT_MAX_SHIFT)
      : UPDRAFT_MIN_TOP;
    const hi = previous ? Math.min(highest, previous.top + UPDRAFT_MAX_SHIFT) : highest;
    layout.columns.push({
      x: UPDRAFT_FIRST_COLUMN + index * UPDRAFT_SPACING,
      top: lo + (draw % (hi - lo + 1)),
      gap,
    });
  }
  return layout.columns[k];
}

/** Whether the glider at height `y` touches column `column` scrolled by `distance`. */
function hits(column: UpdraftColumn, y: number, distance: number): boolean {
  const left = column.x - distance;
  const right = left + UPDRAFT_COLUMN_WIDTH;
  const dx = Math.max(left - UPDRAFT_GLIDER_X, 0, UPDRAFT_GLIDER_X - right);
  if (dx >= UPDRAFT_GLIDER_RADIUS) return false;
  // The column is two blocks: above the gap, and below it down to the ground.
  // A centre above or below the gap is beside a block, so the gap is all that
  // decides it. Inside the gap's band, the nearest point is the gap's edge.
  const bottom = column.top + column.gap;
  if (y < column.top || y > bottom) return true;
  const dy = Math.min(y - column.top, bottom - y);
  return dx * dx + dy * dy < UPDRAFT_GLIDER_RADIUS * UPDRAFT_GLIDER_RADIUS;
}

/** A fresh run: the glider at rest, waiting for its first flap. */
export function createRun(seed: string | number | bigint): UpdraftRun {
  return {
    seed: toBigInt(seed).toString(),
    rulesVersion: UPDRAFT_RULES_VERSION,
    tick: 0,
    y: UPDRAFT_START_Y,
    vy: 0,
    distance: 0,
    passed: 0,
    flapping: false,
    actions: [],
    score: 0,
    outcome: "playing",
    endReason: null,
  };
}

/**
 * Queues a flap for the next tick. One flap a tick: a second tap before the
 * tick runs is the same flap. A flap after the run is over is not a move.
 */
export function flap(run: UpdraftRun): UpdraftRun {
  if (run.outcome !== "playing" || run.flapping) return run;
  if (run.actions.length >= UPDRAFT_MAX_ACTIONS - 1) return run;
  return { ...run, flapping: true, actions: [...run.actions, 2 * run.tick] };
}

/**
 * Runs one tick:
 *
 *   1. a queued flap sets the vertical speed to `UPDRAFT_FLAP`; otherwise
 *      gravity adds `UPDRAFT_GRAVITY`, up to `UPDRAFT_MAX_FALL`;
 *   2. the glider moves; the top of the field is a ceiling it rests against;
 *   3. the field scrolls by the current speed;
 *   4. touching the ground, or the column just passed, or the next one, ends
 *      the run — before any score for this tick;
 *   5. a column whose middle is now behind the glider is passed and scores.
 */
export function step(run: UpdraftRun): UpdraftRun {
  if (run.outcome !== "playing") return run;

  let vy = run.flapping ? UPDRAFT_FLAP : Math.min(run.vy + UPDRAFT_GRAVITY, UPDRAFT_MAX_FALL);
  let y = run.y + vy;
  if (y < UPDRAFT_GLIDER_RADIUS) {
    y = UPDRAFT_GLIDER_RADIUS;
    vy = 0;
  }
  const distance = run.distance + speedFor(run.passed);
  const tick = run.tick + 1;

  const crashed =
    y + UPDRAFT_GLIDER_RADIUS >= UPDRAFT_GROUND ||
    (run.passed > 0 && hits(columnAt(run.seed, run.passed - 1), y, distance)) ||
    hits(columnAt(run.seed, run.passed), y, distance);
  if (crashed) {
    return { ...run, tick, y, vy, distance, flapping: false, outcome: "over", endReason: "crash" };
  }

  const next = columnAt(run.seed, run.passed);
  const passed =
    next.x + UPDRAFT_COLUMN_WIDTH / 2 - distance <= UPDRAFT_GLIDER_X ? run.passed + 1 : run.passed;

  const limit = tick >= UPDRAFT_MAX_TICKS;
  return {
    ...run,
    tick,
    y,
    vy,
    distance,
    passed,
    score: passed,
    flapping: false,
    ...(limit ? { outcome: "over" as const, endReason: "limit" as const } : {}),
  };
}

/**
 * Ends the run where it stands: the player stopped. The stop is recorded as an
 * action so the verifier replays to exactly here — without it the server would
 * let the glider fall on and could count a column the player never saw. The
 * score only ever grows, so stopping early can never earn a point.
 */
export function finish(run: UpdraftRun): UpdraftRun {
  if (run.outcome !== "playing") return run;
  // A flap queued for a tick that will never run is not part of the run.
  const actions = run.flapping ? run.actions.slice(0, -1) : run.actions;
  return {
    ...run,
    flapping: false,
    actions: [...actions, 2 * run.tick + 1],
    outcome: "over",
    stopped: true,
  };
}

/** Replays a list of actions from the seed, the way the verifier does. */
export function replay(seed: string | number | bigint, actions: readonly number[]): UpdraftRun {
  let run = createRun(seed);
  let index = 0;
  while (run.outcome === "playing") {
    const action = actions[index];
    if (action !== undefined && action === 2 * run.tick + 1) return finish(run);
    if (action !== undefined && action === 2 * run.tick) {
      run = flap(run);
      index += 1;
    }
    run = step(run);
  }
  return run;
}

export type UpdraftSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: UpdraftRun): UpdraftSubmission {
  return { rulesVersion: run.rulesVersion, actions: run.actions, score: run.score };
}
