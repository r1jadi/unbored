import { describe, expect, it } from "vitest";

import {
  UPDRAFT_COLUMN_WIDTH,
  UPDRAFT_GLIDER_RADIUS,
  UPDRAFT_GLIDER_X,
  UPDRAFT_GROUND,
  UPDRAFT_MAX_SHIFT,
  UPDRAFT_MIN_TOP,
  UPDRAFT_BOTTOM_MARGIN,
  columnAt,
  createRun,
  finish,
  flap,
  gapFor,
  replay,
  speedFor,
  step,
  submission,
  type UpdraftRun,
} from "@/lib/games/updraft";

/**
 * A pilot that flaps whenever the glider sinks to within 6 000 of the bottom of
 * the gap it is in or heading for, and is not already rising: simple, and good
 * enough to thread columns forever, which is what proves every layout is fair.
 */
function fly(seed: string, ticks: number): UpdraftRun {
  let run = createRun(seed);
  for (let t = 0; t < ticks && run.outcome === "playing"; t += 1) {
    const behind = run.passed > 0 ? columnAt(seed, run.passed - 1) : null;
    const column =
      behind &&
      behind.x + UPDRAFT_COLUMN_WIDTH - run.distance > UPDRAFT_GLIDER_X - UPDRAFT_GLIDER_RADIUS
        ? behind
        : columnAt(seed, run.passed);
    if (run.y > column.top + column.gap - 6_000 && run.vy >= 0) run = flap(run);
    run = step(run);
  }
  return run;
}

describe("Updraft rules", () => {
  it("ramps speed up and the gap down, and both stop at their caps", () => {
    expect(speedFor(0)).toBe(400);
    expect(speedFor(10)).toBe(440);
    expect(speedFor(40)).toBe(560);
    expect(speedFor(400)).toBe(560);
    expect(gapFor(0)).toBe(30_000);
    expect(gapFor(10)).toBe(28_000);
    expect(gapFor(35)).toBe(23_000);
    expect(gapFor(500)).toBe(23_000);
  });

  it("lays out seed 1's first columns — the vector the verifier must reproduce", () => {
    const tops = Array.from({ length: 6 }, (_, k) => columnAt("1", k).top);
    expect(tops).toMatchInlineSnapshot(`
      [
        25496,
        34200,
        43246,
        36086,
        15398,
        34216,
      ]
    `);
  });

  it("keeps every gap on the field and within reach of the one before", () => {
    for (const seed of ["1", "42", "-7", "9007199254740993"]) {
      for (let k = 0; k < 200; k += 1) {
        const column = columnAt(seed, k);
        expect(column.top).toBeGreaterThanOrEqual(UPDRAFT_MIN_TOP);
        expect(column.top + column.gap).toBeLessThanOrEqual(UPDRAFT_GROUND - UPDRAFT_BOTTOM_MARGIN);
        if (k > 0) {
          expect(Math.abs(column.top - columnAt(seed, k - 1).top)).toBeLessThanOrEqual(
            UPDRAFT_MAX_SHIFT,
          );
        }
      }
    }
  });

  it("falls to the ground without a flap — the vector the verifier must reproduce", () => {
    const run = replay("1", []);
    expect(run.outcome).toBe("over");
    expect(run.endReason).toBe("crash");
    expect(run.score).toBe(0);
    expect(run.tick).toBe(33);
  });

  it("records one flap per tick, on the tick it lands", () => {
    let run = createRun("1");
    run = flap(run);
    run = flap(run);
    expect(run.actions).toEqual([0]);
    run = step(run);
    expect(run.vy).toBe(-1_400);
    run = step(run);
    run = flap(run);
    expect(run.actions).toEqual([0, 4]);
  });

  it("is always passable: a simple pilot is still flying at full speed", () => {
    for (const seed of ["1", "2", "42", "777"]) {
      const flown = fly(seed, 20_000);
      expect(flown.outcome).toBe("playing");
      expect(flown.score).toBeGreaterThan(200);
    }
  });

  it("threads columns, and a replay of its actions lands on the same score", () => {
    const flown = fly("1", 3_000);
    expect(flown.score).toBeGreaterThan(5);
    const stopped = finish(flown);
    const replayed = replay("1", submission(stopped).actions);
    expect(replayed.score).toBe(stopped.score);
    expect(replayed.tick).toBe(stopped.tick);
    expect(replayed.stopped).toBe(true);
  });

  it("stopping records the tick, drops an unrun flap and never adds a point", () => {
    let run = createRun("1");
    run = step(flap(run));
    run = flap(run);
    const stopped = finish(run);
    expect(stopped.actions).toEqual([0, 3]);
    expect(stopped.score).toBe(run.score);
    expect(finish(stopped)).toBe(stopped);
  });

  it("a crash is replayed, not claimed: a run's flaps alone decide it", () => {
    let run = createRun("1");
    while (run.outcome === "playing") run = step(run);
    expect(replay("1", run.actions)).toMatchObject({ tick: run.tick, endReason: "crash" });
  });
});
