import { describe, expect, it } from "vitest";

import {
  board,
  boardCode,
  chargedCells,
  createRun,
  finish,
  FUSEBOX_CELLS,
  FUSEBOX_START_SPARKS,
  missedTap,
  PLAIN,
  refundFor,
  refundSteps,
  replay,
  settle,
  SHIELDED,
  shieldsFor,
  submission,
  SURGE,
  surgesFor,
  tap,
  type FuseCell,
  type FuseKind,
  type FuseboxRun,
} from "@/lib/games/fusebox";

/** A board from a sketch: rows of digits, with `s` before a surge cell and `x` before a shielded one. */
function sketch(...rows: string[]): FuseCell[] {
  const cells: FuseCell[] = [];
  for (const match of rows.join("").matchAll(/([sx]?)(\d)/g)) {
    const kind: FuseKind = match[1] === "s" ? SURGE : match[1] === "x" ? SHIELDED : PLAIN;
    cells.push({ charge: Number(match[2]), kind });
  }
  expect(cells).toHaveLength(FUSEBOX_CELLS);
  return cells;
}

const charges = (cells: readonly FuseCell[]) => cells.map((cell) => cell.charge);
const at = (row: number, col: number) => row * 6 + col;

/** A bare run on a board of the test's own. */
const runOn = (cells: FuseCell[], overrides: Partial<FuseboxRun> = {}): FuseboxRun => ({
  ...createRun(1),
  cells,
  ...overrides,
});

describe("Fusebox: the deal", () => {
  it("deals the same board for a seed, and another for another seed or level", () => {
    expect(board("12345", 1)).toEqual(board("12345", 1));
    expect(boardCode(board("12345", 1))).not.toBe(boardCode(board("12346", 1)));
    expect(boardCode(board("12345", 1))).not.toBe(boardCode(board("12345", 2)));
  });

  it("keeps every dealt cell between no charge and three, and special cells charged", () => {
    for (let level = 1; level <= 30; level += 1) {
      for (const cell of board(level * 97, level)) {
        expect(cell.charge).toBeGreaterThanOrEqual(0);
        expect(cell.charge).toBeLessThanOrEqual(3);
        if (cell.kind !== PLAIN) expect(cell.charge).toBeGreaterThan(0);
      }
    }
  });

  it("deals special cells from their boards on, up to their caps", () => {
    expect([1, 2, 3, 6, 7, 11, 40].map(surgesFor)).toEqual([0, 0, 1, 1, 2, 3, 3]);
    expect([1, 4, 5, 6, 7, 15, 40].map(shieldsFor)).toEqual([0, 0, 1, 1, 2, 6, 6]);
    for (const level of [3, 5, 12, 25]) {
      const cells = board(777, level);
      expect(cells.filter((c) => c.kind === SURGE)).toHaveLength(surgesFor(level));
      expect(cells.filter((c) => c.kind === SHIELDED)).toHaveLength(shieldsFor(level));
    }
  });

  it("accepts a seed beyond 2³² and a negative one", () => {
    expect(board("-5", 1)).toHaveLength(FUSEBOX_CELLS);
    expect(board("18446744073709551616", 1)).toEqual(board("0", 1));
  });
});

describe("Fusebox: a tap", () => {
  it("adds one charge and pops nothing below four", () => {
    const settled = settle(sketch("100000", "000000", "000000", "000000", "000000", "000000"), 0);
    expect(settled.cells[0]!.charge).toBe(2);
    expect(settled.waves).toHaveLength(0);
    expect(settled.pops).toBe(0);
    expect(settled.gain).toBe(0);
  });

  it("gives an empty cell its first charge", () => {
    const settled = settle(sketch("000000", "000000", "000000", "000000", "000000", "000000"), 5);
    expect(settled.cells[5]!.charge).toBe(1);
  });

  it("pops at four, empties the cell, and charges the first charged cell each way", () => {
    const settled = settle(
      sketch(
        "000000", // up from the tap: one empty, then a 1
        "001000",
        "000000",
        "201001", // left a 2, right two empties then a 1 at range 3
        "000000",
        "000000",
      ).map((cell, index) => (index === at(3, 2) ? { charge: 3, kind: PLAIN } : cell)),
      at(3, 2),
    );
    expect(settled.pops).toBe(1);
    expect(settled.gain).toBe(1);
    expect(settled.cells[at(3, 2)]!.charge).toBe(0);
    expect(settled.cells[at(1, 2)]!.charge).toBe(2);
    expect(settled.cells[at(3, 0)]!.charge).toBe(3);
    expect(settled.cells[at(3, 5)]!.charge).toBe(2);
  });

  it("does not reach past three cells", () => {
    // Column 0: the tap at the top, a 1 four cells down.
    const settled = settle(sketch("300000", "000000", "000000", "000000", "100000", "000000"), 0);
    expect(settled.pops).toBe(1);
    expect(settled.cells[at(4, 0)]!.charge).toBe(1);
    expect(settled.waves[0]!.bolts.find((b) => b.to === at(3, 0))?.hit).toBe(false);
  });

  it("stops a bolt at the first charged cell", () => {
    const settled = settle(sketch("310000", "000000", "100000", "000000", "000000", "000000"), 0);
    expect(settled.cells[at(0, 1)]!.charge).toBe(2);
    expect(settled.cells[at(2, 0)]!.charge).toBe(2);
    expect(settled.waves[0]!.bolts.filter((b) => b.hit)).toHaveLength(2);
  });

  it("scores each pop by its wave's number", () => {
    // 3 3 3 in a row: wave one the tap, wave two its neighbour, wave three the last.
    const settled = settle(sketch("333000", "000000", "000000", "000000", "000000", "000000"), 0);
    expect(settled.waves.map((wave) => wave.fired)).toEqual([[0], [1], [2]]);
    expect(settled.pops).toBe(3);
    expect(settled.gain).toBe(1 + 2 + 3);
    expect(charges(settled.cells).every((c) => c === 0)).toBe(true);
  });

  it("fires a wave at once, so a cell popping in it takes no bolt", () => {
    // Two cells reach four together in wave two; their bolts at each other are gone.
    const settled = settle(sketch("333000", "300000", "000000", "000000", "000000", "000000"), 0);
    expect(settled.waves[1]!.fired).toEqual([1, 6]);
    expect(settled.waves[1]!.gain).toBe(4);
  });

  it("adds every bolt that lands on one cell in a wave", () => {
    // The tap pops (1,1); (1,0) and (1,2) pop together, and both bolts reach (1,3).
    const settled = settle(
      sketch("000000", "333100", "000000", "000000", "000000", "000000"),
      at(1, 1),
    );
    expect(settled.waves[1]!.fired).toEqual([at(1, 0), at(1, 2)]);
    expect(settled.cells[at(1, 3)]!.charge).toBe(3);
  });

  it("fires a surge cell diagonally too", () => {
    const plain = settle(
      sketch("000000", "010000", "003000", "000000", "000000", "000000"),
      at(2, 2),
    );
    expect(plain.cells[at(1, 1)]!.charge).toBe(1);
    const surge = settle(
      sketch("000000", "010000", "00s3000", "000000", "000000", "000000"),
      at(2, 2),
    );
    expect(surge.cells[at(1, 1)]!.charge).toBe(2);
    expect(surge.cells[at(2, 2)]).toEqual({ charge: 0, kind: PLAIN });
  });

  it("lets a shield take a tap, for no charge", () => {
    const settled = settle(sketch("x300000", "000000", "000000", "000000", "000000", "000000"), 0);
    expect(settled.cells[0]).toEqual({ charge: 3, kind: PLAIN });
    expect(settled.pops).toBe(0);
  });

  it("lets a shield take a bolt, for no charge", () => {
    const settled = settle(sketch("3x20000", "000000", "000000", "000000", "000000", "000000"), 0);
    expect(settled.cells[at(0, 1)]).toEqual({ charge: 2, kind: PLAIN });
  });

  it("gives a shield one bolt and its cell the rest, when two land together", () => {
    // The tap pops (0,0), which sets off (0,1) and (1,0); both then hit (1,1).
    const settled = settle(sketch("330000", "3x10000", "000000", "000000", "000000", "000000"), 0);
    expect(settled.waves[1]!.fired).toEqual([at(0, 1), at(1, 0)]);
    expect(settled.cells[at(1, 1)]).toEqual({ charge: 2, kind: PLAIN });
  });

  it("always ends a chain, with each cell popping at most once", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const cells = board(seed, 1 + (seed % 12));
      for (let cell = 0; cell < FUSEBOX_CELLS; cell += 1) {
        const settled = settle(cells, cell);
        expect(settled.pops).toBeLessThanOrEqual(FUSEBOX_CELLS);
        const all = settled.waves.flatMap((wave) => wave.fired);
        expect(new Set(all).size).toBe(all.length);
        expect(settled.cells.every((c) => c.charge <= 3)).toBe(true);
      }
    }
  });
});

describe("Fusebox: sparks", () => {
  it("asks for longer chains every second board", () => {
    expect(refundSteps(1)).toEqual([4, 7, 11]);
    expect(refundSteps(2)).toEqual([4, 7, 11]);
    expect(refundSteps(3)).toEqual([5, 9, 13]);
    expect(refundSteps(5)).toEqual([6, 11, 15]);
  });

  it("pays nothing, one, two or three", () => {
    expect([3, 4, 6, 7, 10, 11, 36].map((pops) => refundFor(pops, 1))).toEqual([
      0, 1, 1, 2, 2, 3, 3,
    ]);
    expect(refundFor(4, 3)).toBe(0);
  });

  it("spends one spark a tap", () => {
    const run = tap(createRun("12345"), 0);
    expect(run.sparks).toBe(
      FUSEBOX_START_SPARKS - 1 + (run.last!.refund ?? 0) + (run.last!.cleared ? 3 : 0),
    );
    expect(run.actions).toEqual([0]);
  });

  it("pays a long chain back", () => {
    const cells = sketch("333300", "000000", "111111", "000000", "000000", "000000");
    const run = tap(runOn(cells), 0);
    expect(run.last!.pops).toBe(4);
    expect(run.last!.refund).toBe(1);
    expect(run.sparks).toBe(FUSEBOX_START_SPARKS);
  });

  it("clears a board at four charged cells or fewer, pays for it and deals the next", () => {
    const cells = sketch("331000", "000000", "000000", "000000", "000000", "000011");
    expect(chargedCells(cells)).toBe(5);
    const run = tap(runOn(cells), 0);
    expect(run.last!.cleared).toBe(true);
    expect(run.level).toBe(2);
    expect(run.levelsCleared).toBe(1);
    expect(run.sparks).toBe(FUSEBOX_START_SPARKS - 1 + 3);
    expect(run.cells).toEqual(board(run.seed, 2));
  });

  it("ends the run on the last spark, unless the tap pays one back", () => {
    const quiet = sketch("111111", "111111", "000000", "000000", "000000", "000000");
    const lost = tap(runOn(quiet, { sparks: 1 }), 0);
    expect(lost.sparks).toBe(0);
    expect(lost.outcome).toBe("over");
    expect(lost.ending).toBe("sparks");

    const saved = tap(
      runOn(sketch("333300", "000000", "111111", "000000", "000000", "000000"), { sparks: 1 }),
      0,
    );
    expect(saved.outcome).toBe("playing");
    expect(saved.sparks).toBe(1);
  });

  it("refuses a tap off the board or after the end, returning the same run", () => {
    const run = createRun("12345");
    expect(tap(run, -1)).toBe(run);
    expect(tap(run, 36)).toBe(run);
    expect(tap(run, 1.5)).toBe(run);
    const ended = finish(run);
    expect(tap(ended, 0)).toBe(ended);
  });
});

describe("Fusebox: replay and submission", () => {
  /** First-cell play: enough to reach another board's rules along the way. */
  function line(seed: string, taps: number): FuseboxRun {
    let run = createRun(seed);
    for (let i = 0; i < taps && run.outcome === "playing"; i += 1) {
      run = tap(run, (i * 7) % FUSEBOX_CELLS);
    }
    return run;
  }

  it("lands a replay on the run its taps made", () => {
    const run = line("987654321", 9);
    const again = replay(run.seed, run.actions);
    expect(again.cells).toEqual(run.cells);
    expect(again.score).toBe(run.score);
    expect(again.sparks).toBe(run.sparks);
    expect(again.level).toBe(run.level);
  });

  it("submits the taps and the claim, keeping the score when stopped", () => {
    const run = finish(line("42", 5));
    expect(run.ending).toBe("stopped");
    expect(submission(run)).toMatchObject({
      rulesVersion: "fusebox@1",
      actions: run.actions,
      score: run.score,
      tapsPlaced: run.pops,
      levelsCleared: run.levelsCleared,
    });
  });
});

describe("Fusebox: the tap that would have saved the run", () => {
  it("is only offered when the sparks ended the run", () => {
    expect(missedTap(createRun(5))).toBeNull();
    expect(missedTap(finish(tap(createRun(5), 0)))).toBeNull();
  });

  it("finds the best tap on the board the run was lost on, when one exists", () => {
    // Spend every spark on low-value taps across many seeds; some boards have a rescue.
    let found = 0;
    for (let seed = 1; seed <= 25; seed += 1) {
      let run = createRun(seed);
      while (run.outcome === "playing") {
        // An empty cell where there is one: charging it never chains.
        const quiet = run.cells.findIndex((cell) => cell.charge === 0);
        run = tap(run, quiet >= 0 ? quiet : 0);
      }
      const missed = missedTap(run);
      if (run.ending !== "sparks" || !missed) continue;
      found += 1;
      const before = replay(run.seed, run.actions.slice(0, -1));
      expect(missed.cells).toEqual(before.cells);
      expect(missed.sparks).toBeGreaterThan(0);
      expect(missed.pops).toBe(settle(before.cells, missed.cell).pops);
      for (let cell = 0; cell < FUSEBOX_CELLS; cell += 1) {
        expect(refundFor(settle(before.cells, cell).pops, before.level)).toBeLessThanOrEqual(
          missed.sparks,
        );
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe("Fusebox: a run has an end", () => {
  it("ends under a player who always takes the best tap in sight", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      let run = createRun(seed * 104729);
      while (run.outcome === "playing" && run.actions.length < 1000) {
        let best = 0;
        let bestValue = -1;
        for (let cell = 0; cell < FUSEBOX_CELLS; cell += 1) {
          const settled = settle(run.cells, cell);
          const value =
            settled.gain +
            6 * (refundFor(settled.pops, run.level) + (chargedCells(settled.cells) <= 4 ? 3 : 0));
          if (value > bestValue) {
            bestValue = value;
            best = cell;
          }
        }
        run = tap(run, best);
      }
      expect(run.outcome).toBe("over");
      expect(run.ending).toBe("sparks");
    }
  });
});
