/**
 * Queens — the game, as a pure deterministic state machine.
 *
 * Every board is an N×N grid split into N coloured regions. The goal is one Queen
 * in each row, each column and each region, and no two Queens may touch — not even
 * diagonally. Each board has exactly one solution.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_queens_speed_run` in
 * `supabase/migrations/20261217120000_speed_runs.sql` replays the submitted
 * tap list from the session's seed and derives the score itself. The copy is
 * pinned the same three ways as the other games:
 *
 *   - **The rules version is data.** A session carries `queens@2`, the server
 *     refuses to verify a version it does not implement, and this module declares
 *     the same string.
 *   - **The state machine is total and pure.** `tap` takes a run and a cell and
 *     returns a run — no clock, no randomness, no I/O.
 *   - **It is tested against the database's own numbers.** The solution vectors
 *     and the scored line in `queens.test.ts` are the ones
 *     `tests/security/rls_test.sql` asserts. See `docs/games/README.md`.
 *
 * ## What the server needs, and what only the board needs
 *
 * A board is built in two steps from one random stream: first the **solution** (a
 * placement of N non-touching Queens, one per row and column), then the
 * **regions**, grown outwards from those Queens and repaired until the planted
 * placement is the board's only solution. The server only ever needs the first
 * step: a Queen is right exactly when it sits on the solution, so the verifier
 * replays taps against the solution and never grows a region. That keeps the
 * database's copy small — a shuffle — while the region generator, a search with a
 * uniqueness solver inside it, lives only here, where it draws the board.
 *
 * The regions still cannot be chosen by a client: they are a function of the same
 * seed, and a board only counts as solved when its crowns are the solution's.
 *
 * ## The endless game
 *
 * A run is a series of boards that keeps going until the player fails or stops:
 *
 *   - **A tap cycles a cell**: empty → X (a note) → Queen → empty. Any cell can
 *     hold a Queen, right or wrong: nothing is locked and nothing is counted
 *     against the player. Queens that break the rules are shown as clashing.
 *   - **Everything can be taken back, for free.** `undo` steps back one tap, as far
 *     as the start of the board, and `clearBoard` empties it. Neither costs points.
 *   - **A board is solved when its Queens are the solution's**, and the next board
 *     is dealt. A solved board cannot be undone. Boards grow from 5×5 to 9×9 and then stay 9×9: a unique-solution
 *     board past 9×9 takes too long to generate on a phone, and the daily puzzles'
 *     boards sit in the same range.
 *   - **A solved board scores ten points per row**, so a 5×5 board is worth 50 and
 *     a 9×9 board 90: larger boards take much longer, and the score should say so.
 *   - **Nothing ends a run but the player.** There is no clock to lose to and no
 *     mistake to run out of; being quick earns a bonus instead (`speed.ts`), so
 *     every board has a par time (`parMs`).
 *   - **The player may end a run at any time** and keep its score. A run never
 *     loses points, so stopping early can only cost a player the boards they did
 *     not solve, and the verifier accepts any prefix of a legal line.
 *
 * Storage rule: nothing here is persisted. A run lives in React state for as long
 * as the screen is open; a score only exists once the server has verified it.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const QUEENS_RUNTIME = "queens";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const QUEENS_RULES_VERSION = "queens@2";

/** The smallest and largest boards. Boards grow from the first to the second. */
export const QUEENS_MIN_SIDE = 5;
export const QUEENS_MAX_SIDE = 9;

/** The two actions that are not a cell: step back one tap, and empty the board. */
export const QUEENS_UNDO = 81;
export const QUEENS_CLEAR = 82;

/** A board's par time in ms, by its side: 5×5 to 9×9. */
const PAR_MS_BY_SIDE: Readonly<Record<number, number>> = {
  5: 60_000,
  6: 90_000,
  7: 150_000,
  8: 240_000,
  9: 360_000,
};

/**
 * The most taps one submission may carry. A request ceiling, not a final board:
 * notes are taps too, so the bound is generous, and a run that reaches it ends.
 */
export const QUEENS_MAX_ACTIONS = 8192;

/** Ten points per row of a solved board. */
const POINTS_PER_ROW = 10;

// The outer generator, state for state as the verifier advances it: the same
// 32-bit LCG One Move and Stack 10 use, with the same zero-state fallback and
// decimal-string seed handling. It advances once per board, so board two is drawn
// from the second state.
const SEED_MODULUS = 4294967296n;
const ZERO_STATE_FALLBACK = 2654435769;
const OUTER_MULTIPLIER = 1664525;
const OUTER_INCREMENT = 1013904223;
// The inner generator draws one board from the outer state. It is a different
// full-period LCG on purpose: drawing a board from the outer sequence itself would
// walk into the next board's starting state, and two neighbouring boards would
// share their draws shifted by one.
const INNER_MULTIPLIER = 22695477;
const INNER_INCREMENT = 1;

/**
 * What a cell holds. */
export type QueensCell = "empty" | "mark" | "queen";

/**
 * How a run ended.
 *
 * `over` — the player ending the run, or the submission bound.
 */
export type QueensOutcome = "playing" | "over";

/** One run, as this module knows it. */
export type QueensRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /** Every tap, undo and clear, in order. This *is* the submission. */
  readonly taps: readonly number[];
  /** The board being played, 1-based. It has no upper bound. */
  readonly level: number;
  /** The current board's cells, in board order. Reset when a board is solved. */
  readonly cells: readonly QueensCell[];
  /** Boards solved so far. */
  readonly levelsCleared: number;
  /** The cells tapped on this board since it was dealt or cleared: what Undo steps back through. */
  readonly history: readonly number[];
  readonly score: number;
  readonly outcome: QueensOutcome;
  /** True when the player ended the run themself, rather than the bound. */
  readonly stopped: boolean;
};

/** A board as it is drawn: the solution and the regions grown around it. */
export type QueensBoard = {
  readonly size: number;
  /** The solution's column in each row. */
  readonly solution: readonly number[];
  /** The region of each cell, in board order: 0 to size − 1, region r holding row r's Queen. */
  readonly regions: readonly number[];
};

// ── Seeds and generators ────────────────────────────────────────────────────

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) {
      throw new TypeError("a Queens seed must be a whole number");
    }
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Queens seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

/** The seed reduced to the 32-bit state the outer generator starts from. */
function initialState(seed: string | number | bigint): number {
  const value = toBigInt(seed);
  const reduced = Number(((value % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS);
  return reduced === 0 ? ZERO_STATE_FALLBACK : reduced;
}

// `Math.imul` multiplies modulo 2³², which is exactly the LCG's arithmetic; the
// verifier computes the same products in `bigint`.
function advanceOuter(state: number): number {
  return (Math.imul(state, OUTER_MULTIPLIER) + OUTER_INCREMENT) >>> 0;
}

/**
 * The inner stream a board is drawn from. Each draw is bits 16 and above of the
 * next state: this LCG's low bits cycle with a short period, the high bits do not.
 */
function innerStream(state: number): () => number {
  let current = state >>> 0;
  return () => {
    current = (Math.imul(current, INNER_MULTIPLIER) + INNER_INCREMENT) >>> 0;
    return current >>> 16;
  };
}

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError("a Queens level must be a whole number from 1");
  }
}

/**
 * The side of the board a level is played on.
 *
 * 5 for level 1, 6 for 2–3, 7 for 4–6, 8 for 7–10, and 9 from level 11 on. The
 * first boards are quick, so a new player meets the larger ones within a few
 * minutes, and every board after the eleventh is a full 9×9.
 */
export function boardSize(level: number): number {
  assertLevel(level);
  if (level <= 1) return 5;
  if (level <= 3) return 6;
  if (level <= 6) return 7;
  if (level <= 10) return 8;
  return QUEENS_MAX_SIDE;
}

/** The inner stream for a level's board, positioned before its first draw. */
function boardStream(seed: string | number | bigint, level: number): () => number {
  assertLevel(level);
  let state = initialState(seed);
  for (let current = 1; current <= level; current += 1) {
    state = advanceOuter(state);
  }
  return innerStream(state);
}

/**
 * Draws the solution: a shuffle of the columns, redrawn until no two Queens in
 * neighbouring rows touch. About one shuffle in eight passes at every size, so the
 * loop is short; the verifier runs the same loop.
 */
function drawSolution(next: () => number, size: number): number[] {
  for (;;) {
    const columns = Array.from({ length: size }, (_, index) => index);
    for (let index = size - 1; index > 0; index -= 1) {
      const swap = next() % (index + 1);
      [columns[index], columns[swap]] = [columns[swap], columns[index]];
    }
    let apart = true;
    for (let row = 0; row + 1 < size; row += 1) {
      if (Math.abs(columns[row] - columns[row + 1]) < 2) apart = false;
    }
    if (apart) return columns;
  }
}

/**
 * The solution of a level's board: the column of the Queen in each row.
 *
 * This is everything the verifier needs, and it is drawn first, so no part of the
 * region search can change it.
 */
export function solution(seed: string | number | bigint, level: number): number[] {
  return drawSolution(boardStream(seed, level), boardSize(level));
}

// ── Regions ─────────────────────────────────────────────────────────────────

/** The cells above, below, left and right of a cell that are on the board. */
function neighbours(cell: number, size: number): number[] {
  const row = Math.floor(cell / size);
  const column = cell % size;
  const cells: number[] = [];
  if (row > 0) cells.push(cell - size);
  if (row < size - 1) cells.push(cell + size);
  if (column > 0) cells.push(cell - 1);
  if (column < size - 1) cells.push(cell + 1);
  return cells;
}

/**
 * Grows one region per Queen until every cell belongs to one.
 *
 * Each step picks a random unassigned cell that touches a region and joins it to
 * one of the regions it touches. Large regions touch more cells and grow faster,
 * so the board ends up with a mix of large and small regions, the way a
 * hand-made board does.
 */
function growRegions(next: () => number, size: number, queens: readonly number[]): number[] {
  const regions = new Array<number>(size * size).fill(-1);
  queens.forEach((column, row) => {
    regions[row * size + column] = row;
  });
  for (let left = size * size - size; left > 0; left -= 1) {
    const frontier: number[] = [];
    for (let cell = 0; cell < size * size; cell += 1) {
      if (regions[cell] < 0 && neighbours(cell, size).some((other) => regions[other] >= 0)) {
        frontier.push(cell);
      }
    }
    const cell = frontier[next() % frontier.length];
    const touching = neighbours(cell, size)
      .filter((other) => regions[other] >= 0)
      .map((other) => regions[other]);
    regions[cell] = touching[next() % touching.length];
  }
  return regions;
}

/**
 * Up to `limit` solutions of a board, each as the column of the Queen in each row.
 *
 * A row-by-row search: a Queen may not share a column or a region with an earlier
 * one, nor touch the Queen in the row above (the only earlier Queen it could
 * touch). Two solutions are enough to know a board is not unique.
 */
export function solutions(size: number, regions: readonly number[], limit = 2): number[][] {
  const found: number[][] = [];
  const placed: number[] = [];
  const columnUsed = new Array<boolean>(size).fill(false);
  const regionUsed = new Array<boolean>(size).fill(false);

  const search = (row: number) => {
    if (row === size) {
      found.push([...placed]);
      return;
    }
    for (let column = 0; column < size && found.length < limit; column += 1) {
      if (columnUsed[column]) continue;
      if (row > 0 && Math.abs(placed[row - 1] - column) < 2) continue;
      const region = regions[row * size + column];
      if (regionUsed[region]) continue;
      columnUsed[column] = true;
      regionUsed[region] = true;
      placed[row] = column;
      search(row + 1);
      columnUsed[column] = false;
      regionUsed[region] = false;
    }
  };

  search(0);
  return found;
}

/** Whether a region stays connected once one of its cells is taken away. */
function connectedWithout(size: number, regions: readonly number[], removed: number): boolean {
  const region = regions[removed];
  const cells: number[] = [];
  for (let cell = 0; cell < size * size; cell += 1) {
    if (cell !== removed && regions[cell] === region) cells.push(cell);
  }
  if (cells.length === 0) return false;
  const seen = new Set([cells[0]]);
  const stack = [cells[0]];
  while (stack.length > 0) {
    const cell = stack.pop() as number;
    for (const other of neighbours(cell, size)) {
      if (other !== removed && regions[other] === region && !seen.has(other)) {
        seen.add(other);
        stack.push(other);
      }
    }
  }
  return seen.size === cells.length;
}

/** How many fresh layouts to grow before falling back. Never reached in testing. */
const MAX_GROWTHS = 200;

/**
 * A layout that always has exactly one solution: every Queen but the last is alone
 * in its region, and the last region is the rest of the board.
 *
 * The singletons force N − 1 Queens and leave one row and one column for the
 * last. The rest of the board stays connected because no two Queens touch, so
 * they can never wall a cell off. It exists so the generator is total; the search
 * below has never needed it.
 */
export function fallbackRegions(size: number, queens: readonly number[]): number[] {
  const regions = new Array<number>(size * size).fill(size - 1);
  queens.forEach((column, row) => {
    if (row < size - 1) regions[row * size + column] = row;
  });
  return regions;
}

/**
 * Grows regions around the solution until the solution is the board's only one.
 *
 * A fresh layout usually has several solutions. Rather than throwing it away, the
 * search repairs it: it finds another solution, takes a cell where that solution
 * puts a Queen the planted one does not, and hands the cell to a neighbouring
 * region. The other solution then has two Queens in that region, so it is gone;
 * the planted solution is untouched, because none of its Queens moved. A layout
 * that runs out of repairs is regrown.
 */
function uniqueRegions(next: () => number, size: number, queens: readonly number[]): number[] {
  for (let growth = 0; growth < MAX_GROWTHS; growth += 1) {
    const regions = growRegions(next, size, queens);
    for (let repair = 0; repair < 4 * size * size; repair += 1) {
      const found = solutions(size, regions);
      if (found.length === 1) return regions;
      const other = found.find((placement) =>
        placement.some((column, row) => column !== queens[row]),
      );
      if (!other) return regions;

      const moves: [number, number][] = [];
      other.forEach((column, row) => {
        if (column === queens[row]) return;
        const cell = row * size + column;
        if (!connectedWithout(size, regions, cell)) return;
        for (const neighbour of neighbours(cell, size)) {
          if (regions[neighbour] !== regions[cell]) moves.push([cell, regions[neighbour]]);
        }
      });
      if (moves.length === 0) break;
      const [cell, region] = moves[next() % moves.length];
      regions[cell] = region;
    }
  }
  return fallbackRegions(size, queens);
}

const boardCache = new Map<string, QueensBoard>();

/**
 * The board a level shows: its solution and its regions.
 *
 * The regions are drawn from the same stream right after the solution, so they
 * are as much a function of the seed as the solution is. Boards are cached by
 * seed and level, because a 9×9 search can take a noticeable moment and a screen
 * re-renders far more often than it changes board.
 */
export function board(seed: string | number | bigint, level: number): QueensBoard {
  const key = `${toBigInt(seed).toString()}:${level}`;
  const cached = boardCache.get(key);
  if (cached) return cached;

  const size = boardSize(level);
  const next = boardStream(seed, level);
  const queens = drawSolution(next, size);
  const regions = uniqueRegions(next, size, queens);
  const drawn: QueensBoard = { size, solution: queens, regions };
  if (boardCache.size > 64) boardCache.clear();
  boardCache.set(key, drawn);
  return drawn;
}

/**
 * The cells the placed Queens rule out: every other cell in a Queen's row, column
 * and region, and every cell touching it. This is the board's automatic X — a
 * display aid, not state: the taps are the same whether or not it is shown.
 */
export function blockedCells(
  size: number,
  regions: readonly number[],
  cells: readonly QueensCell[],
): Set<number> {
  const blocked = new Set<number>();
  cells.forEach((state, queen) => {
    if (state !== "queen") return;
    const queenRow = Math.floor(queen / size);
    const queenColumn = queen % size;
    for (let cell = 0; cell < size * size; cell += 1) {
      if (cell === queen) continue;
      const row = Math.floor(cell / size);
      const column = cell % size;
      if (
        row === queenRow ||
        column === queenColumn ||
        regions[cell] === regions[queen] ||
        (Math.abs(row - queenRow) <= 1 && Math.abs(column - queenColumn) <= 1)
      ) {
        blocked.add(cell);
      }
    }
  });
  return blocked;
}

// ── A run ───────────────────────────────────────────────────────────────────

function emptyCells(level: number): QueensCell[] {
  const size = boardSize(level);
  return new Array<QueensCell>(size * size).fill("empty");
}

/** A fresh run at the start of the first board. */
export function createRun(seed: string | number | bigint): QueensRun {
  return {
    seed: toBigInt(seed).toString(),
    rulesVersion: QUEENS_RULES_VERSION,
    taps: [],
    level: 1,
    cells: emptyCells(1),
    levelsCleared: 0,
    history: [],
    score: 0,
    outcome: "playing",
    stopped: false,
  };
}

/** The par time of the first `levelsCleared` boards, in ms. */
export function parMs(levelsCleared: number): number {
  let total = 0;
  for (let level = 1; level <= levelsCleared; level += 1) {
    total += PAR_MS_BY_SIDE[boardSize(level)]!;
  }
  return total;
}

/** Whether a tap is playable: the run is live, there are taps left, and the cell is on the board. */
export function canTap(run: QueensRun, cell: number): boolean {
  if (run.outcome !== "playing") return false;
  if (run.taps.length >= QUEENS_MAX_ACTIONS) return false;
  return Number.isInteger(cell) && cell >= 0 && cell < run.cells.length;
}

/** The run after one more action, ending it if that reached the submission bound. */
function withAction(run: QueensRun, action: number, next: Partial<QueensRun>): QueensRun {
  const taps = [...run.taps, action];
  return {
    ...run,
    ...next,
    taps,
    outcome: taps.length >= QUEENS_MAX_ACTIONS ? "over" : "playing",
  };
}

/** Whether a board's Queens are exactly its solution. */
function solved(cells: readonly QueensCell[], answer: readonly number[]): boolean {
  const size = answer.length;
  const placed = cells.reduce((count, cell) => count + (cell === "queen" ? 1 : 0), 0);
  return placed === size && answer.every((column, row) => cells[row * size + column] === "queen");
}

/**
 * Taps a cell and returns the resulting run.
 *
 * Empty becomes an X, an X becomes a Queen, and a Queen becomes empty again. When
 * the board's Queens are its solution, it scores ten points a row and the next
 * board is dealt, empty.
 *
 * An impossible tap is not a tap: the run comes back unchanged, the same object.
 */
export function tap(run: QueensRun, cell: number): QueensRun {
  if (!canTap(run, cell)) return run;

  const cells = [...run.cells];
  const size = boardSize(run.level);
  cells[cell] = cells[cell] === "empty" ? "mark" : cells[cell] === "mark" ? "queen" : "empty";

  if (cells[cell] === "queen" || run.cells[cell] === "queen") {
    if (solved(cells, solution(run.seed, run.level))) {
      const level = run.level + 1;
      return withAction(run, cell, {
        level,
        cells: emptyCells(level),
        history: [],
        levelsCleared: run.levelsCleared + 1,
        score: run.score + POINTS_PER_ROW * size,
      });
    }
  }

  return withAction(run, cell, { cells, history: [...run.history, cell] });
}

/** Whether there is a tap on this board to take back. */
export function canUndo(run: QueensRun): boolean {
  return (
    run.outcome === "playing" && run.history.length > 0 && run.taps.length < QUEENS_MAX_ACTIONS
  );
}

/** Takes back the last tap on this board, for free. With nothing to take back, the same run. */
export function undo(run: QueensRun): QueensRun {
  if (!canUndo(run)) return run;
  const cell = run.history[run.history.length - 1]!;
  const cells = [...run.cells];
  cells[cell] = cells[cell] === "mark" ? "empty" : cells[cell] === "queen" ? "mark" : "queen";
  return withAction(run, QUEENS_UNDO, { cells, history: run.history.slice(0, -1) });
}

/** Empties this board, for free. It cannot be undone. With nothing on it, the same run. */
export function clearBoard(run: QueensRun): QueensRun {
  if (!canUndo(run)) return run;
  return withAction(run, QUEENS_CLEAR, { cells: emptyCells(run.level), history: [] });
}

/** Applies one submitted action: a cell, an undo or a clear. */
export function act(run: QueensRun, action: number): QueensRun {
  if (action === QUEENS_UNDO) return undo(run);
  if (action === QUEENS_CLEAR) return clearBoard(run);
  return tap(run, action);
}

/** Replays a list of actions from a seed: how a run is verified. */
export function replay(seed: string | number | bigint, actions: readonly number[]): QueensRun {
  return actions.reduce(act, createRun(seed));
}

/** The Queens on the board that break a rule: same row, column or region, or touching. */
export function clashingCrowns(
  size: number,
  regions: readonly number[],
  cells: readonly QueensCell[],
): Set<number> {
  const queens = cells.flatMap((cell, index) => (cell === "queen" ? [index] : []));
  const clashing = new Set<number>();
  for (const a of queens) {
    for (const b of queens) {
      if (a >= b) continue;
      const rows = Math.abs(Math.floor(a / size) - Math.floor(b / size));
      const columns = Math.abs((a % size) - (b % size));
      if (rows === 0 || columns === 0 || regions[a] === regions[b] || (rows <= 1 && columns <= 1)) {
        clashing.add(a);
        clashing.add(b);
      }
    }
  }
  return clashing;
}

/**
 * Ends the run where it stands, keeping its score. The taps are unchanged: the
 * verifier accepts any prefix of a legal line, because a run never loses points.
 */
export function finish(run: QueensRun): QueensRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", stopped: true };
}

/**
 * The body of a completion submission, assembled from the run so the number
 * submitted is the one this engine computed.
 */
export type QueensSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  readonly tapsPlaced: number;
  readonly levelsCleared: number;
};

export function submission(run: QueensRun): QueensSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.taps,
    score: run.score,
    tapsPlaced: run.taps.length,
    levelsCleared: run.levelsCleared,
  };
}

/** The current board's size and Queens placed. */
export function progress(run: QueensRun): { level: number; side: number; queens: number } {
  return {
    level: run.level,
    side: boardSize(run.level),
    queens: run.cells.filter((state) => state === "queen").length,
  };
}
