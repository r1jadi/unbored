import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { honeycombBlocks, readBlock } from "@/lib/games/daily-banks-sql";
import { HONEYCOMB_PUZZLES } from "@/lib/games/honeycomb-bank";
import {
  attempt,
  createRun,
  find,
  MAX_WORDS,
  maxScore,
  puzzleIndexForDay,
  puzzleOf,
  rankIndex,
  RANKS,
  refusal,
  replay,
  scoreOf,
  stop,
  submission,
  usesAllSeven,
  wordPoints,
} from "@/lib/games/honeycomb";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20270106120100_honeycomb_sessions.sql"),
  "utf8",
);

const DAY = 20406;

describe("Honeycomb's bank", () => {
  it("has two months of puzzles, each seven different letters and never an s", () => {
    expect(HONEYCOMB_PUZZLES.length).toBeGreaterThanOrEqual(60);
    for (const puzzle of HONEYCOMB_PUZZLES) {
      expect(puzzle.letters).toMatch(/^[a-z]{7}$/);
      expect(new Set(puzzle.letters).size, puzzle.letters).toBe(7);
      expect(puzzle.letters).not.toContain("s");
    }
  });

  it("only accepts words a player could make, sorted, with one using all seven", () => {
    for (const puzzle of HONEYCOMB_PUZZLES) {
      const { letters, words } = puzzle;
      expect(words.length, letters).toBeGreaterThanOrEqual(20);
      expect(words.length, letters).toBeLessThanOrEqual(MAX_WORDS);
      expect([...words].sort(), letters).toEqual(words);
      expect(new Set(words).size, letters).toBe(words.length);
      for (const word of words) {
        expect(word, letters).toMatch(/^[a-z]{4,}$/);
        expect(word.includes(letters[0]!), `${word} in ${letters}`).toBe(true);
        expect(
          [...word].every((ch) => letters.includes(ch)),
          `${word} in ${letters}`,
        ).toBe(true);
      }
      expect(
        words.some((w) => usesAllSeven(puzzle, w)),
        letters,
      ).toBe(true);
    }
  });

  it("is copied into the migration exactly", () => {
    const blocks = honeycombBlocks();
    expect(readBlock(MIGRATION, "honeycomb-count")).toBe(blocks["honeycomb-count"]);
    expect(readBlock(MIGRATION, "honeycomb-points")).toBe(blocks["honeycomb-points"]);
  });
});

describe("a Honeycomb run", () => {
  const run0 = createRun(DAY);
  const puzzle = puzzleOf(run0);
  const four = puzzle.words.findIndex((w) => w.length === 4);
  const all = puzzle.words.findIndex((w) => usesAllSeven(puzzle, w));

  it("scores 1 for four letters, the length for more, and 7 more for all seven", () => {
    expect(puzzleIndexForDay(DAY)).toBe(DAY % HONEYCOMB_PUZZLES.length);
    if (four >= 0) expect(wordPoints(puzzle, puzzle.words[four]!)).toBe(1);
    const allWord = puzzle.words[all]!;
    expect(wordPoints(puzzle, allWord)).toBe(allWord.length + 7);
    expect(scoreOf(find(run0, all))).toBe(allWord.length + 7);
  });

  it("says why a typed word doesn't count", () => {
    const centre = puzzle.letters[0]!;
    const outer = puzzle.letters.slice(1);
    expect(attempt(run0, centre.repeat(3))).toEqual({ kind: "short" });
    expect(attempt(run0, outer.slice(0, 4))).toEqual({ kind: "centre" });
    expect(attempt(run0, `${centre}sss`)).toEqual({ kind: "letters" });
    expect(attempt(run0, centre.repeat(9))).toEqual({ kind: "unknown" });
    const word = puzzle.words[all]!;
    expect(attempt(run0, word.toUpperCase())).toEqual({ kind: "word", id: all });
    expect(attempt(find(run0, all), word)).toEqual({ kind: "found" });
  });

  it("refuses a word twice, or one that isn't in the list", () => {
    const run = find(run0, all);
    expect(refusal(run, all)).toBe("found");
    expect(find(run, all)).toBe(run);
    expect(refusal(run, puzzle.words.length)).toBe("unknown");
    expect(refusal(run, -1)).toBe("unknown");
  });

  it("ends when every word is found, at the day's top score and top rank", () => {
    const ids = puzzle.words.map((_, i) => i);
    const done = replay(DAY, ids);
    expect(done.ending).toBe("all");
    expect(scoreOf(done)).toBe(maxScore(puzzle));
    expect(rankIndex(done)).toBe(RANKS.length - 1);
    expect(refusal(done, 0)).toBe("over");
  });

  it("stops whenever the player likes and keeps the words found", () => {
    const run = stop(find(run0, all));
    expect(rankIndex(createRun(DAY))).toBe(0);
    expect(submission(run)).toEqual({
      rulesVersion: "honeycomb@1",
      actions: [all],
      score: puzzle.words[all]!.length + 7,
    });
  });
});

describe("Honeycomb's verifier", () => {
  it("adds up the same points as the engine", () => {
    expect(MIGRATION).toContain("'honeycomb@1'");
    expect(MIGRATION).toMatch(/v_score := v_score \+ v_points\[v_action \+ 1\]/);
    expect(MIGRATION).toMatch(/honeycomb_max_actions\(\)[\s\S]*?select 64/);
  });
});
