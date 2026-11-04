import { describe, expect, it } from "vitest";

import * as bolted from "@/lib/games/bolted";
import * as cascade from "@/lib/games/cascade";
import * as checkmate from "@/lib/games/checkmate";
import * as decant from "@/lib/games/decant";
import * as eightPuzzle from "@/lib/games/eight-puzzle";
import * as huedini from "@/lib/games/huedini";
import * as miniSudoku from "@/lib/games/mini-sudoku";
import * as scatter from "@/lib/games/scatter";
import * as sudoku from "@/lib/games/sudoku";
import * as tango from "@/lib/games/tango";
import * as zip from "@/lib/games/zip";

const SEED = "123456";

/**
 * A continued run is rebuilt from its saved moves, so a replay has to land on exactly
 * the run those moves made: same board, same score, same level, same clock. Each case
 * plays some real moves the way the game's screen does, then replays what it submitted.
 */
function expectSameRun<R extends { outcome: string }>(
  played: R,
  actionsOf: (run: R) => readonly number[],
  replay: (seed: string, actions: readonly number[]) => R,
) {
  const actions = actionsOf(played);
  expect(actions.length).toBeGreaterThan(0);
  expect(replay(SEED, actions)).toEqual(played);
}

describe("replaying a saved run", () => {
  it("rebuilds Trail", () => {
    let run = zip.createRun(SEED);
    for (const cell of zip.solution(SEED, run.level).slice(0, 4)) run = zip.tap(run, cell);
    expectSameRun(run, (r) => zip.submission(r).actions, zip.replay);
  });

  it("rebuilds Trail across a solved board, with the time it earned", () => {
    let run = zip.createRun(SEED);
    const first = run.level;
    for (const cell of zip.solution(SEED, first)) run = zip.tap(run, cell);
    expect(run.levelsCleared).toBe(1);
    const again = zip.replay(SEED, zip.submission(run).actions);
    expect(again.levelsCleared).toBe(1);
    expect(again.score).toBe(run.score);
  });

  it("rebuilds 8 Puzzle", () => {
    let run = eightPuzzle.createRun(SEED);
    for (let i = 0; i < 12; i += 1) {
      const cell = run.tiles.findIndex((_, index) => eightPuzzle.canTap(run, index));
      run = eightPuzzle.tap(run, cell);
    }
    expectSameRun(run, (r) => eightPuzzle.submission(r).actions, eightPuzzle.replay);
  });

  it("rebuilds Sun & Moon", () => {
    let run = tango.createRun(SEED);
    const cells = run.cells.map((_, index) => index).filter((index) => tango.canTap(run, index));
    for (const cell of cells.slice(0, 5)) run = tango.tap(run, cell);
    expectSameRun(run, (r) => tango.submission(r).actions, tango.replay);
  });

  it("rebuilds Sudoku, whose moves carry the cell and the digit", () => {
    let run = sudoku.createRun(SEED);
    const answer = sudoku.solution(SEED, run.level);
    const open = run.cells
      .map((_, index) => index)
      .filter((index) => sudoku.isEditable(run, index));
    for (const cell of open.slice(0, 6)) run = sudoku.place(run, cell, answer[cell]!);
    expectSameRun(run, (r) => sudoku.submission(r).actions, sudoku.replay);
  });

  it("rebuilds Mini Sudoku", () => {
    let run = miniSudoku.createRun(SEED);
    const answer = miniSudoku.solution(SEED, run.level);
    const open = run.cells
      .map((_, index) => index)
      .filter((index) => miniSudoku.isEditable(run, index));
    for (const cell of open.slice(0, 6)) run = miniSudoku.place(run, cell, answer[cell]!);
    expectSameRun(run, (r) => miniSudoku.submission(r).actions, miniSudoku.replay);
  });

  it("rebuilds Cascade", () => {
    let run = cascade.createRun(SEED);
    for (let i = 0; i < 5; i += 1) {
      const action = cascade.findSwap(run.board);
      expect(action).not.toBeNull();
      run = cascade.apply(run, action!);
    }
    expectSameRun(run, (r) => cascade.submission(r).actions, cascade.replay);
  });

  it("rebuilds Checkmate, including a skip", () => {
    let run = checkmate.createRun(SEED);
    run = checkmate.skip(run);
    run = checkmate.skip(run);
    expectSameRun(run, (r) => checkmate.submission(r).actions, checkmate.replay);
  });

  it("rebuilds Decant, including an undo and an extra tube", () => {
    let run = decant.createRun(SEED);
    const pours: Array<[number, number]> = [];
    for (let from = 0; from < run.tubes.length && pours.length < 3; from += 1) {
      for (let to = 0; to < run.tubes.length && pours.length < 3; to += 1) {
        if (from !== to && decant.canPour(run, from, to)) {
          run = decant.pour(run, from, to);
          pours.push([from, to]);
        }
      }
    }
    expect(pours.length).toBeGreaterThan(0);
    run = decant.undo(run);
    run = decant.addTube(run);
    expectSameRun(run, (r) => decant.submission(r).actions, decant.replay);
  });

  it("rebuilds Bolted, including an undo and an extra bolt", () => {
    let run = bolted.createRun(SEED);
    const moves: Array<[number, number]> = [];
    for (let from = 0; from < run.bolts.length && moves.length < 3; from += 1) {
      for (let to = 0; to < run.bolts.length && moves.length < 3; to += 1) {
        if (from !== to && bolted.canMove(run, from, to)) {
          run = bolted.move(run, from, to);
          moves.push([from, to]);
        }
      }
    }
    expect(moves.length).toBeGreaterThan(0);
    run = bolted.undo(run);
    run = bolted.addBolt(run);
    expectSameRun(run, (r) => bolted.submission(r).actions, bolted.replay);
  });

  it("rebuilds Huedini", () => {
    let run = huedini.createRun(SEED);
    const solved = huedini.solve(run.board);
    expect(solved).not.toBeNull();
    for (const [block, direction] of solved!.slice(0, 2)) {
      const found = run.board.blocks[block as number] as huedini.HuediniBlock;
      run = huedini.move(run, found, direction);
    }
    expectSameRun(run, (r) => huedini.submission(r).actions, huedini.replay);
  });

  it("rebuilds Scatter", () => {
    let run = scatter.createRun(SEED);
    for (let i = 0; i < 3; i += 1) {
      const cell = run.cells.findIndex((_, index) => scatter.canTap(run, index));
      expect(cell).toBeGreaterThanOrEqual(0);
      run = scatter.tap(run, cell);
    }
    expectSameRun(run, (r) => scatter.submission(r).actions, scatter.replay);
  });
});
