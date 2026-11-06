/**
 * Fusebox — the game, as a pure deterministic state machine.
 *
 * A 6×6 grid of cells, each holding up to three charge. A tap spends a spark and
 * adds one charge. A cell that reaches four pops: it empties and fires a bolt each
 * way, and a bolt adds one charge to the first charged cell within three cells of
 * it. That can pop the next cell, and so on, in waves. Big chains pay sparks back,
 * clearing a board pays more, and the run ends when the sparks run out.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_fusebox_run` in
 * `supabase/migrations/20261216120000_fusebox_sessions.sql` replays the submitted
 * taps from the session's seed and derives the score itself. The copy is pinned
 * like every other game's: the rules version (`fusebox@1`) is data, the state
 * machine is total and pure, and tests/security/verifier_vectors.sql holds lines
 * both copies must reproduce. See `docs/games/README.md`.
 *
 * ## A chain always ends
 *
 * A popped cell is empty, and a bolt only ever lands on a charged cell, so a cell
 * can pop at most once in a tap. A tap therefore pops at most 36 cells.
 *
 * ## Two special cells
 *
 * - A **surge** cell (from board 3) fires its bolts diagonally as well.
 * - A **shielded** cell (from board 5) loses its shield to the first bolt or tap
 *   that reaches it, and gains no charge from that one.
 *
 * ## The endless game
 *
 * There is no last board and no clock. Every two boards the refunds ask for longer
 * chains, and fewer cells are dealt close to popping, so every run ends eventually.
 * The player may end a run at any time and keep its score.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const FUSEBOX_RUNTIME = "fusebox";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const FUSEBOX_RULES_VERSION = "fusebox@1";

/** The board's side, and its cells. */
export const FUSEBOX_SIDE = 6;
export const FUSEBOX_CELLS = FUSEBOX_SIDE * FUSEBOX_SIDE;

/** The charge at which a cell pops. */
export const FUSEBOX_POP_AT = 4;

/** How many cells a bolt reaches. */
export const FUSEBOX_BOLT_RANGE = 3;

/** The sparks a run starts with. */
export const FUSEBOX_START_SPARKS = 10;

/** The sparks a cleared board pays. */
export const FUSEBOX_CLEAR_SPARKS = 3;

/** A board is cleared when this many charged cells or fewer are left on it. */
export const FUSEBOX_CLEARED_AT = 4;

/** The most taps one submission may carry: a request ceiling, not a last board. */
export const FUSEBOX_MAX_ACTIONS = 4096;

const SEED_MODULUS = 4294967296n;
const ZERO_STATE_FALLBACK = 2654435769;
/** Mixed into the seed, so Fusebox's boards are its own for any seed. */
const SEED_MIX = 0xc2b2ae35;
const OUTER_MULTIPLIER = 1664525;
const OUTER_INCREMENT = 1013904223;
const INNER_MULTIPLIER = 22695477;
const INNER_INCREMENT = 1;

/** A cell's kind. */
export const PLAIN = 0;
export const SURGE = 1;
export const SHIELDED = 2;
export type FuseKind = typeof PLAIN | typeof SURGE | typeof SHIELDED;

/** One cell. Charge 0 is an empty cell, which is always plain. */
export type FuseCell = { readonly charge: number; readonly kind: FuseKind };

/** One bolt as it flew: where it stopped, and whether it landed on a charged cell. */
export type FuseBolt = { readonly from: number; readonly to: number; readonly hit: boolean };

/** One wave of a chain: the cells that popped together, and the board after it. */
export type FuseWave = {
  readonly fired: readonly number[];
  readonly bolts: readonly FuseBolt[];
  readonly cells: readonly FuseCell[];
  /** The score units this wave earned: its pops × its number. */
  readonly gain: number;
};

/** What a tap does to a board. */
export type FuseSettled = {
  /** The board after the tap and every wave. */
  readonly cells: readonly FuseCell[];
  readonly waves: readonly FuseWave[];
  readonly pops: number;
  readonly gain: number;
};

export type FuseboxEnding = "sparks" | "stopped" | "bound";
export type FuseboxOutcome = "playing" | "over";

/** What the last tap did, for the screen. */
export type FuseboxLast = {
  readonly cell: number;
  /** The board the tap was made on. */
  readonly level: number;
  readonly pops: number;
  readonly gain: number;
  /** The sparks its chain paid back, not counting a cleared board. */
  readonly refund: number;
  readonly cleared: boolean;
  readonly waves: readonly FuseWave[];
};

/** One run, as this module knows it. */
export type FuseboxRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /** Every tap, as a cell index. This *is* the submission. */
  readonly actions: readonly number[];
  /** The board being played, 1-based. */
  readonly level: number;
  readonly cells: readonly FuseCell[];
  readonly sparks: number;
  /** Cells popped, over the whole run. */
  readonly pops: number;
  /** The most cells one tap popped. */
  readonly bestChain: number;
  readonly levelsCleared: number;
  readonly score: number;
  readonly outcome: FuseboxOutcome;
  readonly ending: FuseboxEnding | null;
  readonly last: FuseboxLast | null;
};

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new TypeError("a Fusebox seed must be a whole number");
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Fusebox seed must be a decimal integer string");
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
    throw new RangeError("a Fusebox level is a whole number from 1");
  }
}

/** How many surge cells a board is dealt: one from board 3, one more every 4 boards, up to 3. */
export function surgesFor(level: number): number {
  assertLevel(level);
  return level < 3 ? 0 : Math.min(3, 1 + Math.floor((level - 3) / 4));
}

/** How many shielded cells a board is dealt: one from board 5, one more every 2 boards, up to 6. */
export function shieldsFor(level: number): number {
  assertLevel(level);
  return level < 5 ? 0 : Math.min(6, 1 + Math.floor((level - 5) / 2));
}

/** The pops one tap needs on a board for +1, +2 and +3 sparks. */
export function refundSteps(level: number): readonly [number, number, number] {
  assertLevel(level);
  const steps = Math.floor((level - 1) / 2);
  return [4 + steps, 7 + 2 * steps, 11 + 2 * steps];
}

/** The sparks a chain of `pops` pays back on a board. */
export function refundFor(pops: number, level: number): number {
  const [one, two, three] = refundSteps(level);
  return pops >= three ? 3 : pops >= two ? 2 : pops >= one ? 1 : 0;
}

/**
 * The board a level is dealt, row by row.
 *
 * Draws come from an outer LCG advanced once per level and a second LCG started at
 * that state; a draw is the state's top sixteen bits. Each cell in turn draws its
 * charge: weights 30, 30 and 35 for 0, 1 and 2, and 18 − level for 3, never under
 * 6. Then each surge cell and each shielded cell draws a start cell, and the first
 * charged plain cell from there (wrapping) takes that kind.
 */
export function board(seed: string | number | bigint, level: number): FuseCell[] {
  assertLevel(level);
  let state = initialState(seed);
  for (let current = 1; current <= level; current += 1) {
    state = (Math.imul(state, OUTER_MULTIPLIER) + OUTER_INCREMENT) >>> 0;
  }
  const next = () => {
    state = (Math.imul(state, INNER_MULTIPLIER) + INNER_INCREMENT) >>> 0;
    return state >>> 16;
  };

  const hot = Math.max(6, 18 - level);
  const total = 30 + 30 + 35 + hot;
  const charges: number[] = [];
  for (let cell = 0; cell < FUSEBOX_CELLS; cell += 1) {
    const draw = next() % total;
    charges.push(draw < 30 ? 0 : draw < 60 ? 1 : draw < 95 ? 2 : 3);
  }

  const kinds: FuseKind[] = charges.map(() => PLAIN);
  const place = (kind: FuseKind) => {
    const start = next() % FUSEBOX_CELLS;
    for (let probe = 0; probe < FUSEBOX_CELLS; probe += 1) {
      const cell = (start + probe) % FUSEBOX_CELLS;
      if (charges[cell]! > 0 && kinds[cell] === PLAIN) {
        kinds[cell] = kind;
        return;
      }
    }
  };
  for (let n = surgesFor(level); n > 0; n -= 1) place(SURGE);
  for (let n = shieldsFor(level); n > 0; n -= 1) place(SHIELDED);

  return charges.map((charge, cell) => ({ charge, kind: kinds[cell]! }));
}

/** The eight ways a bolt can fly, as [row, column], clockwise from up. */
const WAYS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
];

/** Whether `cell` can be tapped at all. */
function onBoard(cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < FUSEBOX_CELLS;
}

/**
 * A tap on `cell`, and everything it sets off.
 *
 * A wave is simultaneous: every cell at four or more pops and empties, *then* every
 * bolt flies, so no bolt lands on a cell popping in the same wave. A shield takes
 * one of the bolts that reach its cell, and the rest add charge.
 */
export function settle(start: readonly FuseCell[], cell: number): FuseSettled {
  const charge = start.map((c) => c.charge);
  const kind = start.map((c) => c.kind);
  if (kind[cell] === SHIELDED) kind[cell] = PLAIN;
  else charge[cell] = charge[cell]! + 1;

  const waves: FuseWave[] = [];
  let pops = 0;
  let gain = 0;
  for (;;) {
    const fired: number[] = [];
    charge.forEach((c, at) => {
      if (c >= FUSEBOX_POP_AT) fired.push(at);
    });
    if (fired.length === 0) break;

    const surged = fired.map((at) => kind[at] === SURGE);
    for (const at of fired) {
      charge[at] = 0;
      kind[at] = PLAIN;
    }

    const hits: number[] = charge.map(() => 0);
    const bolts: FuseBolt[] = [];
    fired.forEach((at, index) => {
      const row = Math.floor(at / FUSEBOX_SIDE);
      const col = at % FUSEBOX_SIDE;
      WAYS.forEach(([dr, dc], way) => {
        if (way % 2 === 1 && !surged[index]) return;
        let to = at;
        let hit = false;
        for (let step = 1; step <= FUSEBOX_BOLT_RANGE; step += 1) {
          const r = row + dr * step;
          const c = col + dc * step;
          if (r < 0 || r >= FUSEBOX_SIDE || c < 0 || c >= FUSEBOX_SIDE) break;
          to = r * FUSEBOX_SIDE + c;
          if (charge[to]! > 0) {
            hits[to] = hits[to]! + 1;
            hit = true;
            break;
          }
        }
        if (to !== at) bolts.push({ from: at, to, hit });
      });
    });

    hits.forEach((count, at) => {
      if (count === 0) return;
      if (kind[at] === SHIELDED) {
        kind[at] = PLAIN;
        charge[at] = charge[at]! + count - 1;
      } else {
        charge[at] = charge[at]! + count;
      }
    });

    const number = waves.length + 1;
    pops += fired.length;
    gain += fired.length * number;
    waves.push({
      fired,
      bolts,
      cells: charge.map((c, at) => ({ charge: c, kind: kind[at]! })),
      gain: fired.length * number,
    });
  }

  return { cells: charge.map((c, at) => ({ charge: c, kind: kind[at]! })), waves, pops, gain };
}

/** How many charged cells a board has. */
export function chargedCells(cells: readonly FuseCell[]): number {
  return cells.reduce((count, cell) => count + (cell.charge > 0 ? 1 : 0), 0);
}

/** A fresh run on board one. */
export function createRun(seed: string | number | bigint): FuseboxRun {
  const normalised = toBigInt(seed).toString();
  return {
    seed: normalised,
    rulesVersion: FUSEBOX_RULES_VERSION,
    actions: [],
    level: 1,
    cells: board(normalised, 1),
    sparks: FUSEBOX_START_SPARKS,
    pops: 0,
    bestChain: 0,
    levelsCleared: 0,
    score: 0,
    outcome: "playing",
    ending: null,
    last: null,
  };
}

/** Whether a tap on `cell` is a move now: a live run and a cell on the board. */
export function canTap(run: FuseboxRun, cell: number): boolean {
  return run.outcome === "playing" && onBoard(cell);
}

/**
 * Taps a cell: a spark spent, a chain set off and scored, sparks paid back. A board
 * cleared by it pays more and deals the next. No sparks left ends the run. A tap
 * that is not a move returns the same run object.
 */
export function tap(run: FuseboxRun, cell: number): FuseboxRun {
  if (!canTap(run, cell)) return run;
  const settled = settle(run.cells, cell);
  const refund = refundFor(settled.pops, run.level);
  const cleared = chargedCells(settled.cells) <= FUSEBOX_CLEARED_AT;
  const level = cleared ? run.level + 1 : run.level;
  const sparks = run.sparks - 1 + refund + (cleared ? FUSEBOX_CLEAR_SPARKS : 0);
  const actions = [...run.actions, cell];

  const next: FuseboxRun = {
    ...run,
    actions,
    level,
    cells: cleared ? board(run.seed, level) : settled.cells,
    sparks,
    pops: run.pops + settled.pops,
    bestChain: Math.max(run.bestChain, settled.pops),
    levelsCleared: run.levelsCleared + (cleared ? 1 : 0),
    score: run.score + settled.gain,
    last: {
      cell,
      level: run.level,
      pops: settled.pops,
      gain: settled.gain,
      refund,
      cleared,
      waves: settled.waves,
    },
  };

  if (sparks <= 0) return { ...next, outcome: "over", ending: "sparks" };
  if (actions.length >= FUSEBOX_MAX_ACTIONS) return { ...next, outcome: "over", ending: "bound" };
  return next;
}

/** Replays a list of taps from a seed: how a run is verified. */
export function replay(seed: string | number | bigint, actions: readonly number[]): FuseboxRun {
  return actions.reduce(tap, createRun(seed));
}

/** Ends the run where it stands: the player stopped. */
export function finish(run: FuseboxRun): FuseboxRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stopped" };
}

export type FuseboxSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  /** The run's own summary, shown for an offline practice run the server never saw. */
  readonly tapsPlaced: number;
  readonly levelsCleared: number;
};

export function submission(run: FuseboxRun): FuseboxSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.actions,
    score: run.score,
    tapsPlaced: run.pops,
    levelsCleared: run.levelsCleared,
  };
}

/** The tap that would have saved a lost run, shown on its end screen. */
export type FuseboxMissedTap = {
  /** The board the last tap was made on. */
  readonly cells: readonly FuseCell[];
  readonly cell: number;
  readonly pops: number;
  readonly gain: number;
  /** The sparks it would have paid, a cleared board included. */
  readonly sparks: number;
  readonly waves: readonly FuseWave[];
};

/**
 * The best tap on the board a run was lost on, or null when no tap could have saved
 * it (or the run ended some other way). Best is the most sparks, then the most pops,
 * then the most points, then the lowest cell.
 */
export function missedTap(run: FuseboxRun): FuseboxMissedTap | null {
  if (run.ending !== "sparks" || run.actions.length === 0) return null;
  const before = replay(run.seed, run.actions.slice(0, -1));
  let best: FuseboxMissedTap | null = null;
  for (let cell = 0; cell < FUSEBOX_CELLS; cell += 1) {
    const settled = settle(before.cells, cell);
    const sparks =
      refundFor(settled.pops, before.level) +
      (chargedCells(settled.cells) <= FUSEBOX_CLEARED_AT ? FUSEBOX_CLEAR_SPARKS : 0);
    if (sparks === 0) continue;
    if (
      !best ||
      sparks > best.sparks ||
      (sparks === best.sparks && settled.pops > best.pops) ||
      (sparks === best.sparks && settled.pops === best.pops && settled.gain > best.gain)
    ) {
      best = {
        cells: before.cells,
        cell,
        pops: settled.pops,
        gain: settled.gain,
        sparks,
        waves: settled.waves,
      };
    }
  }
  return best;
}

/** A board as the vectors write it: one hex digit a cell, charge + 4 × kind. */
export function boardCode(cells: readonly FuseCell[]): string {
  return cells.map((cell) => (cell.charge + 4 * cell.kind).toString(16)).join("");
}
