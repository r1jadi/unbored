import { describe, expect, it } from "vitest";

import {
  board,
  budgetMs,
  canTap,
  cellForArrow,
  createRun,
  EIGHT_PUZZLE_MAX_ACTIONS,
  EIGHT_PUZZLE_RULES_VERSION,
  fewestMoves,
  finish,
  scrambleLength,
  SOLVED,
  submission,
  tap,
  type EightPuzzleRun,
} from "@/lib/games/eight-puzzle";

/**
 * The engine's tests are pinned to the *database's* numbers.
 *
 * `public.complete_eight_puzzle_run` replays the submitted slides against each
 * board. The boards and scored lines below are the ones
 * `tests/security/rls_test.sql` asserts for the same seeds.
 */

/** Seed 1's first two boards, in board order; 0 is the gap. */
const SEED_ONE_BOARD_ONE = [1, 6, 0, 5, 3, 2, 4, 7, 8];
const SEED_ONE_BOARD_TWO = [4, 1, 2, 0, 7, 3, 8, 5, 6];

/** The cells slid to solve them, each a shortest solution. */
const SOLVE_ONE = [5, 4, 1, 2, 5, 4, 3, 6, 7, 8];
const SOLVE_TWO = [4, 7, 6, 3, 0, 1, 2, 5, 8];

function playLine(seed: string, line: readonly number[]): EightPuzzleRun {
  return line.reduce((run, cell) => tap(run, cell), createRun(seed));
}

/** Whether a board can be solved: an even number of inversions among its tiles. */
function solvable(tiles: readonly number[]): boolean {
  const order = tiles.filter((tile) => tile !== 0);
  let inversions = 0;
  for (let i = 0; i < order.length; i += 1) {
    for (let j = i + 1; j < order.length; j += 1) if (order[i] > order[j]) inversions += 1;
  }
  return inversions % 2 === 0;
}

describe("the boards are the verifier's boards", () => {
  it("draws seed 1's first two boards in the order the SQL suite documents", () => {
    expect(board("1", 1)).toEqual(SEED_ONE_BOARD_ONE);
    expect(board("1", 2)).toEqual(SEED_ONE_BOARD_TWO);
  });

  it("replays a seed larger than a JS safe integer exactly", () => {
    expect(board("9223372036854775807", 1)).toEqual([2, 3, 6, 1, 0, 8, 7, 4, 5]);
    expect(board("9223372036854775807", 30)).toEqual([1, 3, 7, 6, 0, 4, 8, 5, 2]);
  });

  it("treats a zero seed as the verifier's fallback state", () => {
    expect(board("0", 5)).toEqual(board("2654435769", 5));
  });

  it("refuses a seed that is not a whole number, and a level before the first", () => {
    expect(() => board("1.5", 1)).toThrow(TypeError);
    expect(() => board("1", 0)).toThrow(RangeError);
  });

  it("scrambles more on every board, up to eighty steps", () => {
    expect([1, 2, 3, 24, 25, 100].map(scrambleLength)).toEqual([10, 13, 16, 79, 80, 80]);
  });

  it("is always solvable, never already solved, and never further than its scramble", () => {
    for (let level = 1; level <= 40; level += 1) {
      const tiles = board("31337", level);
      expect([...tiles].sort()).toEqual([...SOLVED].sort());
      expect(solvable(tiles)).toBe(true);
      expect(tiles).not.toEqual(SOLVED);
      const fewest = fewestMoves(tiles);
      expect(fewest).toBeGreaterThan(0);
      expect(fewest).toBeLessThanOrEqual(Math.min(31, scrambleLength(level)));
    }
  });
});

describe("the par", () => {
  it("finds the fewest slides that solve a board", () => {
    expect(fewestMoves(SOLVED)).toBe(0);
    expect(fewestMoves([1, 2, 3, 4, 5, 6, 7, 0, 8])).toBe(1);
    expect(fewestMoves(SEED_ONE_BOARD_ONE)).toBe(SOLVE_ONE.length);
    expect(fewestMoves(SEED_ONE_BOARD_TWO)).toBe(SOLVE_TWO.length);
    // The hardest 3×3 boards are 31 slides from solved.
    expect(fewestMoves([8, 6, 7, 2, 5, 4, 3, 0, 1])).toBe(31);
  });
});

describe("the clock", () => {
  it("starts at sixty seconds and adds fifteen per solved board", () => {
    expect([0, 1, 4].map(budgetMs)).toEqual([60_000, 75_000, 120_000]);
  });
});

describe("a run", () => {
  it("starts on board one with the pinned rules version", () => {
    expect(createRun("1")).toMatchObject({
      seed: "1",
      rulesVersion: EIGHT_PUZZLE_RULES_VERSION,
      level: 1,
      tiles: SEED_ONE_BOARD_ONE,
      moves: 0,
      score: 0,
      outcome: "playing",
    });
    expect(EIGHT_PUZZLE_RULES_VERSION).toBe("eight-puzzle@1");
  });

  it("slides only a tile next to the gap", () => {
    const run = createRun("1"); // the gap is on cell 2
    expect(canTap(run, 1)).toBe(true);
    expect(canTap(run, 5)).toBe(true);
    expect(canTap(run, 0)).toBe(false);
    expect(canTap(run, 2)).toBe(false); // the gap itself
    expect(canTap(run, 9)).toBe(false);
    expect(tap(run, 0)).toBe(run);
    expect(tap(run, 5)).toMatchObject({ tiles: [1, 6, 2, 5, 3, 0, 4, 7, 8], moves: 1 });
  });

  it("solves a board on its last slide, scores ten and deals the next", () => {
    const run = playLine("1", SOLVE_ONE);
    expect(run).toMatchObject({
      level: 2,
      levelsCleared: 1,
      score: 10,
      moves: 0,
      tiles: SEED_ONE_BOARD_TWO,
    });
  });

  it("scores seed 1's two-board line at 20, as the SQL suite does", () => {
    const run = playLine("1", [...SOLVE_ONE, ...SOLVE_TWO]);
    expect(run).toMatchObject({ level: 3, levelsCleared: 2, score: 20 });
  });

  it("maps an arrow to the tile on the far side of the gap", () => {
    const run = createRun("1"); // gap at row 1, column 3
    expect(cellForArrow(run, "ArrowUp")).toBe(5);
    expect(cellForArrow(run, "ArrowRight")).toBe(1);
    expect(cellForArrow(run, "ArrowDown")).toBeNull();
    expect(cellForArrow(run, "ArrowLeft")).toBeNull();
  });

  it("ends where the player stops or the clock runs out, keeping the score", () => {
    const stopped = finish(playLine("1", [...SOLVE_ONE, 4, 7]), "stopped");
    expect(stopped).toMatchObject({ score: 10, outcome: "over", ending: "stopped" });
    expect(tap(stopped, 6)).toBe(stopped);
    expect(finish(stopped, "time")).toBe(stopped);
  });

  it("ends a run at the submission bound", () => {
    const almost: EightPuzzleRun = {
      ...createRun("1"),
      taps: new Array(EIGHT_PUZZLE_MAX_ACTIONS - 1).fill(5),
    };
    expect(tap(almost, 5)).toMatchObject({ outcome: "over", ending: "bound" });
  });

  it("assembles the submission from the run", () => {
    const run = finish(playLine("1", [...SOLVE_ONE, 4, 7]), "stopped");
    expect(submission(run)).toEqual({
      rulesVersion: "eight-puzzle@1",
      actions: [...SOLVE_ONE, 4, 7],
      score: 10,
      tapsPlaced: 12,
      levelsCleared: 1,
    });
  });
});
