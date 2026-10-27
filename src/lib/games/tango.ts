/**
 * Sun & Moon (runtime `tango`) — the game, as a pure deterministic state machine.
 *
 * Sun & Moon, the classic binary puzzle: fill a 6×6 grid with suns and moons. Every row and every
 * column holds three of each, no three of the same sit next to each other across
 * or down, cells joined by `=` match, and cells joined by `×` differ. Some cells
 * start filled. Every board has exactly one solution.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_tango_run` in
 * `supabase/migrations/20261111120000_tango_sessions.sql` replays the submitted
 * taps from the session's seed and derives the score itself. The copy is pinned
 * like every other game's: the rules version (`tango@1`) is data, the state
 * machine is total and pure, and the boards and scored lines in `tango.test.ts`
 * are the ones `tests/security/rls_test.sql` asserts.
 *
 * ## What the server needs, and what only the board needs
 *
 * A board is drawn in three steps from one random stream: the **solution** (a
 * filled grid, row by row), the **givens** (the cells that start filled), and the
 * **signs** (`=` and `×` between neighbours) added until the solution is the only
 * one. The server needs the first two — the board starts with the givens filled,
 * and it is solved exactly when it matches the solution — so both are cheap draws
 * it mirrors. The signs only guide the player's deduction, so they are the
 * client's alone, as Zip's checkpoints are.
 *
 * ## The endless game, against the clock
 *
 * Like Zip and 8 Puzzle, a run is a race: one clock
 * that starts at two minutes and gains forty-five seconds with every solved board,
 * timed by the server from the session's start. A solved board scores ten points
 * a row. A tap cycles a cell — sun, moon, empty — so a run is never ended by a
 * wrong symbol: a player fixes it, and the clock is what is spent. The boards stay
 * 6×6, as the daily puzzles' do; each starts with fewer cells filled than the last, from
 * nine down to three, so the signs carry more of the deduction.
 *
 * Storage rule: nothing here is persisted. A score only exists once the server has
 * verified it.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const TANGO_RUNTIME = "tango";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const TANGO_RULES_VERSION = "tango@1";

/** The board is always 6×6. */
export const TANGO_SIDE = 6;

/** The most taps one submission may carry: a request ceiling, not a final board. */
export const TANGO_MAX_ACTIONS = 8192;

/** The clock a run starts with, and what every solved board adds. */
export const TANGO_START_MS = 120_000;
export const TANGO_BONUS_MS = 45_000;

/** How late after its clock ran out the server still accepts a run. */
export const TANGO_SLACK_MS = 20_000;

/** Ten points per row of a solved board. */
const POINTS_PER_BOARD = 10 * TANGO_SIDE;

const CELLS = TANGO_SIDE * TANGO_SIDE;

/** A cell: empty, a sun or a moon. */
export const EMPTY = 0;
export const SUN = 1;
export const MOON = 2;
export type TangoValue = typeof EMPTY | typeof SUN | typeof MOON;

// The same generators as Queens, Zip and 8 Puzzle: One Move's outer LCG advanced
// once per level, and a second LCG started at that state to draw the board.
const SEED_MODULUS = 4294967296n;
const ZERO_STATE_FALLBACK = 2654435769;
const OUTER_MULTIPLIER = 1664525;
const OUTER_INCREMENT = 1013904223;
const INNER_MULTIPLIER = 22695477;
const INNER_INCREMENT = 1;

/**
 * Every row a solution may use, in a fixed order: three suns and three moons,
 * never three alike in a row. Bit `5 - i` of the mask is cell `i`, a set bit a
 * sun; masks run from 0 to 63 and the fourteen that qualify are kept in order.
 * The verifier lists the same fourteen rows in the same order.
 */
export const TANGO_ROWS: readonly (readonly number[])[] = (() => {
  const rows: number[][] = [];
  for (let mask = 0; mask < 64; mask += 1) {
    const row = Array.from({ length: TANGO_SIDE }, (_, index) =>
      (mask >> (TANGO_SIDE - 1 - index)) & 1 ? SUN : MOON,
    );
    if (row.filter((value) => value === SUN).length !== TANGO_SIDE / 2) continue;
    let alternating = true;
    for (let index = 2; index < TANGO_SIDE; index += 1) {
      if (row[index] === row[index - 1] && row[index] === row[index - 2]) alternating = false;
    }
    if (alternating) rows.push(row);
  }
  return rows;
})();

export type TangoEnding = "time" | "stopped" | "bound";
export type TangoOutcome = "playing" | "over";

/** A sign between two neighbouring cells, smaller index first. */
export type TangoSign = {
  readonly a: number;
  readonly b: number;
  /** `=`: the two cells match. Otherwise `×`: they differ. */
  readonly same: boolean;
};

/** A board as it is drawn. */
export type TangoBoard = {
  /** The solution, in board order. */
  readonly solution: readonly TangoValue[];
  /** The cells that start filled, with their values; 0 elsewhere. */
  readonly start: readonly TangoValue[];
  readonly signs: readonly TangoSign[];
};

/** One run, as this module knows it. */
export type TangoRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /** Every cell tapped, in order. This *is* the submission. */
  readonly taps: readonly number[];
  /** The board being played, 1-based. */
  readonly level: number;
  /** The current board's cells, givens included. */
  readonly cells: readonly TangoValue[];
  readonly levelsCleared: number;
  readonly score: number;
  readonly outcome: TangoOutcome;
  readonly ending: TangoEnding | null;
};

// ── Seeds and generators ────────────────────────────────────────────────────

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new TypeError("a Tango seed must be a whole number");
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Tango seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

function initialState(seed: string | number | bigint): number {
  const value = toBigInt(seed);
  const reduced = Number(((value % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS);
  return reduced === 0 ? ZERO_STATE_FALLBACK : reduced;
}

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError("a Tango level must be a whole number from 1");
  }
}

function boardStream(seed: string | number | bigint, level: number): () => number {
  assertLevel(level);
  let state = initialState(seed);
  for (let current = 1; current <= level; current += 1) {
    state = (Math.imul(state, OUTER_MULTIPLIER) + OUTER_INCREMENT) >>> 0;
  }
  return () => {
    state = (Math.imul(state, INNER_MULTIPLIER) + INNER_INCREMENT) >>> 0;
    return state >>> 16;
  };
}

/** How many cells a level's board starts with: nine on board one, down to three. */
export function givenCount(level: number): number {
  assertLevel(level);
  return Math.max(3, 10 - level);
}

/** The clock a run has earned once `levelsCleared` boards are solved, in ms. */
export function budgetMs(levelsCleared: number): number {
  return TANGO_START_MS + TANGO_BONUS_MS * Math.max(0, levelsCleared);
}

/**
 * Draws the solution, row by row: each row is picked from the rows that keep
 * every column at three suns and three moons at most and never three alike down
 * it. A draw that runs out of rows starts again — about one in ten does.
 */
function drawSolution(next: () => number): TangoValue[] {
  for (;;) {
    const grid: number[][] = [];
    let stuck = false;
    for (let row = 0; row < TANGO_SIDE && !stuck; row += 1) {
      const options = TANGO_ROWS.filter((candidate) =>
        candidate.every((value, column) => {
          const above = grid.map((line) => line[column]);
          const suns = above.filter((cell) => cell === SUN).length + (value === SUN ? 1 : 0);
          const moons = above.length + 1 - suns;
          if (suns > TANGO_SIDE / 2 || moons > TANGO_SIDE / 2) return false;
          return !(row >= 2 && grid[row - 1][column] === value && grid[row - 2][column] === value);
        }),
      );
      if (options.length === 0) {
        stuck = true;
        break;
      }
      grid.push([...options[next() % options.length]]);
    }
    if (!stuck) return grid.flat() as TangoValue[];
  }
}

/** Draws which cells start filled: the first few of a shuffle of every cell. */
function drawStart(next: () => number, solution: readonly TangoValue[], level: number) {
  const order = Array.from({ length: CELLS }, (_, index) => index);
  for (let index = CELLS - 1; index > 0; index -= 1) {
    const swap = next() % (index + 1);
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  const start = new Array<TangoValue>(CELLS).fill(EMPTY);
  for (const cell of order.slice(0, givenCount(level))) start[cell] = solution[cell];
  return start;
}

/** A level's solution: everything the verifier needs to know a board is solved. */
export function solution(seed: string | number | bigint, level: number): TangoValue[] {
  return drawSolution(boardStream(seed, level));
}

/** The cells a level's board starts with filled; 0 elsewhere. */
export function startCells(seed: string | number | bigint, level: number): TangoValue[] {
  const next = boardStream(seed, level);
  return drawStart(next, drawSolution(next), level);
}

// ── Signs and uniqueness (the board only) ───────────────────────────────────

/**
 * Whether a cell breaks no rule given everything around it: its row and column
 * hold at most three of each symbol, no three alike sit in a row through it, and
 * its signs hold with every filled neighbour.
 */
function fits(cells: readonly TangoValue[], cell: number, signsAt: Map<number, TangoSign[]>) {
  const row = Math.floor(cell / TANGO_SIDE);
  const column = cell % TANGO_SIDE;
  let rowSuns = 0;
  let rowMoons = 0;
  let columnSuns = 0;
  let columnMoons = 0;
  for (let index = 0; index < TANGO_SIDE; index += 1) {
    const across = cells[row * TANGO_SIDE + index];
    const down = cells[index * TANGO_SIDE + column];
    if (across === SUN) rowSuns += 1;
    else if (across === MOON) rowMoons += 1;
    if (down === SUN) columnSuns += 1;
    else if (down === MOON) columnMoons += 1;
  }
  const half = TANGO_SIDE / 2;
  if (rowSuns > half || rowMoons > half || columnSuns > half || columnMoons > half) return false;
  for (let index = 0; index + 2 < TANGO_SIDE; index += 1) {
    const a = cells[row * TANGO_SIDE + index];
    if (a && a === cells[row * TANGO_SIDE + index + 1] && a === cells[row * TANGO_SIDE + index + 2])
      return false;
    const b = cells[index * TANGO_SIDE + column];
    if (
      b &&
      b === cells[(index + 1) * TANGO_SIDE + column] &&
      b === cells[(index + 2) * TANGO_SIDE + column]
    )
      return false;
  }
  for (const sign of signsAt.get(cell) ?? []) {
    const x = cells[sign.a];
    const y = cells[sign.b];
    if (x && y && (x === y) !== sign.same) return false;
  }
  return true;
}

function signsByCell(signs: readonly TangoSign[]): Map<number, TangoSign[]> {
  const byCell = new Map<number, TangoSign[]>();
  for (const sign of signs) {
    for (const cell of [sign.a, sign.b]) {
      const list = byCell.get(cell) ?? [];
      list.push(sign);
      byCell.set(cell, list);
    }
  }
  return byCell;
}

/** Up to `limit` complete grids that fill `start` within the rules and the signs. */
export function solutions(
  start: readonly TangoValue[],
  signs: readonly TangoSign[],
  limit = 2,
): TangoValue[][] {
  const cells = [...start];
  const signsAt = signsByCell(signs);
  const found: TangoValue[][] = [];
  const search = (cell: number) => {
    if (found.length >= limit) return;
    if (cell === CELLS) {
      found.push([...cells]);
      return;
    }
    if (cells[cell] !== EMPTY) {
      search(cell + 1);
      return;
    }
    for (const value of [SUN, MOON] as const) {
      cells[cell] = value;
      if (fits(cells, cell, signsAt)) search(cell + 1);
      cells[cell] = EMPTY;
    }
  };
  search(0);
  return found;
}

/** Every pair of neighbouring cells, across then down, smaller index first. */
function neighbourPairs(): [number, number][] {
  const pairs: [number, number][] = [];
  for (let cell = 0; cell < CELLS; cell += 1) {
    if (cell % TANGO_SIDE < TANGO_SIDE - 1) pairs.push([cell, cell + 1]);
    if (cell + TANGO_SIDE < CELLS) pairs.push([cell, cell + TANGO_SIDE]);
  }
  return pairs;
}

/**
 * Adds signs until the solution is the board's only one. While a second
 * solution exists, it adds a sign between two neighbours that the other solution
 * relates the wrong way (equal where the solution differs, or the reverse): the
 * other solution breaks it, the planted one keeps it. Such a pair always exists,
 * because the givens rule out the one grid that differs everywhere — the planted
 * one with every symbol swapped.
 */
function addSigns(
  next: () => number,
  solved: readonly TangoValue[],
  start: readonly TangoValue[],
): TangoSign[] {
  const signs: TangoSign[] = [];
  const pairs = neighbourPairs();
  for (;;) {
    const found = solutions(start, signs);
    const other = found.find((grid) => grid.some((value, index) => value !== solved[index]));
    if (!other) return signs;
    const candidates = pairs.filter(
      ([a, b]) =>
        !signs.some((sign) => sign.a === a && sign.b === b) &&
        (other[a] === other[b]) !== (solved[a] === solved[b]),
    );
    const [a, b] = candidates[next() % candidates.length];
    signs.push({ a, b, same: solved[a] === solved[b] });
  }
}

const boardCache = new Map<string, TangoBoard>();

/** The board a level shows: solution, starting cells and signs. Cached. */
export function board(seed: string | number | bigint, level: number): TangoBoard {
  const key = `${toBigInt(seed).toString()}:${level}`;
  const cached = boardCache.get(key);
  if (cached) return cached;
  const next = boardStream(seed, level);
  const solved = drawSolution(next);
  const start = drawStart(next, solved, level);
  const drawn: TangoBoard = { solution: solved, start, signs: addSigns(next, solved, start) };
  if (boardCache.size > 64) boardCache.clear();
  boardCache.set(key, drawn);
  return drawn;
}

/**
 * The cells that break a rule as the board stands: three alike in a row, a row
 * or column with more than three of a symbol, or a sign that does not hold. The
 * screen marks them; the run does not count them.
 */
export function conflicts(cells: readonly TangoValue[], signs: readonly TangoSign[]): Set<number> {
  const marked = new Set<number>();
  const half = TANGO_SIDE / 2;
  for (let line = 0; line < TANGO_SIDE; line += 1) {
    const across = Array.from({ length: TANGO_SIDE }, (_, index) => line * TANGO_SIDE + index);
    const down = Array.from({ length: TANGO_SIDE }, (_, index) => index * TANGO_SIDE + line);
    for (const group of [across, down]) {
      for (const value of [SUN, MOON]) {
        const holding = group.filter((cell) => cells[cell] === value);
        if (holding.length > half) holding.forEach((cell) => marked.add(cell));
      }
      for (let index = 0; index + 2 < TANGO_SIDE; index += 1) {
        const run = [group[index], group[index + 1], group[index + 2]];
        const value = cells[run[0]];
        if (value && run.every((cell) => cells[cell] === value)) {
          run.forEach((cell) => marked.add(cell));
        }
      }
    }
  }
  for (const sign of signs) {
    const x = cells[sign.a];
    const y = cells[sign.b];
    if (x && y && (x === y) !== sign.same) {
      marked.add(sign.a);
      marked.add(sign.b);
    }
  }
  return marked;
}

// ── A run ───────────────────────────────────────────────────────────────────

/** A fresh run on board one. */
export function createRun(seed: string | number | bigint): TangoRun {
  const normalised = toBigInt(seed).toString();
  return {
    seed: normalised,
    rulesVersion: TANGO_RULES_VERSION,
    taps: [],
    level: 1,
    cells: startCells(normalised, 1),
    levelsCleared: 0,
    score: 0,
    outcome: "playing",
    ending: null,
  };
}

/** Whether a cell can be tapped: the run is live, and the cell did not start filled. */
export function canTap(run: TangoRun, cell: number): boolean {
  if (run.outcome !== "playing") return false;
  if (run.taps.length >= TANGO_MAX_ACTIONS) return false;
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return false;
  return startCells(run.seed, run.level)[cell] === EMPTY;
}

/**
 * Taps a cell: empty becomes a sun, a sun a moon, a moon empty again. A tap that
 * leaves the board equal to its solution solves it: sixty points, and the next
 * board starts. An impossible tap returns the same run object.
 */
export function tap(run: TangoRun, cell: number): TangoRun {
  if (!canTap(run, cell)) return run;
  const taps = [...run.taps, cell];
  const atBound = taps.length >= TANGO_MAX_ACTIONS;
  const cells = [...run.cells];
  cells[cell] = ((cells[cell] + 1) % 3) as TangoValue;

  const answer = solution(run.seed, run.level);
  if (cells.every((value, index) => value === answer[index])) {
    const level = run.level + 1;
    return {
      ...run,
      taps,
      level,
      cells: startCells(run.seed, level),
      levelsCleared: run.levelsCleared + 1,
      score: run.score + POINTS_PER_BOARD,
      outcome: atBound ? "over" : "playing",
      ending: atBound ? "bound" : null,
    };
  }
  return {
    ...run,
    taps,
    cells,
    outcome: atBound ? "over" : "playing",
    ending: atBound ? "bound" : null,
  };
}

/** Ends the run where it stands: the clock ran out, or the player stopped. */
export function finish(run: TangoRun, ending: "time" | "stopped"): TangoRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending };
}

export type TangoSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  readonly tapsPlaced: number;
  readonly levelsCleared: number;
};

export function submission(run: TangoRun): TangoSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.taps,
    score: run.score,
    tapsPlaced: run.taps.length,
    levelsCleared: run.levelsCleared,
  };
}
