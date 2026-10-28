/**
 * Gridburst — the game, as a pure deterministic state machine.
 *
 * Drop the pieces you are dealt onto an 8×8 grid. Fill a row or a column and it
 * bursts. Three pieces are dealt at a time; place all three and three more
 * arrive. The run ends when none of the pieces left in the tray fits anywhere.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_gridburst_run` in
 * `supabase/migrations/20261117120000_gridburst_sessions.sql` replays the
 * submitted placements from the session's seed and derives the score itself. The
 * two copies are pinned the way every other game's are: the rules version is
 * data (`gridburst@1`), the state machine is total and pure, and the vectors in
 * `gridburst.test.ts` are the ones `tests/security/rls_test.sql` asserts. See
 * `docs/games/README.md`.
 *
 * Endless rule: there is no final tray. The pieces are drawn from two pools — the
 * everyday shapes and the big ones (five-in-a-row, the 2×3 slabs, the 3×3 block
 * and the big corners) — and the share drawn from the big pool rises with every
 * piece dealt, so the board gets harder to keep open until it can take nothing.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const GRIDBURST_RUNTIME = "gridburst";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const GRIDBURST_RULES_VERSION = "gridburst@1";

/** The board: 8×8. */
export const GRIDBURST_SIZE = 8;
export const GRIDBURST_CELLS = GRIDBURST_SIZE * GRIDBURST_SIZE;

/** Pieces dealt at a time. */
export const GRIDBURST_TRAY = 3;

/**
 * The most placements one submission may carry. This bounds a request, not a
 * run: there is no final tray.
 */
export const GRIDBURST_MAX_MOVES = 4096;

/** The placements a combo survives without a burst before it resets. */
export const GRIDBURST_COMBO_GRACE = 3;

/** The bonus for a burst that leaves the board empty. */
export const GRIDBURST_CLEAR_BONUS = 300;

/**
 * Every piece, as rows of `#` (filled) and `.` (empty), in the order the deal
 * indexes them. The verifier holds the same table as cell offsets; the order is
 * part of the rules.
 */
export const GRIDBURST_SHAPES: readonly (readonly string[])[] = [
  // The everyday pool: 0–27.
  ["#"],
  ["##"],
  ["#", "#"],
  ["###"],
  ["#", "#", "#"],
  ["####"],
  ["#", "#", "#", "#"],
  ["##", "##"],
  ["##", "#."],
  ["##", ".#"],
  ["#.", "##"],
  [".#", "##"],
  ["###", ".#."],
  [".#.", "###"],
  ["#.", "##", "#."],
  [".#", "##", ".#"],
  [".##", "##."],
  ["#.", "##", ".#"],
  ["##.", ".##"],
  [".#", "##", "#."],
  ["#.", "#.", "##"],
  ["###", "#.."],
  ["##", ".#", ".#"],
  ["..#", "###"],
  [".#", ".#", "##"],
  ["#..", "###"],
  ["##", "#.", "#."],
  ["###", "..#"],
  // The big pool: 28–36.
  ["#####"],
  ["#", "#", "#", "#", "#"],
  ["###", "###"],
  ["##", "##", "##"],
  ["###", "###", "###"],
  ["###", "#..", "#.."],
  ["###", "..#", "..#"],
  ["#..", "#..", "###"],
  ["..#", "..#", "###"],
];

/** The first shape of the big pool; every shape before it is everyday. */
export const GRIDBURST_BIG_FROM = 28;

/** A shape's cells, as `[row, column]` offsets from its top-left corner. */
export function shapeCells(shape: number): readonly (readonly [number, number])[] {
  const rows = GRIDBURST_SHAPES[shape];
  if (!rows) throw new RangeError(`there is no Gridburst shape ${shape}`);
  const cells: [number, number][] = [];
  rows.forEach((line, row) => {
    [...line].forEach((mark, column) => {
      if (mark === "#") cells.push([row, column]);
    });
  });
  return cells;
}

/** A shape's bounding box, for drawing it. */
export function shapeSize(shape: number): { rows: number; columns: number } {
  const rows = GRIDBURST_SHAPES[shape];
  if (!rows) throw new RangeError(`there is no Gridburst shape ${shape}`);
  return { rows: rows.length, columns: Math.max(...rows.map((line) => line.length)) };
}

/**
 * The share of deals drawn from the big pool, as a whole percentage: 8% for the
 * first piece, one point more every twelve pieces, capped at 40%.
 */
export function bigPercent(piece: number): number {
  if (!Number.isInteger(piece) || piece < 0) {
    throw new RangeError("a Gridburst piece index starts at zero");
  }
  return Math.min(40, 8 + Math.floor(piece / 12));
}

export type GridburstEndReason = "stuck" | "limit" | null;
export type GridburstOutcome = "playing" | "over";

/** One run, as this module knows it. */
export type GridburstRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /**
   * Sixty-four cells, in board order. `0` is empty; anything else is filled, and
   * the number is the shape that filled it plus one, so the board can colour it.
   */
  readonly board: readonly number[];
  /** The tray: three shapes, `null` where a piece has been placed. */
  readonly tray: readonly (number | null)[];
  /** Pieces dealt so far, across every tray: the ramp reads it. */
  readonly dealt: number;
  /** The generator's state after the last deal. Not part of the submission. */
  readonly rng: bigint;
  /**
   * Every placement, in order, as `slot × 64 + cell`, the cell being where the
   * piece's top-left corner lands. This *is* the submission.
   */
  readonly moves: readonly number[];
  readonly score: number;
  /** Rows and columns burst so far. */
  readonly lines: number;
  /** The current combo: bursting placements in a row, with grace. */
  readonly combo: number;
  /** Placements since the last burst. Three resets the combo. */
  readonly misses: number;
  readonly outcome: GridburstOutcome;
  /** True when the player ended the run, rather than the game ending it. */
  readonly stopped?: true;
  readonly endReason: GridburstEndReason;
};

// The generator: the same 32-bit LCG and seed handling every other game uses
// (see `src/lib/games/stack10.ts`), because a seed that differs by one bit deals
// different pieces.
const SEED_MODULUS = 4294967296n;
const LCG_MULTIPLIER = 1664525n;
const LCG_INCREMENT = 1013904223n;
const ZERO_STATE_FALLBACK = 2654435769n;

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new TypeError("a Gridburst seed must be a whole number");
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Gridburst seed must be a decimal integer string");
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
 * Deals piece number `piece` from generator state `state`. Two draws: the first
 * chooses the pool, the second the shape within it. Both read bits 16 and up, as
 * the other games do, because this generator's low bits cycle quickly.
 */
function deal(state: bigint, piece: number): { shape: number; state: bigint } {
  const first = advance(state);
  const roll = Number((first >> 16n) % 100n);
  const second = advance(first);
  const big = roll < bigPercent(piece);
  const size = big ? GRIDBURST_SHAPES.length - GRIDBURST_BIG_FROM : GRIDBURST_BIG_FROM;
  const pick = Number((second >> 16n) % BigInt(size));
  return { shape: big ? GRIDBURST_BIG_FROM + pick : pick, state: second };
}

function dealTray(state: bigint, dealt: number): { tray: number[]; state: bigint } {
  const tray: number[] = [];
  let next = state;
  for (let slot = 0; slot < GRIDBURST_TRAY; slot += 1) {
    const drawn = deal(next, dealt + slot);
    tray.push(drawn.shape);
    next = drawn.state;
  }
  return { tray, state: next };
}

/** Whether `shape` fits with its top-left corner on `cell`. */
export function fits(board: readonly number[], shape: number, cell: number): boolean {
  if (!Number.isInteger(cell) || cell < 0 || cell >= GRIDBURST_CELLS) return false;
  const row = Math.floor(cell / GRIDBURST_SIZE);
  const column = cell % GRIDBURST_SIZE;
  return shapeCells(shape).every(([dr, dc]) => {
    const r = row + dr;
    const c = column + dc;
    return r < GRIDBURST_SIZE && c < GRIDBURST_SIZE && board[r * GRIDBURST_SIZE + c] === 0;
  });
}

/** Whether `shape` fits anywhere on the board. */
export function fitsAnywhere(board: readonly number[], shape: number): boolean {
  for (let cell = 0; cell < GRIDBURST_CELLS; cell += 1) {
    if (fits(board, shape, cell)) return true;
  }
  return false;
}

/**
 * The rows and columns that a filled board has completed: `rows` and `columns`
 * are their indices. Both are read before either is cleared, so a cell on a full
 * row and a full column counts toward both and bursts once.
 */
export function fullLines(board: readonly number[]): { rows: number[]; columns: number[] } {
  const rows: number[] = [];
  const columns: number[] = [];
  for (let line = 0; line < GRIDBURST_SIZE; line += 1) {
    let row = true;
    let column = true;
    for (let step = 0; step < GRIDBURST_SIZE; step += 1) {
      if (board[line * GRIDBURST_SIZE + step] === 0) row = false;
      if (board[step * GRIDBURST_SIZE + line] === 0) column = false;
    }
    if (row) rows.push(line);
    if (column) columns.push(line);
  }
  return { rows, columns };
}

/** The board with `shape` dropped on `cell`, before anything bursts. */
export function dropped(board: readonly number[], shape: number, cell: number): number[] {
  const next = [...board];
  const row = Math.floor(cell / GRIDBURST_SIZE);
  const column = cell % GRIDBURST_SIZE;
  for (const [dr, dc] of shapeCells(shape)) {
    next[(row + dr) * GRIDBURST_SIZE + column + dc] = shape + 1;
  }
  return next;
}

/** The board after its full lines burst. */
export function burst(board: readonly number[]): number[] {
  const { rows, columns } = fullLines(board);
  return board.map((value, cell) =>
    rows.includes(Math.floor(cell / GRIDBURST_SIZE)) || columns.includes(cell % GRIDBURST_SIZE)
      ? 0
      : value,
  );
}

/** The points a burst of `lines` lines scores at `combo`. */
export function burstScore(lines: number, combo: number): number {
  return 10 * lines * lines * combo;
}

/** A placement's action number: the tray slot and the cell its corner lands on. */
export function encodeMove(slot: number, cell: number): number {
  return slot * GRIDBURST_CELLS + cell;
}

export function decodeMove(move: number): { slot: number; cell: number } {
  return { slot: Math.floor(move / GRIDBURST_CELLS), cell: move % GRIDBURST_CELLS };
}

/** A fresh run: an empty board and the first tray. */
export function createRun(seed: string | number | bigint): GridburstRun {
  const opening = dealTray(initialState(seed), 0);
  return {
    seed: toBigInt(seed).toString(),
    rulesVersion: GRIDBURST_RULES_VERSION,
    board: Array.from({ length: GRIDBURST_CELLS }, () => 0),
    tray: opening.tray,
    dealt: GRIDBURST_TRAY,
    rng: opening.state,
    moves: [],
    score: 0,
    lines: 0,
    combo: 0,
    misses: 0,
    outcome: "playing",
    endReason: null,
  };
}

/** Whether the tray piece in `slot` can go on `cell` now. */
export function canPlace(run: GridburstRun, slot: number, cell: number): boolean {
  if (run.outcome !== "playing") return false;
  if (!Number.isInteger(slot) || slot < 0 || slot >= GRIDBURST_TRAY) return false;
  const shape = run.tray[slot];
  return shape !== null && shape !== undefined && fits(run.board, shape, cell);
}

/**
 * Places the tray piece in `slot` with its corner on `cell`, bursts any full
 * lines, deals a new tray if this was the last piece, and ends the run when no
 * piece left fits.
 *
 * Scoring: one point per cell placed; a burst of `L` lines scores `10 × L²`
 * times the combo, which grows by one with every bursting placement and resets
 * after three placements in a row burst nothing; a burst that empties the board
 * adds 300.
 *
 * A placement that does not fit is not a move: the run comes back unchanged.
 */
export function place(run: GridburstRun, slot: number, cell: number): GridburstRun {
  if (!canPlace(run, slot, cell)) return run;
  const shape = run.tray[slot] as number;

  const filled = dropped(run.board, shape, cell);
  const { rows, columns } = fullLines(filled);
  const lines = rows.length + columns.length;
  const board = lines > 0 ? burst(filled) : filled;

  let score = run.score + shapeCells(shape).length;
  let combo = run.combo;
  let misses = run.misses;
  if (lines > 0) {
    combo += 1;
    misses = 0;
    score += burstScore(lines, combo);
    if (board.every((value) => value === 0)) score += GRIDBURST_CLEAR_BONUS;
  } else {
    misses += 1;
    if (misses >= GRIDBURST_COMBO_GRACE) combo = 0;
  }

  let tray: (number | null)[] = run.tray.map((piece, index) => (index === slot ? null : piece));
  let dealt = run.dealt;
  let rng = run.rng;
  if (tray.every((piece) => piece === null)) {
    const next = dealTray(rng, dealt);
    tray = next.tray;
    rng = next.state;
    dealt += GRIDBURST_TRAY;
  }

  const moves = [...run.moves, encodeMove(slot, cell)];
  const stuck = !tray.some((piece) => piece !== null && fitsAnywhere(board, piece));
  const limit = moves.length >= GRIDBURST_MAX_MOVES;
  return {
    ...run,
    board,
    tray,
    dealt,
    rng,
    moves,
    score,
    lines: run.lines + lines,
    combo,
    misses,
    outcome: stuck || limit ? "over" : "playing",
    endReason: stuck ? "stuck" : limit ? "limit" : null,
  };
}

/** Replays a list of placements from the seed: how a saved run is restored. */
export function replay(seed: string | number | bigint, moves: readonly number[]): GridburstRun {
  return moves.reduce((run, move) => {
    const { slot, cell } = decodeMove(move);
    return place(run, slot, cell);
  }, createRun(seed));
}

/**
 * Ends the run where it stands: the player stopped. The score only ever grows,
 * so stopping early can never earn a point, and the verifier accepts the line.
 */
export function finish(run: GridburstRun): GridburstRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", stopped: true };
}

export type GridburstSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: GridburstRun): GridburstSubmission {
  return { rulesVersion: run.rulesVersion, actions: run.moves, score: run.score };
}
