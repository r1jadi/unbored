import { describe, expect, it } from "vitest";

import {
  blockedCells,
  board,
  boardSize,
  canTap,
  createRun,
  fallbackRegions,
  finish,
  progress,
  QUEENS_MAX_ACTIONS,
  QUEENS_MISTAKES,
  QUEENS_RULES_VERSION,
  solution,
  solutions,
  submission,
  tap,
  type QueensRun,
} from "@/lib/games/queens";

/**
 * The engine's tests are pinned to the *database's* numbers.
 *
 * `public.complete_queens_run` is the authority: it replays the submitted taps
 * against each board's solution and derives the score. The solution vectors and
 * the scored lines below are the ones `tests/security/rls_test.sql` asserts for
 * the same seeds, so a green suite proves agreement with the verifier rather than
 * self-consistency. The regions are the client's alone, and are tested here for
 * the property that matters: the planted solution is the board's only one.
 *
 * The vectors are also written down in `docs/games/README.md`.
 */

/** Seed 1's solutions for boards one to four: the Queen's column in each row. */
const SEED_ONE_SOLUTIONS = [
  [1, 3, 0, 4, 2],
  [4, 1, 3, 0, 5, 2],
  [0, 3, 5, 1, 4, 2],
  [0, 6, 1, 4, 2, 5, 3],
];

/** Board one solved (each solution cell tapped twice), then three wrong Queens on board two. */
const SEED_ONE_LINE = [1, 1, 8, 8, 10, 10, 19, 19, 22, 22, 4, 4, 4, 0, 0, 1, 1, 2, 2];

/** Boards one and two solved: 50 + 60 points. */
const SEED_ONE_TWO_BOARDS = [
  1, 1, 8, 8, 10, 10, 19, 19, 22, 22, 4, 4, 7, 7, 15, 15, 18, 18, 29, 29, 32, 32,
];

function playLine(seed: string, line: number[]): QueensRun {
  return line.reduce((run, cell) => tap(run, cell), createRun(seed));
}

/** The cells of a solution, in row order. */
function solutionCells(columns: readonly number[]): number[] {
  return columns.map((column, row) => row * columns.length + column);
}

describe("the solution is the verifier's solution", () => {
  it("draws seed 1's solutions in the order the SQL suite documents", () => {
    SEED_ONE_SOLUTIONS.forEach((columns, index) => {
      expect(solution("1", index + 1)).toEqual(columns);
    });
  });

  it("replays a seed larger than a JS safe integer exactly", () => {
    expect(solution("9223372036854775807", 1)).toEqual([4, 1, 3, 0, 2]);
    expect(solution("9223372036854775807", 11)).toEqual([5, 8, 3, 0, 2, 6, 1, 4, 7]);
  });

  it("treats a zero seed as the verifier's fallback state", () => {
    for (let level = 1; level <= 12; level += 1) {
      expect(solution("0", level)).toEqual(solution("2654435769", level));
    }
  });

  it("reduces a negative seed the way the verifier does", () => {
    expect(solution("-1", 3)).toEqual(solution("4294967295", 3));
  });

  it("refuses a seed that is not a whole number, and a level before the first", () => {
    expect(() => solution("1.5", 1)).toThrow(TypeError);
    expect(() => solution(1.5, 1)).toThrow(TypeError);
    expect(() => solution("1", 0)).toThrow(RangeError);
  });

  it("never puts two Queens in one column or touching", () => {
    for (let level = 1; level <= 30; level += 1) {
      const columns = solution("12345", level);
      expect([...columns].sort((a, b) => a - b)).toEqual(columns.map((_, index) => index));
      for (let row = 0; row + 1 < columns.length; row += 1) {
        expect(Math.abs(columns[row] - columns[row + 1])).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe("the boards", () => {
  it("grow from 5×5 to 9×9 and stay there", () => {
    expect([1, 2, 3, 4, 6, 7, 10, 11, 12, 100].map(boardSize)).toEqual([
      5, 6, 6, 7, 7, 8, 8, 9, 9, 9,
    ]);
  });

  it("have N connected regions, each holding one Queen of the solution", () => {
    for (const level of [1, 2, 4, 7, 11]) {
      const drawn = board("1", level);
      const { size, regions } = drawn;
      expect(drawn.solution).toEqual(solution("1", level));
      expect(new Set(regions)).toEqual(new Set(Array.from({ length: size }, (_, r) => r)));
      drawn.solution.forEach((column, row) => {
        expect(regions[row * size + column]).toBe(row);
      });
      for (let region = 0; region < size; region += 1) {
        const cells = regions.flatMap((r, cell) => (r === region ? [cell] : []));
        const seen = new Set([cells[0]]);
        const stack = [cells[0]];
        while (stack.length > 0) {
          const cell = stack.pop() as number;
          const row = Math.floor(cell / size);
          const column = cell % size;
          const around = [
            row > 0 ? cell - size : -1,
            row < size - 1 ? cell + size : -1,
            column > 0 ? cell - 1 : -1,
            column < size - 1 ? cell + 1 : -1,
          ];
          for (const other of around) {
            if (other >= 0 && regions[other] === region && !seen.has(other)) {
              seen.add(other);
              stack.push(other);
            }
          }
        }
        expect(seen.size).toBe(cells.length);
      }
    }
  });

  it("have exactly one solution, and it is the planted one", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const level of [1, 3, 5, 8, 11]) {
        const drawn = board(String(seed * 7919), level);
        expect(solutions(drawn.size, drawn.regions)).toEqual([drawn.solution]);
      }
    }
  });

  it("are the same board every time a seed and level are asked for", () => {
    const first = board("424242", 6);
    expect(board("424242", 6)).toBe(first);
    expect(board("424242", 7)).not.toEqual(first);
  });

  it("has a fallback layout that is always unique", () => {
    const columns = solution("1", 11);
    const regions = fallbackRegions(9, columns);
    expect(solutions(9, regions)).toEqual([columns]);
  });

  it("rules out a Queen's row, column, region and neighbours, and nothing else", () => {
    const size = 5;
    const regions = board("1", 1).regions;
    const cells = new Array(25).fill("empty");
    cells[12] = "queen";
    const blocked = blockedCells(size, regions, cells);
    expect(blocked.has(12)).toBe(false);
    for (const cell of [10, 11, 13, 14, 2, 7, 17, 22, 6, 8, 16, 18])
      expect(blocked.has(cell)).toBe(true);
    regions.forEach((region, cell) => {
      if (region === regions[12] && cell !== 12) expect(blocked.has(cell)).toBe(true);
    });
    expect(blockedCells(size, regions, new Array(25).fill("mark")).size).toBe(0);
  });
});

describe("a run", () => {
  it("starts on board one with the pinned rules version and no score", () => {
    const run = createRun("1");
    expect(run).toMatchObject({
      seed: "1",
      rulesVersion: QUEENS_RULES_VERSION,
      level: 1,
      score: 0,
      mistakes: 0,
      outcome: "playing",
    });
    expect(run.cells).toHaveLength(25);
    expect(QUEENS_RULES_VERSION).toBe("queens@1");
  });

  it("cycles a cell: empty, X, Queen, empty", () => {
    const cell = 1; // Seed 1, board one: row 0's Queen is in column 1.
    let run = tap(createRun("1"), cell);
    expect(run.cells[cell]).toBe("mark");
    run = tap(run, cell);
    expect(run.cells[cell]).toBe("queen");
    run = tap(run, cell);
    expect(run.cells[cell]).toBe("empty");
    expect(run.taps).toEqual([1, 1, 1]);
    expect(run.mistakes).toBe(0);
  });

  it("counts a Queen off the solution as a mistake and locks the cell", () => {
    let run = tap(tap(createRun("1"), 0), 0);
    expect(run.cells[0]).toBe("ruled-out");
    expect(run.mistakes).toBe(1);
    expect(canTap(run, 0)).toBe(false);
    expect(tap(run, 0)).toBe(run);
    run = tap(run, 0);
    expect(run.taps).toEqual([0, 0]);
  });

  it("solves a board on its last Queen, scores ten a row and deals an empty next board", () => {
    const run = playLine("1", SEED_ONE_LINE.slice(0, 10));
    expect(run.level).toBe(2);
    expect(run.levelsCleared).toBe(1);
    expect(run.score).toBe(50);
    expect(run.cells).toEqual(new Array(36).fill("empty"));
  });

  it("scores seed 1's two-board line at 110, as the SQL suite does", () => {
    const run = playLine("1", SEED_ONE_TWO_BOARDS);
    expect(run).toMatchObject({ level: 3, levelsCleared: 2, score: 110, outcome: "playing" });
  });

  it("ends seed 1's line on the third mistake, keeping the solved board", () => {
    const run = playLine("1", SEED_ONE_LINE);
    expect(run).toMatchObject({
      level: 2,
      levelsCleared: 1,
      score: 50,
      mistakes: QUEENS_MISTAKES,
      outcome: "over",
      stopped: false,
    });
    expect(run.taps).toEqual(SEED_ONE_LINE);
    expect(canTap(run, 5)).toBe(false);
    expect(tap(run, 5)).toBe(run);
  });

  it("carries mistakes from one board to the next", () => {
    const run = playLine("1", [0, 0, ...SEED_ONE_LINE.slice(0, 10)]);
    expect(run.level).toBe(2);
    expect(run.mistakes).toBe(1);
  });

  it("lets the player end the run and keep its score", () => {
    const run = finish(playLine("1", SEED_ONE_LINE.slice(0, 11)));
    expect(run).toMatchObject({ score: 50, outcome: "over", stopped: true });
    expect(run.taps).toHaveLength(11);
    expect(finish(run)).toBe(run);
  });

  it("offers no tap off the current board", () => {
    const run = createRun("1");
    expect(canTap(run, 25)).toBe(false);
    expect(canTap(run, -1)).toBe(false);
    expect(canTap(run, 1.5)).toBe(false);
    expect(canTap(run, 24)).toBe(true);
  });

  it("ends a run at the submission bound rather than offering a tap it cannot carry", () => {
    const almost: QueensRun = {
      ...createRun("1"),
      taps: new Array(QUEENS_MAX_ACTIONS - 1).fill(3),
    };
    const run = tap(almost, 3);
    expect(run.outcome).toBe("over");
    expect(canTap(run, 4)).toBe(false);
  });

  it("assembles the submission from the run, so the claim cannot be edited on the way out", () => {
    const run = playLine("1", SEED_ONE_LINE);
    expect(submission(run)).toEqual({
      rulesVersion: "queens@1",
      actions: SEED_ONE_LINE,
      score: 50,
      tapsPlaced: SEED_ONE_LINE.length,
      levelsCleared: 1,
    });
  });

  it("reports the board, Queens placed and mistakes left", () => {
    const run = playLine("1", [1, 1, 0, 0]);
    expect(progress(run)).toEqual({ level: 1, side: 5, queens: 1, mistakesLeft: 2 });
  });
});
