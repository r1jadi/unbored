import { describe, expect, it } from "vitest";

import {
  GRIDBURST_CELLS,
  GRIDBURST_SHAPES,
  bigPercent,
  burstScore,
  createRun,
  decodeMove,
  encodeMove,
  finish,
  fits,
  place,
  replay,
  shapeCells,
  submission,
  type GridburstRun,
} from "@/lib/games/gridburst";

/** The first placement that fits, in slot order then cell order, until stuck. */
function greedy(seed: string): GridburstRun {
  let run = createRun(seed);
  while (run.outcome === "playing") {
    let next = run;
    for (let slot = 0; slot < 3 && next === run; slot += 1) {
      for (let cell = 0; cell < GRIDBURST_CELLS && next === run; cell += 1) {
        next = place(run, slot, cell);
      }
    }
    run = next;
  }
  return run;
}

function filledBits(run: GridburstRun): string {
  return run.board.map((value) => (value === 0 ? "0" : "1")).join("");
}

describe("the deal", () => {
  it("deals seed 1's opening trays", () => {
    expect(createRun("1").tray).toEqual([8, 23, 24]);
    expect(createRun("15").tray).toEqual([25, 5, 4]);
  });

  it("reads a full-width seed without rounding it", () => {
    // A seed parsed as a double would round and deal different pieces.
    expect(createRun("9223372036854775807").tray).toEqual([19, 15, 24]);
  });

  it("ramps the big pool from 8% to a 40% ceiling", () => {
    expect([0, 11, 12, 100, 384, 1000].map(bigPercent)).toEqual([8, 8, 9, 16, 40, 40]);
  });

  it("keeps the shape table the verifier mirrors", () => {
    expect(GRIDBURST_SHAPES).toHaveLength(37);
    expect(shapeCells(32)).toHaveLength(9);
    expect(shapeCells(12)).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 1],
    ]);
  });
});

describe("a placement", () => {
  it("encodes the slot and the corner cell", () => {
    expect(encodeMove(2, 63)).toBe(191);
    expect(decodeMove(131)).toEqual({ slot: 2, cell: 3 });
  });

  it("is not a move when the piece runs off the board or overlaps", () => {
    const run = createRun("1");
    // Shape 8 is a 2×2 corner: its corner on the last column runs off the edge.
    expect(fits(run.board, 8, 7)).toBe(false);
    expect(place(run, 0, 7)).toBe(run);
    const placed = place(run, 0, 0);
    expect(place(placed, 1, 0)).toBe(placed);
    // A used slot cannot be played again.
    expect(place(placed, 0, 40)).toBe(placed);
  });

  it("scores a cell a point and deals a new tray after the third piece", () => {
    let run = createRun("1");
    run = place(run, 0, 0);
    expect(run.score).toBe(3);
    expect(run.tray).toEqual([null, 23, 24]);
    run = place(run, 1, 1);
    run = place(run, 2, 3);
    expect(run.tray).toEqual([22, 5, 16]);
    expect(run.dealt).toBe(6);
  });

  it("bursts a full row, multiplies by the combo and pays for an empty board", () => {
    const board = Array.from({ length: GRIDBURST_CELLS }, (_, cell) =>
      cell > 0 && cell < 8 ? 1 : 0,
    );
    const run: GridburstRun = { ...createRun("1"), board, tray: [0, 0, 0] };
    const next = place(run, 0, 0);
    expect(next.lines).toBe(1);
    expect(next.combo).toBe(1);
    expect(next.score).toBe(1 + burstScore(1, 1) + 300);
    expect(next.board.every((value) => value === 0)).toBe(true);
  });

  it("bursts a row and a column together, and keeps the combo for three misses", () => {
    // Row 0 and column 0 are full except their shared corner.
    const board = Array.from({ length: GRIDBURST_CELLS }, (_, cell) =>
      cell !== 0 && (cell < 8 || cell % 8 === 0) ? 1 : 0,
    );
    const start: GridburstRun = { ...createRun("1"), board, tray: [0, 0, 0], combo: 2 };
    const next = place(start, 0, 0);
    expect(next.lines).toBe(2);
    expect(next.combo).toBe(3);
    expect(next.score).toBe(1 + 10 * 4 * 3 + 300);

    let run = next;
    run = place(run, 1, 20);
    run = place(run, 2, 30);
    expect(run.combo).toBe(3);
    // The third miss is the new tray's first piece, wherever it first fits.
    const before = run;
    for (let cell = 0; run === before; cell += 1) run = place(run, 0, cell);
    expect(run.misses).toBe(3);
    expect(run.combo).toBe(0);
  });
});

describe("a run", () => {
  it("plays seed 1's greedy line until nothing fits", () => {
    const run = greedy("1");
    expect(run.moves).toEqual([0, 65, 131, 5, 88, 155, 32, 101, 135, 43, 112, 182]);
    expect(run.score).toBe(46);
    expect(run.lines).toBe(0);
    expect(run.endReason).toBe("stuck");
    expect(filledBits(run)).toBe(
      "1101111111111011000110101111110010011111111101111101111001100011",
    );
  });

  it("plays seed 15's greedy line, with bursts", () => {
    const run = greedy("15");
    expect(run.moves).toEqual([
      0, 65, 133, 6, 70, 130, 0, 76, 136, 4, 69, 129, 3, 64, 152, 28, 98, 168, 45, 134,
    ]);
    expect(run.score).toBe(162);
    expect(run.lines).toBe(5);
    expect(run.endReason).toBe("stuck");
  });

  it("replays a saved line to the same run", () => {
    const run = greedy("15");
    const again = replay("15", run.moves);
    expect(again.score).toBe(run.score);
    expect(again.board).toEqual(run.board);
  });

  it("refuses moves after the end and keeps the score when the player stops", () => {
    const over = greedy("1");
    expect(place(over, 0, 0)).toBe(over);
    const live = place(createRun("1"), 0, 0);
    const stopped = finish(live);
    expect(stopped.outcome).toBe("over");
    expect(stopped.stopped).toBe(true);
    expect(submission(stopped)).toEqual({
      rulesVersion: "gridburst@1",
      actions: [0],
      score: 3,
    });
  });
});
