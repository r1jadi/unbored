import { describe, expect, it } from "vitest";

import {
  board,
  boardSize,
  budgetMs,
  canMove,
  canTap,
  createRun,
  finish,
  move,
  solution,
  solutions,
  submission,
  tap,
  ZIP_MAX_ACTIONS,
  ZIP_RULES_VERSION,
  type ZipRun,
} from "@/lib/games/zip";

/**
 * The engine's tests are pinned to the *database's* numbers.
 *
 * `public.complete_zip_run` replays the submitted cells against each board's
 * solution path. The solution vectors and scored lines below are the ones
 * `tests/security/rls_test.sql` asserts for the same seeds. The checkpoints and
 * walls are the client's alone, and are tested here for the property that
 * matters: the solution is the board's only path.
 */

/** Seed 1's first two solutions (5×5): every cell, in path order. */
const SEED_ONE_BOARD_ONE = [
  8, 7, 6, 5, 10, 15, 20, 21, 16, 11, 12, 17, 22, 23, 24, 19, 18, 13, 14, 9, 4, 3, 2, 1, 0,
];
const SEED_ONE_BOARD_TWO = [
  20, 15, 10, 5, 0, 1, 6, 11, 12, 7, 2, 3, 4, 9, 8, 13, 14, 19, 18, 17, 16, 21, 22, 23, 24,
];

/** Board one solved, then board two started, cut back once, and the run ended. */
const SEED_ONE_LINE = [...SEED_ONE_BOARD_ONE, 20, 15, 10, 5, 15, 10];

function playLine(seed: string, line: readonly number[]): ZipRun {
  return line.reduce((run, cell) => tap(run, cell), createRun(seed));
}

describe("the solution is the verifier's solution", () => {
  it("draws seed 1's solution paths in the order the SQL suite documents", () => {
    expect(solution("1", 1)).toEqual(SEED_ONE_BOARD_ONE);
    expect(solution("1", 2)).toEqual(SEED_ONE_BOARD_TWO);
  });

  it("replays a seed larger than a JS safe integer exactly", () => {
    expect(solution("9223372036854775807", 1)).toEqual([
      0, 1, 2, 3, 4, 9, 14, 13, 18, 19, 24, 23, 22, 21, 20, 15, 16, 17, 12, 11, 10, 5, 6, 7, 8,
    ]);
  });

  it("treats a zero seed as the verifier's fallback state", () => {
    for (const level of [1, 3, 9]) {
      expect(solution("0", level)).toEqual(solution("2654435769", level));
    }
  });

  it("refuses a seed that is not a whole number, and a level before the first", () => {
    expect(() => solution("1.5", 1)).toThrow(TypeError);
    expect(() => solution("1", 0)).toThrow(RangeError);
  });

  it("visits every cell once, one orthogonal step at a time", () => {
    for (let level = 1; level <= 12; level += 1) {
      const size = boardSize(level);
      const path = solution("4242", level);
      expect([...path].sort((a, b) => a - b)).toEqual(path.map((_, index) => index));
      for (let index = 1; index < path.length; index += 1) {
        const a = path[index - 1];
        const b = path[index];
        const sameRow = Math.floor(a / size) === Math.floor(b / size) && Math.abs(a - b) === 1;
        const sameColumn = a % size === b % size && Math.abs(a - b) === size;
        expect(sameRow || sameColumn).toBe(true);
      }
    }
  });
});

describe("the boards", () => {
  it("grow from 5×5 to 7×7 and stay there", () => {
    expect([1, 2, 3, 8, 9, 50].map(boardSize)).toEqual([5, 5, 6, 6, 7, 7]);
  });

  it("number the solution's first cell 1 and its last the highest, in path order", () => {
    for (const level of [1, 3, 9]) {
      const drawn = board("1", level);
      expect(drawn.numbers[drawn.solution[0]]).toBe(1);
      expect(drawn.numbers[drawn.solution[drawn.solution.length - 1]]).toBe(drawn.last);
      const inOrder = drawn.solution.map((cell) => drawn.numbers[cell]).filter((n) => n > 0);
      expect(inOrder).toEqual(inOrder.map((_, index) => index + 1));
    }
  });

  it("never wall off a step the solution takes", () => {
    for (const level of [1, 3, 9]) {
      const drawn = board("77", level);
      for (let index = 1; index < drawn.solution.length; index += 1) {
        const a = Math.min(drawn.solution[index - 1], drawn.solution[index]);
        const b = Math.max(drawn.solution[index - 1], drawn.solution[index]);
        expect(drawn.walls.some(([x, y]) => x === a && y === b)).toBe(false);
      }
    }
  });

  it("have exactly one solution, and it is the planted one", () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      for (const level of [1, 3, 9]) {
        const drawn = board(String(seed * 7919), level);
        expect(solutions(drawn.size, drawn.numbers, drawn.walls)).toEqual([drawn.solution]);
      }
    }
  });
});

describe("the clock", () => {
  it("starts at sixty seconds and adds five seconds a row per solved board", () => {
    expect(budgetMs(0)).toBe(60_000);
    expect(budgetMs(1)).toBe(85_000);
    expect(budgetMs(2)).toBe(110_000);
    expect(budgetMs(3)).toBe(140_000);
    expect(budgetMs(9)).toBe(60_000 + 2 * 25_000 + 6 * 30_000 + 35_000);
  });
});

describe("a run", () => {
  it("starts on board one with the pinned rules version, no path and no score", () => {
    expect(createRun("1")).toMatchObject({
      seed: "1",
      rulesVersion: ZIP_RULES_VERSION,
      level: 1,
      path: [],
      score: 0,
      outcome: "playing",
      ending: null,
    });
    expect(ZIP_RULES_VERSION).toBe("zip@1");
  });

  it("starts the path only on the cell numbered 1", () => {
    const run = createRun("1");
    expect(canTap(run, 0)).toBe(false);
    expect(tap(run, 0)).toBe(run);
    expect(tap(run, 8).path).toEqual([8]);
  });

  it("extends the path to a neighbour of its head, and nowhere else", () => {
    const run = playLine("1", [8, 7]);
    expect(run.path).toEqual([8, 7]);
    expect(canTap(run, 6)).toBe(true);
    expect(canTap(run, 0)).toBe(false);
    expect(canTap(run, 7)).toBe(false); // the head itself is not a move
    expect(canTap(run, 25)).toBe(false);
  });

  it("cuts the path back when an earlier cell is entered again", () => {
    const run = playLine("1", [8, 7, 6, 5, 7]);
    expect(run.path).toEqual([8, 7]);
    expect(run.taps).toEqual([8, 7, 6, 5, 7]);
  });

  it("stops extending once the path reaches the solution's last cell", () => {
    const run = playLine("1", [8, 7, 6, 5, 0]);
    expect(canTap(run, 1)).toBe(false);
    expect(canTap(run, 7)).toBe(true);
  });

  it("solves a board when the path is the solution: ten a row, and a fresh board", () => {
    const run = playLine("1", SEED_ONE_BOARD_ONE);
    expect(run).toMatchObject({ level: 2, levelsCleared: 1, score: 50, path: [] });
  });

  it("scores seed 1's two-board line at 100, as the SQL suite does", () => {
    const run = playLine("1", [...SEED_ONE_BOARD_ONE, ...SEED_ONE_BOARD_TWO]);
    expect(run).toMatchObject({ level: 3, levelsCleared: 2, score: 100, outcome: "playing" });
  });

  it("ends where the player stops or the clock runs out, keeping the score", () => {
    const stopped = finish(playLine("1", SEED_ONE_LINE), "stopped");
    expect(stopped).toMatchObject({ score: 50, outcome: "over", ending: "stopped" });
    expect(stopped.path).toEqual([20, 15, 10]);
    expect(finish(stopped, "time")).toBe(stopped);
    expect(tap(stopped, 5)).toBe(stopped);
    expect(finish(createRun("1"), "time").ending).toBe("time");
  });

  it("ends a run at the submission bound", () => {
    const almost: ZipRun = { ...createRun("1"), taps: new Array(ZIP_MAX_ACTIONS - 1).fill(8) };
    const run = tap(almost, 8);
    expect(run).toMatchObject({ outcome: "over", ending: "bound" });
  });

  it("assembles the submission from the run", () => {
    const run = finish(playLine("1", SEED_ONE_LINE), "stopped");
    expect(submission(run)).toEqual({
      rulesVersion: "zip@1",
      actions: SEED_ONE_LINE,
      score: 50,
      tapsPlaced: SEED_ONE_LINE.length,
      levelsCleared: 1,
    });
  });
});

describe("the board's own rules", () => {
  // Seed 1's first board numbers 8 → 1, 6 → 2, 16 → 3, 12 → 4, 24 → 5, 14 → 6,
  // 2 → 7 and 0 → 8, with a wall between 14 and 19.
  const drawn = board("1", 1);

  it("refuses a number reached before the one it follows", () => {
    // 8 → 7 → 2 would reach 7 before 2.
    const run = playLine("1", [8, 7]);
    expect(drawn.numbers[2]).toBe(7);
    expect(canTap(run, 2)).toBe(true); // the verifier would accept it
    expect(canMove(run, drawn, 2)).toBe(false); // the board does not send it
    expect(move(run, drawn, 2)).toBe(run);
    expect(canMove(run, drawn, 6)).toBe(true);
  });

  it("refuses a step through a wall", () => {
    expect(drawn.walls).toContainEqual([14, 19]);
    const run = playLine("1", [8, 7, 6, 5, 10, 15, 20, 21, 16, 11, 12, 17, 22, 23, 24, 19]);
    expect(canTap(run, 14)).toBe(true);
    expect(canMove(run, drawn, 14)).toBe(false);
  });

  it("plays the whole solution through `move`", () => {
    const run = SEED_ONE_BOARD_ONE.reduce(
      (current, cell) => move(current, drawn, cell),
      createRun("1"),
    );
    expect(run.score).toBe(50);
  });
});
