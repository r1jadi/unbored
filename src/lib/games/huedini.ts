/**
 * Huedini — the game, as a pure deterministic state machine.
 *
 * A grid of coloured blocks, a few walls, and coloured gates in the board's
 * edge. Drag a block and it slides until a wall, another block or the edge stops
 * it; at the edge it slips out through a gate of its own colour, if the gate
 * covers its whole width. Blocks get in each other's way, so a board is a puzzle
 * about order: which block to move aside, and where, before the others can leave.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_huedini_run` in
 * `supabase/migrations/20261129120000_huedini_sessions.sql` replays the submitted
 * actions from the session's seed and derives the score itself. The copy is pinned
 * like every other game's: the rules version (`huedini@1`) is data, the state
 * machine is total and pure, and the boards in `huedini.test.ts` are the ones the
 * verifier must reproduce. See `docs/games/README.md`.
 *
 * ## The boards
 *
 * Boards come from a bank (`huedini-bank.ts`, made by
 * `scripts/generate-huedini-bank.mjs`) of boards a solver has proved clearable,
 * in four tiers that need more and more set-up moves. A level draws a board from
 * its tier and relabels the colours, so the same layout reads differently.
 *
 * ## The endless game, against the clock
 *
 * Like Decant, a run is a series of boards against one clock the server times:
 * seventy-five seconds to start, and every cleared board adds the next board's
 * allowance — more for the harder tiers, and tapered as the run goes
 * (`clock.ts`). A cleared board scores one unit (ten points) per block. Undo and
 * restart are actions too, so the server replays them.
 */

import { taperedBonusMs } from "@/lib/games/clock";
import { HUEDINI_BANK, HUEDINI_PER_TIER } from "@/lib/games/huedini-bank";

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const HUEDINI_RUNTIME = "huedini";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const HUEDINI_RULES_VERSION = "huedini@1";

/** The most actions one submission may carry: a request ceiling, not a last board. */
export const HUEDINI_MAX_ACTIONS = 8192;

/** The colours a board can use. */
export const HUEDINI_COLOURS = 6;

/** The clock a run starts with. */
export const HUEDINI_START_MS = 75_000;
/** The time a board of each tier is given: what clearing the board before it adds, before the taper. */
export const HUEDINI_ALLOWANCE_MS = [30_000, 40_000, 50_000, 60_000] as const;
/** How late after its clock ran out the server still accepts a run. */
export const HUEDINI_SLACK_MS = 20_000;

/** Actions: a move is `anchor × 4 + direction`; these two are the board's own controls. */
export const HUEDINI_UNDO = 254;
export const HUEDINI_RESTART = 255;

const SEED_MODULUS = 4294967296n;
const ZERO_STATE_FALLBACK = 2654435769;
const OUTER_MULTIPLIER = 1664525;
const OUTER_INCREMENT = 1013904223;
const INNER_MULTIPLIER = 22695477;
const INNER_INCREMENT = 1;

/** A direction: 0 up, 1 right, 2 down, 3 left. Also an edge: 0 top, 1 right, 2 bottom, 3 left. */
export type Direction = 0 | 1 | 2 | 3;

/** A block: its top-left cell, its size and its colour (1–6). `id` stays with it as it moves. */
export type HuediniBlock = {
  readonly id: number;
  readonly r: number;
  readonly c: number;
  readonly h: number;
  readonly w: number;
  readonly colour: number;
};

/** A gate: two cells of one edge, from `start`, in one colour. */
export type HuediniGate = {
  readonly edge: Direction;
  readonly start: number;
  readonly colour: number;
};

export type HuediniBoard = {
  readonly side: number;
  /** Wall cells, row-major indices. */
  readonly walls: readonly number[];
  readonly gates: readonly HuediniGate[];
  /** The blocks still on the board. */
  readonly blocks: readonly HuediniBlock[];
};

export type HuediniEnding = "time" | "stopped" | "bound";
export type HuediniOutcome = "playing" | "over";

/** One run, as this module knows it. */
export type HuediniRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /** Every action, in order. This *is* the submission. */
  readonly actions: readonly number[];
  /** The board being played, 1-based. */
  readonly level: number;
  readonly board: HuediniBoard;
  /** The blocks the board was dealt: what a cleared board scores, and what restart restores. */
  readonly dealt: number;
  /** The current board's earlier states, for undo. Not part of the submission. */
  readonly history: readonly HuediniBoard[];
  /** Moves made on the current board (undo takes one back). */
  readonly moves: number;
  /** Blocks out over the whole run, counting the current board. */
  readonly exits: number;
  readonly levelsCleared: number;
  readonly score: number;
  readonly outcome: HuediniOutcome;
  readonly ending: HuediniEnding | null;
};

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new TypeError("a Huedini seed must be a whole number");
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Huedini seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

function initialState(seed: string | number | bigint): number {
  const reduced = Number(((toBigInt(seed) % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS);
  return reduced === 0 ? ZERO_STATE_FALLBACK : reduced;
}

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError("a Huedini level is a whole number from 1");
  }
}

/** The bank tier a level draws from, by index: boards 1–2, 3–5, 6–9, then the rest. */
export function tierIndex(level: number): number {
  assertLevel(level);
  return level <= 2 ? 0 : level <= 5 ? 1 : level <= 9 ? 2 : 3;
}

/** The time the board at `level` is given, before the taper. */
export function allowanceMs(level: number): number {
  return HUEDINI_ALLOWANCE_MS[tierIndex(level)]!;
}

/**
 * The clock a run has earned once `levelsCleared` boards are cleared, in ms:
 * seventy-five seconds, plus the allowance of the board after each one cleared,
 * shrunk by the taper (`clock.ts`) for the board just cleared.
 */
export function budgetMs(levelsCleared: number): number {
  let total = HUEDINI_START_MS;
  for (let level = 1; level <= levelsCleared; level += 1) {
    total += taperedBonusMs(allowanceMs(level + 1), level);
  }
  return total;
}

/** A bank entry, decoded. See `scripts/generate-huedini-bank.mjs` for the format. */
export function decode(code: string): HuediniBoard {
  const [sideText, cells, colours, gateText] = code.split("|") as [string, string, string, string];
  const side = Number(sideText);
  const walls: number[] = [];
  const blocks: HuediniBlock[] = [];
  for (let cell = 0; cell < cells.length; cell += 1) {
    const char = cells[cell]!;
    if (char === "#") walls.push(cell);
    if (char < "a" || char > "z") continue;
    const id = char.charCodeAt(0) - 97;
    if (blocks[id]) continue;
    // The first cell of a letter in reading order is its top-left.
    let w = 1;
    while ((cell % side) + w < side && cells[cell + w] === char) w += 1;
    let h = 1;
    while (cell + h * side < cells.length && cells[cell + h * side] === char) h += 1;
    blocks[id] = {
      id,
      r: Math.floor(cell / side),
      c: cell % side,
      h,
      w,
      colour: Number(colours[id]),
    };
  }
  const gates: HuediniGate[] = [];
  for (let i = 0; i + 2 < gateText.length; i += 3) {
    gates.push({
      edge: Number(gateText[i]) as Direction,
      start: Number(gateText[i + 1]),
      colour: Number(gateText[i + 2]),
    });
  }
  return { side, walls, gates, blocks };
}

/**
 * The board a level is dealt.
 *
 * Draws come from One Move's outer LCG advanced once per level and a second LCG
 * started at that state, as Decant draws its boards; a draw is the state's top
 * sixteen bits. The first draw picks the entry within the level's tier; then the
 * colours 1–6 are shuffled by a Fisher–Yates pass from the last down, each swap
 * partner the next draw modulo the colours left, and colour `k` of the entry
 * becomes the shuffle's `k`th.
 */
export function board(seed: string | number | bigint, level: number): HuediniBoard {
  assertLevel(level);
  let state = initialState(seed);
  for (let current = 1; current <= level; current += 1) {
    state = (Math.imul(state, OUTER_MULTIPLIER) + OUTER_INCREMENT) >>> 0;
  }
  const next = () => {
    state = (Math.imul(state, INNER_MULTIPLIER) + INNER_INCREMENT) >>> 0;
    return state >>> 16;
  };
  const entry = HUEDINI_BANK[tierIndex(level) * HUEDINI_PER_TIER + (next() % HUEDINI_PER_TIER)]!;
  const palette = Array.from({ length: HUEDINI_COLOURS }, (_, i) => i + 1);
  for (let i = palette.length - 1; i > 0; i -= 1) {
    const j = next() % (i + 1);
    [palette[i], palette[j]] = [palette[j]!, palette[i]!];
  }
  const decoded = decode(entry);
  const relabel = (colour: number) => palette[colour - 1]!;
  return {
    ...decoded,
    blocks: decoded.blocks.map((block) => ({ ...block, colour: relabel(block.colour) })),
    gates: decoded.gates.map((gate) => ({ ...gate, colour: relabel(gate.colour) })),
  };
}

const STEPS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
];

/** Where a slide ends: the block's new top-left and how far it went, or that it left. */
export type SlideResult =
  | { readonly kind: "stop"; readonly r: number; readonly c: number; readonly distance: number }
  | { readonly kind: "exit"; readonly distance: number; readonly gate: HuediniGate };

/**
 * Slides `block` `dir` on `board`: cell by cell until the next step would hit a
 * wall, another block or the edge. At the edge it leaves if a gate of its colour
 * on that edge covers its whole width. `null` when it cannot move at all.
 */
export function slide(
  board: HuediniBoard,
  block: HuediniBlock,
  dir: Direction,
): SlideResult | null {
  const { side } = board;
  const taken = new Set(board.walls);
  for (const other of board.blocks) {
    if (other.id === block.id) continue;
    for (let y = 0; y < other.h; y += 1)
      for (let x = 0; x < other.w; x += 1) taken.add((other.r + y) * side + other.c + x);
  }
  const [dr, dc] = STEPS[dir]!;
  let { r, c } = block;
  let distance = 0;
  for (;;) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nc < 0 || nr + block.h > side || nc + block.w > side) {
      const lo = dir === 0 || dir === 2 ? c : r;
      const hi = lo + (dir === 0 || dir === 2 ? block.w : block.h) - 1;
      const gate = board.gates.find(
        (g) => g.edge === dir && g.colour === block.colour && g.start <= lo && hi <= g.start + 1,
      );
      if (gate) return { kind: "exit", distance, gate };
      break;
    }
    let free = true;
    for (let y = 0; y < block.h && free; y += 1)
      for (let x = 0; x < block.w && free; x += 1)
        if (taken.has((nr + y) * side + nc + x)) free = false;
    if (!free) break;
    r = nr;
    c = nc;
    distance += 1;
  }
  return distance > 0 ? { kind: "stop", r, c, distance } : null;
}

/** The block whose top-left cell is `cell`, if any. */
export function blockAt(board: HuediniBoard, cell: number): HuediniBlock | undefined {
  return board.blocks.find((block) => block.r * board.side + block.c === cell);
}

/** A move's action number: the block's top-left cell × 4 + the direction. */
export function encodeMove(board: HuediniBoard, block: HuediniBlock, dir: Direction): number {
  return (block.r * board.side + block.c) * 4 + dir;
}

/** The board after a slide. Assumes the slide is possible. */
function moved(board: HuediniBoard, block: HuediniBlock, result: SlideResult): HuediniBoard {
  return {
    ...board,
    blocks:
      result.kind === "exit"
        ? board.blocks.filter((other) => other.id !== block.id)
        : board.blocks.map((other) =>
            other.id === block.id ? { ...other, r: result.r, c: result.c } : other,
          ),
  };
}

/** A fresh run on board one. */
export function createRun(seed: string | number | bigint): HuediniRun {
  const normalised = toBigInt(seed).toString();
  const first = board(normalised, 1);
  return {
    seed: normalised,
    rulesVersion: HUEDINI_RULES_VERSION,
    actions: [],
    level: 1,
    board: first,
    dealt: first.blocks.length,
    history: [],
    moves: 0,
    exits: 0,
    levelsCleared: 0,
    score: 0,
    outcome: "playing",
    ending: null,
  };
}

function withAction(run: HuediniRun, action: number, changes: Partial<HuediniRun>): HuediniRun {
  const actions = [...run.actions, action];
  const atBound = actions.length >= HUEDINI_MAX_ACTIONS;
  return {
    ...run,
    ...changes,
    actions,
    outcome: atBound ? "over" : "playing",
    ending: atBound ? "bound" : null,
  };
}

/** Whether `block` can be moved `dir` now. */
export function canMove(run: HuediniRun, block: HuediniBlock, dir: Direction): boolean {
  return run.outcome === "playing" && slide(run.board, block, dir) !== null;
}

/**
 * Slides `block` `dir`. A slide that empties the board scores one unit per block
 * it was dealt and deals the next board. A move that is not possible returns the
 * same run object.
 */
export function move(run: HuediniRun, block: HuediniBlock, dir: Direction): HuediniRun {
  if (run.outcome !== "playing") return run;
  const current = run.board.blocks.find((other) => other.id === block.id);
  if (!current) return run;
  const result = slide(run.board, current, dir);
  if (!result) return run;
  const action = encodeMove(run.board, current, dir);
  const after = moved(run.board, current, result);
  const exits = run.exits + (result.kind === "exit" ? 1 : 0);
  if (after.blocks.length === 0) {
    const level = run.level + 1;
    const next = board(run.seed, level);
    return withAction(run, action, {
      level,
      board: next,
      dealt: next.blocks.length,
      history: [],
      moves: 0,
      exits,
      levelsCleared: run.levelsCleared + 1,
      score: run.score + run.dealt,
    });
  }
  return withAction(run, action, {
    board: after,
    history: [...run.history, run.board],
    moves: run.moves + 1,
    exits,
  });
}

/** Takes back the last move on this board. Nothing to take back returns the same run. */
export function undo(run: HuediniRun): HuediniRun {
  if (run.outcome !== "playing" || run.history.length === 0) return run;
  const previous = run.history[run.history.length - 1]!;
  return withAction(run, HUEDINI_UNDO, {
    board: previous,
    history: run.history.slice(0, -1),
    moves: run.moves - 1,
    exits: run.exits - (previous.blocks.length - run.board.blocks.length),
  });
}

/** Puts this board back as it was dealt. On a board with nothing moved it does nothing. */
export function restart(run: HuediniRun): HuediniRun {
  if (run.outcome !== "playing" || run.moves === 0) return run;
  const dealt = board(run.seed, run.level);
  return withAction(run, HUEDINI_RESTART, {
    board: dealt,
    history: [],
    moves: 0,
    exits: run.exits - (dealt.blocks.length - run.board.blocks.length),
  });
}

/** Applies one submitted action: how a run is replayed. */
export function apply(run: HuediniRun, action: number): HuediniRun {
  if (action === HUEDINI_UNDO) return undo(run);
  if (action === HUEDINI_RESTART) return restart(run);
  const block = blockAt(run.board, Math.floor(action / 4));
  if (!block) return run;
  return move(run, block, (action % 4) as Direction);
}

/** Replays a list of actions from a seed. */
export function replay(seed: string | number | bigint, actions: readonly number[]): HuediniRun {
  return actions.reduce(apply, createRun(seed));
}

/** Ends the run where it stands: the clock ran out, or the player stopped. */
export function finish(run: HuediniRun, ending: "time" | "stopped"): HuediniRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending };
}

export type HuediniSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: HuediniRun): HuediniSubmission {
  return { rulesVersion: run.rulesVersion, actions: run.actions, score: run.score };
}

/**
 * A lower bound on the moves a board still needs: one for every block to leave,
 * and one more for a block not lined up with any gate of its colour. A move
 * changes it by at most one, so it keeps `solve` exact.
 */
export function movesLeftAtLeast(board: HuediniBoard): number {
  let total = 0;
  for (const block of board.blocks) {
    const lined = board.gates.some((gate) => {
      if (gate.colour !== block.colour) return false;
      const lo = gate.edge === 0 || gate.edge === 2 ? block.c : block.r;
      const hi = lo + (gate.edge === 0 || gate.edge === 2 ? block.w : block.h) - 1;
      return gate.start <= lo && hi <= gate.start + 1;
    });
    total += lined ? 1 : 2;
  }
  return total;
}

/**
 * A shortest solution for a board, as `[block id, direction]` moves, or null
 * when there is none (or the search gives up). A* on `movesLeftAtLeast`, as the
 * bank's generator grades its boards; the tests use it to prove every bank
 * board clearable in the moves the bank says.
 */
export function solve(start: HuediniBoard, limit = 400_000): [number, Direction][] | null {
  const key = (b: HuediniBoard) =>
    b.blocks
      .map((block) => `${block.id}:${block.r},${block.c}`)
      .sort()
      .join(";");
  type Entry = { board: HuediniBoard; g: number; path: [number, Direction][] };
  const best = new Map<string, number>([[key(start), 0]]);
  const buckets: Entry[][] = [];
  const push = (entry: Entry) => {
    const f = entry.g + movesLeftAtLeast(entry.board);
    (buckets[f] ??= []).push(entry);
  };
  push({ board: start, g: 0, path: [] });
  for (let f = 0; f < buckets.length; f += 1) {
    const bucket = buckets[f];
    while (bucket?.length) {
      const entry = bucket.pop()!;
      if ((best.get(key(entry.board)) ?? Infinity) < entry.g) continue;
      if (entry.board.blocks.length === 0) return entry.path;
      for (const block of entry.board.blocks) {
        for (const dir of [0, 1, 2, 3] as const) {
          const result = slide(entry.board, block, dir);
          if (!result) continue;
          const after = moved(entry.board, block, result);
          const k = key(after);
          const known = best.get(k);
          if (known !== undefined && known <= entry.g + 1) continue;
          best.set(k, entry.g + 1);
          if (best.size > limit) return null;
          push({ board: after, g: entry.g + 1, path: [...entry.path, [block.id, dir]] });
        }
      }
    }
  }
  return null;
}
