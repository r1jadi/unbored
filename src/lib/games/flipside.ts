/**
 * Flipside — the game, as a pure deterministic state machine.
 *
 * A runner speeds along a tunnel, standing on the floor. A tap flips gravity and
 * it falls up onto the ceiling; another tap brings it back down. The floor and
 * the ceiling have holes in them and spikes on them: fall into a hole or touch a
 * spike and the run is over. Skim a row of spikes without touching it and the
 * near miss scores extra, more for every one in a row. There is no last hole: the
 * tunnel speeds up and the holes widen until the player slips or chooses to stop.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_flipside_run` in
 * `supabase/migrations/20261230120000_flipside_sessions.sql` replays the
 * submitted taps from the session's seed, tick by tick, and derives the score
 * itself. Like Flutter's (`updraft.ts`), the physics is whole numbers only — no
 * float can round differently in the browser and in Postgres — and the vectors in
 * `flipside.test.ts` are the ones the verifier must reproduce. See
 * `docs/games/README.md`.
 *
 * The world advances in fixed ticks, sixty a second, and a tap is the tick it
 * lands on. The screen's clock decides only how many ticks have happened.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const FLIPSIDE_RUNTIME = "flipside";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const FLIPSIDE_RULES_VERSION = "flipside@1";

/** Ticks per second. A tick is the world's only unit of time. */
export const FLIPSIDE_TICK_RATE = 60;
export const FLIPSIDE_TICK_MS = 1000 / FLIPSIDE_TICK_RATE;

/** The most ticks one run may last: thirty minutes. */
export const FLIPSIDE_MAX_TICKS = 30 * 60 * FLIPSIDE_TICK_RATE;

/** The most actions one submission may carry. */
export const FLIPSIDE_MAX_ACTIONS = 8192;

// ── The tunnel, in world units ───────────────────────────────────────────────
// 75 000 wide and 100 000 tall, y growing downwards. The screen scales it.

export const FLIPSIDE_WIDTH = 75_000;
export const FLIPSIDE_HEIGHT = 100_000;
/** The ceiling's surface: rock above it. */
export const FLIPSIDE_CEILING = 12_000;
/** The floor's surface: rock below it. */
export const FLIPSIDE_FLOOR = 88_000;

/** The runner: a square, centred at a fixed x. */
export const FLIPSIDE_RUNNER_X = 22_000;
export const FLIPSIDE_HALF = 3_000;
const RUNNER_LEFT = FLIPSIDE_RUNNER_X - FLIPSIDE_HALF;
const RUNNER_RIGHT = FLIPSIDE_RUNNER_X + FLIPSIDE_HALF;

/** Where the runner's centre rests on the floor, and on the ceiling. */
export const FLIPSIDE_ON_FLOOR = FLIPSIDE_FLOOR - FLIPSIDE_HALF;
export const FLIPSIDE_ON_CEILING = FLIPSIDE_CEILING + FLIPSIDE_HALF;

/** Past these, the runner has fallen out of the tunnel through a hole. */
const FELL_BELOW = FLIPSIDE_FLOOR + FLIPSIDE_HALF;
const FELL_ABOVE = FLIPSIDE_CEILING - FLIPSIDE_HALF;

/** Gravity, units per tick per tick; the fastest fall; the push a flip starts with. */
export const FLIPSIDE_GRAVITY = 110;
export const FLIPSIDE_MAX_FALL = 2_600;
export const FLIPSIDE_KICK = 300;

/**
 * How many ticks a tap waits for the runner to land. A tap in mid-air is not
 * lost: it flips the moment the runner touches down, if that is soon enough.
 */
export const FLIPSIDE_BUFFER = 6;

/** How tall spikes stand off their surface. */
export const FLIPSIDE_SPIKE = 4_000;
/** Passing spikes this close or closer without touching them is a near miss. */
export const FLIPSIDE_GRAZE = 3_000;

/** Where the first hazard starts, and the least room from one hazard's start to the next. */
export const FLIPSIDE_FIRST = 90_000;
export const FLIPSIDE_SPACING = 38_000;

/** The scroll speed: 420 a tick, five more for every hazard passed, up to 620. */
export function speedFor(passed: number): number {
  return Math.min(620, 420 + 5 * passed);
}

export type FlipsideSurface = "floor" | "ceiling";
export type FlipsideKind = "hole" | "spikes";

/** One hazard: the world x of its left edge, how wide it is, where, and what. */
export type FlipsideHazard = {
  readonly x: number;
  readonly width: number;
  readonly surface: FlipsideSurface;
  readonly kind: FlipsideKind;
};

export type FlipsideEndReason = "crash" | "limit" | null;
export type FlipsideOutcome = "playing" | "over";

/** One run, as this module knows it. */
export type FlipsideRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /** Ticks simulated so far. The next tick to run is this one. */
  readonly tick: number;
  readonly y: number;
  readonly vy: number;
  /** 1 while gravity pulls down to the floor, −1 while it pulls up to the ceiling. */
  readonly gravity: 1 | -1;
  /** How far the tunnel has scrolled: a hazard's screen x is `x − distance`. */
  readonly distance: number;
  /** Hazards passed. */
  readonly passed: number;
  /** Ticks a waiting tap still has to land; 0 when no tap waits. */
  readonly buffer: number;
  /** Whether the spikes alongside have been skimmed. */
  readonly grazing: boolean;
  /** Near misses in a row. */
  readonly combo: number;
  /** The tick of the last near miss, for the screen's flash; −1 if none yet. */
  readonly lastGraze: number;
  /**
   * Every action, in order: `2 × tick` for a tap on that tick, and
   * `2 × tick + 1` for a run the player stopped before that tick.
   */
  readonly actions: readonly number[];
  readonly score: number;
  readonly outcome: FlipsideOutcome;
  readonly stopped?: true;
  readonly endReason: FlipsideEndReason;
};

// The generator every game uses (see `src/lib/games/stack10.ts`).
const SEED_MODULUS = 4294967296n;
const LCG_MULTIPLIER = 1664525n;
const LCG_INCREMENT = 1013904223n;
const ZERO_STATE_FALLBACK = 2654435769n;

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new TypeError("a Flipside seed must be a whole number");
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Flipside seed must be a decimal integer string");
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

const layouts = new Map<string, { state: bigint; hazards: FlipsideHazard[] }>();

/**
 * Hazard `k` of the seed's tunnel. One draw per hazard, read from bit 16 up, and
 * split into its parts:
 *
 *   bit 0        the surface: floor (0) or ceiling (1);
 *   bits 1–3     spikes when under 3 (of 8) and k ≥ 3, otherwise a hole;
 *   bits 4–7     extra width, (bits mod 9) × 500;
 *   bits 8–15    extra room before it, (bits mod 13) × 1000.
 *
 * The width starts at 12 000 and grows 200 a hazard to 20 000, so the widest is
 * 24 000 and the narrowest stretch of clear rock between two hazards 14 000 —
 * room to land and flip again at full speed.
 */
export function hazardAt(seed: string | number | bigint, k: number): FlipsideHazard {
  if (!Number.isInteger(k) || k < 0) throw new RangeError("a Flipside hazard index starts at zero");
  const key = toBigInt(seed).toString();
  let layout = layouts.get(key);
  if (!layout) {
    layout = { state: initialState(key), hazards: [] };
    if (layouts.size > 16) layouts.clear();
    layouts.set(key, layout);
  }
  while (layout.hazards.length <= k) {
    const index = layout.hazards.length;
    layout.state = advance(layout.state);
    const draw = Number(layout.state >> 16n);
    const previous = layout.hazards[index - 1];
    const room = ((draw >> 8) % 13) * 1000;
    layout.hazards.push({
      x: previous ? previous.x + FLIPSIDE_SPACING + room : FLIPSIDE_FIRST,
      width: Math.min(20_000, 12_000 + 200 * index) + (((draw >> 4) & 15) % 9) * 500,
      surface: (draw & 1) === 0 ? "floor" : "ceiling",
      kind: index >= 3 && ((draw >> 1) & 7) < 3 ? "spikes" : "hole",
    });
  }
  return layout.hazards[k];
}

/** A fresh run: the runner on the floor, waiting for the first tap. */
export function createRun(seed: string | number | bigint): FlipsideRun {
  return {
    seed: toBigInt(seed).toString(),
    rulesVersion: FLIPSIDE_RULES_VERSION,
    tick: 0,
    y: FLIPSIDE_ON_FLOOR,
    vy: 0,
    gravity: 1,
    distance: 0,
    passed: 0,
    buffer: 0,
    grazing: false,
    combo: 0,
    lastGraze: -1,
    actions: [],
    score: 0,
    outcome: "playing",
    endReason: null,
  };
}

/**
 * A tap: it waits up to `FLIPSIDE_BUFFER` ticks for the runner to stand on a
 * surface, then flips gravity. A tap while one is already waiting is the same
 * tap, and is not recorded.
 */
export function tap(run: FlipsideRun): FlipsideRun {
  if (run.outcome !== "playing" || run.buffer > 0) return run;
  if (run.actions.length >= FLIPSIDE_MAX_ACTIONS - 1) return run;
  return { ...run, buffer: FLIPSIDE_BUFFER, actions: [...run.actions, 2 * run.tick] };
}

/** Whether the runner stands on its surface, ready to flip. */
export function grounded(run: FlipsideRun): boolean {
  return run.y === (run.gravity === 1 ? FLIPSIDE_ON_FLOOR : FLIPSIDE_ON_CEILING);
}

/**
 * Runs one tick:
 *
 *   1. a waiting tap flips gravity if the runner stands on its surface, giving it
 *      a push of `FLIPSIDE_KICK` away; otherwise the tap waits one tick less;
 *   2. gravity pulls, up to `FLIPSIDE_MAX_FALL`, and the runner moves;
 *   3. the tunnel scrolls by the current speed;
 *   4. crossing a surface lands on it — unless a hole lies wholly under the
 *      runner, when it falls in. Fallen in, it crashes into the hole's far wall
 *      or drops out of the tunnel;
 *   5. touching spikes crashes; passing within `FLIPSIDE_GRAZE` of them grazes;
 *   6. a crash ends the run before any score this tick;
 *   7. a hazard wholly behind the runner is passed: one point, and spikes that
 *      were grazed add the combo — one more for each near miss in a row.
 */
export function step(run: FlipsideRun): FlipsideRun {
  if (run.outcome !== "playing") return run;

  let gravity = run.gravity;
  let vy = run.vy;
  let buffer = run.buffer;
  if (buffer > 0) {
    if (grounded(run)) {
      gravity = gravity === 1 ? -1 : 1;
      vy = gravity * FLIPSIDE_KICK;
      buffer = 0;
    } else {
      buffer -= 1;
    }
  }
  vy = Math.max(-FLIPSIDE_MAX_FALL, Math.min(FLIPSIDE_MAX_FALL, vy + gravity * FLIPSIDE_GRAVITY));
  let y = run.y + vy;
  const distance = run.distance + speedFor(run.passed);
  const tick = run.tick + 1;

  const hazard = hazardAt(run.seed, run.passed);
  const left = hazard.x - distance;
  const right = left + hazard.width;
  const alongside = left < RUNNER_RIGHT && right > RUNNER_LEFT;
  const overHole = hazard.kind === "hole" && left <= RUNNER_LEFT && right >= RUNNER_RIGHT;
  const floorSolid = !(overHole && hazard.surface === "floor");
  const ceilingSolid = !(overHole && hazard.surface === "ceiling");

  let crashed = false;
  if (y > FLIPSIDE_ON_FLOOR) {
    if (run.y <= FLIPSIDE_ON_FLOOR && floorSolid) {
      y = FLIPSIDE_ON_FLOOR;
      vy = 0;
    } else if (floorSolid || y >= FELL_BELOW) {
      crashed = true;
    }
  } else if (y < FLIPSIDE_ON_CEILING) {
    if (run.y >= FLIPSIDE_ON_CEILING && ceilingSolid) {
      y = FLIPSIDE_ON_CEILING;
      vy = 0;
    } else if (ceilingSolid || y <= FELL_ABOVE) {
      crashed = true;
    }
  }

  let grazing = run.grazing;
  let lastGraze = run.lastGraze;
  if (!crashed && hazard.kind === "spikes" && alongside) {
    const clear =
      hazard.surface === "floor"
        ? FLIPSIDE_FLOOR - FLIPSIDE_SPIKE - (y + FLIPSIDE_HALF)
        : y - FLIPSIDE_HALF - (FLIPSIDE_CEILING + FLIPSIDE_SPIKE);
    if (clear < 0) crashed = true;
    else if (clear <= FLIPSIDE_GRAZE && !grazing) {
      grazing = true;
      lastGraze = tick;
    }
  }

  if (crashed) {
    return {
      ...run,
      tick,
      y,
      vy,
      gravity,
      distance,
      buffer: 0,
      outcome: "over",
      endReason: "crash",
    };
  }

  let { passed, score, combo } = run;
  if (right < RUNNER_LEFT) {
    passed += 1;
    score += 1;
    if (hazard.kind === "spikes") {
      if (grazing) {
        combo += 1;
        score += combo;
      } else {
        combo = 0;
      }
    }
    grazing = false;
  }

  const limit = tick >= FLIPSIDE_MAX_TICKS;
  return {
    ...run,
    tick,
    y,
    vy,
    gravity,
    distance,
    passed,
    buffer,
    grazing,
    combo,
    lastGraze,
    score,
    ...(limit ? { outcome: "over" as const, endReason: "limit" as const } : {}),
  };
}

/**
 * Ends the run where it stands: the player stopped. The stop is an action so the
 * verifier replays to exactly here. A tap still waiting is kept: it was made.
 */
export function finish(run: FlipsideRun): FlipsideRun {
  if (run.outcome !== "playing") return run;
  return {
    ...run,
    buffer: 0,
    actions: [...run.actions, 2 * run.tick + 1],
    outcome: "over",
    stopped: true,
  };
}

/** Replays a list of actions from the seed, the way the verifier does. */
export function replay(seed: string | number | bigint, actions: readonly number[]): FlipsideRun {
  let run = createRun(seed);
  let index = 0;
  while (run.outcome === "playing") {
    const action = actions[index];
    if (action !== undefined && action === 2 * run.tick + 1) return finish(run);
    if (action !== undefined && action === 2 * run.tick) {
      run = tap(run);
      index += 1;
    }
    run = step(run);
  }
  return run;
}

export type FlipsideSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: FlipsideRun): FlipsideSubmission {
  return { rulesVersion: run.rulesVersion, actions: run.actions, score: run.score };
}
