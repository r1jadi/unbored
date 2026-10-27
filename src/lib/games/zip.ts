/**
 * Zip — the game, as a pure deterministic state machine.
 *
 * Every board is an N×N grid with numbered checkpoints and, sometimes, walls.
 * Draw one path that starts on 1, passes through the numbers in order, visits
 * every cell exactly once and ends on the highest number. Moves go up, down, left
 * or right, never through a wall. Every board has exactly one solution.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_zip_run` in `supabase/migrations/20261105120000_zip_sessions.sql`
 * replays the submitted cells from the session's seed and derives the score
 * itself. The copy is pinned the same way as the other games: the rules version
 * (`zip@1`) is data, the state machine is total and pure, and the solution paths
 * and scored lines in `zip.test.ts` are the ones `tests/security/rls_test.sql`
 * asserts. See `docs/games/README.md`.
 *
 * ## What the server needs, and what only the board needs
 *
 * A board is drawn in two steps from one random stream: first the **solution**, a
 * random path through every cell, then the **checkpoints and walls**, added until
 * that path is the board's only solution. The server only needs the first step: a
 * path that covers the board is solved exactly when it *is* the solution, because
 * the solution is unique. So the verifier replays the drawn path against the
 * solution and never places a checkpoint; the uniqueness search lives only here.
 *
 * Because of that split, the server's move rules are looser than the board's: it
 * checks that a step is to a neighbouring cell, not whether it crosses a wall or
 * reaches a number early. The board never sends such a step (`move` refuses it),
 * so the moves the server sees are always a subset of what it accepts, and the two
 * agree on every score.
 *
 * ## The endless game, against the clock
 *
 * A numbered-path puzzle is a speed puzzle, and so is this: a run is a series of boards
 * against one clock. The clock starts at sixty seconds and every solved board adds
 * five seconds per row. When it reaches zero the run is over; the player may also
 * end it early. A solved board scores ten points per row. The clock is enforced by
 * the server's own time, not the client's: a Zip session is issued when the player
 * presses Start, and the verifier refuses a run that arrives later than the time
 * its solved boards earned (`out_of_time`).
 *
 * Storage rule: nothing here is persisted. A score only exists once the server has
 * verified it.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const ZIP_RUNTIME = "zip";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const ZIP_RULES_VERSION = "zip@1";

/** The largest board. Boards grow from 5×5 to 7×7 and stay there. */
export const ZIP_MAX_SIDE = 7;

/** The most cells one submission may carry: a request ceiling, not a final board. */
export const ZIP_MAX_ACTIONS = 8192;

/** The clock a run starts with. */
export const ZIP_START_MS = 60_000;

/** The time a solved board adds, per row of that board. */
export const ZIP_BONUS_MS_PER_ROW = 5_000;

/**
 * How late after the clock runs out the server still accepts a run: the time
 * between the session being issued and the board appearing, plus the submission's
 * own round trip.
 */
export const ZIP_SLACK_MS = 20_000;

/** Ten points per row of a solved board. */
const POINTS_PER_ROW = 10;

// The same generators as Queens: One Move's outer LCG advanced once per level,
// and a second LCG started at that state to draw the board.
const SEED_MODULUS = 4294967296n;
const ZERO_STATE_FALLBACK = 2654435769;
const OUTER_MULTIPLIER = 1664525;
const OUTER_INCREMENT = 1013904223;
const INNER_MULTIPLIER = 22695477;
const INNER_INCREMENT = 1;

/** Backbite moves per cell when shuffling the solution path. */
const SHUFFLES_PER_CELL = 8;

/**
 * How a run ended. `time` — the clock ran out; `stopped` — the player ended it;
 * `bound` — the submission bound was reached.
 */
export type ZipEnding = "time" | "stopped" | "bound";

export type ZipOutcome = "playing" | "over";

/** One run, as this module knows it. */
export type ZipRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /** Every cell sent, in order. This *is* the submission. */
  readonly taps: readonly number[];
  /** The board being played, 1-based. */
  readonly level: number;
  /** The path drawn so far on the current board, from its start. */
  readonly path: readonly number[];
  readonly levelsCleared: number;
  readonly score: number;
  readonly outcome: ZipOutcome;
  readonly ending: ZipEnding | null;
};

/** A board as it is drawn. */
export type ZipBoard = {
  readonly size: number;
  /** The solution: every cell, in path order. */
  readonly solution: readonly number[];
  /** The number on each cell, in board order; 0 for a cell without one. */
  readonly numbers: readonly number[];
  /** The highest number, which the path ends on. */
  readonly last: number;
  /** Walls, each as the two cells it separates, smaller first. */
  readonly walls: readonly (readonly [number, number])[];
};

// ── Seeds and generators ────────────────────────────────────────────────────

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new TypeError("a Zip seed must be a whole number");
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Zip seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

function initialState(seed: string | number | bigint): number {
  const value = toBigInt(seed);
  const reduced = Number(((value % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS);
  return reduced === 0 ? ZERO_STATE_FALLBACK : reduced;
}

function advanceOuter(state: number): number {
  return (Math.imul(state, OUTER_MULTIPLIER) + OUTER_INCREMENT) >>> 0;
}

function innerStream(state: number): () => number {
  let current = state >>> 0;
  return () => {
    current = (Math.imul(current, INNER_MULTIPLIER) + INNER_INCREMENT) >>> 0;
    return current >>> 16;
  };
}

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError("a Zip level must be a whole number from 1");
  }
}

/** The side of the board a level is played on: 5 for 1–2, 6 for 3–8, then 7. */
export function boardSize(level: number): number {
  assertLevel(level);
  if (level <= 2) return 5;
  if (level <= 8) return 6;
  return ZIP_MAX_SIDE;
}

/** The clock a run has earned once `levelsCleared` boards are solved, in ms. */
export function budgetMs(levelsCleared: number): number {
  let total = ZIP_START_MS;
  for (let level = 1; level <= levelsCleared; level += 1) {
    total += ZIP_BONUS_MS_PER_ROW * boardSize(level);
  }
  return total;
}

function boardStream(seed: string | number | bigint, level: number): () => number {
  assertLevel(level);
  let state = initialState(seed);
  for (let current = 1; current <= level; current += 1) {
    state = advanceOuter(state);
  }
  return innerStream(state);
}

/** Row-and-column steps, in the order a direction draw picks them. */
const STEPS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * Draws the solution path with backbite moves.
 *
 * It starts as a serpentine — left to right along the first row, right to left
 * along the second, and so on — which already visits every cell once. A backbite
 * picks one end of the path and one of its four neighbours; if that neighbour is
 * on the board and not already the end's neighbour on the path, the end joins it
 * and the stretch between them is reversed. Every step keeps the path covering
 * the board, and eight steps per cell leave no trace of the serpentine.
 */
function drawPath(next: () => number, size: number): number[] {
  const cells = size * size;
  const path: number[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      path.push(row * size + (row % 2 === 0 ? column : size - 1 - column));
    }
  }
  const position = new Array<number>(cells);
  path.forEach((cell, index) => {
    position[cell] = index;
  });
  const reverse = (from: number, to: number) => {
    for (let low = from, high = to; low < high; low += 1, high -= 1) {
      const held = path[low];
      path[low] = path[high];
      path[high] = held;
      position[path[low]] = low;
      position[path[high]] = high;
    }
  };

  for (let move = 0; move < SHUFFLES_PER_CELL * cells; move += 1) {
    const tail = next() % 2 === 1;
    const [rowStep, columnStep] = STEPS[next() % 4];
    const end = tail ? path[cells - 1] : path[0];
    const row = Math.floor(end / size) + rowStep;
    const column = (end % size) + columnStep;
    if (row < 0 || row >= size || column < 0 || column >= size) continue;
    const joined = position[row * size + column];
    if (tail) {
      if (joined === cells - 2) continue;
      reverse(joined + 1, cells - 1);
    } else {
      if (joined === 1) continue;
      reverse(0, joined - 1);
    }
  }
  return path;
}

/**
 * The solution of a level's board: every cell, in the order the path visits it.
 * This is everything the verifier needs.
 */
export function solution(seed: string | number | bigint, level: number): number[] {
  return drawPath(boardStream(seed, level), boardSize(level));
}

// ── Checkpoints, walls and uniqueness (the board only) ──────────────────────

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

function wallKey(a: number, b: number): number {
  return a < b ? a * 4096 + b : b * 4096 + a;
}

/**
 * Up to `limit` solutions of a board: paths from the cell numbered 1 that reach
 * the numbers in order, cross no wall, visit every cell once and end on the
 * highest number.
 *
 * A depth-first search, pruned two ways after every step: the unvisited cells
 * must still be one connected piece reachable from the head, and no unvisited
 * cell may be left with fewer open sides than it needs (two to pass through, one
 * for the final cell).
 */
export function solutions(
  size: number,
  numbers: readonly number[],
  walls: readonly (readonly [number, number])[],
  limit = 2,
): number[][] {
  const cells = size * size;
  const blocked = new Set(walls.map(([a, b]) => wallKey(a, b)));
  const open = (a: number, b: number) => !blocked.has(wallKey(a, b));
  const last = Math.max(...numbers);
  const start = numbers.indexOf(1);
  const end = numbers.indexOf(last);
  const visited = new Uint8Array(cells);
  const path: number[] = [];
  const found: number[][] = [];

  const viable = (head: number): boolean => {
    let remaining = 0;
    for (let cell = 0; cell < cells; cell += 1) if (!visited[cell]) remaining += 1;
    if (remaining === 0) return true;
    const seen = new Uint8Array(cells);
    const stack: number[] = [];
    for (const other of neighbours(head, size)) {
      if (!visited[other] && open(head, other)) {
        seen[other] = 1;
        stack.push(other);
      }
    }
    let reached = 0;
    while (stack.length > 0) {
      const cell = stack.pop() as number;
      reached += 1;
      for (const other of neighbours(cell, size)) {
        if (!visited[other] && !seen[other] && open(cell, other)) {
          seen[other] = 1;
          stack.push(other);
        }
      }
    }
    if (reached !== remaining) return false;

    let narrow = 0;
    for (let cell = 0; cell < cells; cell += 1) {
      if (visited[cell]) continue;
      let sides = 0;
      for (const other of neighbours(cell, size)) {
        if ((!visited[other] || other === head) && open(cell, other)) sides += 1;
      }
      if (cell === end) {
        if (sides < 1) return false;
      } else if (sides < 2) {
        if (sides < 1) return false;
        narrow += 1;
        if (narrow > 1) return false;
      }
    }
    return true;
  };

  const search = (cell: number, nextNumber: number) => {
    if (found.length >= limit) return;
    visited[cell] = 1;
    path.push(cell);
    const expected = numbers[cell] > 0 ? numbers[cell] + 1 : nextNumber;
    if (path.length === cells) {
      if (cell === end) found.push([...path]);
    } else if (cell !== end && viable(cell)) {
      for (const other of neighbours(cell, size)) {
        if (visited[other] || !open(cell, other)) continue;
        if (numbers[other] > 0 && numbers[other] !== expected) continue;
        search(other, expected);
      }
    }
    visited[cell] = 0;
    path.pop();
  };

  if (start >= 0 && end >= 0) search(start, 2);
  return found;
}

/** Numbers each listed path position, in order, and leaves every other cell blank. */
function numbersAt(size: number, path: readonly number[], positions: readonly number[]): number[] {
  const numbers = new Array<number>(size * size).fill(0);
  [...positions]
    .sort((a, b) => a - b)
    .forEach((position, index) => {
      numbers[path[position]] = index + 1;
    });
  return numbers;
}

/** How many checkpoints or walls the search may add before falling back. */
const MAX_FIXES = 200;

/**
 * Places checkpoints and walls until the solution is the board's only path.
 *
 * It starts with a checkpoint every four cells or so along the solution (jittered
 * by a cell either way), plus 1 at the start and the highest number at the end.
 * While a second solution exists, it adds one constraint that rules that solution
 * out and leaves the planted one valid: usually a checkpoint the other path would
 * reach out of order, otherwise a wall across a step the other path takes and the
 * planted one does not. If it ever ran out of fixes, numbering every cell would
 * force the path; it never has in testing.
 */
function constrain(
  next: () => number,
  size: number,
  path: readonly number[],
): { numbers: number[]; walls: [number, number][] } {
  const cells = size * size;
  const positions = new Set<number>([0, cells - 1]);
  const initial = Math.floor(cells / 4);
  const gap = (cells - 1) / (initial + 1);
  for (let index = 1; index <= initial; index += 1) {
    const jitter = (next() % 3) - 1;
    positions.add(Math.min(cells - 2, Math.max(1, Math.round(index * gap) + jitter)));
  }
  const walls: [number, number][] = [];
  const steps = new Set<number>();
  for (let index = 0; index + 1 < cells; index += 1) {
    steps.add(wallKey(path[index], path[index + 1]));
  }

  for (let fix = 0; fix < MAX_FIXES; fix += 1) {
    const numbers = numbersAt(size, path, [...positions]);
    const found = solutions(size, numbers, walls);
    const other = found.find((candidate) => candidate.some((cell, index) => cell !== path[index]));
    if (!other) return { numbers, walls };

    const otherIndex = new Array<number>(cells);
    other.forEach((cell, index) => {
      otherIndex[cell] = index;
    });
    const sorted = [...positions].sort((a, b) => a - b);
    const checkpoints: number[] = [];
    for (let position = 1; position < cells - 1; position += 1) {
      if (positions.has(position)) continue;
      const order = [...sorted, position]
        .sort((a, b) => a - b)
        .map((planted) => otherIndex[path[planted]]);
      if (order.some((value, index) => index > 0 && value < order[index - 1])) {
        checkpoints.push(position);
      }
    }
    if (checkpoints.length > 0 && next() % 4 !== 0) {
      positions.add(checkpoints[next() % checkpoints.length]);
      continue;
    }
    const crossings: [number, number][] = [];
    for (let index = 0; index + 1 < cells; index += 1) {
      const a = other[index];
      const b = other[index + 1];
      if (!steps.has(wallKey(a, b))) crossings.push(a < b ? [a, b] : [b, a]);
    }
    walls.push(crossings[next() % crossings.length]);
  }
  return {
    numbers: numbersAt(
      size,
      path,
      path.map((_, index) => index),
    ),
    walls,
  };
}

const boardCache = new Map<string, ZipBoard>();

/** The board a level shows. Cached by seed and level. */
export function board(seed: string | number | bigint, level: number): ZipBoard {
  const key = `${toBigInt(seed).toString()}:${level}`;
  const cached = boardCache.get(key);
  if (cached) return cached;

  const size = boardSize(level);
  const next = boardStream(seed, level);
  const path = drawPath(next, size);
  const { numbers, walls } = constrain(next, size, path);
  const drawn: ZipBoard = { size, solution: path, numbers, last: Math.max(...numbers), walls };
  if (boardCache.size > 64) boardCache.clear();
  boardCache.set(key, drawn);
  return drawn;
}

// ── A run ───────────────────────────────────────────────────────────────────

/** A fresh run at the start of the first board. */
export function createRun(seed: string | number | bigint): ZipRun {
  return {
    seed: toBigInt(seed).toString(),
    rulesVersion: ZIP_RULES_VERSION,
    taps: [],
    level: 1,
    path: [],
    levelsCleared: 0,
    score: 0,
    outcome: "playing",
    ending: null,
  };
}

function adjacent(a: number, b: number, size: number): boolean {
  const rowA = Math.floor(a / size);
  const rowB = Math.floor(b / size);
  return (
    (rowA === rowB && Math.abs(a - b) === 1) ||
    (a % size === b % size && Math.abs(rowA - rowB) === 1)
  );
}

/**
 * Whether the *verifier* accepts a cell as the next action: the run is live and
 * under the bound, and the cell either starts the path on the solution's first
 * cell, steps back onto an earlier cell of the path (cutting it there), or
 * extends the path to a neighbour of its head that is not on it yet — unless the
 * head is already the solution's last cell.
 */
export function canTap(run: ZipRun, cell: number): boolean {
  if (run.outcome !== "playing") return false;
  if (run.taps.length >= ZIP_MAX_ACTIONS) return false;
  const size = boardSize(run.level);
  if (!Number.isInteger(cell) || cell < 0 || cell >= size * size) return false;
  const path = run.path;
  if (path.length === 0) return cell === solution(run.seed, run.level)[0];
  const at = path.indexOf(cell);
  if (at >= 0) return at < path.length - 1;
  const head = path[path.length - 1];
  const route = solution(run.seed, run.level);
  if (head === route[route.length - 1]) return false;
  return adjacent(head, cell, size);
}

/**
 * Applies one action under the verifier's rules and returns the resulting run.
 *
 * A path that covers the board and is the solution solves it: ten points a row,
 * and the next board starts with no path. An action the verifier would refuse
 * returns the same run object.
 */
export function tap(run: ZipRun, cell: number): ZipRun {
  if (!canTap(run, cell)) return run;
  const taps = [...run.taps, cell];
  const atBound = taps.length >= ZIP_MAX_ACTIONS;
  const at = run.path.indexOf(cell);
  const path = at >= 0 ? run.path.slice(0, at + 1) : [...run.path, cell];
  const size = boardSize(run.level);

  if (path.length === size * size) {
    const route = solution(run.seed, run.level);
    if (path.every((value, index) => value === route[index])) {
      return {
        ...run,
        taps,
        level: run.level + 1,
        path: [],
        levelsCleared: run.levelsCleared + 1,
        score: run.score + POINTS_PER_ROW * size,
        outcome: atBound ? "over" : "playing",
        ending: atBound ? "bound" : null,
      };
    }
  }
  return {
    ...run,
    taps,
    path,
    outcome: atBound ? "over" : "playing",
    ending: atBound ? "bound" : null,
  };
}

/**
 * Whether the *board* allows a cell as the next action: everything `canTap`
 * requires, plus the board's own rules — no step through a wall, and no number
 * reached before the one it follows.
 */
export function canMove(run: ZipRun, drawn: ZipBoard, cell: number): boolean {
  if (!canTap(run, cell)) return false;
  const path = run.path;
  if (path.length === 0 || path.includes(cell)) return true;
  const head = path[path.length - 1];
  if (drawn.walls.some(([a, b]) => wallKey(a, b) === wallKey(head, cell))) return false;
  const number = drawn.numbers[cell];
  if (number === 0) return true;
  const reached = Math.max(0, ...path.map((value) => drawn.numbers[value]));
  return number === reached + 1;
}

/** A move on the board: applied only if the board's rules allow it. */
export function move(run: ZipRun, drawn: ZipBoard, cell: number): ZipRun {
  return canMove(run, drawn, cell) ? tap(run, cell) : run;
}

/** Ends the run where it stands: the clock ran out, or the player stopped. */
export function finish(run: ZipRun, ending: "time" | "stopped"): ZipRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending };
}

export type ZipSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  readonly tapsPlaced: number;
  readonly levelsCleared: number;
};

export function submission(run: ZipRun): ZipSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.taps,
    score: run.score,
    tapsPlaced: run.taps.length,
    levelsCleared: run.levelsCleared,
  };
}
