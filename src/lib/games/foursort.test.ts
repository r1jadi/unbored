import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FOURSORT_PUZZLES } from "@/lib/games/foursort-bank";
import {
  bestOverlap,
  boardOrder,
  createRun,
  groupMask,
  guess,
  MAX_GUESSES,
  maskOf,
  refusal,
  replay,
  scoreOf,
  stop,
  submission,
  wordOf,
} from "@/lib/games/foursort";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20270105120000_foursort_sessions.sql"),
  "utf8",
);

const DAY = 20406;
/** Three of group 0 and one of group 1: "one away". */
const ONE_AWAY = maskOf([0, 1, 2, 4]);
const WRONG = maskOf([0, 4, 8, 12]);

describe("Foursort's bank", () => {
  it("has sixteen different words in every puzzle", () => {
    expect(FOURSORT_PUZZLES.length).toBeGreaterThanOrEqual(30);
    FOURSORT_PUZZLES.forEach((puzzle, i) => {
      const words = puzzle.groups.flatMap((g) => g.words.map((w) => w.toLowerCase()));
      expect(new Set(words).size, `puzzle ${i}`).toBe(16);
      for (const g of puzzle.groups) expect(g.title.trim(), `puzzle ${i}`).not.toBe("");
    });
  });

  it("names a word by its id", () => {
    const puzzle = FOURSORT_PUZZLES[0]!;
    expect(wordOf(puzzle, 0)).toBe(puzzle.groups[0]!.words[0]);
    expect(wordOf(puzzle, 15)).toBe(puzzle.groups[3]!.words[3]);
  });
});

describe("a Foursort run", () => {
  it("finds a group, keeps it and scores it", () => {
    const run = guess(createRun(DAY), groupMask(2));
    expect(run.found).toEqual([2]);
    expect(run.mistakes).toBe(0);
    expect(scoreOf(run)).toBe(15);
  });

  it("counts a wrong guess as a mistake, and tells one away from far off", () => {
    const run = guess(createRun(DAY), ONE_AWAY);
    expect(run.mistakes).toBe(1);
    expect(bestOverlap(ONE_AWAY)).toBe(3);
    expect(bestOverlap(WRONG)).toBe(1);
  });

  it("refuses guesses that are not moves", () => {
    let run = createRun(DAY);
    expect(refusal(run, maskOf([0, 1, 2]))).toBe("size");
    expect(refusal(run, maskOf([0, 1, 2, 3, 4]))).toBe("size");
    expect(refusal(run, 1 << 16)).toBe("size");
    run = guess(run, ONE_AWAY);
    expect(refusal(run, ONE_AWAY)).toBe("repeat");
    expect(guess(run, ONE_AWAY)).toBe(run);
    run = guess(run, groupMask(1));
    expect(refusal(run, maskOf([4, 8, 12, 0]))).toBe("found");
  });

  it("ends on the fourth mistake, keeping 15 a group", () => {
    const run = replay(DAY, [
      groupMask(0),
      maskOf([4, 5, 6, 8]),
      maskOf([4, 5, 6, 9]),
      maskOf([4, 5, 6, 10]),
      maskOf([4, 5, 6, 11]),
    ]);
    expect(run.outcome).toBe("over");
    expect(run.ending).toBe("out");
    expect(scoreOf(run)).toBe(15);
    expect(refusal(run, groupMask(1))).toBe("over");
  });

  it("is worth 100 solved clean, and 10 less for every mistake", () => {
    const clean = replay(DAY, [0, 1, 2, 3].map(groupMask));
    expect(clean.ending).toBe("solved");
    expect(scoreOf(clean)).toBe(100);
    const messy = replay(
      DAY,
      [WRONG, ONE_AWAY, maskOf([0, 1, 2, 5]), 3, 2, 1, 0].map((m, i) => (i < 3 ? m : groupMask(m))),
    );
    expect(messy.guesses).toHaveLength(MAX_GUESSES);
    expect(messy.ending).toBe("solved");
    expect(scoreOf(messy)).toBe(70);
  });

  it("can stop early and keep its groups", () => {
    const run = stop(guess(createRun(DAY), groupMask(3)));
    expect(run.ending).toBe("stopped");
    expect(submission(run)).toEqual({
      rulesVersion: "foursort@1",
      actions: [groupMask(3)],
      score: 15,
    });
  });

  it("shows every word once, in the same order for everyone on a day", () => {
    const order = boardOrder(DAY);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(boardOrder(DAY)).toEqual(order);
    expect(boardOrder(DAY + 1)).not.toEqual(order);
  });
});

describe("Foursort's verifier", () => {
  it("scores with the same numbers as the engine", () => {
    expect(MIGRATION).toContain("'foursort@1'");
    expect(MIGRATION).toMatch(/v_found \* 15/);
    expect(MIGRATION).toMatch(/10 \* \(4 - v_mistakes\)/);
    expect(MIGRATION).toMatch(/foursort_max_actions\(\)[\s\S]*?select 7/);
  });
});
