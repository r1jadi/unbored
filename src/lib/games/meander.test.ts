import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { meanderBlocks, readBlock } from "@/lib/games/daily-banks-sql";
import { MEANDER_PUZZLES } from "@/lib/games/meander-bank";
import {
  adjacent,
  CELLS,
  createRun,
  decodeTrace,
  encodeTrace,
  HINT,
  hintTarget,
  lettersOf,
  liftCode,
  MAX_HINTS,
  MAX_LENGTH,
  MAX_MOVES,
  maxScore,
  MEANDER_RULES_VERSION,
  MIN_LENGTH,
  move,
  owners,
  puzzleIndexForDay,
  puzzleOf,
  refusal,
  replay,
  scoreOf,
  solution,
  stop,
  submission,
} from "@/lib/games/meander";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20270113120000_meander_sessions.sql"),
  "utf8",
);

/** A day that plays puzzle `p`. */
const dayFor = (p: number) =>
  20400 +
  ((p - (20400 % MEANDER_PUZZLES.length) + MEANDER_PUZZLES.length) % MEANDER_PUZZLES.length);

describe("the Meander bank", () => {
  it("has a grid for every day", () => {
    expect(MEANDER_PUZZLES.length).toBeGreaterThanOrEqual(30);
  });

  it.each(MEANDER_PUZZLES.map((p, i) => [i, p] as const))(
    "puzzle %i holds its words, every letter once",
    (_, puzzle) => {
      expect(puzzle.rows).toHaveLength(5);
      for (const row of puzzle.rows) expect(row).toMatch(/^[A-Z]{5}$/);
      expect(puzzle.words.length).toBeGreaterThanOrEqual(4);
      expect(puzzle.words.length).toBeLessThanOrEqual(5);
      expect(new Set(puzzle.words).size).toBe(puzzle.words.length);
      const letters = lettersOf(puzzle);
      const used = puzzle.paths.flat();
      expect(used.sort((a, b) => a - b)).toEqual(Array.from({ length: CELLS }, (_, i) => i));
      puzzle.paths.forEach((path, i) => {
        const word = puzzle.words[i]!;
        expect(word.length).toBeGreaterThanOrEqual(MIN_LENGTH);
        expect(word.length).toBeLessThanOrEqual(MAX_LENGTH);
        expect(path.map((cell) => letters[cell]).join("")).toBe(word);
        for (let k = 1; k < path.length; k += 1)
          expect(adjacent(path[k - 1]!, path[k]!)).toBe(true);
      });
    },
  );

  it("never lays a word out straight along a row or column", () => {
    for (const puzzle of MEANDER_PUZZLES) {
      for (const path of puzzle.paths) {
        const steps = path.slice(1).map((cell, k) => cell - path[k]!);
        const straight = steps.some((s, k) => k >= 2 && s === steps[k - 1] && s === steps[k - 2]);
        expect(straight).toBe(false);
      }
    }
  });

  it("never shows a word whole in a row or column", () => {
    for (const puzzle of MEANDER_PUZZLES) {
      const lines = [
        ...puzzle.rows,
        ...Array.from({ length: 5 }, (_, c) => puzzle.rows.map((row) => row[c]).join("")),
      ];
      for (const word of puzzle.words) {
        for (const line of lines) {
          expect(line.includes(word) || line.split("").reverse().join("").includes(word)).toBe(
            false,
          );
        }
      }
    }
  });

  it("is copied into the migration exactly", () => {
    const blocks = meanderBlocks();
    expect(readBlock(MIGRATION, "meander-count")).toBe(blocks["meander-count"]);
    expect(readBlock(MIGRATION, "meander-bank")).toBe(blocks["meander-bank"]);
  });
});

describe("a trace's code", () => {
  it("round-trips every path of every grid", () => {
    for (const puzzle of MEANDER_PUZZLES) {
      for (const path of puzzle.paths) {
        const code = encodeTrace(path)!;
        expect(code).toBeGreaterThanOrEqual(100);
        expect(decodeTrace(code)).toEqual([...path]);
      }
    }
  });

  it("refuses what is not a path", () => {
    expect(encodeTrace([0, 1, 2])).toBeNull(); // too short
    expect(encodeTrace([0, 1, 2, 3, 4, 9, 14, 19, 24])).toBeNull(); // too long
    expect(encodeTrace([0, 1, 2, 4])).toBeNull(); // a jump
    expect(encodeTrace([4, 5, 6, 7])).toBeNull(); // wraps a row
    expect(encodeTrace([0, 1, 6, 1])).toBeNull(); // a cell twice
    expect(decodeTrace(99)).toBeNull();
    // Starting at the right edge and stepping right leaves the grid.
    expect(decodeTrace(4 + 25 * 4 + 400 * (1 + 4 * 2 + 16 * 2))).toBeNull();
    // A direction past the trace's length is an alias, not a code.
    expect(decodeTrace(0 + 25 * 4 + 400 * 64)).toBeNull();
  });
});

describe("a Meander run", () => {
  const day = dayFor(0);
  const puzzle = puzzleOf(createRun(day));

  it("plays puzzle d mod n", () => {
    expect(puzzleIndexForDay(day)).toBe(0);
    expect(puzzleIndexForDay(-1)).toBe(MEANDER_PUZZLES.length - 1);
    expect(createRun(day).rulesVersion).toBe(MEANDER_RULES_VERSION);
  });

  it("is solved by its own paths, scoring the best the day allows", () => {
    const run = replay(day, solution(puzzle));
    expect(run.ending).toBe("solved");
    expect(run.outcome).toBe("over");
    expect(scoreOf(run)).toBe(maxScore(puzzle));
    expect(maxScore(puzzle)).toBe(puzzle.words.length * 10 + 50 + 75);
    expect(owners(run).every((owner) => owner >= 0)).toBe(true);
  });

  it("solves in any order", () => {
    const run = replay(day, [...solution(puzzle)].reverse());
    expect(run.ending).toBe("solved");
  });

  it("refuses a trace that spells no word of the day, or sits on a placed word", () => {
    const [first] = solution(puzzle);
    const run = move(createRun(day), first!);
    expect(refusal(run, first!)).toBe("taken");
    const reversed = encodeTrace([...puzzle.paths[1]!].reverse())!;
    expect(refusal(createRun(day), reversed)).toBe("unknown");
    expect(move(createRun(day), reversed)).toEqual(createRun(day));
  });

  it("lifts a placed word, and only a placed one", () => {
    const [first] = solution(puzzle);
    const placed = move(createRun(day), first!);
    expect(refusal(placed, liftCode(1))).toBe("nothing");
    const lifted = move(placed, liftCode(0));
    expect(lifted.placed).toEqual([]);
    expect(lifted.moves).toEqual([first, liftCode(0)]);
    expect(refusal(lifted, first!)).toBeNull();
  });

  it("hints at the first word neither placed nor hinted, three times at most", () => {
    let run = move(createRun(day), solution(puzzle)[0]!);
    expect(hintTarget(run)).toBe(1);
    run = move(run, HINT);
    expect(run.hinted).toEqual([1]);
    run = move(run, HINT);
    run = move(run, HINT);
    expect(run.hinted).toEqual([1, 2, 3]);
    expect(refusal(run, HINT)).toBe("nothing");
    const solved = solution(puzzle)
      .slice(1)
      .reduce((r, m) => move(r, m), run);
    expect(solved.ending).toBe("solved");
    expect(scoreOf(solved)).toBe(puzzle.words.length * 10 + 50);
  });

  it("keeps 10 a placed word when it stops", () => {
    const run = stop(replay(day, solution(puzzle).slice(0, 2)));
    expect(run.ending).toBe("stopped");
    expect(scoreOf(run)).toBe(20);
    expect(refusal(run, solution(puzzle)[2]!)).toBe("over");
    expect(submission(run)).toEqual({
      rulesVersion: MEANDER_RULES_VERSION,
      actions: solution(puzzle).slice(0, 2),
      score: 20,
    });
  });

  it("takes no more than the submission bound of moves", () => {
    const [first] = solution(puzzle);
    let run = createRun(day);
    while (run.moves.length < MAX_MOVES) {
      run = move(move(run, first!), liftCode(0));
    }
    expect(refusal(run, first!)).toBe("full");
    expect(MAX_HINTS).toBe(3);
  });

  it("accepts a word traced along another route when the letters allow it", () => {
    // Find a grid where some word can be traced along a route that is not its own.
    let found = false;
    for (const [index, p] of MEANDER_PUZZLES.entries()) {
      const letters = lettersOf(p);
      for (const [w, path] of p.paths.entries()) {
        const alt = otherRoute(letters, p.words[w]!, path);
        if (!alt) continue;
        const run = move(createRun(dayFor(index)), encodeTrace(alt)!);
        expect(run.placed).toEqual([{ word: w, cells: alt }]);
        found = true;
        break;
      }
      if (found) break;
    }
    expect(found).toBe(true);
  });
});

/** A route spelling `word` on the grid other than `own`, or null. */
function otherRoute(letters: string[], word: string, own: readonly number[]): number[] | null {
  const key = own.join();
  function walk(path: number[]): number[] | null {
    if (path.length === word.length) return path.join() === key ? null : path;
    const last = path[path.length - 1]!;
    for (let next = 0; next < CELLS; next += 1) {
      if (!adjacent(last, next) || path.includes(next) || letters[next] !== word[path.length]) {
        continue;
      }
      const found = walk([...path, next]);
      if (found) return found;
    }
    return null;
  }
  for (let start = 0; start < CELLS; start += 1) {
    if (letters[start] !== word[0]) continue;
    const found = walk([start]);
    if (found) return found;
  }
  return null;
}
