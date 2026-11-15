import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { onlyOnceBlocks, readBlock } from "@/lib/games/daily-banks-sql";
import {
  answerable,
  KINDS,
  ONLY_ONCE_PUZZLES,
  QUESTION_POOLS,
  QUESTIONS_PER_PUZZLE,
  toHexMask,
} from "@/lib/games/only-once-bank";
import { COUNTRIES, ELEMENTS, US_STATES } from "@/lib/games/only-once-data";
import {
  answer,
  createRun,
  currentQuestion,
  kindOf,
  matches,
  puzzleOf,
  refusal,
  replay,
  scoreOf,
  stop,
  timeOut,
} from "@/lib/games/only-once";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20270104120200_only_once_sessions.sql"),
  "utf8",
);

/** Seven different right answers for a puzzle, one per question. */
function solve(questions: readonly { answers: readonly number[] }[]): number[] {
  const picked: number[] = [];
  const go = (q: number): boolean => {
    if (q === questions.length) return true;
    for (const id of questions[q]!.answers) {
      if (picked.includes(id)) continue;
      picked.push(id);
      if (go(q + 1)) return true;
      picked.pop();
    }
    return false;
  };
  go(0);
  return picked;
}

describe("Only Once's facts and puzzles", () => {
  it("are the ones the migration holds", () => {
    for (const [name, body] of Object.entries(onlyOnceBlocks())) {
      expect(readBlock(MIGRATION, name), name).toBe(body);
    }
  });

  it("count every country, state and element once", () => {
    expect(COUNTRIES).toHaveLength(194);
    expect(US_STATES).toHaveLength(50);
    expect(ELEMENTS).toHaveLength(118);
    for (const kind of KINDS) {
      const names = kind.entities.map((e) => e.name);
      expect(new Set(names).size, kind.id).toBe(names.length);
    }
  });

  it("build every puzzle broad to narrow, answerable with seven different answers", () => {
    for (const puzzle of ONLY_ONCE_PUZZLES) {
      expect(puzzle.questions).toHaveLength(QUESTIONS_PER_PUZZLE);
      expect(answerable(puzzle.questions)).toBe(true);
      const sizes = puzzle.questions.map((q) => q.answers.length);
      expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
      expect(new Set(puzzle.questions.map((q) => q.text)).size).toBe(QUESTIONS_PER_PUZZLE);
    }
    for (const pool of QUESTION_POOLS) expect(pool.length).toBeGreaterThanOrEqual(25);
  });

  it("packs answer sets as hex, four ids a digit, lowest first", () => {
    expect(toHexMask([0], 8)).toBe("10");
    expect(toHexMask([3, 4], 8)).toBe("81");
    expect(toHexMask([1, 2, 7], 8)).toBe("68");
  });
});

describe("an Only Once run", () => {
  const day = 20406;

  it("takes a right answer once, and turns down wrong or used ones", () => {
    let run = createRun(day);
    const first = currentQuestion(run)!;
    const id = first.answers[0]!;
    run = answer(run, id);
    expect(run.answers).toEqual([id]);
    expect(refusal(run, id)).toBe("used");
    const wrong = kindOf(run).entities.findIndex(
      (_, i) => !currentQuestion(run)!.answers.includes(i),
    );
    expect(refusal(run, wrong)).toBe("wrong");
    expect(answer(run, wrong)).toBe(run);
  });

  it("scores ten a question and a hundred for all seven", () => {
    const picks = solve(puzzleOf(createRun(day)).questions);
    const top = replay(day, picks);
    expect(top.ending).toBe("summit");
    expect(scoreOf(top)).toBe(100);
    const partial = timeOut(replay(day, picks.slice(0, 3)));
    expect(partial.ending).toBe("timeout");
    expect(scoreOf(partial)).toBe(30);
    expect(scoreOf(stop(createRun(day)))).toBe(0);
  });

  it("matches names and aliases among the whole kind", () => {
    const countries = KINDS[0]!;
    expect(matches(countries, "usa")[0]!.entity.name).toBe("United States");
    expect(matches(countries, "czechia")[0]!.entity.name).toBe("Czech Republic");
    expect(matches(KINDS[2]!, "fe")[0]!.entity.name).toBe("Iron");
  });
});
