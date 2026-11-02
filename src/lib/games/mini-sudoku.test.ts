import { describe, expect, it } from "vitest";

import {
  MINI_SUDOKU_BANK,
  MINI_SUDOKU_PER_TIER,
  MINI_SUDOKU_TIERS,
} from "@/lib/games/mini-sudoku-bank";
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
  MINI_SUDOKU_MAX_ACTIONS,
  MINI_SUDOKU_RULES_VERSION,
  peers,
  place,
  solution,
  startCells,
  submission,
  tierOf,
  unitsOf,
  type MiniSudokuDigit,
  type MiniSudokuRun,
} from "@/lib/games/mini-sudoku";

/**
 * The engine's tests are pinned to the *database's* numbers.
 *
 * `public.complete_mini_sudoku_run` replays the submitted moves from each board's
 * starting cells (`public.mini_sudoku_start`) and scores a board once it is full
 * and obeys the rules. The starting cells and scored lines below are the ones
 * `tests/security/rls_test.sql` asserts for the same seeds.
 */

/** Seed 1's first two boards, in reading order, 0 an empty cell: both gentle. */
const START_ONE = "000503530040006215210030400002623450";
const SOLUTION_ONE = "164523532146346215215634451362623451";
const START_TWO = "240015531002600400403256004000320060";
const SOLUTION_TWO = "246315531642652431413256164523325164";

/** The moves that fill seed 1's first and second boards, as `cell × 10 + digit`. */
const LINE_ONE = [1, 16, 24, 42, 82, 91, 116, 123, 134, 205, 216, 234, 255, 261, 273, 286, 351];
const LINE_TWO = [26, 33, 96, 104, 135, 142, 163, 171, 191, 241, 256, 275, 282, 293, 325, 331, 354];

const digits = (text: string) => text.split("").map(Number);

/** How many ways a grid can be finished, counting no further than two. */
function countSolutions(cells: readonly MiniSudokuDigit[]): number {
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
      grid[cell] = EMPTY;
      if (found > 1) return;
    }
  };
  search();
  return found;
}

function play(run: MiniSudokuRun, moves: readonly number[]): MiniSudokuRun {
  return moves.reduce((current, move) => place(current, Math.floor(move / 10), move % 10), run);
}

describe("the bank", () => {
  it("holds four tiers of unique 6×6 puzzles with the documented number of givens", () => {
    expect(MINI_SUDOKU_TIERS).toEqual(["gentle", "easy", "medium", "hard"]);
    expect(MINI_SUDOKU_BANK).toHaveLength(MINI_SUDOKU_TIERS.length * MINI_SUDOKU_PER_TIER);
    const givens = [19, 16, 14, 12];
    MINI_SUDOKU_BANK.forEach((puzzle, index) => {
      expect(puzzle).toMatch(/^[0-6]{36}$/);
      const tier = Math.floor(index / MINI_SUDOKU_PER_TIER);
      expect(digits(puzzle).filter((d) => d !== 0)).toHaveLength(givens[tier]);
      expect(countSolutions(digits(puzzle) as MiniSudokuDigit[])).toBe(1);
    });
    expect(new Set(MINI_SUDOKU_BANK).size).toBe(MINI_SUDOKU_BANK.length);
  });
});

describe("the geometry", () => {
  it("has 2×3 boxes: a cell has 5 row, 5 column and 2 extra box peers", () => {
    // Cell 0 sits in the top-left box (rows 0–1, columns 0–2).
    expect(peers(0).sort((a, b) => a - b)).toEqual(
      [1, 2, 3, 4, 5, 6, 12, 18, 24, 30, 7, 8].sort((a, b) => a - b),
    );
    expect(unitsOf(14).box).toEqual([12, 13, 14, 18, 19, 20]);
    expect(unitsOf(35).box).toEqual([27, 28, 29, 33, 34, 35]);
  });

  it("calls a grid solved only when every row, column and box holds 1 to 6", () => {
    const full = digits(SOLUTION_ONE) as MiniSudokuDigit[];
    expect(isSolved(full)).toBe(true);
    const swapped = [...full];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(isSolved(swapped)).toBe(false);
    expect(isSolved(digits(START_ONE) as MiniSudokuDigit[])).toBe(false);
  });
});

describe("the boards", () => {
  it("matches the database's draws for seed 1", () => {
    expect(startCells(1, 1).join("")).toBe(START_ONE);
    expect(solution(1, 1).join("")).toBe(SOLUTION_ONE);
    expect(startCells(1, 2).join("")).toBe(START_TWO);
    expect(solution(1, 2).join("")).toBe(SOLUTION_TWO);
    expect(startCells(1, 10).join("")).toBe("104350000004403600010000600005000002");
  });

  it("treats a zero seed as the fixed fallback, and reads big seeds exactly", () => {
    expect(startCells(0, 3)).toEqual(startCells(2654435769, 3));
    expect(startCells("9223372036854775807", 1).join("")).toBe(
      "530040040305103462020510000100304056",
    );
  });

  it("gives every board exactly one solution, whatever the seed and level", () => {
    for (const seed of [1, 2, 17, 4000000000, "123456789012"]) {
      for (let level = 1; level <= 12; level += 1) {
        const start = startCells(seed, level);
        expect(countSolutions(start)).toBe(1);
        expect(isSolved(solution(seed, level))).toBe(true);
        start.forEach((digit, cell) => {
          if (digit !== EMPTY) expect(solution(seed, level)[cell]).toBe(digit);
        });
      }
    }
  });

  it("steps the tier at boards 3, 6 and 10, with fewer givens each time", () => {
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
    expect([1, 3, 6, 10].map((level) => givenCount(1, level))).toEqual([19, 16, 14, 12]);
    expect(board(1, 1)).toBe(board(1, 1));
  });

  it("rejects a bad seed or level", () => {
    expect(() => startCells("abc", 1)).toThrow(TypeError);
    expect(() => startCells(1.5, 1)).toThrow(TypeError);
    expect(() => startCells(1, 0)).toThrow(RangeError);
  });
});

describe("the clock", () => {
  it("starts at two minutes and adds the tapered allowance of the next board", () => {
    expect([0, 1, 2, 3, 8].map(budgetMs)).toEqual([120000, 192000, 274500, 349500, 690000]);
  });
});

describe("a run", () => {
  it("starts on board one with the givens in place", () => {
    const run = createRun(1);
    expect(run).toMatchObject({
      level: 1,
      levelsCleared: 0,
      score: 0,
      outcome: "playing",
      rulesVersion: MINI_SUDOKU_RULES_VERSION,
    });
    expect(run.cells.join("")).toBe(START_ONE);
  });

  it("refuses moves on givens, off the board, above 6 and ones that change nothing", () => {
    const run = createRun(1);
    const given = run.cells.findIndex((d) => d !== EMPTY);
    const empty = run.cells.indexOf(EMPTY);
    expect(canPlace(run, given, 1)).toBe(false);
    expect(canPlace(run, 36, 1)).toBe(false);
    expect(canPlace(run, -1, 1)).toBe(false);
    expect(canPlace(run, empty, 7)).toBe(false);
    expect(canPlace(run, empty, 0)).toBe(false);
    expect(place(run, given, 1)).toBe(run);
    expect(canPlace(run, empty, 3)).toBe(true);
  });

  it("places, overwrites and clears a digit, recording each as a move", () => {
    const empty = createRun(1).cells.indexOf(EMPTY);
    let run = place(createRun(1), empty, 3);
    run = place(run, empty, 4);
    run = place(run, empty, 0);
    expect(run.cells[empty]).toBe(0);
    expect(run.moves).toEqual([encodeMove(empty, 3), encodeMove(empty, 4), encodeMove(empty, 0)]);
  });

  it("marks a repeated digit as a conflict but lets the run go on", () => {
    const run = createRun(1);
    const cells = [...run.cells];
    const first = cells.indexOf(EMPTY);
    const clash = peers(first).find((cell) => cells[cell] !== EMPTY)!;
    const next = place(run, first, cells[clash]);
    const marked = conflicts(next.cells);
    expect(marked.has(first) && marked.has(clash)).toBe(true);
    expect(next.outcome).toBe("playing");
  });

  it("scores sixty points when a board is filled and deals the next", () => {
    const run = play(createRun(1), LINE_ONE);
    expect(run).toMatchObject({ level: 2, levelsCleared: 1, score: 60, outcome: "playing" });
    expect(run.cells.join("")).toBe(START_TWO);
    expect(run.moves).toEqual(LINE_ONE);
  });

  it("a wrong full board scores nothing, and fixing it does", () => {
    const wrong = [...LINE_ONE];
    wrong[wrong.length - 1] = 351 - 1; // the last cell gets a wrong digit
    let run = play(createRun(1), wrong);
    expect(run.score).toBe(0);
    expect(run.level).toBe(1);
    run = place(run, 35, 1);
    expect(run.score).toBe(60);
  });

  it("scores two boards in a row", () => {
    const run = play(createRun(1), [...LINE_ONE, ...LINE_TWO]);
    expect(run).toMatchObject({ level: 3, levelsCleared: 2, score: 120 });
    expect(submission(run)).toEqual({
      rulesVersion: "mini-sudoku@1",
      actions: [...LINE_ONE, ...LINE_TWO],
      score: 120,
      tapsPlaced: 34,
      levelsCleared: 2,
    });
  });

  it("ends when stopped or out of time, and then takes no more moves", () => {
    const stopped = finish(play(createRun(1), LINE_ONE.slice(0, 3)), "stopped");
    expect(stopped).toMatchObject({ outcome: "over", ending: "stopped" });
    expect(finish(stopped, "time")).toBe(stopped);
    const empty = stopped.cells.indexOf(EMPTY);
    expect(canPlace(stopped, empty, 2)).toBe(false);
  });

  it("stops at the action ceiling", () => {
    const empty = createRun(1).cells.indexOf(EMPTY);
    let run = createRun(1);
    for (let i = 0; i < MINI_SUDOKU_MAX_ACTIONS; i += 1) {
      run = place(run, empty, i % 2 === 0 ? 1 : 2);
    }
    expect(run).toMatchObject({ outcome: "over", ending: "bound" });
    expect(run.moves).toHaveLength(MINI_SUDOKU_MAX_ACTIONS);
  });
});
