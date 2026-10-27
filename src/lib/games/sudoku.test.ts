import { describe, expect, it } from "vitest";

import { SUDOKU_BANK, SUDOKU_PER_TIER, SUDOKU_TIERS } from "@/lib/games/sudoku-bank";
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
  tierOf,
  type SudokuDigit,
  type SudokuRun,
} from "@/lib/games/sudoku";

/**
 * The engine's tests are pinned to the *database's* numbers.
 *
 * `public.complete_sudoku_run` replays the submitted moves from each board's
 * starting cells (`public.sudoku_start`) and scores a board once it is full and
 * obeys the rules. The starting cells and scored lines below are the ones
 * `tests/security/rls_test.sql` asserts for the same seeds.
 */

/** Seed 1's first two boards, in reading order, 0 an empty cell: both gentle. */
const START_ONE =
  "730090000040130872000057049080610090000800600000003080178002904920004001060901250";
const SOLUTION_ONE =
  "732498516549136872816257349287615493351849627694723185178562934925384761463971258";
const START_TWO =
  "003906000016400000008003500000304600000009740067502100734091800080005472005807309";

/** The moves that fill seed 1's first board, as `cell × 10 + digit`. */
const LINE_ONE = [
  22, 34, 58, 65, 71, 86, 95, 119, 146, 188, 191, 206, 212, 243, 272, 297, 325, 334, 353, 363, 375,
  381, 404, 419, 432, 447, 456, 469, 474, 487, 492, 511, 535, 575, 586, 613, 655, 663, 678, 697,
  706, 724, 743, 767, 808,
];

const digits = (text: string) => text.split("").map(Number);

/** How many ways a grid can be finished, counting no further than two. */
function countSolutions(cells: readonly SudokuDigit[]): number {
  const grid = [...cells];
  let found = 0;
  const search = () => {
    const cell = grid.indexOf(EMPTY);
    if (cell < 0) {
      found += 1;
      return;
    }
    for (const digit of candidates(grid, cell)) {
      grid[cell] = digit;
      search();
      if (found > 1) break;
    }
    grid[cell] = EMPTY;
  };
  search();
  return found;
}

/** The moves that fill a board from its start with its solution. */
function fillLine(seed: string, level: number): number[] {
  const answer = solution(seed, level);
  const start = startCells(seed, level);
  return answer.flatMap((digit, cell) => (start[cell] ? [] : [encodeMove(cell, digit)]));
}

function playLine(seed: string, line: readonly number[]): SudokuRun {
  return line.reduce((run, move) => place(run, Math.floor(move / 10), move % 10), createRun(seed));
}

describe("the bank", () => {
  it("holds four tiers of fifty puzzles, each with exactly one solution", () => {
    expect(SUDOKU_TIERS).toEqual(["gentle", "easy", "medium", "hard"]);
    expect(SUDOKU_BANK).toHaveLength(4 * SUDOKU_PER_TIER);
    // Every tenth puzzle: a full check of 200 searches is slow for a unit test.
    for (let index = 0; index < SUDOKU_BANK.length; index += 10) {
      expect(countSolutions(digits(SUDOKU_BANK[index]) as SudokuDigit[])).toBe(1);
    }
  });

  it("gives the gentle tier the most clues and the hard tier the fewest", () => {
    const clues = (tier: number) =>
      SUDOKU_BANK.slice(tier * SUDOKU_PER_TIER, (tier + 1) * SUDOKU_PER_TIER).map(
        (puzzle) => puzzle.replace(/0/g, "").length,
      );
    expect(Math.min(...clues(0))).toBe(36);
    expect(Math.max(...clues(3))).toBeLessThanOrEqual(27);
    expect(Math.min(...clues(0))).toBeGreaterThan(Math.max(...clues(2)));
  });
});

describe("the boards are the verifier's boards", () => {
  it("draws seed 1's first two boards in the order the SQL suite documents", () => {
    expect(startCells("1", 1)).toEqual(digits(START_ONE));
    expect(solution("1", 1)).toEqual(digits(SOLUTION_ONE));
    expect(startCells("1", 2)).toEqual(digits(START_TWO));
  });

  it("replays a seed larger than a JS safe integer exactly", () => {
    expect(startCells("9223372036854775807", 1).join("")).toBe(
      "000802006000609700600740010200000560896000201100270009502000000701490625009125080",
    );
  });

  it("treats a zero seed as the verifier's fallback state", () => {
    expect(startCells("0", 3)).toEqual(startCells("2654435769", 3));
  });

  it("refuses a seed that is not a whole number, and a level before the first", () => {
    expect(() => startCells("1.5", 1)).toThrow(TypeError);
    expect(() => startCells("1", 0)).toThrow(RangeError);
  });

  it("gets harder by tier: gentle, easy, medium, then hard", () => {
    expect([1, 2, 3, 5, 6, 9, 10, 50].map(tierOf)).toEqual([
      "gentle",
      "gentle",
      "easy",
      "easy",
      "medium",
      "medium",
      "hard",
      "hard",
    ]);
    expect([1, 3, 6, 10].map((level) => givenCount("1", level))).toEqual([36, 30, 26, 25]);
  });

  it("keeps every board unique: the disguise never adds a solution", () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      for (const level of [1, 4, 8, 12]) {
        const drawn = board(String(seed * 7919), level);
        expect(countSolutions(drawn.start)).toBe(1);
        expect(isSolved(drawn.solution)).toBe(true);
        drawn.start.forEach((digit, cell) => {
          if (digit !== EMPTY) expect(drawn.solution[cell]).toBe(digit);
        });
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

  it("solves a full grid that obeys the rules", () => {
    const solved = solution("1", 1);
    expect(isSolved(solved)).toBe(true);
    const broken = [...solved];
    broken[0] = broken[1];
    expect(isSolved(broken)).toBe(false);
    expect(isSolved([...solved.slice(0, 80), EMPTY])).toBe(false);
  });

  it("lists the digits an empty cell can still take", () => {
    // Cell 2 of seed 1's first board: its row holds 7, 3 and 9, its column an 8,
    // and its box a 4.
    expect(candidates(digits(START_ONE) as SudokuDigit[], 2)).toEqual([1, 2, 5, 6]);
  });
});

describe("the clock", () => {
  it("starts at six minutes and adds the next board's allowance per solved board", () => {
    // Board 2 is gentle (+4 min), 3 easy (+5), 6 medium (+8), 10 hard (+10).
    expect([0, 1, 2].map(budgetMs)).toEqual([360_000, 600_000, 900_000]);
    expect(budgetMs(5) - budgetMs(4)).toBe(480_000);
    expect(budgetMs(9) - budgetMs(8)).toBe(600_000);
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
    expect(SUDOKU_RULES_VERSION).toBe("sudoku@2");
  });

  it("puts a digit in a cell, replaces it, and clears it", () => {
    let run = place(createRun("1"), 2, 2);
    expect(run.cells[2]).toBe(2);
    run = place(run, 2, 5);
    expect(run.cells[2]).toBe(5);
    run = place(run, 2, 0);
    expect(run.cells[2]).toBe(EMPTY);
    expect(run.moves).toEqual([22, 25, 20]);
  });

  it("does not count a move that changes nothing, or touches a starting cell", () => {
    const run = createRun("1"); // cell 0 starts as a 7
    expect(canPlace(run, 0, 1)).toBe(false);
    expect(place(run, 0, 1)).toBe(run);
    expect(place(run, 2, 0)).toBe(run); // already empty
    expect(canPlace(run, 81, 1)).toBe(false);
    expect(canPlace(run, 2, 10)).toBe(false);
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
    expect(run.moves).toHaveLength(90);
  });

  it("ends where the player stops or the clock runs out, keeping the score", () => {
    const stopped = finish(playLine("1", [...LINE_ONE, 5]), "stopped");
    expect(stopped).toMatchObject({ score: 90, outcome: "over", ending: "stopped" });
    expect(place(stopped, 1, 2)).toBe(stopped);
    expect(finish(stopped, "time")).toBe(stopped);
  });

  it("ends a run at the submission bound", () => {
    const almost: SudokuRun = {
      ...createRun("1"),
      moves: new Array(SUDOKU_MAX_ACTIONS - 1).fill(1),
    };
    expect(place(almost, 2, 1)).toMatchObject({ outcome: "over", ending: "bound" });
  });

  it("assembles the submission from the run", () => {
    const run = finish(playLine("1", LINE_ONE), "stopped");
    expect(submission(run)).toEqual({
      rulesVersion: "sudoku@2",
      actions: LINE_ONE,
      score: 90,
      tapsPlaced: LINE_ONE.length,
      levelsCleared: 1,
    });
  });
});
