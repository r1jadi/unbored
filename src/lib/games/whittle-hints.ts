/**
 * Hints for Whittle: a cell, what to do with it, and why.
 *
 * A hint is advice only: it never touches the run, and the score is what the
 * server derives from the moves. A board can have more than one answer, so a hint
 * follows the answer nearest the player's own crosses, and only says a mark is
 * wrong when no answer has it.
 */
import { t } from "@/lib/settings/language";
import {
  board,
  CIRCLED,
  columnCells,
  columnSum,
  CROSSED,
  WHITTLE_SIDE,
  rowCells,
  rowSum,
  solutions,
  type WhittleBoard,
  type WhittleMark,
  type WhittleRun,
} from "@/lib/games/whittle";

export type WhittleHint = {
  readonly cell: number;
  /** `cross`: cross this number out. `restore`: this cross, or circle, has to go. */
  readonly action: "cross" | "restore";
  readonly reason: string;
};

/**
 * The answer that fits the player's marks best: one that has every cross and no
 * circle crossed out when there is one, otherwise the one with the fewest marks
 * against it.
 */
function nearest(drawn: WhittleBoard, marks: readonly WhittleMark[]): readonly boolean[] {
  let best: readonly boolean[] = drawn.crossed;
  let bestScore = -Infinity;
  for (const answer of solutions(drawn)) {
    let score = 0;
    marks.forEach((mark, cell) => {
      if (mark === CROSSED) score += answer[cell] ? 1 : -1;
      else if (mark === CIRCLED && answer[cell]) score -= 1;
    });
    if (score > bestScore) {
      best = answer;
      bestScore = score;
    }
  }
  return best;
}

/**
 * What the hint timer counts as progress: the board and its crosses. Circles are
 * notes, so circling a number does not put a hint away.
 */
export function whittleProgress(run: WhittleRun): string {
  return `${run.level}:${run.marks.map((mark) => (mark === CROSSED ? 1 : 0)).join("")}`;
}

/**
 * In order:
 *
 *   1. a crossed-out number no answer crosses out comes back;
 *   2. a circled number every fitting answer crosses out loses its circle;
 *   3. a number bigger than its row's or column's target is crossed out;
 *   4. a number that is exactly what its row or column is over by is crossed out;
 *   5. otherwise the next number the nearest answer crosses out.
 */
export function whittleHint(run: WhittleRun): WhittleHint | null {
  if (run.outcome !== "playing") return null;
  const drawn = board(run.seed, run.level);
  const { numbers, rowTargets, columnTargets } = drawn;
  const marks = run.marks;
  const answer = nearest(drawn, marks);
  const row = (cell: number) => Math.floor(cell / WHITTLE_SIDE);
  const column = (cell: number) => cell % WHITTLE_SIDE;

  // 1. A cross the nearest answer does not have: no answer fits the crosses as they are.
  const wrongCross = marks.findIndex((mark, cell) => mark === CROSSED && !answer[cell]);
  if (wrongCross >= 0) {
    const r = row(wrongCross);
    const c = column(wrongCross);
    const rowShort = rowSum(drawn, marks, r) < rowTargets[r];
    const columnShort = columnSum(drawn, marks, c) < columnTargets[c];
    return {
      cell: wrongCross,
      action: "restore",
      reason: rowShort
        ? t("Row {n} is under its target of {target}: bring this {number} back.", {
            n: r + 1,
            target: rowTargets[r],
            number: numbers[wrongCross],
          })
        : columnShort
          ? t("Column {n} is under its target of {target}: bring this {number} back.", {
              n: c + 1,
              target: columnTargets[c],
              number: numbers[wrongCross],
            })
          : t("This {number} has to stay: the board can't be finished with it crossed out.", {
              number: numbers[wrongCross],
            }),
    };
  }

  // 2. A circle on a number that has to go.
  const wrongCircle = marks.findIndex((mark, cell) => mark === CIRCLED && answer[cell]);
  if (wrongCircle >= 0) {
    return {
      cell: wrongCircle,
      action: "restore",
      reason: t("This circled {number} can't stay: the board can't be finished around it.", {
        number: numbers[wrongCircle],
      }),
    };
  }

  const open = answer.flatMap((crossed, cell) =>
    crossed && marks[cell] !== CROSSED ? [cell] : [],
  );
  if (open.length === 0) return null;

  // 3. A number bigger than a target can never be part of it.
  for (const cell of open) {
    const r = row(cell);
    const c = column(cell);
    if (numbers[cell] > rowTargets[r]) {
      return {
        cell,
        action: "cross",
        reason: t("This {number} is bigger than row {n}'s target of {target}, so it has to go.", {
          number: numbers[cell],
          n: r + 1,
          target: rowTargets[r],
        }),
      };
    }
    if (numbers[cell] > columnTargets[c]) {
      return {
        cell,
        action: "cross",
        reason: t(
          "This {number} is bigger than column {n}'s target of {target}, so it has to go.",
          { number: numbers[cell], n: c + 1, target: columnTargets[c] },
        ),
      };
    }
  }

  // 4. A line that is over by exactly one of its numbers, the last it has to lose.
  for (const cell of open) {
    const r = row(cell);
    const c = column(cell);
    const lastIn = (cells: number[]) => cells.filter((other) => open.includes(other)).length === 1;
    const rowOver = rowSum(drawn, marks, r) - rowTargets[r];
    if (rowOver === numbers[cell] && lastIn(rowCells(r))) {
      return {
        cell,
        action: "cross",
        reason: t("Row {n} adds up to {sum} and needs {target}: cross out this {number}.", {
          n: r + 1,
          sum: rowSum(drawn, marks, r),
          target: rowTargets[r],
          number: numbers[cell],
        }),
      };
    }
    const columnOver = columnSum(drawn, marks, c) - columnTargets[c];
    if (columnOver === numbers[cell] && lastIn(columnCells(c))) {
      return {
        cell,
        action: "cross",
        reason: t("Column {n} adds up to {sum} and needs {target}: cross out this {number}.", {
          n: c + 1,
          sum: columnSum(drawn, marks, c),
          target: columnTargets[c],
          number: numbers[cell],
        }),
      };
    }
  }

  // 5. The next number the answer crosses out.
  const cell = open[0];
  const r = row(cell);
  return {
    cell,
    action: "cross",
    reason: t(
      "Row {n} is {over} over its target of {target}. This {number} is part of what goes.",
      {
        n: r + 1,
        over: rowSum(drawn, marks, r) - rowTargets[r],
        target: rowTargets[r],
        number: numbers[cell],
      },
    ),
  };
}
