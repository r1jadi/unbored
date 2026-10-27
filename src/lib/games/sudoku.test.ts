import { describe, expect, it } from "vitest";

import {
  board,
  budgetMs,
  candidates,
  canPlace,
  conflicts,
  createRun,
  EMPTY,
  encodeMove,
  finish,
  givenCount,
  isSolved,
  place,
  solution,
  startCells,
  submission,
  SUDOKU_MAX_ACTIONS,
  SUDOKU_RULES_VERSION,
  type SudokuDigit,
  type SudokuRun,
} from "@/lib/games/sudoku";

/**
 * The engine's tests are pinned to the *database's* numbers.
 *
 * `public.complete_sudoku_run` replays the submitted moves from each board's
 * starting cells and scores a board once it is full and obeys the rules. The
 * solutions, starting cells and scored lines below are the ones
 * `tests/security/rls_test.sql` asserts for the same seeds.
 */

/** Seed 1's first two boards, in reading order, 0 an empty cell. */
const SOLUTION_ONE =
  "635718429187492536924563781841925673259637148376184952498256317713849265562371894";
const START_ONE =
  "005018409080002006020003701000025070250630140006084902090250317003049205060300800";
const SOLUTION_TWO =
  "728146953461935827359872164975284631842613579136597248214369785587421396693758412";
const START_TWO =
  "708006003461005027000002104905000030040613570130597048010300080007401096600008000";

/** The moves that fill seed 1's first board, as `cell × 10 + digit`. */
const LINE_ONE = [
  6, 13, 37, 72, 91, 117, 124, 139, 155, 163, 189, 204, 215, 226, 258, 278, 284, 291, 309, 336, 353,
  389, 417, 448, 453, 467, 481, 525, 544, 568, 596, 637, 641, 668, 706, 725, 742, 767, 771, 799,
  804,
];

const digits = (text: string) => text.split("").map(Number);

/** The moves that fill a board from its start with its planted solution. */
function fillLine(seed: string, level: number): number[] {
  const answer = solution(seed, level);
  const start = startCells(seed, level);
  return answer.flatMap((digit, cell) => (start[cell] ? [] : [encodeMove(cell, digit)]));
}

function playLine(seed: string, line: readonly number[]): SudokuRun {
  return line.reduce((run, move) => place(run, Math.floor(move / 10), move % 10), createRun(seed));
}

describe("the boards are the verifier's boards", () => {
  it("draws seed 1's first two boards in the order the SQL suite documents", () => {
    expect(solution("1", 1)).toEqual(digits(SOLUTION_ONE));
    expect(startCells("1", 1)).toEqual(digits(START_ONE));
    expect(solution("1", 2)).toEqual(digits(SOLUTION_TWO));
    expect(startCells("1", 2)).toEqual(digits(START_TWO));
  });

  it("replays a seed larger than a JS safe integer exactly", () => {
    expect(solution("9223372036854775807", 1).join("")).toBe(
      "784519362632874519159362874541936287827451936396287451268745193913628745475193628",
    );
  });

  it("treats a zero seed as the verifier's fallback state", () => {
    expect(solution("0", 3)).toEqual(solution("2654435769", 3));
  });

  it("refuses a seed that is not a whole number, and a level before the first", () => {
    expect(() => solution("1.5", 1)).toThrow(TypeError);
    expect(() => solution("1", 0)).toThrow(RangeError);
  });

  it("starts with forty cells filled, one fewer a board, down to thirty", () => {
    expect([1, 2, 10, 11, 50].map(givenCount)).toEqual([40, 39, 31, 30, 30]);
    for (const level of [1, 6, 15]) {
      const start = startCells("4242", level);
      const answer = solution("4242", level);
      expect(start.filter((value) => value !== EMPTY)).toHaveLength(givenCount(level));
      start.forEach((value, cell) => {
        if (value !== EMPTY) expect(value).toBe(answer[cell]);
      });
    }
  });

  it("always plants a grid that obeys the rules", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      for (const level of [1, 7, 30]) {
        expect(isSolved(board(String(seed * 7919), level).solution)).toBe(true);
      }
    }
  });
});

describe("the rules on a board", () => {
  it("marks a digit twice in a row, a column or a box", () => {
    const cells = new Array<SudokuDigit>(81).fill(EMPTY);
    cells[0] = 5;
    cells[8] = 5; // same row
    expect([...conflicts(cells)].sort((a, b) => a - b)).toEqual([0, 8]);

    const column = new Array<SudokuDigit>(81).fill(EMPTY);
    column[4] = 3;
    column[76] = 3;
    expect(conflicts(column).size).toBe(2);

    const box = new Array<SudokuDigit>(81).fill(EMPTY);
    box[0] = 7;
    box[20] = 7; // row 3, column 3: the same top-left box
    expect(conflicts(box).size).toBe(2);
  });

  it("solves a full grid that obeys the rules, even one that is not the planted one", () => {
    const planted = solution("1", 1);
    expect(isSolved(planted)).toBe(true);
    // Swapping two digits everywhere is another valid grid.
    const swapped = planted.map((digit) => (digit === 1 ? 2 : digit === 2 ? 1 : digit));
    expect(isSolved(swapped)).toBe(true);
    const broken = [...planted];
    broken[0] = broken[1];
    expect(isSolved(broken)).toBe(false);
    expect(isSolved([...planted.slice(0, 80), EMPTY])).toBe(false);
  });

  it("lists the digits an empty cell can still take", () => {
    const cells = digits(START_ONE) as SudokuDigit[];
    expect(candidates(cells, 0)).toContain(solution("1", 1)[0]);
    expect(candidates(cells, 0)).not.toContain(5); // cell 2 already holds a 5
  });
});

describe("the clock", () => {
  it("starts at six minutes and adds three per solved board", () => {
    expect([0, 1, 2].map(budgetMs)).toEqual([360_000, 540_000, 720_000]);
  });
});

describe("a run", () => {
  it("starts on board one with its givens filled and the pinned rules version", () => {
    expect(createRun("1")).toMatchObject({
      seed: "1",
      rulesVersion: SUDOKU_RULES_VERSION,
      level: 1,
      cells: digits(START_ONE),
      score: 0,
      outcome: "playing",
    });
    expect(SUDOKU_RULES_VERSION).toBe("sudoku@1");
  });

  it("puts a digit in a cell, replaces it, and clears it", () => {
    let run = place(createRun("1"), 0, 6);
    expect(run.cells[0]).toBe(6);
    run = place(run, 0, 4);
    expect(run.cells[0]).toBe(4);
    run = place(run, 0, 0);
    expect(run.cells[0]).toBe(EMPTY);
    expect(run.moves).toEqual([6, 4, 0]);
  });

  it("does not count a move that changes nothing, or touches a starting cell", () => {
    const run = createRun("1"); // cell 2 starts as a 5
    expect(canPlace(run, 2, 1)).toBe(false);
    expect(place(run, 2, 1)).toBe(run);
    expect(place(run, 0, 0)).toBe(run); // already empty
    expect(canPlace(run, 81, 1)).toBe(false);
    expect(canPlace(run, 0, 10)).toBe(false);
  });

  it("solves a board when it is full and right: ninety points and the next board", () => {
    expect(fillLine("1", 1)).toEqual(LINE_ONE);
    const run = playLine("1", LINE_ONE);
    expect(run).toMatchObject({
      level: 2,
      levelsCleared: 1,
      score: 90,
      cells: digits(START_TWO),
    });
  });

  it("scores seed 1's two-board line at 180, as the SQL suite does", () => {
    const run = playLine("1", [...LINE_ONE, ...fillLine("1", 2)]);
    expect(run).toMatchObject({ level: 3, levelsCleared: 2, score: 180 });
    expect(run.moves).toHaveLength(83);
  });

  it("ends where the player stops or the clock runs out, keeping the score", () => {
    const stopped = finish(playLine("1", [...LINE_ONE, 11]), "stopped");
    expect(stopped).toMatchObject({ score: 90, outcome: "over", ending: "stopped" });
    expect(place(stopped, 2, 2)).toBe(stopped);
    expect(finish(stopped, "time")).toBe(stopped);
  });

  it("ends a run at the submission bound", () => {
    const almost: SudokuRun = {
      ...createRun("1"),
      moves: new Array(SUDOKU_MAX_ACTIONS - 1).fill(1),
    };
    expect(place(almost, 0, 1)).toMatchObject({ outcome: "over", ending: "bound" });
  });

  it("assembles the submission from the run", () => {
    const run = finish(playLine("1", LINE_ONE), "stopped");
    expect(submission(run)).toEqual({
      rulesVersion: "sudoku@1",
      actions: LINE_ONE,
      score: 90,
      tapsPlaced: LINE_ONE.length,
      levelsCleared: 1,
    });
  });
});
