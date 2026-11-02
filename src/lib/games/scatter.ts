/**
 * Scatter — the game, as a pure deterministic state machine.
 *
 * A grid of arrow tiles. Tap a tile and it flies off the board the way it
 * points, if its lane to the edge is clear; if another tile is in the way it
 * jams and stays where it is. Three jams end the run. Some tiles are
 * turnstiles: every tile that escapes turns each turnstile a quarter turn
 * clockwise, so the order the board is cleared in decides where they point.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_scatter_run` in
 * `supabase/migrations/20261128120000_scatter_sessions.sql` replays the submitted
 * taps from the session's seed and derives the score itself. The copy is pinned
 * like every other game's: the rules version (`scatter@1`) is data, the state
 * machine is total and pure, and the boards in `scatter.test.ts` are the ones the
 * verifier must reproduce. See `docs/games/README.md`.
 *
 * ## The boards
 *
 * A board is built backwards from a solution. Tiles are placed one at a time,
 * each on a free cell facing a direction whose lane is clear of the tiles placed
 * before it, so clearing them in the reverse of the order they were placed
 * always works. A turnstile is placed already turned back by the escapes that
 * come before it in that order, so it points the right way when its turn comes.
 * Boards grow from 4×4 to 7×7, fill from half to four fifths of their cells, and
 * gain a turnstile a board from board three.
 *
 * ## Stuck boards
 *
 * Cleared in another order, turnstiles can end up all facing blocked lanes.
 * When no tile on a board can leave, the board is lost: it costs a jam and the
 * next board is dealt, without the clearing bonus.
 *
 * ## The endless game
 *
 * There is no last board and no clock. Every escape scores one unit (ten points
 * on screen), every cleared board five more. The player may end a run at any
 * time and keep its score.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const SCATTER_RUNTIME = "scatter";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const SCATTER_RULES_VERSION = "scatter@1";

/** The largest board's side. */
export const SCATTER_MAX_SIDE = 7;

/** Jams that end a run. */
export const SCATTER_MAX_JAMS = 3;

/** The score units an escape earns, and a cleared board on top. */
export const SCATTER_EXIT_SCORE = 1;
export const SCATTER_CLEAR_BONUS = 5;

/** The most taps one submission may carry: a request ceiling, not a last board. */
export const SCATTER_MAX_ACTIONS = 4096;

const SEED_MODULUS = 4294967296n;
const ZERO_STATE_FALLBACK = 2654435769;
const OUTER_MULTIPLIER = 1664525;
const OUTER_INCREMENT = 1013904223;
const INNER_MULTIPLIER = 22695477;
const INNER_INCREMENT = 1;

/** A direction: 0 up, 1 right, 2 down, 3 left. */
export type Direction = 0 | 1 | 2 | 3;

/** One cell: empty, or a tile with the way it points now. */
export type ScatterCell = null | { readonly dir: Direction; readonly turnstile: boolean };

export type ScatterEnding = "jams" | "stopped" | "bound";
export type ScatterOutcome = "playing" | "over";

/** What the last tap did, for the screen. */
export type ScatterEvent = "exit" | "jam" | "clear" | "stuck";

/** One run, as this module knows it. */
export type ScatterRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /** Every tap, as the cell index on the board it was made on. This *is* the submission. */
  readonly actions: readonly number[];
  /** The board being played, 1-based. */
  readonly level: number;
  readonly side: number;
  /** The board, row by row. */
  readonly cells: readonly ScatterCell[];
  /** Tiles that escaped, over the whole run. */
  readonly exits: number;
  readonly levelsCleared: number;
  readonly jams: number;
  readonly score: number;
  readonly outcome: ScatterOutcome;
  readonly ending: ScatterEnding | null;
  /** What the last tap did, and to which cell. */
  readonly last: { readonly event: ScatterEvent; readonly cell: number } | null;
};

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new TypeError("a Scatter seed must be a whole number");
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Scatter seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

function initialState(seed: string | number | bigint): number {
  const reduced = Number(((toBigInt(seed) % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS);
  return reduced === 0 ? ZERO_STATE_FALLBACK : reduced;
}

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError("a Scatter level is a whole number from 1");
  }
}

/** A board's side: 4 for boards 1–2, 5 for 3–5, 6 for 6–9, then 7. */
export function sideFor(level: number): number {
  assertLevel(level);
  return level <= 2 ? 4 : level <= 5 ? 5 : level <= 9 ? 6 : SCATTER_MAX_SIDE;
}

/** How many tiles a board is dealt: half its cells on board one, five points more a board, up to 80%. */
export function tilesFor(level: number): number {
  const side = sideFor(level);
  const fill = Math.min(80, 50 + 5 * (level - 1));
  return Math.floor((side * side * fill) / 100);
}

/** How many of a board's tiles are turnstiles: none on boards 1–2, then one more a board, up to a quarter. */
export function turnstilesFor(level: number, tiles = tilesFor(level)): number {
  return Math.min(Math.floor(tiles / 4), Math.max(0, level - 2));
}

/** The step a direction takes, as [row, column]. */
const STEPS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
];

/** Whether the lane from `cell` to the edge, the way `dir` points, holds no tile. */
export function laneClear(
  occupied: (cell: number) => boolean,
  side: number,
  cell: number,
  dir: Direction,
): boolean {
  const [dr, dc] = STEPS[dir]!;
  let row = Math.floor(cell / side) + dr;
  let col = (cell % side) + dc;
  while (row >= 0 && row < side && col >= 0 && col < side) {
    if (occupied(row * side + col)) return false;
    row += dr;
    col += dc;
  }
  return true;
}

/**
 * The board a level is dealt, row by row.
 *
 * Draws come from One Move's outer LCG advanced once per level and a second LCG
 * started at that state, as Decant draws its boards; a draw is the state's top
 * sixteen bits. For each tile in turn: a start cell and a start direction are
 * drawn; from the start cell onwards (wrapping), the first free cell with a
 * clear lane in some direction — tried from the start direction, clockwise —
 * takes the tile facing it. A tile that fits nowhere ends the dealing. Then for
 * each turnstile a start index is drawn among the placed tiles, and the first
 * one from there (wrapping) that is not a turnstile yet becomes one, turned back
 * by one quarter for every tile that leaves before it in the solution.
 */
export function board(seed: string | number | bigint, level: number): ScatterCell[] {
  assertLevel(level);
  let state = initialState(seed);
  for (let current = 1; current <= level; current += 1) {
    state = (Math.imul(state, OUTER_MULTIPLIER) + OUTER_INCREMENT) >>> 0;
  }
  const next = () => {
    state = (Math.imul(state, INNER_MULTIPLIER) + INNER_INCREMENT) >>> 0;
    return state >>> 16;
  };

  const side = sideFor(level);
  const count = side * side;
  const target = tilesFor(level);
  const occupied: boolean[] = Array.from({ length: count }, () => false);
  const placed: { cell: number; dir: Direction }[] = [];
  const isOccupied = (cell: number) => occupied[cell]!;

  for (let k = 0; k < target; k += 1) {
    const startCell = next() % count;
    const startDir = next() % 4;
    let found = false;
    for (let probe = 0; probe < count && !found; probe += 1) {
      const cell = (startCell + probe) % count;
      if (occupied[cell]) continue;
      for (let turn = 0; turn < 4; turn += 1) {
        const dir = ((startDir + turn) % 4) as Direction;
        if (laneClear(isOccupied, side, cell, dir)) {
          occupied[cell] = true;
          placed.push({ cell, dir });
          found = true;
          break;
        }
      }
    }
    if (!found) break;
  }

  const n = placed.length;
  const turnstile: boolean[] = Array.from({ length: n }, () => false);
  const turns = turnstilesFor(level, n);
  for (let t = 0; t < turns; t += 1) {
    const start = next() % n;
    for (let probe = 0; probe < n; probe += 1) {
      const index = (start + probe) % n;
      if (!turnstile[index]) {
        turnstile[index] = true;
        break;
      }
    }
  }

  const cells: ScatterCell[] = Array.from({ length: count }, () => null);
  placed.forEach(({ cell, dir }, index) => {
    // The last placed leaves first: `before` tiles leave ahead of this one.
    const before = n - 1 - index;
    const facing = turnstile[index] ? (((((dir - before) % 4) + 4) % 4) as Direction) : dir;
    cells[cell] = { dir: facing, turnstile: turnstile[index]! };
  });
  return cells;
}

/** Whether the tile on `cell` can leave the board now. */
export function canExit(cells: readonly ScatterCell[], side: number, cell: number): boolean {
  const tile = cells[cell];
  if (!tile) return false;
  return laneClear((other) => cells[other] !== null, side, cell, tile.dir);
}

/** Whether some tile on the board can leave. */
function anyExit(cells: readonly ScatterCell[], side: number): boolean {
  return cells.some((_, cell) => canExit(cells, side, cell));
}

/** A fresh run on board one. */
export function createRun(seed: string | number | bigint): ScatterRun {
  const normalised = toBigInt(seed).toString();
  return {
    seed: normalised,
    rulesVersion: SCATTER_RULES_VERSION,
    actions: [],
    level: 1,
    side: sideFor(1),
    cells: board(normalised, 1),
    exits: 0,
    levelsCleared: 0,
    jams: 0,
    score: 0,
    outcome: "playing",
    ending: null,
    last: null,
  };
}

/** Whether a tap on `cell` is a move now: a live run and a tile on that cell. */
export function canTap(run: ScatterRun, cell: number): boolean {
  return run.outcome === "playing" && Number.isInteger(cell) && run.cells[cell] != null;
}

/** The run with the next board dealt. */
function dealNext(run: ScatterRun): Pick<ScatterRun, "level" | "side" | "cells"> {
  const level = run.level + 1;
  return { level, side: sideFor(level), cells: board(run.seed, level) };
}

/**
 * Taps the tile on `cell`. With its lane clear it escapes, scores, and turns
 * every turnstile; a cleared board scores its bonus and deals the next. With
 * its lane blocked it jams. A board left with no tile that can leave is lost
 * for a jam. A tap that is not a move returns the same run object.
 */
export function tap(run: ScatterRun, cell: number): ScatterRun {
  if (!canTap(run, cell)) return run;
  const actions = [...run.actions, cell];
  let next: ScatterRun;

  if (canExit(run.cells, run.side, cell)) {
    const cells = run.cells.map((tile, index): ScatterCell => {
      if (index === cell || !tile) return null;
      return tile.turnstile ? { dir: ((tile.dir + 1) % 4) as Direction, turnstile: true } : tile;
    });
    const score = run.score + SCATTER_EXIT_SCORE;
    if (cells.every((tile) => tile === null)) {
      next = {
        ...run,
        ...dealNext(run),
        actions,
        exits: run.exits + 1,
        levelsCleared: run.levelsCleared + 1,
        score: score + SCATTER_CLEAR_BONUS,
        last: { event: "clear", cell },
      };
    } else {
      next = { ...run, actions, cells, exits: run.exits + 1, score, last: { event: "exit", cell } };
    }
  } else {
    next = { ...run, actions, jams: run.jams + 1, last: { event: "jam", cell } };
  }

  if (next.jams < SCATTER_MAX_JAMS && !anyExit(next.cells, next.side)) {
    next = { ...next, ...dealNext(next), jams: next.jams + 1, last: { event: "stuck", cell } };
  }

  if (next.jams >= SCATTER_MAX_JAMS) return { ...next, outcome: "over", ending: "jams" };
  if (actions.length >= SCATTER_MAX_ACTIONS) return { ...next, outcome: "over", ending: "bound" };
  return next;
}

/** Replays a list of taps from a seed: how a run is verified. */
export function replay(seed: string | number | bigint, actions: readonly number[]): ScatterRun {
  return actions.reduce(tap, createRun(seed));
}

/** Ends the run where it stands: the player stopped. */
export function finish(run: ScatterRun): ScatterRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stopped" };
}

export type ScatterSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: ScatterRun): ScatterSubmission {
  return { rulesVersion: run.rulesVersion, actions: run.actions, score: run.score };
}

/**
 * The cells to tap, in order, to clear a fresh board, or null when the search
 * gives up. Tries the tiles that can leave, depth first; the tests use it to
 * prove boards clearable.
 */
export function solve(
  start: readonly ScatterCell[],
  side: number,
  limit = 50_000,
): number[] | null {
  let visited = 0;
  const path: number[] = [];
  const search = (cells: readonly ScatterCell[]): boolean | null => {
    if (cells.every((tile) => tile === null)) return true;
    if ((visited += 1) > limit) return null;
    for (let cell = 0; cell < cells.length; cell += 1) {
      if (!canExit(cells, side, cell)) continue;
      const after = cells.map((tile, index): ScatterCell => {
        if (index === cell || !tile) return null;
        return tile.turnstile ? { dir: ((tile.dir + 1) % 4) as Direction, turnstile: true } : tile;
      });
      path.push(cell);
      const found = search(after);
      if (found !== false) return found;
      path.pop();
    }
    return false;
  };
  return search(start) === true ? path : null;
}
