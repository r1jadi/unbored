/**
 * Hints: a move that helps, for a player who has been stuck a while — and why.
 *
 * Each function reads a run and returns where to look, computed from the same
 * rules the run plays by, together with a `reason`: the sentence the screen
 * shows, saying why that move is right. For the logic puzzles (Crowns, Sun &
 * Moon, Sudoku) the reason is a deduction from the board as it stands — the
 * rule that forces the move — and only when no simple rule applies does it fall
 * back to "anything else leads to a dead end", which the solver has checked.
 *
 * A hint never changes a run and is never submitted — the player still makes the
 * move, and the server verifies it like any other — so a hint cannot score
 * anything by itself.
 *
 * Only games with a right move to point at have one: Stack 10, Color Merge,
 * One Move, Crowns, Trail, 8 Puzzle, Sun & Moon and Sudoku. Trail's hint is the
 * next cell of the path and carries no reason: a path has no single rule that
 * forces its next step. Chain and Memory Flash test memory, and Don't Touch the
 * Black and 7 Second are against the clock, so a hint would be the answer rather
 * than help.
 */
import {
  COLOR_MERGE_DIRECTIONS,
  DOWN,
  LEFT,
  RIGHT,
  canSlide,
  slideGain,
  type ColorMergeDirection,
  type ColorMergeRun,
} from "@/lib/games/color-merge";
import { canTap as canSlideTile, fewestMoves, type EightPuzzleRun } from "@/lib/games/eight-puzzle";
import {
  boardPattern as oneMovePattern,
  boardSize as oneMoveSize,
  solvedCell as oneMoveSolvedCell,
  winningCell,
  type OneMoveRun,
} from "@/lib/games/one-move";
import { board as queensBoard, blockedCells, type QueensRun } from "@/lib/games/queens";
import { canPlace, tileAt, type Stack10Run } from "@/lib/games/stack10";
import {
  board as sudokuBoard,
  candidates as sudokuCandidates,
  canFinish as sudokuCanFinish,
  conflicts as sudokuConflicts,
  EMPTY as SUDOKU_EMPTY,
  units as sudokuUnits,
  unitsOf as sudokuUnitsOf,
  type SudokuDigit,
  type SudokuRun,
} from "@/lib/games/sudoku";
import {
  board as tangoBoard,
  conflicts as tangoConflicts,
  EMPTY as TANGO_EMPTY,
  MOON,
  SUN,
  TANGO_SIDE,
  solution as tangoSolution,
  startCells as tangoStart,
  type TangoRun,
  type TangoSign,
  type TangoValue,
} from "@/lib/games/tango";
import { solution as zipSolution, type ZipRun } from "@/lib/games/zip";

/** How long a player goes without a right move before a hint is offered. */
export const HINT_IDLE_MS = 10_000;
/** How long after one hint the next can be asked for. */
export const HINT_COOLDOWN_MS = 5_000;

const CLEAR_TOTAL = 10;

/** "3", "3 or 7", "3, 5 or 7". */
function either(items: readonly (string | number)[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** "1, 2 and 3". */
function all(items: readonly (string | number)[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function at(cell: number, side: number): string {
  return `row ${Math.floor(cell / side) + 1}, column ${(cell % side) + 1}`;
}

// ── Stack 10 ────────────────────────────────────────────────────────────────

/**
 * Stack 10: the column for the next tile. One it clears is best — the one
 * holding the most tiles, since that scores most; otherwise the column it fills
 * closest to ten without passing it. Null when every column would overflow.
 */
export function stack10Hint(run: Stack10Run): { column: number; reason: string } | null {
  if (run.outcome !== "playing") return null;
  const tile = run.nextTile ?? tileAt(run.seed, run.actions.length);
  let best: { column: number; clears: boolean; tiles: number; total: number } | null = null;
  let clearing = 0;
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
    if (candidate.clears) clearing += 1;
    if (
      best === null ||
      (candidate.clears && !best.clears) ||
      (candidate.clears === best.clears &&
        (candidate.clears ? candidate.tiles > best.tiles : candidate.total > best.total))
    ) {
      best = candidate;
    }
  }
  if (!best) return null;
  const name = `column ${best.column + 1}`;
  const reason = best.clears
    ? `The ${tile} makes ${name} exactly 10, which clears it${
        clearing > 1 ? ` — and it holds the most tiles of the columns that would clear` : ""
      }.`
    : `No column reaches exactly 10 with a ${tile}. ${
        name[0].toUpperCase() + name.slice(1)
      } gets closest, at ${best.total}, without going over.`;
  return { column: best.column, reason };
}

// ── Color Merge ─────────────────────────────────────────────────────────────

const DIRECTION_NAMES: Record<ColorMergeDirection, string> = {
  0: "up",
  [RIGHT]: "right",
  [DOWN]: "down",
  [LEFT]: "left",
};

/** Color Merge: the slide that merges the most, or any slide that moves the board. */
export function colorMergeHint(
  run: ColorMergeRun,
): { direction: ColorMergeDirection; reason: string } | null {
  let best: { direction: ColorMergeDirection; gain: number } | null = null;
  for (const direction of COLOR_MERGE_DIRECTIONS) {
    if (!canSlide(run, direction)) continue;
    const gain = slideGain(run.board, direction);
    if (best === null || gain > best.gain) best = { direction, gain };
  }
  if (!best) return null;
  const name = DIRECTION_NAMES[best.direction];
  return {
    direction: best.direction,
    reason:
      best.gain > 0
        ? `Sliding ${name} merges the most tiles of any slide: +${best.gain}.`
        : `No slide merges anything yet. Sliding ${name} moves the board so new pairs can line up.`,
  };
}

// ── One Move ────────────────────────────────────────────────────────────────

/**
 * One Move: where the winning cell is, a step at a time. The first hint on a
 * board narrows it to a row; the next one points at the cell. Giving the cell
 * away at once would be the answer, not a hint. The reason reads the board: the
 * cells out of the checkerboard are the cross the winning move flips back.
 */
export function oneMoveHint(
  run: OneMoveRun,
  hintsOnBoard: number,
):
  | { kind: "row"; row: number; size: number; reason: string }
  | { kind: "cell"; cell: number; reason: string }
  | null {
  if (run.outcome !== "playing") return null;
  const cell = winningCell(run.seed, run.level);
  const size = oneMoveSize(run.level);
  const pattern = oneMovePattern(run.seed, run.level);
  const row = Math.floor(cell / size);
  const offInRow = pattern.cells.filter(
    (dark, index) =>
      Math.floor(index / size) === row && dark !== oneMoveSolvedCell(run.level, index),
  ).length;
  return hintsOnBoard === 0
    ? {
        kind: "row",
        row,
        size,
        reason: `Row ${row + 1} has the most cells out of the checkerboard pattern (${offInRow}). A move flips a cell and its neighbours, so the middle of that cross is in this row.`,
      }
    : {
        kind: "cell",
        cell,
        reason: `The cells out of the checkerboard pattern are this one and its neighbours above, below, left and right — exactly the cross a tap here flips back.`,
      };
}

// ── Crowns ──────────────────────────────────────────────────────────────────

export type QueensHint = {
  readonly cell: number;
  /** `crown`: place one here. `mark`: this cell can't hold one — an X. */
  readonly kind: "crown" | "mark";
  readonly reason: string;
  /** The cells the reason is about — a row, column or region — to outline. */
  readonly focus: readonly number[];
};

/**
 * Crowns: a cell and what goes there, by the simplest rule that forces it. Cells
 * are "open" when no crown placed so far rules them out and they are not a red
 * X; the player's own X notes are not trusted. In order:
 *
 *   1. a row, column or region with one open cell left takes its crown there;
 *   2. a region whose open cells all sit in one row (or column) owns that row's
 *      crown, so the row's other open cells are X — and the same the other way
 *      round, a row whose open cells all sit in one region;
 *   3. a crown here would leave some row, column or region with no open cell,
 *      so it is an X;
 *   4. otherwise the next crown of the solution, which is the board's only one.
 */
export function queensHint(run: QueensRun): QueensHint | null {
  if (run.outcome !== "playing") return null;
  const { size, regions, solution } = queensBoard(run.seed, run.level);
  const cells = run.cells;
  const blocked = blockedCells(size, regions, cells);
  const open = (cell: number) =>
    cells[cell] !== "queen" && cells[cell] !== "ruled-out" && !blocked.has(cell);
  const rowOf = (cell: number) => Math.floor(cell / size);
  const columnOf = (cell: number) => cell % size;
  const everyCell = Array.from({ length: size * size }, (_, cell) => cell);

  type Unit = { name: string; own: string; cells: number[] };
  const units: Unit[] = [];
  for (let line = 0; line < size; line += 1) {
    units.push({
      name: `row ${line + 1}`,
      own: `row ${line + 1}`,
      cells: everyCell.filter((cell) => rowOf(cell) === line),
    });
  }
  for (let line = 0; line < size; line += 1) {
    units.push({
      name: `column ${line + 1}`,
      own: `column ${line + 1}`,
      cells: everyCell.filter((cell) => columnOf(cell) === line),
    });
  }
  for (let region = 0; region < size; region += 1) {
    units.push({
      name: "the outlined colour region",
      own: "its colour region",
      cells: everyCell.filter((cell) => regions[cell] === region),
    });
  }
  const crowned = (unit: Unit) => unit.cells.some((cell) => cells[cell] === "queen");
  const openIn = (unit: Unit) => unit.cells.filter(open);
  const unmarked = (cell: number) => cells[cell] !== "mark";

  // 1. One open cell left in a row, column or region.
  for (const unit of units) {
    if (crowned(unit)) continue;
    const left = openIn(unit);
    if (left.length !== 1) continue;
    const reason =
      unit.cells.length === 1
        ? "Its colour region is this one cell, so the crown goes here."
        : `It's the only cell left in ${unit.own} where a crown can go: every other one is ruled out by a crown or an X in red.`;
    return { cell: left[0], kind: "crown", reason, focus: unit.cells };
  }

  // 2. A region confined to one line, or a line confined to one region.
  const lineUnits = units.slice(0, 2 * size);
  const regionUnits = units.slice(2 * size);
  for (const region of regionUnits) {
    if (crowned(region)) continue;
    const roomy = openIn(region);
    if (roomy.length === 0) continue;
    for (const line of lineUnits) {
      if (crowned(line) || !roomy.every((cell) => line.cells.includes(cell))) continue;
      const target = openIn(line).find((cell) => !region.cells.includes(cell) && unmarked(cell));
      if (target === undefined) continue;
      return {
        cell: target,
        kind: "mark",
        reason: `The outlined colour region only has room in ${line.name}, so ${line.name}'s crown goes in that region — not here. Mark it with an X.`,
        focus: roomy,
      };
    }
  }
  for (const line of lineUnits) {
    if (crowned(line)) continue;
    const roomy = openIn(line);
    if (roomy.length === 0) continue;
    const region = regionUnits.find((unit) => roomy.every((cell) => unit.cells.includes(cell)));
    if (!region || crowned(region)) continue;
    const target = openIn(region).find((cell) => !line.cells.includes(cell) && unmarked(cell));
    if (target === undefined) continue;
    return {
      cell: target,
      kind: "mark",
      reason: `Every open cell in ${line.name} is in this cell's colour region, so that region's crown must be in ${line.name} — not here. Mark it with an X.`,
      focus: roomy,
    };
  }

  // 3. A crown here would leave a row, column or region with no room.
  for (const cell of everyCell) {
    if (!open(cell) || !unmarked(cell)) continue;
    const reach = (other: number) =>
      other === cell ||
      rowOf(other) === rowOf(cell) ||
      columnOf(other) === columnOf(cell) ||
      regions[other] === regions[cell] ||
      (Math.abs(rowOf(other) - rowOf(cell)) <= 1 &&
        Math.abs(columnOf(other) - columnOf(cell)) <= 1);
    for (const unit of units) {
      if (crowned(unit) || unit.cells.includes(cell)) continue;
      const roomy = openIn(unit);
      if (roomy.length === 0 || !roomy.every(reach)) continue;
      return {
        cell,
        kind: "mark",
        reason: `A crown here would leave no room for one in ${unit.name}. Mark it with an X.`,
        focus: roomy,
      };
    }
  }

  // 4. The next crown of the solution.
  for (let row = 0; row < size; row += 1) {
    const cell = row * size + solution[row];
    if (cells[cell] === "queen") continue;
    return {
      cell,
      kind: "crown",
      reason: `This is the only cell in row ${row + 1} that works: a crown anywhere else in that row leads to a dead end further on.`,
      focus: everyCell.filter((other) => rowOf(other) === row),
    };
  }
  return null;
}

/**
 * What Crowns counts as a right move for the hint's idle wait: crowns placed
 * and X notes made, so following an X hint clears it.
 */
export function queensPlaced(run: QueensRun): string {
  const crowns = run.cells.filter((state) => state === "queen").length;
  const marks = run.cells.filter((state) => state === "mark").length;
  return `${crowns}:${marks}`;
}

// ── Trail ───────────────────────────────────────────────────────────────────

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

// ── 8 Puzzle ────────────────────────────────────────────────────────────────

/** 8 Puzzle: the tile whose slide is on a shortest way to solved. */
export function eightPuzzleHint(run: EightPuzzleRun): { cell: number; reason: string } | null {
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
  if (!best) return null;
  const tile = run.tiles[best.cell];
  return {
    cell: best.cell,
    reason:
      best.left === 0
        ? `Sliding the ${tile} into the gap solves the board.`
        : `Sliding the ${tile} leaves ${best.left} ${
            best.left === 1 ? "slide" : "slides"
          } to solve the board — the fewest of any move from here.`,
  };
}

// ── Sun & Moon ──────────────────────────────────────────────────────────────

export type TangoHint = {
  readonly cell: number;
  readonly value: TangoValue;
  /** True when the cell holds the wrong symbol now. */
  readonly fix: boolean;
  readonly reason: string;
};

const symbol = (value: TangoValue) => (value === SUN ? "sun" : "moon");
const symbols = (value: TangoValue) => (value === SUN ? "suns" : "moons");
const other = (value: TangoValue): TangoValue => (value === SUN ? MOON : SUN);

/** The six cells of each row and column, named. */
const TANGO_LINES: readonly { name: string; cells: readonly number[] }[] = (() => {
  const lines: { name: string; cells: number[] }[] = [];
  for (let line = 0; line < TANGO_SIDE; line += 1) {
    lines.push({
      name: `row ${line + 1}`,
      cells: Array.from({ length: TANGO_SIDE }, (_, index) => line * TANGO_SIDE + index),
    });
    lines.push({
      name: `column ${line + 1}`,
      cells: Array.from({ length: TANGO_SIDE }, (_, index) => index * TANGO_SIDE + line),
    });
  }
  return lines;
})();

/** Which rule a cell breaks as the board stands, in words, or null. */
function tangoClash(
  cells: readonly TangoValue[],
  signs: readonly TangoSign[],
  cell: number,
): string | null {
  const value = cells[cell];
  if (value === TANGO_EMPTY) return null;
  for (const line of TANGO_LINES) {
    const index = line.cells.indexOf(cell);
    if (index < 0) continue;
    for (let start = Math.max(0, index - 2); start <= Math.min(index, TANGO_SIDE - 3); start += 1) {
      if ([0, 1, 2].every((step) => cells[line.cells[start + step]] === value)) {
        return `that makes three ${symbols(value)} in a row in ${line.name}`;
      }
    }
    const count = line.cells.filter((other) => cells[other] === value).length;
    if (count > TANGO_SIDE / 2) {
      return `${line.name} would have ${count} ${symbols(value)}, and only three fit`;
    }
  }
  for (const sign of signs) {
    if (sign.a !== cell && sign.b !== cell) continue;
    const x = cells[sign.a];
    const y = cells[sign.b];
    if (x && y && (x === y) !== sign.same) {
      return `the ${sign.same ? "=" : "×"} sign next to it says the two cells ${
        sign.same ? "match" : "differ"
      }`;
    }
  }
  return null;
}

/**
 * The first move a simple rule forces on the board, with the rule in words: a
 * sign next to a filled cell, two alike side by side, a gap between two alike,
 * or a line that already has its three of a symbol. Signs first: they are the
 * easiest to see.
 */
function tangoForced(
  cells: readonly TangoValue[],
  signs: readonly TangoSign[],
): { cell: number; value: TangoValue; reason: string } | null {
  for (const sign of signs) {
    for (const [here, there] of [
      [sign.a, sign.b],
      [sign.b, sign.a],
    ]) {
      if (cells[here] !== TANGO_EMPTY || cells[there] === TANGO_EMPTY) continue;
      const near = cells[there];
      return {
        cell: here,
        value: sign.same ? near : other(near),
        reason: `The ${sign.same ? "=" : "×"} sign between this cell and ${at(
          there,
          TANGO_SIDE,
        )} means they ${sign.same ? "match" : "differ"}, and that one is a ${symbol(near)}.`,
      };
    }
  }
  for (const line of TANGO_LINES) {
    for (let index = 0; index < TANGO_SIDE; index += 1) {
      const cell = line.cells[index];
      if (cells[cell] !== TANGO_EMPTY) continue;
      const look = (offset: number) => {
        const position = index + offset;
        return position >= 0 && position < TANGO_SIDE ? cells[line.cells[position]] : TANGO_EMPTY;
      };
      for (const [a, b] of [
        [1, 2],
        [-1, -2],
      ]) {
        if (look(a) !== TANGO_EMPTY && look(a) === look(b)) {
          return {
            cell,
            value: other(look(a)),
            reason: `Two ${symbols(look(a))} sit next to it in ${line.name}, and three in a row isn't allowed.`,
          };
        }
      }
      if (look(-1) !== TANGO_EMPTY && look(-1) === look(1)) {
        return {
          cell,
          value: other(look(-1)),
          reason: `It sits between two ${symbols(look(-1))} in ${line.name}, and three in a row isn't allowed.`,
        };
      }
    }
  }
  for (const line of TANGO_LINES) {
    for (const value of [SUN, MOON] as const) {
      const count = line.cells.filter((cell) => cells[cell] === value).length;
      const gap = line.cells.find((cell) => cells[cell] === TANGO_EMPTY);
      if (count === TANGO_SIDE / 2 && gap !== undefined) {
        const name = line.name[0].toUpperCase() + line.name.slice(1);
        return {
          cell: gap,
          value: other(value),
          reason: `${name} already has its three ${symbols(value)}, so the rest of it is ${symbols(other(value))}.`,
        };
      }
    }
  }
  return null;
}

/**
 * Whether putting `value` in `cell` lets the simple rules force a clash, and if
 * so, the clash in words. Each forced move is a true consequence, so a clash
 * proves the cell holds the other symbol.
 */
function tangoContradiction(
  cells: readonly TangoValue[],
  signs: readonly TangoSign[],
  cell: number,
  value: TangoValue,
): string | null {
  const trial = [...cells];
  trial[cell] = value;
  for (let step = 0; step <= trial.length; step += 1) {
    const clashing = [...tangoConflicts(trial, signs)];
    if (clashing.length > 0) {
      for (const at of clashing) {
        const words = tangoClash(trial, signs, at);
        if (words) return words;
      }
      return "a clash";
    }
    const next = tangoForced(trial, signs);
    if (!next) return null;
    trial[next.cell] = next.value;
  }
  return null;
}

/**
 * Sun & Moon: a cell and the symbol it takes, and why. A symbol already placed
 * wrong comes first — it is what stands between the player and the solution, and
 * with one solution per board a wrong symbol can never be finished. Then the
 * simplest rule that forces a cell (see `tangoForced`); then a cell where one
 * symbol makes the rules force a clash; and only then the solution's symbol at
 * the first empty cell, which is the only one the board can be finished with.
 */
export function tangoHint(run: TangoRun): TangoHint | null {
  if (run.outcome !== "playing") return null;
  const { signs } = tangoBoard(run.seed, run.level);
  const answer = tangoSolution(run.seed, run.level);
  const cells = run.cells;

  const wrong = cells
    .map((value, cell) => ({ value, cell }))
    .filter(({ value, cell }) => value !== TANGO_EMPTY && value !== answer[cell]);
  for (const { value, cell } of wrong) {
    const words = tangoClash(cells, signs, cell);
    if (words) {
      return {
        cell,
        value: answer[cell],
        fix: true,
        reason: `This ${symbol(value)} breaks a rule: ${words}. It should be a ${symbol(answer[cell])}.`,
      };
    }
  }
  if (wrong.length > 0) {
    const { value, cell } = wrong[0];
    return {
      cell,
      value: answer[cell],
      fix: true,
      reason: `With a ${symbol(value)} here the board can't be finished — it needs a ${symbol(answer[cell])}.`,
    };
  }

  const forced = tangoForced(cells, signs);
  if (forced) return { ...forced, fix: false };

  for (let cell = 0; cell < cells.length; cell += 1) {
    if (cells[cell] !== TANGO_EMPTY) continue;
    for (const value of [SUN, MOON] as const) {
      const words = tangoContradiction(cells, signs, cell, value);
      if (!words) continue;
      return {
        cell,
        value: other(value),
        fix: false,
        reason: `If this were a ${symbol(value)}, the rules would force a clash: ${words}. So it's a ${symbol(other(value))}.`,
      };
    }
  }

  const empty = cells.findIndex((value) => value === TANGO_EMPTY);
  if (empty < 0) return null;
  return {
    cell: empty,
    value: answer[empty],
    fix: false,
    reason: `Only a ${symbol(answer[empty])} here lets the board be finished: a ${symbol(
      other(answer[empty]),
    )} leads to a dead end a few steps on.`,
  };
}

/** How many of the cells the player fills are right: a right move raises it. */
export function tangoRight(run: TangoRun): number {
  const answer = tangoSolution(run.seed, run.level);
  const start = tangoStart(run.seed, run.level);
  return run.cells.filter((value, cell) => start[cell] === TANGO_EMPTY && value === answer[cell])
    .length;
}

// ── Sudoku ──────────────────────────────────────────────────────────────────

export type SudokuHint = {
  readonly cell: number;
  /** `place`: put `digit` here. `clear`: the digit here has to go. */
  readonly action: "place" | "clear";
  /** The digit to place, or the one to clear. */
  readonly digit: SudokuDigit;
  readonly reason: string;
};

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/**
 * Sudoku: a cell, what to do with it, and why. In order:
 *
 *   1. a digit that repeats in its row, column or box comes out;
 *   2. a digit the rest of the board can't be finished around comes out (the
 *      solver checks);
 *   3. a digit with only one place left in a box, row or column goes there;
 *   4. a cell with only one digit left that fits takes it;
 *   5. otherwise the cell with the fewest options, and the one the solver can
 *      finish the board with.
 */
export function sudokuHint(run: SudokuRun): SudokuHint | null {
  if (run.outcome !== "playing") return null;
  const { solution, start } = sudokuBoard(run.seed, run.level);
  const cells = run.cells;
  const player = (cell: number) => start[cell] === SUDOKU_EMPTY && cells[cell] !== SUDOKU_EMPTY;

  // 1. A repeat.
  const clashes = sudokuConflicts(cells);
  const clashing = [...clashes].filter(player).sort((a, b) => a - b);
  const repeat = clashing.find((cell) => cells[cell] !== solution[cell]) ?? clashing[0];
  if (repeat !== undefined) {
    const digit = cells[repeat];
    const units = sudokuUnitsOf(repeat);
    const same = (unit: readonly number[]) =>
      unit.some((other) => other !== repeat && cells[other] === digit);
    const where = same(units.row)
      ? `row ${Math.floor(repeat / 9) + 1}`
      : same(units.column)
        ? `column ${(repeat % 9) + 1}`
        : "its box";
    return {
      cell: repeat,
      action: "clear",
      digit,
      reason: `This ${digit} can't stay: there's already a ${digit} in ${where}.`,
    };
  }

  // 2. A digit that can't be finished around.
  if (!sudokuCanFinish(cells)) {
    const filled = cells.map((_, cell) => cell).filter(player);
    const culprit = filled.find((cell) => {
      const without = [...cells];
      without[cell] = SUDOKU_EMPTY;
      return sudokuCanFinish(without);
    });
    if (culprit !== undefined) {
      return {
        cell: culprit,
        action: "clear",
        digit: cells[culprit],
        reason: `With a ${cells[culprit]} here, the rest of the board can't be finished. Clear it.`,
      };
    }
    const first = filled.find((cell) => cells[cell] !== solution[cell]) ?? filled[0];
    if (first !== undefined) {
      return {
        cell: first,
        action: "clear",
        digit: cells[first],
        reason: `The board can't be finished as it stands. Start by clearing this ${cells[first]}.`,
      };
    }
  }

  const options = cells.map((value, cell) =>
    value === SUDOKU_EMPTY ? sudokuCandidates(cells, cell) : [],
  );

  // 3. The only place for a digit in a box, then a row, then a column.
  for (const kind of ["box", "row", "column"] as const) {
    for (let index = 0; index < 9; index += 1) {
      const unit = sudokuUnits()[index * 3 + (kind === "row" ? 0 : kind === "column" ? 1 : 2)];
      for (const digit of DIGITS) {
        if (unit.some((cell) => cells[cell] === digit)) continue;
        const spots = unit.filter((cell) => options[cell].includes(digit));
        if (spots.length !== 1) continue;
        const name =
          kind === "box" ? "its box" : kind === "row" ? `row ${index + 1}` : `column ${index + 1}`;
        const sees =
          kind === "box"
            ? "its row or column"
            : kind === "row"
              ? "its column or box"
              : "its row or box";
        return {
          cell: spots[0],
          action: "place",
          digit,
          reason: `This is the only place in ${name} where a ${digit} fits: every other empty cell there already sees a ${digit} in ${sees}.`,
        };
      }
    }
  }

  // 4. The only digit that fits a cell.
  const single = options.findIndex((fits) => fits.length === 1);
  if (single >= 0) {
    const digit = options[single][0];
    return {
      cell: single,
      action: "place",
      digit,
      reason: `Only a ${digit} fits here: its row, column and box already hold ${all(
        DIGITS.filter((other) => other !== digit),
      )}.`,
    };
  }

  // 5. The fewest options, checked with the solver.
  let best = -1;
  for (let cell = 0; cell < cells.length; cell += 1) {
    if (cells[cell] !== SUDOKU_EMPTY || options[cell].length === 0) continue;
    if (best < 0 || options[cell].length < options[best].length) best = cell;
  }
  if (best < 0) return null;
  const fits = options[best];
  const working = fits.filter((digit) => {
    const trial = [...cells];
    trial[best] = digit;
    return sudokuCanFinish(trial);
  });
  const digit = working.includes(solution[best]) ? solution[best] : (working[0] ?? fits[0]);
  const failing = fits.filter((other) => !working.includes(other));
  const reason =
    working.length === 1
      ? `Only ${either(fits)} fit here, and with ${
          failing.length === 1 ? `a ${failing[0]}` : either(failing)
        } the rest of the board can't be finished — so it's a ${digit}.`
      : `${either(fits)} all fit here, and more than one of them can finish the board. A ${digit} works.`;
  return { cell: best, action: "place", digit, reason };
}

/** How many cells the player filled without a clash: a right move raises it. */
export function sudokuRight(run: SudokuRun): number {
  const { start } = sudokuBoard(run.seed, run.level);
  const clashes = sudokuConflicts(run.cells);
  return run.cells.filter(
    (digit, cell) => start[cell] === SUDOKU_EMPTY && digit !== SUDOKU_EMPTY && !clashes.has(cell),
  ).length;
}
