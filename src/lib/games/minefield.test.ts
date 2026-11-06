import { describe, expect, it } from "vitest";

import {
  act,
  allSafeOpen,
  chordTargets,
  cleanBonus,
  clearBonus,
  CLOSED,
  createRun,
  FLAGGED,
  finish,
  HIT,
  MINE,
  MINEFIELD_FLAG_OFFSET as F,
  MINEFIELD_LIVES,
  MINEFIELD_MAX_ACTIONS,
  minesFor,
  minesLeft,
  minesOn,
  minePercent,
  neighbours,
  numbersFor,
  OPEN,
  replay,
  sideFor,
  submission,
  type MinefieldRun,
} from "./minefield";

const SEED = "12345";

/** Opens every safe cell of the current board, starting from `first`. */
function clearBoard(run: MinefieldRun, first = 27): MinefieldRun {
  let current = run.numbers ? run : act(run, first);
  const { level } = current;
  for (let cell = 0; current.level === level && cell < current.cells.length; cell += 1) {
    if (current.cells[cell] === CLOSED && current.numbers![cell] !== MINE) {
      current = act(current, cell);
    }
  }
  return current;
}

/** The first mine still closed on the board. */
const closedMine = (run: MinefieldRun) =>
  run.cells.findIndex((state, at) => state === CLOSED && run.numbers![at] === MINE);

describe("the boards", () => {
  it("grow from 8×8 to 10×10 and hold more mines up to 22%", () => {
    expect([1, 2, 3, 5, 6, 100].map(sideFor)).toEqual([8, 8, 9, 9, 10, 10]);
    expect([1, 2, 3, 19, 500].map(minePercent)).toEqual([13, 13, 14, 22, 22]);
    expect([1, 3, 6, 19, 500].map(minesFor)).toEqual([8, 11, 15, 22, 22]);
  });

  it("refuses a level that is not one", () => {
    expect(() => sideFor(0)).toThrow(RangeError);
    expect(() => minesOn(1, 1.5, 0)).toThrow(RangeError);
  });

  it("finds each cell's neighbours, ascending, at a corner, an edge and the middle", () => {
    expect(neighbours(0, 8)).toEqual([1, 8, 9]);
    expect(neighbours(4, 8)).toEqual([3, 5, 11, 12, 13]);
    expect(neighbours(27, 8)).toEqual([18, 19, 20, 26, 28, 34, 35, 36]);
    expect(neighbours(63, 8)).toEqual([54, 55, 62]);
  });

  it("draws the right number of distinct mines, sorted, the same every time", () => {
    for (const level of [1, 3, 6, 19]) {
      const mines = minesOn(SEED, level, 0);
      expect(mines).toHaveLength(minesFor(level));
      expect(new Set(mines).size).toBe(mines.length);
      expect([...mines].sort((a, b) => a - b)).toEqual(mines);
      expect(minesOn(SEED, level, 0)).toEqual(mines);
    }
  });

  it("keeps the first cell and its neighbours clear, wherever it is", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      for (const level of [1, 3, 6, 25]) {
        const side = sideFor(level);
        for (const first of [0, side - 1, side * side - 1, Math.floor((side * side) / 2)]) {
          const mines = new Set(minesOn(seed, level, first));
          expect(mines.has(first)).toBe(false);
          for (const near of neighbours(first, side)) expect(mines.has(near)).toBe(false);
        }
      }
    }
  });

  it("reads a whole bigint seed, not a rounded double", () => {
    expect(minesOn("9223372036854775807", 1, 0)).not.toEqual(minesOn("9223372036854775808", 1, 0));
    expect(() => createRun("not a seed")).toThrow(TypeError);
  });

  it("numbers each cell by the mines around it", () => {
    const numbers = numbersFor([0, 2], 3);
    expect(numbers).toEqual([MINE, 2, MINE, 1, 2, 1, 0, 0, 0]);
  });
});

describe("opening", () => {
  it("makes the first tap of a board safe, and opens an area", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const run = act(createRun(seed), seed % 64);
      expect(run.hits).toBe(0);
      expect(run.lives).toBe(MINEFIELD_LIVES);
      expect(run.opened).toBeGreaterThan(1);
      expect(run.numbers![seed % 64]).toBe(0);
      expect(run.score).toBe(run.opened);
    }
  });

  it("spreads from a zero, and only through zeros", () => {
    const run = act(createRun(SEED), 27);
    run.cells.forEach((state, at) => {
      if (state !== OPEN || run.numbers![at] !== 0) return;
      for (const near of neighbours(at, run.side)) expect(run.cells[near]).toBe(OPEN);
    });
    expect(run.cells.every((state, at) => state !== OPEN || run.numbers![at] !== MINE)).toBe(true);
  });

  it("costs a life for a mine, leaves it found, and carries on", () => {
    const first = act(createRun(SEED), 27);
    const mine = closedMine(first);
    const left = minesLeft(first);
    const run = act(first, mine);
    expect(run.cells[mine]).toBe(HIT);
    expect(run.lives).toBe(MINEFIELD_LIVES - 1);
    expect(run.hits).toBe(1);
    expect(run.score).toBe(first.score);
    expect(run.outcome).toBe("playing");
    expect(minesLeft(run)).toBe(left - 1);
  });

  it("ends the run on the last life, and takes no action after it", () => {
    let run = act(createRun(SEED), 27);
    for (let life = 0; life < MINEFIELD_LIVES; life += 1) run = act(run, closedMine(run));
    expect(run).toMatchObject({ lives: 0, outcome: "over", ending: "mines" });
    expect(act(run, 0)).toBe(run);
    expect(act(run, F)).toBe(run);
    expect(finish(run)).toBe(run);
  });
});

describe("flags", () => {
  it("toggle before a board's mines exist, and do not draw them", () => {
    let run = act(createRun(SEED), F + 5);
    expect(run.cells[5]).toBe(FLAGGED);
    expect(run.numbers).toBeNull();
    expect(minesLeft(run)).toBe(minesFor(1) - 1);
    run = act(run, F + 5);
    expect(run.cells[5]).toBe(CLOSED);
    expect(run.actions).toEqual([F + 5, F + 5]);
    expect(run.score).toBe(0);
  });

  it("protect their cell from a tap", () => {
    const run = act(createRun(SEED), F + 5);
    expect(act(run, 5)).toBe(run);
  });

  it("stop the spread, and the cell can still be opened once it comes off", () => {
    const open = act(createRun(SEED), 27);
    const near = neighbours(27, 8)[0]!;
    let run = act(createRun(SEED), F + near);
    run = act(run, 27);
    expect(run.cells[near]).toBe(FLAGGED);
    run = act(run, F + near);
    run = act(run, near);
    expect(run.cells[near]).toBe(OPEN);
    expect(run.opened).toBe(open.opened);
  });

  it("cannot go on an opened cell or a found mine", () => {
    const first = act(createRun(SEED), 27);
    expect(act(first, F + 27)).toBe(first);
    const mine = closedMine(first);
    const hit = act(first, mine);
    expect(act(hit, F + mine)).toBe(hit);
  });

  it("need not be right to clear a board, except on a safe cell", () => {
    const first = act(createRun(SEED), 27);
    const safe = first.cells.findIndex(
      (state, at) => state === CLOSED && first.numbers![at] !== MINE,
    );
    const flagged = act(first, F + safe);
    const stuck = clearBoard(flagged);
    expect(stuck.levelsCleared).toBe(0);
    expect(stuck.cells[safe]).toBe(FLAGGED);
    expect(act(act(stuck, F + safe), safe).levelsCleared).toBe(1);
  });
});

describe("a tap on an opened number", () => {
  /** A number with a closed mine and a closed safe neighbour, on an opened board. */
  function scene() {
    const run = act(createRun(SEED), 27);
    for (let cell = 0; cell < run.cells.length; cell += 1) {
      if (run.cells[cell] !== OPEN || run.numbers![cell]! <= 0) continue;
      const around = neighbours(cell, run.side).filter((at) => run.cells[at] === CLOSED);
      const mines = around.filter((at) => run.numbers![at] === MINE);
      const safe = around.filter((at) => run.numbers![at] !== MINE);
      if (mines.length === run.numbers![cell] && safe.length >= mines.length && safe.length > 0) {
        return { run, cell, mines, safe };
      }
    }
    throw new Error("no such number on this board");
  }

  it("is not a move until its flags add up", () => {
    const { run, cell } = scene();
    expect(chordTargets(run, cell)).toEqual([]);
    expect(act(run, cell)).toBe(run);
  });

  it("is not a move on a blank cell, or with nothing left to open", () => {
    const run = act(createRun(SEED), 27);
    expect(act(run, 27)).toBe(run);
  });

  it("opens the rest of the neighbours when the flags are right", () => {
    const { run, cell, mines, safe } = scene();
    const flagged = mines.reduce((current, mine) => act(current, F + mine), run);
    const after = act(flagged, cell);
    for (const at of safe) expect(after.cells[at]).toBe(OPEN);
    for (const mine of mines) expect(after.cells[mine]).toBe(FLAGGED);
    expect(after.hits).toBe(0);
    expect(after.score).toBeGreaterThan(flagged.score);
  });

  it("sets off a mine when a flag is wrong", () => {
    const { run, cell, mines, safe } = scene();
    const flagged = safe.slice(0, mines.length).reduce((current, at) => act(current, F + at), run);
    const after = act(flagged, cell);
    expect(after.hits).toBe(mines.length);
    expect(after.cells[mines[0]!]).toBe(HIT);
    expect(after.lives).toBe(MINEFIELD_LIVES - mines.length);
  });

  it("stops at the last life, in ascending order", () => {
    let run = act(createRun(1), 27);
    run = act(run, closedMine(run));
    run = act(run, closedMine(run));
    expect(run.lives).toBe(1);
    // Any number now flagged wrongly is one mine from the end.
    for (let cell = 0; cell < run.cells.length; cell += 1) {
      if (run.cells[cell] !== OPEN || run.numbers![cell]! <= 0) continue;
      const around = neighbours(cell, run.side);
      const mines = around.filter((at) => run.cells[at] === CLOSED && run.numbers![at] === MINE);
      const safe = around.filter((at) => run.cells[at] === CLOSED && run.numbers![at] !== MINE);
      const marked = around.filter((at) => run.cells[at] === HIT).length;
      const need = run.numbers![cell]! - marked;
      if (mines.length === 0 || safe.length < need) continue;
      const flagged = safe.slice(0, need).reduce((current, at) => act(current, F + at), run);
      const after = act(flagged, cell);
      if (after === flagged) continue;
      expect(after.ending).toBe("mines");
      expect(after.lives).toBe(0);
      expect(after.levelsCleared).toBe(0);
      return;
    }
    throw new Error("no such number on this board");
  });
});

describe("clearing a board", () => {
  it("pays for its cells, its rows and a clean board, and deals the next", () => {
    const run = clearBoard(createRun(SEED));
    const safe = 64 - minesFor(1);
    expect(run.level).toBe(2);
    expect(run.levelsCleared).toBe(1);
    expect(run.cleanBoards).toBe(1);
    expect(run.opened).toBe(safe);
    expect(run.score).toBe(safe + clearBonus(8) + cleanBonus(8));
    expect(run.last).toMatchObject({ cleared: true, level: 1, lifeBack: false });
    expect(run.numbers).toBeNull();
    expect(run.cells.every((state) => state === CLOSED)).toBe(true);
  });

  it("pays nothing extra for a board that set off a mine", () => {
    let run = act(createRun(SEED), 27);
    run = act(run, closedMine(run));
    run = clearBoard(run);
    expect(run.cleanBoards).toBe(0);
    expect(run.score).toBe(64 - minesFor(1) + clearBonus(8));
  });

  it("brings a life back every third board, never past the most", () => {
    let run = act(createRun(SEED), 27);
    run = act(run, closedMine(run));
    run = clearBoard(run);
    run = clearBoard(run);
    expect(run.lives).toBe(MINEFIELD_LIVES - 1);
    run = clearBoard(run);
    expect(run.levelsCleared).toBe(3);
    expect(run.lives).toBe(MINEFIELD_LIVES);
    expect(run.last?.lifeBack).toBe(true);

    let full = createRun(SEED);
    for (let board = 0; board < 3; board += 1) full = clearBoard(full);
    expect(full.lives).toBe(MINEFIELD_LIVES);
    expect(full.last?.lifeBack).toBe(false);
  });

  it("grows the board when the level asks for it", () => {
    let run = createRun(SEED);
    for (let board = 0; board < 2; board += 1) run = clearBoard(run);
    expect(run.level).toBe(3);
    expect(run.side).toBe(9);
    expect(run.cells).toHaveLength(81);
    expect(act(run, 80).cells[80]).toBe(OPEN);
  });

  it("is what allSafeOpen says it is", () => {
    const numbers = numbersFor([0], 2);
    expect(allSafeOpen([CLOSED, OPEN, OPEN, OPEN], numbers)).toBe(true);
    expect(allSafeOpen([FLAGGED, OPEN, FLAGGED, OPEN], numbers)).toBe(false);
  });
});

describe("a run", () => {
  it("refuses cells off the board and nonsense actions", () => {
    const run = createRun(SEED);
    for (const action of [64, F + 64, 199, 200, -1, 1.5, Number.NaN]) {
      expect(act(run, action)).toBe(run);
    }
  });

  it("stops at the submission bound", () => {
    let run = createRun(SEED);
    for (let n = 0; n < MINEFIELD_MAX_ACTIONS; n += 1) run = act(run, F);
    expect(run).toMatchObject({ outcome: "over", ending: "bound" });
    expect(run.actions).toHaveLength(MINEFIELD_MAX_ACTIONS);
  });

  it("can be ended by the player, keeping its score", () => {
    const run = finish(act(createRun(SEED), 27));
    expect(run).toMatchObject({ outcome: "over", ending: "stopped" });
    expect(run.score).toBeGreaterThan(0);
  });

  it("replays to exactly the same run", () => {
    let run = act(createRun(SEED), F + 3);
    run = act(run, 27);
    run = act(run, closedMine(run));
    run = clearBoard(run);
    run = act(run, 40);
    expect(replay(SEED, run.actions)).toEqual(run);
  });

  it("submits its actions, score and summary", () => {
    const run = clearBoard(createRun(SEED));
    expect(submission(run)).toEqual({
      rulesVersion: "minefield@1",
      actions: run.actions,
      score: run.score,
      tapsPlaced: run.opened,
      levelsCleared: 1,
    });
  });
});
