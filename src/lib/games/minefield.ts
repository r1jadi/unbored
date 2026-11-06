/**
 * Minefield — the game, as a pure deterministic state machine.
 *
 * Open every safe cell of a grid with hidden mines. An opened cell shows how many
 * of its eight neighbours are mines; a cell with none opens its neighbours too. A
 * flag marks a cell as a mine and protects it from a stray tap. Tapping an opened
 * number whose flags add up opens the rest of its neighbours. A mine costs a life
 * rather than the run, because a board can come down to a true guess.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_minefield_run` in
 * `supabase/migrations/20261218120000_minefield_sessions.sql` replays the submitted
 * actions from the session's seed and derives the score itself. The copy is pinned
 * like every other game's: the rules version (`minefield@1`) is data, the state
 * machine is total and pure, and tests/security/verifier_vectors.sql holds lines
 * both copies must reproduce. See `docs/games/README.md`.
 *
 * ## The first tap of a board is always safe
 *
 * A board's mines are drawn when its first cell is opened, from the seed, the level
 * and that cell, and never on that cell or its neighbours. So the first tap always
 * opens an area to reason from.
 *
 * ## The endless game
 *
 * There is no last board. Boards grow from 8×8 to 10×10 and hold more mines until
 * 22% of the cells are mines, and a run ends when its lives do. The player may end a
 * run at any time and keep its score.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const MINEFIELD_RUNTIME = "minefield";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const MINEFIELD_RULES_VERSION = "minefield@1";

/** The lives a run starts with, and the most it can hold. */
export const MINEFIELD_LIVES = 3;

/** Every this many cleared boards, a life comes back. */
export const MINEFIELD_LIFE_EVERY = 3;

/** An action of this or more toggles a flag: action − offset is the cell. */
export const MINEFIELD_FLAG_OFFSET = 100;

/** The most actions one submission may carry: a request ceiling, not a last board. */
export const MINEFIELD_MAX_ACTIONS = 4096;

const SEED_MODULUS = 4294967296n;
const ZERO_STATE_FALLBACK = 2654435769;
/** Mixed into the seed, so Minefield's boards are its own for any seed. */
const SEED_MIX = 0x27d4eb2f;
const OUTER_MULTIPLIER = 1664525;
const OUTER_INCREMENT = 1013904223;
const INNER_MULTIPLIER = 22695477;
const INNER_INCREMENT = 1;

/** A cell's state. A mine that was hit stays on the board and counts as found. */
export const CLOSED = 0;
export const FLAGGED = 1;
export const OPEN = 2;
export const HIT = 3;
export type MineCell = typeof CLOSED | typeof FLAGGED | typeof OPEN | typeof HIT;

/** In a board's numbers, the value of a cell holding a mine. */
export const MINE = -1;

export type MinefieldEnding = "mines" | "stopped" | "bound";
export type MinefieldOutcome = "playing" | "over";

/** What the last action did, for the screen. */
export type MinefieldLast = {
  readonly cell: number;
  readonly kind: "open" | "flag" | "unflag";
  /** The board the action was made on. */
  readonly level: number;
  /** Safe cells it opened. */
  readonly opened: number;
  /** Mines it set off. */
  readonly hits: number;
  /** The units it earned, a cleared board's included. */
  readonly gain: number;
  readonly cleared: boolean;
  /** Whether clearing the board brought a life back. */
  readonly lifeBack: boolean;
};

/** One run, as this module knows it. */
export type MinefieldRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /** Every action, in order. This *is* the submission. */
  readonly actions: readonly number[];
  /** The board being played, 1-based. */
  readonly level: number;
  readonly side: number;
  readonly cells: readonly MineCell[];
  /** Each cell's number, or `MINE`. Null until the board's first cell is opened. */
  readonly numbers: readonly number[] | null;
  readonly lives: number;
  /** Mines set off on this board. */
  readonly boardHits: number;
  /** Mines set off over the whole run. */
  readonly hits: number;
  /** Safe cells opened over the whole run. */
  readonly opened: number;
  readonly levelsCleared: number;
  /** Boards cleared without setting off a mine. */
  readonly cleanBoards: number;
  readonly score: number;
  readonly outcome: MinefieldOutcome;
  readonly ending: MinefieldEnding | null;
  readonly last: MinefieldLast | null;
};

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new TypeError("a Minefield seed must be a whole number");
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Minefield seed must be a decimal integer string");
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
    throw new RangeError("a Minefield level is a whole number from 1");
  }
}

/** A board's side: 8 for boards 1–2, 9 for 3–5, then 10. */
export function sideFor(level: number): number {
  assertLevel(level);
  return level <= 2 ? 8 : level <= 5 ? 9 : 10;
}

/** The share of a board's cells that are mines, in percent: 13 rising to 22. */
export function minePercent(level: number): number {
  assertLevel(level);
  return Math.min(22, 12 + Math.floor((level + 1) / 2));
}

/** How many mines a board holds. */
export function minesFor(level: number): number {
  const side = sideFor(level);
  return Math.floor((side * side * minePercent(level)) / 100);
}

/** The units a cleared board pays: two a row. */
export function clearBonus(side: number): number {
  return 2 * side;
}

/** The further units a board cleared without setting off a mine pays: one a row. */
export function cleanBonus(side: number): number {
  return side;
}

/** A cell's neighbours, ascending. */
export function neighbours(cell: number, side: number): number[] {
  const row = Math.floor(cell / side);
  const col = cell % side;
  const found: number[] = [];
  for (let r = Math.max(0, row - 1); r <= Math.min(side - 1, row + 1); r += 1) {
    for (let c = Math.max(0, col - 1); c <= Math.min(side - 1, col + 1); c += 1) {
      if (r !== row || c !== col) found.push(r * side + c);
    }
  }
  return found;
}

/**
 * The mines of a board, ascending, given the first cell opened on it.
 *
 * Draws come from an outer LCG advanced once per level and a second LCG started at
 * that state; a draw is the state's top sixteen bits. The candidates are every cell
 * but the first and its neighbours, ascending. For i from 0, slot i swaps with slot
 * i + draw mod (candidates − i), and the first `minesFor(level)` slots are the mines.
 */
export function minesOn(seed: string | number | bigint, level: number, first: number): number[] {
  assertLevel(level);
  const side = sideFor(level);
  let state = initialState(seed);
  for (let current = 1; current <= level; current += 1) {
    state = (Math.imul(state, OUTER_MULTIPLIER) + OUTER_INCREMENT) >>> 0;
  }
  const next = () => {
    state = (Math.imul(state, INNER_MULTIPLIER) + INNER_INCREMENT) >>> 0;
    return state >>> 16;
  };

  const kept = new Set([first, ...neighbours(first, side)]);
  const candidates: number[] = [];
  for (let cell = 0; cell < side * side; cell += 1) {
    if (!kept.has(cell)) candidates.push(cell);
  }
  const count = minesFor(level);
  for (let i = 0; i < count; i += 1) {
    const j = i + (next() % (candidates.length - i));
    const held = candidates[i]!;
    candidates[i] = candidates[j]!;
    candidates[j] = held;
  }
  return candidates.slice(0, count).sort((a, b) => a - b);
}

/** Each cell's number on a board with these mines, or `MINE`. */
export function numbersFor(mines: readonly number[], side: number): number[] {
  const numbers: number[] = Array.from({ length: side * side }, () => 0);
  for (const mine of mines) {
    for (const near of neighbours(mine, side)) numbers[near] = numbers[near]! + 1;
  }
  for (const mine of mines) numbers[mine] = MINE;
  return numbers;
}

/**
 * Opens a safe cell and, from any cell numbered 0, its neighbours, in place. A flag
 * stops the spread. Returns how many cells opened.
 */
export function openInto(
  cells: MineCell[],
  numbers: readonly number[],
  side: number,
  cell: number,
): number {
  const stack = [cell];
  let opened = 0;
  while (stack.length > 0) {
    const at = stack.pop()!;
    if (cells[at] !== CLOSED) continue;
    cells[at] = OPEN;
    opened += 1;
    if (numbers[at] === 0) stack.push(...neighbours(at, side));
  }
  return opened;
}

/** Whether every safe cell of a board is open. */
export function allSafeOpen(cells: readonly MineCell[], numbers: readonly number[]): boolean {
  return cells.every((state, at) => state === OPEN || numbers[at] === MINE);
}

/** A fresh run on board one. */
export function createRun(seed: string | number | bigint): MinefieldRun {
  const normalised = toBigInt(seed).toString();
  const side = sideFor(1);
  return {
    seed: normalised,
    rulesVersion: MINEFIELD_RULES_VERSION,
    actions: [],
    level: 1,
    side,
    cells: Array.from({ length: side * side }, () => CLOSED),
    numbers: null,
    lives: MINEFIELD_LIVES,
    boardHits: 0,
    hits: 0,
    opened: 0,
    levelsCleared: 0,
    cleanBoards: 0,
    score: 0,
    outcome: "playing",
    ending: null,
    last: null,
  };
}

/** The mines still to find: the board's, less the flags up and the mines set off. */
export function minesLeft(run: MinefieldRun): number {
  const found = run.cells.reduce<number>(
    (count, state) => count + (state === FLAGGED || state === HIT ? 1 : 0),
    0,
  );
  return minesFor(run.level) - found;
}

/** The closed neighbours a tap on an opened number opens, or none if it may not. */
export function chordTargetsOn(
  cells: readonly MineCell[],
  numbers: readonly number[],
  side: number,
  cell: number,
): number[] {
  if (cells[cell] !== OPEN) return [];
  const number = numbers[cell]!;
  if (number <= 0) return [];
  const around = neighbours(cell, side);
  const marked = around.filter((at) => cells[at] === FLAGGED || cells[at] === HIT).length;
  return marked === number ? around.filter((at) => cells[at] === CLOSED) : [];
}

/** `chordTargetsOn` for a run's board. */
export function chordTargets(run: MinefieldRun, cell: number): number[] {
  return run.numbers ? chordTargetsOn(run.cells, run.numbers, run.side, cell) : [];
}

function toggleFlag(run: MinefieldRun, cell: number): MinefieldRun {
  const state = run.cells[cell];
  if (state !== CLOSED && state !== FLAGGED) return run;
  const cells = [...run.cells];
  cells[cell] = state === CLOSED ? FLAGGED : CLOSED;
  return {
    ...run,
    cells,
    last: {
      cell,
      kind: state === CLOSED ? "flag" : "unflag",
      level: run.level,
      opened: 0,
      hits: 0,
      gain: 0,
      cleared: false,
      lifeBack: false,
    },
  };
}

function openCells(run: MinefieldRun, cell: number, targets: readonly number[]): MinefieldRun {
  const numbers = run.numbers ?? numbersFor(minesOn(run.seed, run.level, cell), run.side);
  const cells = [...run.cells];
  let lives = run.lives;
  let opened = 0;
  let hits = 0;
  for (const target of targets) {
    if (cells[target] !== CLOSED) continue;
    if (numbers[target] === MINE) {
      cells[target] = HIT;
      hits += 1;
      lives -= 1;
      if (lives === 0) break;
    } else {
      opened += openInto(cells, numbers, run.side, target);
    }
  }

  const boardHits = run.boardHits + hits;
  const cleared = lives > 0 && allSafeOpen(cells, numbers);
  const bonus = cleared ? clearBonus(run.side) + (boardHits === 0 ? cleanBonus(run.side) : 0) : 0;
  const gain = opened + bonus;
  const levelsCleared = run.levelsCleared + (cleared ? 1 : 0);
  const lifeBack = cleared && levelsCleared % MINEFIELD_LIFE_EVERY === 0 && lives < MINEFIELD_LIVES;
  const level = cleared ? run.level + 1 : run.level;
  const side = sideFor(level);

  return {
    ...run,
    level,
    side,
    cells: cleared ? Array.from({ length: side * side }, () => CLOSED) : cells,
    numbers: cleared ? null : numbers,
    lives: lives + (lifeBack ? 1 : 0),
    boardHits: cleared ? 0 : boardHits,
    hits: run.hits + hits,
    opened: run.opened + opened,
    levelsCleared,
    cleanBoards: run.cleanBoards + (cleared && boardHits === 0 ? 1 : 0),
    score: run.score + gain,
    last: { cell, kind: "open", level: run.level, opened, hits, gain, cleared, lifeBack },
  };
}

/**
 * One action: a flag toggled (cell + `MINEFIELD_FLAG_OFFSET`), a closed cell opened,
 * or an opened number's neighbours opened. An action that is not a move returns the
 * same run object, and the verifier refuses a run that contains one: an action after
 * the run ended, a cell off the board, opening a flagged cell or a mine already set
 * off, flagging an opened cell, or tapping an opened cell whose flags do not add up.
 */
export function act(run: MinefieldRun, action: number): MinefieldRun {
  if (run.outcome !== "playing" || !Number.isInteger(action) || action < 0) return run;
  const flagging = action >= MINEFIELD_FLAG_OFFSET;
  const cell = flagging ? action - MINEFIELD_FLAG_OFFSET : action;
  if (cell >= run.cells.length) return run;

  let next: MinefieldRun;
  if (flagging) {
    next = toggleFlag(run, cell);
  } else if (run.cells[cell] === CLOSED) {
    next = openCells(run, cell, [cell]);
  } else {
    const targets = chordTargets(run, cell);
    next = targets.length > 0 ? openCells(run, cell, targets) : run;
  }
  if (next === run) return run;

  const actions = [...run.actions, action];
  if (next.lives === 0) return { ...next, actions, outcome: "over", ending: "mines" };
  if (actions.length >= MINEFIELD_MAX_ACTIONS) {
    return { ...next, actions, outcome: "over", ending: "bound" };
  }
  return { ...next, actions };
}

/** Replays a list of actions from a seed: how a run is verified. */
export function replay(seed: string | number | bigint, actions: readonly number[]): MinefieldRun {
  return actions.reduce(act, createRun(seed));
}

/** Ends the run where it stands: the player stopped. */
export function finish(run: MinefieldRun): MinefieldRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stopped" };
}

export type MinefieldSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  /** The run's own summary, shown for an offline practice run the server never saw. */
  readonly tapsPlaced: number;
  readonly levelsCleared: number;
};

export function submission(run: MinefieldRun): MinefieldSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.actions,
    score: run.score,
    tapsPlaced: run.opened,
    levelsCleared: run.levelsCleared,
  };
}

/** A board's cells as the vectors write them: one digit a cell, its state. */
export function cellsCode(cells: readonly MineCell[]): string {
  return cells.join("");
}
