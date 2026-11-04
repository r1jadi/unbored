import { describe, expect, it } from "vitest";

import { board as decantBoard } from "@/lib/games/decant";
import {
  addBolt,
  board,
  BOLTED_EXTRA_BOLT,
  BOLTED_RESTART,
  BOLTED_RULES_VERSION,
  BOLTED_UNDO,
  budgetMs,
  canMove,
  coloursFor,
  createRun,
  encodeMove,
  finish,
  isLocked,
  move,
  moveAmount,
  restart,
  solve,
  submission,
  undo,
  type BoltedRun,
} from "@/lib/games/bolted";

const text = (bolts: readonly (readonly number[])[]) =>
  bolts.map((bolt) => (bolt.length ? bolt.join("") : "-")).join(" ");

/** Plays a board's solution, move by move. */
function solveBoard(run: BoltedRun): BoltedRun {
  const level = run.level;
  for (const [from, to] of solve(run.bolts)!) run = move(run, from, to);
  expect(run.level).toBe(level + 1);
  return run;
}

describe("the boards", () => {
  it("deals seed 1's first boards", () => {
    expect(text(board("1", 1))).toBe(SEED_1_BOARDS[0]);
    expect(text(board("1", 2))).toBe(SEED_1_BOARDS[1]);
    expect(text(board("1", 13))).toBe(SEED_1_BOARDS[2]);
  });

  it("is not Decant's deal for the same seed", () => {
    expect(text(board("1", 1))).not.toBe(text(decantBoard("1", 1)));
  });

  it("grows from three colours to eight, with two empty bolts", () => {
    expect([1, 2, 3, 4, 11, 12, 30].map(coloursFor)).toEqual([3, 3, 4, 4, 8, 8, 8]);
    const dealt = board("7", 11);
    expect(dealt).toHaveLength(10);
    expect(dealt.slice(-2)).toEqual([[], []]);
  });

  it("deals boards that can be sorted", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const level of [1, 3, 5, 9]) {
        expect(solve(board(String(seed), level)), `seed ${seed}, board ${level}`).not.toBeNull();
      }
    }
  });
});

describe("a move", () => {
  it("carries the top run of one colour, as much as fits", () => {
    expect(moveAmount([[1, 2, 2], [3, 2], []], 0, 2)).toBe(2);
    expect(moveAmount([[1, 2, 2], [3, 3, 2], []], 0, 1)).toBe(1);
    expect(moveAmount([[1, 2], [3, 1], []], 0, 1)).toBe(0);
  });

  it("never moves a locked bolt", () => {
    const bolts = [[2, 2, 2, 2], [], [1]];
    expect(isLocked(bolts[0])).toBe(true);
    expect(moveAmount(bolts, 0, 1)).toBe(0);
  });

  it("solves a board for a point a colour, and deals the next", () => {
    const run = solveBoard(createRun("1"));
    expect(run.score).toBe(3);
    expect(run.levelsCleared).toBe(1);
    expect(run.rulesVersion).toBe(BOLTED_RULES_VERSION);
    expect(budgetMs(1)).toBe(75_000 + 18_000);
  });
});

describe("hidden nuts", () => {
  it("are all face up on the first two boards", () => {
    expect(createRun("1").hidden.every((h) => h === 0)).toBe(true);
  });

  it("hide all but the top of each dealt bolt from board three, and uncover as nuts move", () => {
    let run = createRun("1");
    run = solveBoard(solveBoard(run));
    expect(run.level).toBe(3);
    const colours = coloursFor(3);
    expect(run.hidden.slice(0, colours)).toEqual(Array.from({ length: colours }, () => 3));

    const [from, to] = solve(run.bolts)![0];
    const carried = moveAmount(run.bolts, from, to);
    const after = move(run, from, to);
    expect(after.hidden[from]).toBe(Math.max(0, 4 - carried - 1));
    // Undo puts the nuts back but keeps them face up.
    expect(undo(after).hidden[from]).toBe(after.hidden[from]);
  });
});

describe("the board's controls", () => {
  it("undo, restart and the extra bolt are actions, and the bolt costs clock", () => {
    let run = createRun("1");
    const [from, to] = solve(run.bolts)![0];
    run = move(run, from, to);
    run = undo(run);
    run = move(run, from, to);
    run = restart(run);
    run = addBolt(run);
    expect(run.bolts).toHaveLength(6);
    expect(addBolt(run)).toBe(run);
    expect(submission(run).actions).toEqual([
      encodeMove(from, to),
      BOLTED_UNDO,
      encodeMove(from, to),
      BOLTED_RESTART,
      BOLTED_EXTRA_BOLT,
    ]);
    expect(budgetMs(0, 1)).toBe(60_000);
  });

  it("takes nothing once the run is over", () => {
    const run = finish(createRun("1"), "time");
    expect(canMove(run, 0, 3)).toBe(false);
    expect(undo(run)).toBe(run);
  });
});

/** Seed 1's boards 1, 2 and 13, bolts bottom to top, `-` empty. */
const SEED_1_BOARDS = [
  "2132 3321 1321 - -",
  "1311 3122 3322 - -",
  "8685 7421 2544 7367 8383 1146 6213 2575 - -",
];
