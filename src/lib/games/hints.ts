/**
 * Hints: a move that helps, for a player who has been stuck a while.
 *
 * Each function reads a run and returns where to look, computed from the same
 * rules the run plays by. A hint never changes a run and is never submitted —
 * the player still makes the move, and the server verifies it like any other —
 * so a hint cannot score anything by itself.
 *
 * Only games with a right move to point at have one: Stack 10, Color Merge,
 * One Move, Queens, Zip, 8 Puzzle and Tango. Chain and Memory Flash test memory, and
 * Don't Touch the Black and 7 Second are against the clock, so a hint would be
 * the answer rather than help.
 */
import {
  COLOR_MERGE_DIRECTIONS,
  canSlide,
  slideGain,
  type ColorMergeDirection,
  type ColorMergeRun,
} from "@/lib/games/color-merge";
import { canTap as canSlideTile, fewestMoves, type EightPuzzleRun } from "@/lib/games/eight-puzzle";
import { boardSize as oneMoveSize, winningCell, type OneMoveRun } from "@/lib/games/one-move";
import {
  boardSize as queensSize,
  solution as queensSolution,
  type QueensRun,
} from "@/lib/games/queens";
import { canPlace, tileAt, type Stack10Run } from "@/lib/games/stack10";
import {
  EMPTY as TANGO_EMPTY,
  solution as tangoSolution,
  startCells as tangoStart,
  type TangoRun,
  type TangoValue,
} from "@/lib/games/tango";
import { solution as zipSolution, type ZipRun } from "@/lib/games/zip";

/** How long a player goes without a right move before a hint is offered. */
export const HINT_IDLE_MS = 10_000;
/** How long after one hint the next can be asked for. */
export const HINT_COOLDOWN_MS = 5_000;

const CLEAR_TOTAL = 10;

/**
 * Stack 10: the column for the next tile. One it clears is best — the one
 * holding the most tiles, since that scores most; otherwise the column it fills
 * closest to ten without passing it. Null when every column would overflow.
 */
export function stack10Hint(run: Stack10Run): number | null {
  if (run.outcome !== "playing") return null;
  const tile = run.nextTile ?? tileAt(run.seed, run.actions.length);
  let best: { column: number; clears: boolean; tiles: number; total: number } | null = null;
  for (let index = 0; index < run.columns.length; index += 1) {
    if (!canPlace(run, index)) continue;
    const column = run.columns[index];
    const total = column.sum + tile;
    if (total > CLEAR_TOTAL) continue;
    const candidate = {
      column: index,
      clears: total === CLEAR_TOTAL,
      tiles: column.tiles.length,
      total,
    };
    if (
      best === null ||
      (candidate.clears && !best.clears) ||
      (candidate.clears === best.clears &&
        (candidate.clears ? candidate.tiles > best.tiles : candidate.total > best.total))
    ) {
      best = candidate;
    }
  }
  return best?.column ?? null;
}

/** Color Merge: the slide that merges the most, or any slide that moves the board. */
export function colorMergeHint(run: ColorMergeRun): ColorMergeDirection | null {
  let best: { direction: ColorMergeDirection; gain: number } | null = null;
  for (const direction of COLOR_MERGE_DIRECTIONS) {
    if (!canSlide(run, direction)) continue;
    const gain = slideGain(run.board, direction);
    if (best === null || gain > best.gain) best = { direction, gain };
  }
  return best?.direction ?? null;
}

/**
 * One Move: where the winning cell is, a step at a time. The first hint on a
 * board narrows it to a row; the next one points at the cell. Giving the cell
 * away at once would be the answer, not a hint.
 */
export function oneMoveHint(
  run: OneMoveRun,
  hintsOnBoard: number,
): { kind: "row"; row: number; size: number } | { kind: "cell"; cell: number } | null {
  if (run.outcome !== "playing") return null;
  const cell = winningCell(run.seed, run.level);
  const size = oneMoveSize(run.level);
  return hintsOnBoard === 0
    ? { kind: "row", row: Math.floor(cell / size), size }
    : { kind: "cell", cell };
}

/** Queens: the cell of the next Queen not yet placed, in row order. */
export function queensHint(run: QueensRun): number | null {
  if (run.outcome !== "playing") return null;
  const size = queensSize(run.level);
  const answer = queensSolution(run.seed, run.level);
  for (let row = 0; row < size; row += 1) {
    const cell = row * size + answer[row];
    if (run.cells[cell] !== "queen") return cell;
  }
  return null;
}

/** How many queens are on the board: a placed Queen is the right move Queens counts. */
export function queensPlaced(run: QueensRun): number {
  return run.cells.filter((state) => state === "queen").length;
}

/**
 * Zip: the next cell of the path. While the path still follows the solution
 * that is the cell after its head; once it has strayed, it is the last cell it
 * got right, which cuts the path back there.
 */
export function zipHint(run: ZipRun): { cell: number; back: boolean } | null {
  if (run.outcome !== "playing") return null;
  const route = zipSolution(run.seed, run.level);
  const agreed = zipAgreement(run);
  if (agreed === run.path.length) {
    return agreed < route.length ? { cell: route[agreed], back: false } : null;
  }
  return { cell: route[agreed - 1], back: true };
}

/** How many cells of the path agree with the solution, from its start. */
export function zipAgreement(run: ZipRun): number {
  const route = zipSolution(run.seed, run.level);
  let agreed = 0;
  while (agreed < run.path.length && run.path[agreed] === route[agreed]) agreed += 1;
  return agreed;
}

/** 8 Puzzle: the tile whose slide is on a shortest way to solved. */
export function eightPuzzleHint(run: EightPuzzleRun): number | null {
  if (run.outcome !== "playing") return null;
  const gap = run.tiles.indexOf(0);
  let best: { cell: number; left: number } | null = null;
  for (let cell = 0; cell < run.tiles.length; cell += 1) {
    if (!canSlideTile(run, cell)) continue;
    const tiles = [...run.tiles];
    tiles[gap] = tiles[cell];
    tiles[cell] = 0;
    const left = fewestMoves(tiles);
    if (left < 0) continue;
    if (best === null || left < best.left) best = { cell, left };
  }
  return best?.cell ?? null;
}

/**
 * Tango: a cell and the symbol it takes. A symbol already placed wrong comes
 * first — it is what stands between the player and the solution — and otherwise
 * the first empty cell, in board order.
 */
export function tangoHint(run: TangoRun): { cell: number; value: TangoValue; fix: boolean } | null {
  if (run.outcome !== "playing") return null;
  const answer = tangoSolution(run.seed, run.level);
  const wrong = run.cells.findIndex(
    (value, cell) => value !== TANGO_EMPTY && value !== answer[cell],
  );
  if (wrong >= 0) return { cell: wrong, value: answer[wrong], fix: true };
  const empty = run.cells.findIndex((value) => value === TANGO_EMPTY);
  return empty >= 0 ? { cell: empty, value: answer[empty], fix: false } : null;
}

/** How many of the cells the player fills are right: a right move raises it. */
export function tangoRight(run: TangoRun): number {
  const answer = tangoSolution(run.seed, run.level);
  const start = tangoStart(run.seed, run.level);
  return run.cells.filter((value, cell) => start[cell] === TANGO_EMPTY && value === answer[cell])
    .length;
}
