import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { THEN_AND_NOW_PUZZLES } from "@/lib/games/then-and-now-bank";
import {
  createRun,
  decode,
  encode,
  MAX_TRIES,
  refusal,
  replay,
  scoreOf,
  startOrder,
  stop,
  submission,
  submit,
  yearLabel,
} from "@/lib/games/then-and-now";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20270106120000_then_and_now_sessions.sql"),
  "utf8",
);

const DAY = 20406;
const RIGHT = encode([0, 1, 2, 3, 4, 5]);

describe("Then & Now's bank", () => {
  it("lists every puzzle's six events oldest first, in different years", () => {
    expect(THEN_AND_NOW_PUZZLES.length).toBeGreaterThanOrEqual(30);
    THEN_AND_NOW_PUZZLES.forEach((puzzle) => {
      const years = puzzle.events.map((e) => e.year);
      years.slice(1).forEach((year, i) => expect(year, puzzle.theme).toBeGreaterThan(years[i]!));
      expect(new Set(puzzle.events.map((e) => e.text)).size, puzzle.theme).toBe(6);
    });
  });

  it("writes years for the screen", () => {
    expect(yearLabel(1969)).toBe("1969");
    expect(yearLabel(-44)).toBe("44 BC");
    expect(yearLabel(80)).toBe("AD 80");
  });
});

describe("an order as a code", () => {
  it("round-trips, and refuses anything that is not all six ids", () => {
    expect(decode(encode([5, 3, 1, 0, 2, 4]))).toEqual([5, 3, 1, 0, 2, 4]);
    expect(decode(encode([0, 0, 1, 2, 3, 4]))).toBeNull();
    expect(decode(6 ** 6)).toBeNull();
    expect(decode(-1)).toBeNull();
  });
});

describe("a Then & Now run", () => {
  it("locks every event in its right place", () => {
    const run = submit(createRun(DAY), encode([0, 2, 1, 3, 5, 4]));
    expect(run.locked).toEqual([true, false, false, true, false, false]);
    expect(scoreOf(run)).toBe(20);
  });

  it("refuses a try that moves a locked event, repeats one, or is not an order", () => {
    const first = encode([0, 2, 1, 3, 5, 4]);
    const run = submit(createRun(DAY), first);
    expect(refusal(run, encode([1, 0, 2, 3, 4, 5]))).toBe("moved");
    expect(refusal(run, first)).toBe("repeat");
    expect(refusal(run, encode([0, 0, 0, 0, 0, 0]))).toBe("invalid");
    expect(submit(run, first)).toBe(run);
  });

  it("is worth 120 solved first time, and 20 less for every extra try", () => {
    expect(scoreOf(replay(DAY, [RIGHT]))).toBe(120);
    const late = replay(DAY, [
      encode([1, 0, 3, 2, 5, 4]),
      encode([2, 1, 0, 5, 4, 3]),
      encode([0, 1, 2, 5, 4, 3]),
      RIGHT,
    ]);
    expect(late.ending).toBe("solved");
    expect(scoreOf(late)).toBe(60);
  });

  it("ends after the fourth try, keeping 10 a placed event", () => {
    const run = replay(DAY, [
      encode([1, 0, 3, 2, 5, 4]),
      encode([2, 0, 1, 4, 5, 3]),
      encode([3, 0, 1, 5, 2, 4]),
      encode([4, 1, 0, 5, 3, 2]),
    ]);
    expect(run.tries).toHaveLength(MAX_TRIES);
    expect(run.ending).toBe("out");
    expect(scoreOf(run)).toBe(10);
    expect(refusal(run, RIGHT)).toBe("over");
  });

  it("stops early and keeps its placed events", () => {
    const run = stop(submit(createRun(DAY), encode([0, 1, 3, 2, 5, 4])));
    expect(submission(run)).toEqual({
      rulesVersion: "then-and-now@1",
      actions: [encode([0, 1, 3, 2, 5, 4])],
      score: 20,
    });
  });

  it("starts shuffled, the same for everyone on a day", () => {
    for (let day = 20000; day < 20400; day += 1) {
      const order = startOrder(day);
      expect([...order].sort()).toEqual([0, 1, 2, 3, 4, 5]);
      expect(order.filter((id, p) => id === p).length).toBeLessThanOrEqual(2);
    }
    expect(startOrder(DAY)).toEqual(startOrder(DAY));
  });
});

describe("Then & Now's verifier", () => {
  it("scores with the same numbers as the engine", () => {
    expect(MIGRATION).toContain("'then-and-now@1'");
    expect(MIGRATION).toMatch(/v_placed \* 10 \+ 20 \* \(4 - v_tries\)/);
    expect(MIGRATION).toMatch(/then_and_now_max_actions\(\)[\s\S]*?select 4/);
  });
});
