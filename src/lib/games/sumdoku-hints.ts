/**
 * Hints for Sumdoku: a cell, what to do with it, and why.
 *
 * A hint is advice only: it never touches the run, and the score is what the
 * server derives from the moves. Every board has one solution, so a digit that is
 * not the solution's can never be finished around.
 */
import { t } from "@/lib/settings/language";
import {
  badCages,
  board,
  cageSum,
  candidates,
  conflicts,
  EMPTY,
  unitsOf,
  type SumdokuDigit,
  type SumdokuRun,
} from "@/lib/games/sumdoku";

export type SumdokuHint = {
  readonly cell: number;
  /** `place`: put `digit` here. `clear`: the digit here has to go. */
  readonly action: "place" | "clear";
  readonly digit: SumdokuDigit;
  readonly reason: string;
};

/**
 * In order:
 *
 *   1. a digit that repeats in its row, column, box or cage comes out;
 *   2. a digit in a cage that has gone wrong on its sum comes out;
 *   3. a digit off the solution comes out (the board can't be finished around it);
 *   4. a cage with one empty cell left takes the digit that makes its total;
 *   5. a cell with only one digit left that fits takes it;
 *   6. otherwise the cell with the fewest options, and the solution's digit.
 */
export function sumdokuHint(run: SumdokuRun): SumdokuHint | null {
  if (run.outcome !== "playing") return null;
  const drawn = board(run.seed, run.level);
  const { solution, start, cageOf, cages } = drawn;
  const cells = run.cells;
  const player = (cell: number) => start[cell] === EMPTY && cells[cell] !== EMPTY;
  const wrongFirst = (list: number[]) =>
    list.find((cell) => cells[cell] !== solution[cell]) ?? list[0];

  // 1. A repeat in a row, column, box or cage.
  const clashing = [...conflicts(drawn, cells)].filter(player).sort((a, b) => a - b);
  const repeats = clashing.filter((cell) => {
    const digit = cells[cell];
    const around = unitsOf(cell);
    const unitsAndCage = [around.row, around.column, around.box, cages[cageOf[cell]].cells];
    return unitsAndCage.some((unit) =>
      unit.some((other) => other !== cell && cells[other] === digit),
    );
  });
  const repeat = repeats.length ? wrongFirst(repeats) : undefined;
  if (repeat !== undefined) {
    const digit = cells[repeat];
    const around = unitsOf(repeat);
    const same = (unit: readonly number[]) =>
      unit.some((other) => other !== repeat && cells[other] === digit);
    const where = same(around.row)
      ? t("row {n}", { n: Math.floor(repeat / 6) + 1 })
      : same(around.column)
        ? t("column {n}", { n: (repeat % 6) + 1 })
        : same(around.box)
          ? t("its box")
          : t("its cage");
    return {
      cell: repeat,
      action: "clear",
      digit,
      reason: t("This {digit} can't stay: there's already a {digit2} in {where}.", {
        digit,
        digit2: digit,
        where,
      }),
    };
  }

  // 2. A cage whose sum has gone wrong.
  const bad = badCages(drawn, cells)[0];
  if (bad) {
    const mine = bad.cells.filter(player);
    const chosen = mine.length ? wrongFirst(mine) : undefined;
    if (chosen !== undefined) {
      const sum = cageSum(bad, cells);
      return {
        cell: chosen,
        action: "clear",
        digit: cells[chosen],
        reason:
          sum > bad.total
            ? t("This cage adds up to {sum} already, past its {total}. This {digit} has to go.", {
                sum,
                total: bad.total,
                digit: cells[chosen],
              })
            : t("This cage is full but adds up to {sum}, not {total}. This {digit} has to go.", {
                sum,
                total: bad.total,
                digit: cells[chosen],
              }),
      };
    }
  }

  // 3. A digit off the solution.
  const off = cells.findIndex((value, cell) => player(cell) && value !== solution[cell]);
  if (off >= 0) {
    return {
      cell: off,
      action: "clear",
      digit: cells[off],
      reason: t("With a {n} here, the rest of the board can't be finished. Clear it.", {
        n: cells[off],
      }),
    };
  }

  // 4. A cage with one cell left.
  for (const cage of cages) {
    const open = cage.cells.filter((cell) => cells[cell] === EMPTY);
    if (open.length !== 1 || cage.cells.length < 2) continue;
    const cell = open[0];
    const digit = solution[cell];
    return {
      cell,
      action: "place",
      digit,
      reason: t(
        "This cage adds up to {total} and already holds {sum}, so the last cell is a {digit}.",
        {
          total: cage.total,
          sum: cageSum(cage, cells),
          digit,
        },
      ),
    };
  }

  const options = cells.map((value, cell) =>
    value === EMPTY ? candidates(drawn, cells, cell) : [],
  );

  // 5. The only digit that fits a cell.
  const single = options.findIndex((fits) => fits.length === 1);
  if (single >= 0) {
    const digit = options[single][0];
    return {
      cell: single,
      action: "place",
      digit,
      reason: t(
        "Only a {digit} fits here: its row, column and box rule out the rest, and its cage total does the others.",
        { digit },
      ),
    };
  }

  // 6. The fewest options: the solution's digit.
  let best = -1;
  for (let cell = 0; cell < cells.length; cell += 1) {
    if (cells[cell] !== EMPTY) continue;
    if (best < 0 || options[cell].length < options[best].length) best = cell;
  }
  if (best < 0) return null;
  const digit = solution[best];
  const cage = cages[cageOf[best]];
  return {
    cell: best,
    action: "place",
    digit,
    reason:
      options[best].length > 1
        ? t("{n} all fit here, but only a {digit} lets the board be finished.", {
            n: options[best].join(", "),
            digit,
          })
        : t("This cage of {size} adds up to {total}; a {digit} goes here.", {
            size: cage.cells.length,
            total: cage.total,
            digit,
          }),
  };
}

/** How many cells the player filled with the solution's digit: a right move raises it. */
export function sumdokuRight(run: SumdokuRun): number {
  const { start, solution } = board(run.seed, run.level);
  return run.cells.filter(
    (digit, cell) => start[cell] === EMPTY && digit !== EMPTY && digit === solution[cell],
  ).length;
}
