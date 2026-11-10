import { describe, expect, it } from "vitest";

import { whittleHint, whittleProgress } from "@/lib/games/whittle-hints";
import {
  board,
  boardCode,
  boardFrom,
  canMark,
  CIRCLED,
  columnSum,
  createRun,
  CROSSED,
  WHITTLE_MAX_NUMBER,
  WHITTLE_PAR_MS,
  WHITTLE_RULES_VERSION,
  finish,
  isSolved,
  mark,
  nextMark,
  parMs,
  replay,
  rowSum,
  solutions,
  submission,
  tierIndex,
  tierOf,
  UNMARKED,
  type WhittleMark,
  type WhittleRun,
} from "@/lib/games/whittle";

/**
 * The engine's tests are pinned to the *database's* numbers: the boards below are
 * the ones `tests/security/verifier_vectors.sql` asserts `public.whittle_board`
 * deals, and the scored lines are what `public.complete_whittle_run` replays.
 */

/** Seed 1's first two boards: 25 numbers, 5 row targets, 5 column targets. */
const BOARD_ONE = "8,6,4,6,7,4,9,1,3,3,4,2,3,1,1,4,7,1,8,8,3,7,9,6,4,21,13,8,19,7,16,29,4,3,16";
const BOARD_TWO = "5,3,2,2,9,2,4,7,7,5,6,4,4,4,9,5,4,8,9,1,8,4,8,2,3,2,9,13,17,14,5,12,22,2,14";

/** The moves that solve seed 1's first and second boards, as `cell × 10 + mark`. */
const LINE_ONE = [21, 31, 51, 91, 111, 131, 171, 181, 201, 221, 231, 241];
const LINE_TWO = [1, 11, 31, 41, 51, 71, 81, 101, 111, 131, 181, 191, 201, 241];

function play(run: WhittleRun, moves: readonly number[]): WhittleRun {
  return moves.reduce((current, move) => mark(current, Math.floor(move / 10), move % 10), run);
}

const asMarks = (crossed: readonly boolean[]): WhittleMark[] =>
  crossed.map((gone) => (gone ? CROSSED : UNMARKED));

describe("a board", () => {
  it("is the one the database deals", () => {
    expect(boardCode(board(1, 1))).toBe(BOARD_ONE);
    expect(boardCode(board("1", 2))).toBe(BOARD_TWO);
    expect(board(1n, 1)).toBe(board("1", 1));
  });

  it("has targets its own answer makes, none zero, and never starts solved", () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      for (const level of [1, 3, 4, 7, 8, 20]) {
        const drawn = board(seed, level);
        const answer = asMarks(drawn.crossed);
        expect(isSolved(drawn, answer), `seed ${seed} board ${level}`).toBe(true);
        expect(isSolved(drawn, asMarks(drawn.crossed.map(() => false)))).toBe(false);
        expect(Math.min(...drawn.rowTargets, ...drawn.columnTargets)).toBeGreaterThan(0);
        const max = WHITTLE_MAX_NUMBER[tierIndex(level)];
        expect(drawn.numbers.every((n) => n >= 1 && n <= max)).toBe(true);
        expect(drawn.numbers).toHaveLength(25);
      }
    }
  });

  it("steps through the tiers, with more par for the harder ones", () => {
    expect([1, 3, 4, 7, 8, 50].map(tierOf)).toEqual([
      "easy",
      "easy",
      "medium",
      "medium",
      "hard",
      "hard",
    ]);
    expect(parMs(0)).toBe(0);
    expect(parMs(4)).toBe(3 * WHITTLE_PAR_MS[0] + WHITTLE_PAR_MS[1]);
    expect(() => board(1, 0)).toThrow(RangeError);
    expect(() => board("x", 1)).toThrow(TypeError);
  });

  it("lists every answer once, the drawn one first", () => {
    const drawn = board(1, 1);
    const all = solutions(drawn);
    expect(all[0]).toEqual(drawn.crossed);
    for (const answer of all) expect(isSolved(drawn, asMarks(answer))).toBe(true);

    // Rows one and two are the same, and each loses one of its first two numbers:
    // crossing (0,0) and (1,1) or (0,1) and (1,0) both make every target.
    const twin = boardFrom(
      [2, 2, 5, 5, 5, 2, 2, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
      Array.from({ length: 25 }, (_, cell) => cell === 0 || cell === 6),
    );
    const answers = solutions(twin);
    expect(answers.length).toBeGreaterThanOrEqual(2);
    expect(new Set(answers.map((answer) => answer.join())).size).toBe(answers.length);
    for (const answer of answers) expect(isSolved(twin, asMarks(answer))).toBe(true);
  });
});

describe("a run", () => {
  it("scores a solved board and deals the next", () => {
    let run = play(createRun(1), LINE_ONE.slice(0, -1));
    expect(run).toMatchObject({ level: 1, score: 0, levelsCleared: 0 });
    run = play(run, LINE_ONE.slice(-1));
    expect(run).toMatchObject({ level: 2, score: 50, levelsCleared: 1, outcome: "playing" });
    expect(run.marks.every((m) => m === UNMARKED)).toBe(true);
    run = play(run, LINE_TWO);
    expect(run).toMatchObject({ level: 3, score: 100, levelsCleared: 2 });
    expect(run.moves).toEqual([...LINE_ONE, ...LINE_TWO]);
  });

  it("counts a circled number as standing, and solves by sums alone", () => {
    const drawn = board(1, 1);
    let run = mark(createRun(1), 0, CIRCLED);
    expect(rowSum(drawn, run.marks, 0)).toBe(8 + 6 + 4 + 6 + 7);
    run = mark(run, 0, CROSSED);
    expect(rowSum(drawn, run.marks, 0)).toBe(6 + 4 + 6 + 7);
    expect(columnSum(drawn, run.marks, 0)).toBe(4 + 4 + 4 + 3);
    // A circle on a number that stays does not get in the way of the solve.
    run = play(mark(run, 0, CIRCLED), [42, ...LINE_ONE]);
    expect(run.levelsCleared).toBe(1);
  });

  it("refuses a move that changes nothing or is off the board", () => {
    const run = createRun(1);
    expect(canMark(run, 0, UNMARKED)).toBe(false);
    expect(canMark(run, 25, CROSSED)).toBe(false);
    expect(canMark(run, -1, CROSSED)).toBe(false);
    expect(canMark(run, 0, 3)).toBe(false);
    expect(mark(run, 0, 3)).toBe(run);
    expect(canMark(finish(run), 0, CROSSED)).toBe(false);
  });

  it("cycles a tap through cross, circle and clear", () => {
    const marks: WhittleMark[] = [UNMARKED, CROSSED, CIRCLED];
    expect(marks.map(nextMark)).toEqual([CROSSED, CIRCLED, UNMARKED]);
  });

  it("ends when the player stops, and submits what it played", () => {
    const run = finish(play(createRun(1), [...LINE_ONE, 2]));
    expect(run).toMatchObject({ outcome: "over", ending: "stopped" });
    expect(submission(run)).toEqual({
      rulesVersion: WHITTLE_RULES_VERSION,
      actions: [...LINE_ONE, 2],
      score: 50,
      tapsPlaced: 13,
      levelsCleared: 1,
    });
    expect(replay(1, submission(run).actions)).toEqual({
      ...run,
      outcome: "playing",
      ending: null,
    });
  });
});

describe("a hint", () => {
  it("can be followed from a fresh board to the solve", () => {
    for (const seed of [1, 42, 77]) {
      let run = createRun(seed);
      for (let step = 0; step < 30 && run.levelsCleared === 0; step += 1) {
        const hint = whittleHint(run)!;
        expect(hint.action).toBe("cross");
        expect(hint.reason.length).toBeGreaterThan(10);
        const before = whittleProgress(run);
        run = mark(run, hint.cell, CROSSED);
        if (run.levelsCleared === 0) expect(whittleProgress(run)).not.toBe(before);
      }
      expect(run.levelsCleared, `seed ${seed}`).toBe(1);
    }
  });

  it("takes back a cross no answer has, then a circle on a number that goes", () => {
    const drawn = board(1, 1);
    const stays = drawn.crossed.indexOf(false);
    const goes = drawn.crossed.indexOf(true);
    let run = mark(createRun(1), stays, CROSSED);
    expect(whittleHint(run)).toMatchObject({ cell: stays, action: "restore" });
    run = mark(mark(run, stays, UNMARKED), goes, CIRCLED);
    expect(whittleHint(run)).toMatchObject({ cell: goes, action: "restore" });
    expect(whittleHint(finish(run))).toBeNull();
  });
});
