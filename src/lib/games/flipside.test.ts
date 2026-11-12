import { describe, expect, it } from "vitest";

import {
  createRun,
  FLIPSIDE_BUFFER,
  FLIPSIDE_ON_CEILING,
  FLIPSIDE_ON_FLOOR,
  FLIPSIDE_RULES_V1,
  finish,
  grounded,
  hazardAt,
  replay,
  speedFor,
  step,
  submission,
  tap,
  type FlipsideRun,
} from "./flipside";

function stepUntil(run: FlipsideRun, ticks: number): FlipsideRun {
  let next = run;
  for (let i = 0; i < ticks && next.outcome === "playing"; i += 1) next = step(next);
  return next;
}

/** Whether a run with no further taps stays alive for `ticks` ticks. */
function survives(run: FlipsideRun, ticks: number): boolean {
  return stepUntil(run, ticks).outcome === "playing";
}

/** Whether a tap now lands the runner on the other surface without a crash. */
function landsSafely(run: FlipsideRun): boolean {
  let next = step(tap(run));
  for (let i = 0; i < 120; i += 1) {
    if (next.outcome !== "playing") return false;
    if (grounded(next)) return survives(next, 1);
    next = step(next);
  }
  return false;
}

/**
 * A plain pilot: it stays where it is while that is safe, and flips at the last
 * tick a flip still lands safely. It knows nothing a player can't see.
 */
function fly(seed: number, hazards: number): FlipsideRun {
  let run = tap(createRun(seed));
  run = stepUntil(run, 1);
  let flipAt = -1;
  while (run.outcome === "playing" && run.passed < hazards) {
    if (run.tick === flipAt) {
      run = tap(run);
      flipAt = -1;
    } else if (flipAt < 0 && grounded(run) && run.buffer === 0 && !survives(run, 50)) {
      // Every tick it could still flip from, staying put until then: it flips
      // on the last one that lands safely.
      let latest = 0;
      let ahead = run;
      for (let i = 0; i < 50 && ahead.outcome === "playing" && grounded(ahead); i += 1) {
        if (landsSafely(ahead)) latest = i;
        ahead = step(ahead);
      }
      if (latest === 0) run = tap(run);
      else flipAt = run.tick + latest;
    }
    run = step(run);
  }
  return run;
}

describe("the tunnel", () => {
  it("lays out seed 1's first hazards", () => {
    const first = Array.from({ length: 6 }, (_, k) => hazardAt(1, k));
    expect(first.map((h) => [h.x, h.width, h.surface, h.kind])).toEqual([
      [60_000, 16_000, "floor", "hole"],
      [101_000, 16_200, "floor", "hole"],
      [151_000, 12_900, "floor", "hole"],
      [200_000, 16_100, "ceiling", "spikes"],
      [250_000, 15_800, "floor", "spikes"],
      [291_000, 13_000, "floor", "hole"],
    ]);
  });

  it("still lays out flipside@1's tunnel, 30 000 further out", () => {
    const first = Array.from({ length: 6 }, (_, k) => hazardAt(1, k, FLIPSIDE_RULES_V1));
    expect(first.map((h) => [h.x, h.width, h.surface, h.kind])).toEqual([
      [90_000, 16_000, "floor", "hole"],
      [131_000, 16_200, "floor", "hole"],
      [181_000, 12_900, "floor", "hole"],
      [230_000, 16_100, "ceiling", "spikes"],
      [280_000, 15_800, "floor", "spikes"],
      [321_000, 13_000, "floor", "hole"],
    ]);
  });

  it("is faster under flipside@2", () => {
    expect(speedFor(0)).toBe(600);
    expect(speedFor(50)).toBe(900);
    expect(speedFor(0, FLIPSIDE_RULES_V1)).toBe(420);
    expect(speedFor(50, FLIPSIDE_RULES_V1)).toBe(620);
  });

  it("never lets two hazards touch", () => {
    for (const seed of [1, 2, 3, 99, 123456789]) {
      for (let k = 1; k < 300; k += 1) {
        const before = hazardAt(seed, k - 1);
        expect(hazardAt(seed, k).x - (before.x + before.width)).toBeGreaterThanOrEqual(14_000);
      }
    }
  });

  it("keeps the first three hazards holes", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (let k = 0; k < 3; k += 1) expect(hazardAt(seed, k).kind).toBe("hole");
    }
  });
});

describe("a run", () => {
  it("runs along the floor and scores nothing until a hazard is passed", () => {
    const run = stepUntil(createRun(1), 30);
    expect(run.y).toBe(FLIPSIDE_ON_FLOOR);
    expect(run.score).toBe(0);
  });

  it("flips to the ceiling on a tap and lands there", () => {
    const run = stepUntil(tap(createRun(1)), 60);
    expect(run.gravity).toBe(-1);
    expect(run.y).toBe(FLIPSIDE_ON_CEILING);
    expect(run.outcome).toBe("playing");
  });

  it("holds a tap made in mid-air until the runner lands", () => {
    let run = stepUntil(tap(createRun(1)), 1);
    while (!grounded(run)) {
      const next = step(run);
      if (grounded(next)) break;
      run = next;
    }
    // A few ticks before landing: the tap waits.
    run = tap(run);
    expect(run.buffer).toBe(FLIPSIDE_BUFFER);
    run = stepUntil(run, 4);
    expect(run.gravity).toBe(1);
  });

  it("ignores a second tap while one waits", () => {
    const run = tap(createRun(1));
    expect(tap(run)).toBe(run);
  });

  it("records an immediate stop as zero ticks and zero points", () => {
    const run = finish(createRun(1));
    expect(run.actions).toEqual([1]);
    expect(run.score).toBe(0);
    expect(replay(1, [1]).tick).toBe(0);
  });

  it("crashes on seed 1 with no taps", () => {
    const run = replay(1, []);
    expect(run.endReason).toBe("crash");
    expect({ tick: run.tick, score: run.score }).toEqual({ tick: 75, score: 0 });
    // The same line under flipside@1 crashes later: the tunnel was slower.
    const old = replay(1, [], FLIPSIDE_RULES_V1);
    expect({ tick: old.tick, score: old.score, rules: old.rulesVersion }).toEqual({
      tick: 179,
      score: 0,
      rules: FLIPSIDE_RULES_V1,
    });
  });

  it("refuses rules it does not know", () => {
    expect(() => createRun(1, "flipside@9")).toThrow(RangeError);
  });

  it("replays to the same run", () => {
    for (const seed of [1, 2, 3, 4]) {
      const flown = fly(seed, 60);
      const stopped = finish(flown);
      const again = replay(seed, stopped.actions);
      expect(again.score).toBe(stopped.score);
      expect(again.tick).toBe(stopped.tick);
      expect(submission(stopped).actions).toEqual(stopped.actions);
    }
  });
});

describe("fairness", () => {
  it("lets a plain pilot through 250 hazards on every seed tried", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const run = fly(seed * 7919, 250);
      expect({ seed, passed: run.passed, outcome: run.outcome }).toEqual({
        seed,
        passed: 250,
        outcome: "playing",
      });
    }
  }, 60_000);
});
