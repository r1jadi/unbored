/**
 * Cascade — the game, as a pure deterministic state machine.
 *
 * The swap-and-match puzzle: an 8×8 board of six kinds of tile. Swap two
 * neighbours to line up three or more of a kind in a row or a column; they clear,
 * the tiles above fall into the gaps, new tiles drop in from the top, and any new
 * lines clear in turn — a cascade, each wave worth more than the last. Four in a
 * line leave a line tile behind, five in a line or an L or T a burst tile, and a
 * cleared line or burst tile clears its row, column or 3×3 square with it.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_cascade_run` in
 * `supabase/migrations/20261202120000_cascade_sessions.sql` replays the submitted
 * swaps from the session's seed and derives the score itself. The copy is pinned
 * like every other game's: the rules version (`cascade@1`) is data, the state
 * machine is total and pure, and the boards in `cascade.test.ts` are the ones the
 * verifier must reproduce. See `docs/games/README.md`.
 *
 * ## One stream of tiles
 *
 * Every tile the run ever sees — the first board, each refill, each reshuffle —
 * is the next draw from one generator seeded by the session, so the server and
 * this module see the same tiles in the same order. A board is dealt cell by cell
 * with no line of three already on it and at least one swap to make, and when a
 * cascade settles on a board with no swap left, a fresh board is dealt.
 *
 * ## The endless game, against the clock
 *
 * Like Decant, a run is a series of levels against one clock the server times:
 * sixty seconds to start, and each level asks for more tiles cleared — 30, then
 * 40, 50, … — and adds twenty seconds as `clock.ts` tapers it. Every cleared tile
 * scores a point times its wave (ten on screen: `SCORE_SCALE`). Any prefix of a legal line is a valid
 * submission: the score never goes down.
 */

import { taperedBonusMs } from "@/lib/games/clock";

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const CASCADE_RUNTIME = "cascade";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const CASCADE_RULES_VERSION = "cascade@1";

/** The board is square: this many cells a side. */
export const CASCADE_SIZE = 8;
export const CASCADE_CELLS = CASCADE_SIZE * CASCADE_SIZE;

/** Kinds of tile, numbered 1 to 6. */
export const CASCADE_COLOURS = 6;

/** The most swaps one submission may carry: a request ceiling, not a last level. */
export const CASCADE_MAX_ACTIONS = 4096;

/** The clock a run starts with, and what every level adds before the taper. */
export const CASCADE_START_MS = 60_000;
export const CASCADE_BONUS_MS = 20_000;

/** How late after its clock ran out the server still accepts a run. */
export const CASCADE_SLACK_MS = 20_000;

/** Points a cleared tile scores, times the wave it cleared in (shown ×10: `SCORE_SCALE`). */
export const CASCADE_POINTS_PER_TILE = 1;

/** The most waves one swap resolves; past it the board is left as it stands. */
export const CASCADE_MAX_WAVES = 64;

/** The most boards one deal tries for one with a swap on it; the last one stands. */
export const CASCADE_MAX_DEALS = 1000;

/** What a tile is, beyond its kind: a plain tile, a line tile or a burst tile. */
export const PLAIN = 0;
export const ROW_LINE = 1;
export const COLUMN_LINE = 2;
export const BURST = 3;

/** A swap's direction: with the neighbour to the right, or the one below. */
export const RIGHT = 0;
export const DOWN = 1;

const SEED_MODULUS = 4294967296n;
const ZERO_STATE_FALLBACK = 2654435769;
const MULTIPLIER = 22695477;
const INCREMENT = 1;

/**
 * A cell's tile: `colour + 8 × special`, colour 1 to 6 and special one of
 * `PLAIN`, `ROW_LINE`, `COLUMN_LINE` and `BURST`. 0 is an empty cell, which only
 * exists inside a cascade.
 */
export type Tile = number;

/** The board, row by row from the top: cell `row × 8 + column`. */
export type CascadeBoard = readonly Tile[];

export const colourOf = (tile: Tile): number => tile % 8;
export const specialOf = (tile: Tile): number => Math.floor(tile / 8);
export const rowOf = (cell: number): number => Math.floor(cell / CASCADE_SIZE);
export const columnOf = (cell: number): number => cell % CASCADE_SIZE;

export type CascadeEnding = "time" | "stopped" | "bound";
export type CascadeOutcome = "playing" | "over";

/** One wave of a cascade: what cleared, what was left behind, and where it fell. */
export type CascadeWave = {
  /** Every cell that cleared, ascending, including the ones a special cleared. */
  readonly cleared: readonly number[];
  /** Special tiles this wave made, as `[cell, tile]`. They stay where they formed, then fall. */
  readonly created: readonly (readonly [number, Tile])[];
  /** The board once the wave has fallen and refilled. */
  readonly board: CascadeBoard;
  /** How many rows the tile now in each cell fell to get there. */
  readonly fall: readonly number[];
  readonly points: number;
};

/** What the last swap did, for the screen to animate. Not part of the submission. */
export type CascadeMove = {
  readonly from: number;
  readonly to: number;
  /** The board right after the swap, before anything cleared. */
  readonly swapped: CascadeBoard;
  readonly waves: readonly CascadeWave[];
  /** Whether the board was left without a swap, so a fresh one was dealt. */
  readonly reshuffled: boolean;
};

/** One run, as this module knows it. */
export type CascadeRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /** Every swap, as `cell × 2 + direction`, in order. This *is* the submission. */
  readonly actions: readonly number[];
  readonly board: CascadeBoard;
  /** The generator, after every tile drawn so far. */
  readonly rng: number;
  /** The level being played, 1-based. */
  readonly level: number;
  /** Tiles cleared towards this level's goal. */
  readonly progress: number;
  readonly levelsCleared: number;
  /** Every tile cleared over the run. */
  readonly cleared: number;
  readonly score: number;
  readonly lastMove: CascadeMove | null;
  readonly outcome: CascadeOutcome;
  readonly ending: CascadeEnding | null;
};

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new TypeError("a Cascade seed must be a whole number");
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Cascade seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

function initialState(seed: string | number | bigint): number {
  const reduced = Number(((toBigInt(seed) % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS);
  return reduced === 0 ? ZERO_STATE_FALLBACK : reduced;
}

/** The generator: a tile's kind is the next draw. Mutates `rng.state`. */
type Rng = { state: number };
function drawColour(rng: Rng): number {
  rng.state = (Math.imul(rng.state, MULTIPLIER) + INCREMENT) >>> 0;
  return 1 + ((rng.state >>> 16) % CASCADE_COLOURS);
}

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError("a Cascade level must be a whole number from 1");
  }
}

/** The tiles a level asks for: 30, then ten more every level. */
export function goalFor(level: number): number {
  assertLevel(level);
  return 20 + 10 * level;
}

/** The clock a run has earned, in ms: sixty seconds, plus every level's twenty, tapered. */
export function budgetMs(levelsCleared: number): number {
  let ms = CASCADE_START_MS;
  for (let level = 1; level <= levelsCleared; level += 1) {
    ms += taperedBonusMs(CASCADE_BONUS_MS, level);
  }
  return ms;
}

/** A swap's action number, and back. */
export function encodeSwap(cell: number, direction: number): number {
  return cell * 2 + direction;
}

/** The two cells a swap exchanges, or null when the neighbour is off the board. */
export function swapCells(action: number): [number, number] | null {
  if (!Number.isInteger(action) || action < 0 || action >= CASCADE_CELLS * 2) return null;
  const cell = Math.floor(action / 2);
  if (action % 2 === RIGHT) {
    return columnOf(cell) < CASCADE_SIZE - 1 ? [cell, cell + 1] : null;
  }
  return rowOf(cell) < CASCADE_SIZE - 1 ? [cell, cell + CASCADE_SIZE] : null;
}

/** The swap between two neighbouring cells, or null when they are not neighbours. */
export function swapBetween(a: number, b: number): number | null {
  const [low, high] = a < b ? [a, b] : [b, a];
  if (high - low === 1 && rowOf(low) === rowOf(high)) return encodeSwap(low, RIGHT);
  if (high - low === CASCADE_SIZE) return encodeSwap(low, DOWN);
  return null;
}

/** Whether the tile in `cell` sits in a line of three or more of its kind. */
function inLine(board: CascadeBoard, cell: number): boolean {
  const colour = colourOf(board[cell]);
  if (colour === 0) return false;
  const row = rowOf(cell);
  const column = columnOf(cell);
  let across = 1;
  for (let c = column - 1; c >= 0 && colourOf(board[row * 8 + c]) === colour; c -= 1) across += 1;
  for (let c = column + 1; c < 8 && colourOf(board[row * 8 + c]) === colour; c += 1) across += 1;
  if (across >= 3) return true;
  let down = 1;
  for (let r = row - 1; r >= 0 && colourOf(board[r * 8 + column]) === colour; r -= 1) down += 1;
  for (let r = row + 1; r < 8 && colourOf(board[r * 8 + column]) === colour; r += 1) down += 1;
  return down >= 3;
}

function swapped(board: CascadeBoard, a: number, b: number): Tile[] {
  const next = [...board];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/** Whether a swap is allowed on a board: it must line up three or more. */
export function isSwapLegal(board: CascadeBoard, action: number): boolean {
  const cells = swapCells(action);
  if (!cells) return false;
  const next = swapped(board, cells[0], cells[1]);
  return inLine(next, cells[0]) || inLine(next, cells[1]);
}

/** The first legal swap on a board, scanning cells in order, or null. The screen's hint. */
export function findSwap(board: CascadeBoard): number | null {
  for (let action = 0; action < CASCADE_CELLS * 2; action += 1) {
    if (isSwapLegal(board, action)) return action;
  }
  return null;
}

/**
 * Deals a board from the generator: cell by cell, row by row, each tile drawn
 * again until it does not complete a line of three with the two to its left or
 * the two above it. A board with no legal swap is dealt again, up to
 * `CASCADE_MAX_DEALS` times; the last one stands.
 */
function deal(rng: Rng): Tile[] {
  let board: Tile[] = [];
  for (let attempt = 0; attempt < CASCADE_MAX_DEALS; attempt += 1) {
    board = [];
    for (let cell = 0; cell < CASCADE_CELLS; cell += 1) {
      const row = rowOf(cell);
      const column = columnOf(cell);
      let colour: number;
      do {
        colour = drawColour(rng);
      } while (
        (column >= 2 && board[cell - 1] === colour && board[cell - 2] === colour) ||
        (row >= 2 && board[cell - 8] === colour && board[cell - 16] === colour)
      );
      board.push(colour);
    }
    if (findSwap(board) !== null) break;
  }
  return board;
}

/** The first board a seed deals, and the generator after it. */
export function firstBoard(seed: string | number | bigint): { board: Tile[]; rng: number } {
  const rng = { state: initialState(seed) };
  const board = deal(rng);
  return { board, rng: rng.state };
}

type Line = { cells: number[]; across: boolean };

/** Every line of three or more on a board: rows top to bottom, then columns left to right. */
function linesOn(board: CascadeBoard): Line[] {
  const lines: Line[] = [];
  for (let row = 0; row < 8; row += 1) {
    let start = 0;
    for (let column = 1; column <= 8; column += 1) {
      const here = column < 8 ? colourOf(board[row * 8 + column]) : -1;
      const first = colourOf(board[row * 8 + start]);
      if (here === first && first !== 0) continue;
      if (column - start >= 3 && first !== 0) {
        lines.push({
          cells: Array.from({ length: column - start }, (_, i) => row * 8 + start + i),
          across: true,
        });
      }
      start = column;
    }
  }
  for (let column = 0; column < 8; column += 1) {
    let start = 0;
    for (let row = 1; row <= 8; row += 1) {
      const here = row < 8 ? colourOf(board[row * 8 + column]) : -1;
      const first = colourOf(board[start * 8 + column]);
      if (here === first && first !== 0) continue;
      if (row - start >= 3 && first !== 0) {
        lines.push({
          cells: Array.from({ length: row - start }, (_, i) => (start + i) * 8 + column),
          across: false,
        });
      }
      start = row;
    }
  }
  return lines;
}

/** The cells a special tile clears when it clears: its row, its column, or the 3×3 around it. */
export function blastOf(cell: number, special: number): number[] {
  const row = rowOf(cell);
  const column = columnOf(cell);
  if (special === ROW_LINE) return Array.from({ length: 8 }, (_, c) => row * 8 + c);
  if (special === COLUMN_LINE) return Array.from({ length: 8 }, (_, r) => r * 8 + column);
  if (special === BURST) {
    const cells: number[] = [];
    for (let r = Math.max(0, row - 1); r <= Math.min(7, row + 1); r += 1) {
      for (let c = Math.max(0, column - 1); c <= Math.min(7, column + 1); c += 1) {
        cells.push(r * 8 + c);
      }
    }
    return cells;
  }
  return [];
}

/**
 * Resolves a board after a swap, wave by wave, drawing refills from `rng`.
 *
 * In each wave, every line of three or more clears. Some leave a special tile in
 * one of their cells — the swapped cell, if the line runs through it on the first
 * wave, or else the line's first cell:
 *
 * 1. A cell where a row line and a column line cross (an L, a T or a +) makes a
 *    burst there, unless one of the two lines has already made one; those two
 *    lines make nothing else. Crossings are taken in cell order.
 * 2. Every other line of five or more makes a burst, and of four a line tile
 *    along it: a row line from a line across, a column line from one down. Row
 *    lines first, then column lines, in the order `linesOn` finds them. A line
 *    whose cell already holds a new tile makes nothing.
 *
 * A special tile among the cleared cells clears its blast too, and any special
 * caught in a blast clears its own. Every cleared cell scores a point times the
 * wave; the new specials take their cells, the tiles above fall, and each column
 * is refilled from the bottom-most gap up, columns left to right.
 */
function resolve(
  start: CascadeBoard,
  swappedCells: readonly [number, number],
  rng: Rng,
): { board: Tile[]; waves: CascadeWave[] } {
  let board = [...start];
  const waves: CascadeWave[] = [];
  for (let wave = 1; wave <= CASCADE_MAX_WAVES; wave += 1) {
    const lines = linesOn(board);
    if (lines.length === 0) break;

    const matched = new Set<number>();
    for (const line of lines) for (const cell of line.cells) matched.add(cell);

    const anchor = (line: Line): number => {
      if (wave === 1) {
        for (const cell of swappedCells) if (line.cells.includes(cell)) return cell;
      }
      return line.cells[0];
    };
    const created = new Map<number, Tile>();
    const used = new Set<Line>();
    const across = lines.filter((line) => line.across);
    const down = lines.filter((line) => !line.across);
    for (const cell of [...matched].sort((a, b) => a - b)) {
      const row = across.find((line) => line.cells.includes(cell));
      const column = down.find((line) => line.cells.includes(cell));
      if (!row || !column || used.has(row) || used.has(column)) continue;
      used.add(row);
      used.add(column);
      created.set(cell, colourOf(board[cell]) + 8 * BURST);
    }
    for (const line of [...across, ...down]) {
      if (used.has(line) || line.cells.length < 4) continue;
      const cell = anchor(line);
      if (created.has(cell)) continue;
      const special = line.cells.length >= 5 ? BURST : line.across ? ROW_LINE : COLUMN_LINE;
      created.set(cell, colourOf(board[cell]) + 8 * special);
    }

    const clear = new Set(matched);
    const queue = [...matched].sort((a, b) => a - b).filter((cell) => specialOf(board[cell]) > 0);
    const fired = new Set<number>();
    while (queue.length > 0) {
      const cell = queue.shift()!;
      if (fired.has(cell)) continue;
      fired.add(cell);
      for (const hit of blastOf(cell, specialOf(board[cell]))) {
        if (clear.has(hit)) continue;
        clear.add(hit);
        if (specialOf(board[hit]) > 0) queue.push(hit);
      }
    }

    const next = [...board];
    for (const cell of clear) next[cell] = 0;
    for (const [cell, tile] of created) next[cell] = tile;

    // Gravity, then the refill: each column falls, then fills from its lowest gap up.
    const fall = Array.from({ length: CASCADE_CELLS }, () => 0);
    for (let column = 0; column < 8; column += 1) {
      let write = 7;
      for (let row = 7; row >= 0; row -= 1) {
        const tile = next[row * 8 + column];
        if (tile === 0) continue;
        next[row * 8 + column] = 0;
        next[write * 8 + column] = tile;
        fall[write * 8 + column] = write - row;
        write -= 1;
      }
      const gaps = write + 1;
      for (let row = write; row >= 0; row -= 1) {
        next[row * 8 + column] = drawColour(rng);
        fall[row * 8 + column] = gaps;
      }
    }

    waves.push({
      cleared: [...clear].sort((a, b) => a - b),
      created: [...created].sort((a, b) => a[0] - b[0]),
      board: next,
      fall,
      points: clear.size * CASCADE_POINTS_PER_TILE * wave,
    });
    board = next;
  }
  return { board, waves };
}

/** A fresh run on level one. */
export function createRun(seed: string | number | bigint): CascadeRun {
  const normalised = toBigInt(seed).toString();
  const { board, rng } = firstBoard(normalised);
  return {
    seed: normalised,
    rulesVersion: CASCADE_RULES_VERSION,
    actions: [],
    board,
    rng,
    level: 1,
    progress: 0,
    levelsCleared: 0,
    cleared: 0,
    score: 0,
    lastMove: null,
    outcome: "playing",
    ending: null,
  };
}

/** Whether a swap is allowed now. */
export function canSwap(run: CascadeRun, action: number): boolean {
  return run.outcome === "playing" && isSwapLegal(run.board, action);
}

/**
 * Makes a swap and resolves its cascade. Tiles cleared count towards the level's
 * goal, and a goal met moves on a level — more than one, if a cascade clears
 * enough — carrying the rest over. A board left with no swap is dealt afresh. A
 * swap that is not allowed returns the same run object.
 */
export function swap(run: CascadeRun, action: number): CascadeRun {
  if (!canSwap(run, action)) return run;
  const [from, to] = swapCells(action)!;
  const rng = { state: run.rng };
  const after = swapped(run.board, from, to);
  const { board: settled, waves } = resolve(after, [from, to], rng);
  let board = settled;
  let reshuffled = false;
  if (findSwap(board) === null) {
    board = deal(rng);
    reshuffled = true;
  }

  const tiles = waves.reduce((sum, wave) => sum + wave.cleared.length, 0);
  let level = run.level;
  let progress = run.progress + tiles;
  let levelsCleared = run.levelsCleared;
  while (progress >= goalFor(level)) {
    progress -= goalFor(level);
    level += 1;
    levelsCleared += 1;
  }

  const actions = [...run.actions, action];
  const atBound = actions.length >= CASCADE_MAX_ACTIONS;
  return {
    ...run,
    actions,
    board,
    rng: rng.state,
    level,
    progress,
    levelsCleared,
    cleared: run.cleared + tiles,
    score: run.score + waves.reduce((sum, wave) => sum + wave.points, 0),
    lastMove: { from, to, swapped: after, waves, reshuffled },
    outcome: atBound ? "over" : "playing",
    ending: atBound ? "bound" : null,
  };
}

/** Applies one submitted action: how a run is replayed. */
export function apply(run: CascadeRun, action: number): CascadeRun {
  return swap(run, action);
}

/** Ends the run where it stands: the clock ran out, or the player stopped. */
export function finish(run: CascadeRun, ending: "time" | "stopped"): CascadeRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending };
}

export type CascadeSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: CascadeRun): CascadeSubmission {
  return { rulesVersion: run.rulesVersion, actions: run.actions, score: run.score };
}
