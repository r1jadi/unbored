import { describe, expect, it } from "vitest";

import {
  board,
  canExit,
  canTap,
  createRun,
  finish,
  laneClear,
  replay,
  SCATTER_MAX_JAMS,
  SCATTER_RULES_VERSION,
  sideFor,
  solve,
  submission,
  tap,
  tilesFor,
  turnstilesFor,
  type ScatterCell,
  type ScatterRun,
} from "@/lib/games/scatter";

/** A board as the verifier's `scatter_board` returns it: 0 empty, else 1 + dir, + 4 for a turnstile. */
function encode(cells: readonly ScatterCell[]): string {
  return cells.map((tile) => (tile ? 1 + tile.dir + (tile.turnstile ? 4 : 0) : 0)).join("");
}

/** A live run on a hand-made board. */
function on(cells: ScatterCell[], side: number): ScatterRun {
  return { ...createRun(1), side, cells };
}

const up = { dir: 0, turnstile: false } as const;
const right = { dir: 1, turnstile: false } as const;
const down = { dir: 2, turnstile: false } as const;
const left = { dir: 3, turnstile: false } as const;

describe("Scatter boards", () => {
  it("grow from 4×4 to 7×7 and fill up as the run goes", () => {
    expect([1, 2, 3, 5, 6, 9, 10, 50].map(sideFor)).toEqual([4, 4, 5, 5, 6, 6, 7, 7]);
    expect([1, 2, 3, 10, 20].map((level) => tilesFor(level))).toEqual([8, 8, 15, 39, 39]);
    expect([1, 2, 3, 4, 12].map((level) => turnstilesFor(level))).toEqual([0, 0, 1, 2, 9]);
  });

  it("are a function of the seed and the level", () => {
    expect(encode(board("12345", 1))).toBe(encode(board(12345, 1)));
    expect(encode(board("12345", 1))).not.toBe(encode(board("12345", 2)));
    expect(encode(board("12345", 1))).not.toBe(encode(board("12346", 1)));
  });

  // The verifier must deal exactly these: they are checked against
  // `public.scatter_board` when the migration is tested.
  it("deal the pinned boards", () => {
    expect(encode(board("12345", 1))).toMatchInlineSnapshot(`"0022043204020003"`);
    expect(encode(board("12345", 3))).toMatchInlineSnapshot(`"0440401022500014403233200"`);
    expect(encode(board("987654321", 10))).toMatchInlineSnapshot(
      `"1111118807074236037222333222522822000003224003332"`,
    );
  });

  it("can always be cleared, and always offer a first escape", () => {
    for (const seed of ["1", "2", "777", "4294967295", "-5"]) {
      for (let level = 1; level <= 24; level += 1) {
        const side = sideFor(level);
        const cells = board(seed, level);
        expect(cells.some((_, cell) => canExit(cells, side, cell))).toBe(true);
        expect(solve(cells, side, 200_000)).not.toBeNull();
      }
    }
  });
});

describe("a lane", () => {
  it("is clear when no tile stands between a cell and the edge", () => {
    const filled = new Set([5]);
    const occupied = (cell: number) => filled.has(cell);
    // 4×4: cell 9 is row 2, column 1; cell 5 is right above it.
    expect(laneClear(occupied, 4, 9, 0)).toBe(false);
    expect(laneClear(occupied, 4, 9, 1)).toBe(true);
    expect(laneClear(occupied, 4, 9, 2)).toBe(true);
    expect(laneClear(occupied, 4, 1, 2)).toBe(false);
    // A tile on the edge, pointing out, is always free.
    expect(laneClear(occupied, 4, 0, 0)).toBe(true);
  });
});

describe("a tap", () => {
  it("lets a free tile escape for a point", () => {
    const run = tap(on([up, null, null, null, ...Array(12).fill(null), down], 4), 0);
    expect(run.cells[0]).toBeNull();
    expect(run.score).toBe(1);
    expect(run.exits).toBe(1);
    expect(run.jams).toBe(0);
    expect(run.last).toEqual({ event: "exit", cell: 0 });
  });

  it("jams a blocked tile, which stays", () => {
    // Cell 0 points right into cell 1; cell 15 can still leave.
    const start = on([right, up, ...Array(13).fill(null), down], 4);
    const run = tap(start, 0);
    expect(run.cells[0]).toEqual(right);
    expect(run.jams).toBe(1);
    expect(run.score).toBe(0);
    expect(run.actions).toEqual([0]);
    expect(run.last).toEqual({ event: "jam", cell: 0 });
  });

  it("turns every turnstile a quarter clockwise when a tile escapes, but not on a jam", () => {
    const turnstile = { dir: 3, turnstile: true } as const;
    const start = on([up, right, turnstile, ...Array(12).fill(null), down], 4);
    const jammed = tap(start, 1);
    expect(jammed.cells[2]).toEqual(turnstile);
    const escaped = tap(start, 0);
    expect(escaped.cells[2]).toEqual({ dir: 0, turnstile: true });
  });

  it("clears a board for a bonus and deals the next", () => {
    const run = tap(on([up, ...Array(15).fill(null)], 4), 0);
    expect(run.levelsCleared).toBe(1);
    expect(run.level).toBe(2);
    expect(run.score).toBe(1 + 5);
    expect(encode(run.cells)).toBe(encode(board(run.seed, 2)));
    expect(run.last?.event).toBe("clear");
  });

  it("loses a board with no tile that can leave, for a jam", () => {
    // Cells 0 and 1 face each other; once cell 15 leaves nothing can.
    const run = tap(on([right, left, ...Array(13).fill(null), down], 4), 15);
    expect(run.score).toBe(1);
    expect(run.jams).toBe(1);
    expect(run.levelsCleared).toBe(0);
    expect(run.level).toBe(2);
    expect(run.last).toEqual({ event: "stuck", cell: 15 });
  });

  it("ends the run on the third jam", () => {
    let run = on([right, up, ...Array(13).fill(null), down], 4);
    for (let i = 0; i < SCATTER_MAX_JAMS; i += 1) run = tap(run, 0);
    expect(run.jams).toBe(SCATTER_MAX_JAMS);
    expect(run.outcome).toBe("over");
    expect(run.ending).toBe("jams");
    expect(canTap(run, 15)).toBe(false);
    expect(tap(run, 15)).toBe(run);
  });

  it("on an empty cell is not a move", () => {
    const run = createRun("12345");
    const empty = run.cells.findIndex((tile) => tile === null);
    expect(tap(run, empty)).toBe(run);
    expect(tap(run, -1)).toBe(run);
    expect(tap(run, 999)).toBe(run);
  });
});

describe("a run", () => {
  it("starts on board one with the pinned rules version", () => {
    const run = createRun("12345");
    expect(run.rulesVersion).toBe(SCATTER_RULES_VERSION);
    expect(SCATTER_RULES_VERSION).toBe("scatter@1");
    expect(run.level).toBe(1);
    expect(run.side).toBe(4);
    expect(run.outcome).toBe("playing");
  });

  it("replays to the same state it was played to", () => {
    let run = createRun("4242");
    for (let step = 0; step < 60 && run.outcome === "playing"; step += 1) {
      // Mostly escapes, with the odd jam.
      const cells = run.cells.map((_, cell) => cell).filter((cell) => run.cells[cell]);
      const free = cells.filter((cell) => canExit(run.cells, run.side, cell));
      const pick = step % 7 === 3 ? cells.find((cell) => !free.includes(cell)) : free[0];
      run = tap(run, pick ?? free[0]!);
    }
    const again = replay("4242", run.actions);
    expect(again.score).toBe(run.score);
    expect(again.jams).toBe(run.jams);
    expect(again.level).toBe(run.level);
    expect(encode(again.cells)).toBe(encode(run.cells));
  });

  it("can be ended at any time, keeping its score", () => {
    const run = finish(tap(createRun("12345"), solve(board("12345", 1), 4)![0]!));
    expect(run.outcome).toBe("over");
    expect(run.ending).toBe("stopped");
    expect(submission(run)).toEqual({
      rulesVersion: "scatter@1",
      actions: run.actions,
      score: 1,
      tapsPlaced: run.exits,
      levelsCleared: run.levelsCleared,
    });
  });
});
