/**
 * Hints for Mini Sudoku: a cell, what to do with it, and why.
 *
 * Kept apart from `hints.ts` because the board is small enough to explain in
 * full. A hint is advice only: it never touches the run, and the score is what
 * the server derives from the moves.
 */
import {
  board,
  candidates,
  canFinish,
  conflicts,
  EMPTY,
  unitsOf,
  units,
  type MiniSudokuDigit,
  type MiniSudokuRun,
} from "@/lib/games/mini-sudoku";

import { t } from "@/lib/settings/language";
export type MiniSudokuHint = {
  readonly cell: number;
  /** `place`: put `digit` here. `clear`: the digit here has to go. */
  readonly action: "place" | "clear";
  /** The digit to place, or the one to clear. */
  readonly digit: MiniSudokuDigit;
  readonly reason: string;
};

const DIGITS = [1, 2, 3, 4, 5, 6] as const;

/**
 * In order:
 *
 *   1. a digit that repeats in its row, column or box comes out;
 *   2. a digit the rest of the board can't be finished around comes out (the
 *      solver checks);
 *   3. a digit with only one place left in a box, row or column goes there;
 *   4. a cell with only one digit left that fits takes it;
 *   5. otherwise the cell with the fewest options, and the digit the solver can
 *      finish the board with.
 */
export function miniSudokuHint(run: MiniSudokuRun): MiniSudokuHint | null {
  if (run.outcome !== "playing") return null;
  const { solution, start } = board(run.seed, run.level);
  const cells = run.cells;
  const player = (cell: number) => start[cell] === EMPTY && cells[cell] !== EMPTY;

  // 1. A repeat.
  const clashing = [...conflicts(cells)].filter(player).sort((a, b) => a - b);
  const repeat = clashing.find((cell) => cells[cell] !== solution[cell]) ?? clashing[0];
  if (repeat !== undefined) {
    const digit = cells[repeat];
    const around = unitsOf(repeat);
    const same = (unit: readonly number[]) =>
      unit.some((other) => other !== repeat && cells[other] === digit);
    const where = same(around.row)
      ? t("row {n}", { n: Math.floor(repeat / 6) + 1 })
      : same(around.column)
        ? t("column {n}", { n: (repeat % 6) + 1 })
        : t("its box");
    return {
      cell: repeat,
      action: "clear",
      digit,
      reason: `This ${digit} can't stay: there's already a ${digit} in ${where}.`,
    };
  }

  // 2. A digit that can't be finished around.
  if (!canFinish(cells)) {
    const filled = cells.map((_, cell) => cell).filter(player);
    const culprit = filled.find((cell) => {
      const without = [...cells];
      without[cell] = EMPTY;
      return canFinish(without);
    });
    const chosen = culprit ?? filled.find((cell) => cells[cell] !== solution[cell]) ?? filled[0];
    if (chosen !== undefined) {
      return {
        cell: chosen,
        action: "clear",
        digit: cells[chosen],
        reason: t("With a {n} here, the rest of the board can't be finished. Clear it.", {
          n: cells[chosen],
        }),
      };
    }
  }

  const options = cells.map((value, cell) => (value === EMPTY ? candidates(cells, cell) : []));

  // 3. The only place for a digit in a box, then a row, then a column.
  const all = units();
  for (const kind of ["box", "row", "column"] as const) {
    for (let index = 0; index < 6; index += 1) {
      const unit = all[index * 3 + (kind === "row" ? 0 : kind === "column" ? 1 : 2)];
      for (const digit of DIGITS) {
        if (unit.some((cell) => cells[cell] === digit)) continue;
        const spots = unit.filter((cell) => options[cell].includes(digit));
        if (spots.length !== 1) continue;
        const name =
          kind === "box"
            ? t("its box")
            : kind === "row"
              ? t("row {n}", { n: index + 1 })
              : t("column {n}", { n: index + 1 });
        return {
          cell: spots[0],
          action: "place",
          digit,
          reason: t("This is the only place in {name} where a {digit} fits.", { name, digit }),
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
      reason: t(
        "Only a {digit} fits here: its row, column and box already hold the other digits.",
        { digit },
      ),
    };
  }

  // 5. The fewest options, checked with the solver.
  let best = -1;
  for (let cell = 0; cell < cells.length; cell += 1) {
    if (cells[cell] !== EMPTY || options[cell].length === 0) continue;
    if (best < 0 || options[cell].length < options[best].length) best = cell;
  }
  if (best < 0) return null;
  const fits = options[best];
  const working = fits.filter((digit) => {
    const trial = [...cells];
    trial[best] = digit;
    return canFinish(trial);
  });
  const digit = working.includes(solution[best]) ? solution[best] : (working[0] ?? fits[0]);
  return {
    cell: best,
    action: "place",
    digit,
    reason:
      working.length === 1
        ? t("Of {n}, only a {digit} lets the board be finished.", { n: fits.join(", "), digit })
        : t("{n} all fit here; a {digit} works.", { n: fits.join(", "), digit }),
  };
}

/** How many cells the player filled without a clash: a right move raises it. */
export function miniSudokuRight(run: MiniSudokuRun): number {
  const { start } = board(run.seed, run.level);
  const clashes = conflicts(run.cells);
  return run.cells.filter(
    (digit, cell) => start[cell] === EMPTY && digit !== EMPTY && !clashes.has(cell),
  ).length;
}
