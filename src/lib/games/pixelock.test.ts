import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { pixelockBlocks, readBlock } from "@/lib/games/daily-banks-sql";
import { PIXELOCK_PICTURES } from "@/lib/games/pixelock-bank";
import {
  CELLS,
  CROSS,
  cluesOf,
  code,
  createRun,
  FILL,
  inkCount,
  inked,
  inkOf,
  lineDone,
  move,
  pictureIndexForDay,
  refusal,
  replay,
  runsOf,
  scoreOf,
  solveByLines,
  stop,
  submission,
} from "@/lib/games/pixelock";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20270105120100_pixelock_sessions.sql"),
  "utf8",
);

/** The first day from 20000 that plays picture `index`. */
function dayFor(index: number): number {
  let day = 20000;
  while (pictureIndexForDay(day) !== index) day += 1;
  return day;
}

/** Every right move for a day's picture, filling ink in reading order. */
function cleanSolve(day: number): number[] {
  const picture = PIXELOCK_PICTURES[pictureIndexForDay(day)]!;
  const moves: number[] = [];
  for (let i = 0; i < CELLS; i += 1) if (inked(picture, i)) moves.push(code(i, FILL));
  return moves;
}

describe("Pixelock's bank", () => {
  it("has a month of different pictures", () => {
    expect(PIXELOCK_PICTURES.length).toBeGreaterThanOrEqual(30);
    const drawn = PIXELOCK_PICTURES.map((p) => p.rows.join(""));
    expect(new Set(drawn).size).toBe(drawn.length);
    for (const p of PIXELOCK_PICTURES) {
      expect(inkCount(p), p.name).toBeGreaterThan(15);
      expect(inkCount(p), p.name).toBeLessThan(CELLS);
    }
  });

  it("only has pictures the clues solve line by line, without guessing", () => {
    for (const p of PIXELOCK_PICTURES) {
      expect(solveByLines(cluesOf(p)), p.name).toEqual(inkOf(p));
    }
  });

  it("is copied into the migration exactly", () => {
    expect(readBlock(MIGRATION, "pixelock-bank")).toBe(pixelockBlocks()["pixelock-bank"]);
  });
});

describe("the clues", () => {
  it("are the runs of each line", () => {
    expect(runsOf([true, true, false, true, false, false, true, true, true, false])).toEqual([
      2, 1, 3,
    ]);
    expect(runsOf(Array(10).fill(false))).toEqual([]);
    const heart = cluesOf(PIXELOCK_PICTURES[0]!);
    expect(heart.rows[0]).toEqual([2, 2]);
    expect(heart.rows[9]).toEqual([]);
    expect(heart.columns[4]).toEqual([7]);
  });
});

describe("a Pixelock run", () => {
  const DAY = dayFor(0); // the heart

  it("fills ink and crosses out blanks for free, scoring each right fill", () => {
    let run = move(createRun(DAY), code(1, FILL));
    run = move(run, code(0, CROSS));
    expect(run.mistakes).toBe(0);
    expect(run.fills).toBe(1);
    expect(scoreOf(run)).toBe(1);
  });

  it("costs a life for a wrong move and shows the cell as it is", () => {
    const run = move(createRun(DAY), code(0, FILL));
    expect(run.mistakes).toBe(1);
    expect(run.cells[0]).toBe(2);
    expect(run.revealed).toEqual([0]);
    const filled = move(run, code(1, CROSS));
    expect(filled.cells[1]).toBe(1);
    expect(filled.fills).toBe(0);
  });

  it("refuses moves that are not moves", () => {
    const run = move(createRun(DAY), code(1, FILL));
    expect(refusal(run, code(1, CROSS))).toBe("shown");
    expect(move(run, code(1, CROSS))).toBe(run);
    expect(refusal(run, 200)).toBe("unknown");
    expect(refusal(run, -1)).toBe("unknown");
  });

  it("ends on the third mistake", () => {
    const run = replay(DAY, [code(0, FILL), code(3, FILL), code(4, FILL)]);
    expect(run.ending).toBe("out");
    expect(refusal(run, code(1, FILL))).toBe("over");
    expect(scoreOf(run)).toBe(0);
  });

  it("is solved when every inked cell is filled, crosses or not", () => {
    for (const index of [0, 7, 15, 29]) {
      const day = dayFor(index);
      const run = replay(day, cleanSolve(day));
      const ink = inkCount(PIXELOCK_PICTURES[index]!);
      expect(run.ending).toBe("solved");
      expect(scoreOf(run)).toBe(ink + 50 + 75);
      expect(run.moves).toHaveLength(ink);
    }
  });

  it("keeps fewer lives' worth when solved with mistakes", () => {
    const moves = [code(0, FILL), ...cleanSolve(DAY)];
    const run = replay(DAY, moves);
    expect(run.ending).toBe("solved");
    expect(scoreOf(run)).toBe(inkCount(PIXELOCK_PICTURES[0]!) + 50 + 50);
  });

  it("dims a line once its ink is all shown", () => {
    let run = createRun(DAY);
    expect(lineDone(run, "row", 9)).toBe(true);
    expect(lineDone(run, "row", 0)).toBe(false);
    for (const cell of [1, 2, 7, 8]) run = move(run, code(cell, FILL));
    expect(lineDone(run, "row", 0)).toBe(true);
  });

  it("stops early and keeps its fills", () => {
    const run = stop(move(createRun(DAY), code(1, FILL)));
    expect(submission(run)).toEqual({ rulesVersion: "pixelock@1", actions: [2], score: 1 });
  });
});

describe("Pixelock's verifier", () => {
  it("scores with the same numbers as the engine", () => {
    expect(MIGRATION).toContain("'pixelock@1'");
    expect(MIGRATION).toMatch(/v_fills \+ 50 \+ 25 \* \(3 - v_mistakes\)/);
    expect(MIGRATION).toMatch(/v_action >= 200/);
    expect(MIGRATION).toMatch(/pixelock_max_actions\(\)[\s\S]*?select 100/);
  });
});
