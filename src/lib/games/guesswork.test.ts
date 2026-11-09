import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  GJEJE_ANSWERS,
  GJEJE_GUESSES,
  GUESSWORK_ANSWERS,
  GUESSWORK_GUESSES,
} from "@/lib/games/guesswork-bank";
import {
  alphabetFor,
  answerForDay,
  createRun,
  decodeGuess,
  encodeGuess,
  finish,
  GJEJE_RULES_VERSION,
  guess,
  GUESSWORK_RULES_VERSION,
  letterMarks,
  lettersOf,
  marksFor,
  refusal,
  replay,
  scoreOf,
  submission,
  wordSet,
} from "@/lib/games/guesswork";

/**
 * The engine's tests are pinned to the database's: the banks below are compared
 * with the lists in the migration word for word, and the packing, the marks and the
 * scores are the ones `public.complete_guesswork_run` replays.
 */

const MIGRATION = join(
  __dirname,
  "../../../supabase/migrations/20261222120000_guesswork_sessions.sql",
);

function sqlList(name: string): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf(`-- ${name}:begin`);
  const end = sql.indexOf(`-- ${name}:end`);
  return [...sql.slice(start, end).matchAll(/'([^']+)'/g)].map((match) => match[1]!);
}

const english = wordSet(GUESSWORK_ANSWERS, GUESSWORK_GUESSES);
const albanian = wordSet(GJEJE_ANSWERS, GJEJE_GUESSES);

describe("the banks", () => {
  it("match the database's lists, word for word and in order", () => {
    expect(sqlList("guesswork-answers")).toEqual([...GUESSWORK_ANSWERS]);
    expect(sqlList("guesswork-guesses")).toEqual([...GUESSWORK_GUESSES]);
    expect(sqlList("gjeje-answers")).toEqual([...GJEJE_ANSWERS]);
    expect(sqlList("gjeje-guesses")).toEqual([...GJEJE_GUESSES]);
  });

  it("hold five-square words of each language's alphabet, each once", () => {
    for (const [words, rules] of [
      [[...GUESSWORK_ANSWERS, ...GUESSWORK_GUESSES], GUESSWORK_RULES_VERSION],
      [[...GJEJE_ANSWERS, ...GJEJE_GUESSES], GJEJE_RULES_VERSION],
    ] as const) {
      const alphabet = alphabetFor(rules);
      for (const word of words) {
        expect(lettersOf(word), word).toHaveLength(5);
        expect(
          lettersOf(word).every((letter) => alphabet.includes(letter)),
          word,
        ).toBe(true);
      }
      expect(new Set(words).size).toBe(words.length);
    }
    expect(GUESSWORK_ANSWERS.length).toBeGreaterThan(600);
    expect(GJEJE_ANSWERS.length).toBeGreaterThan(190);
  });

  it("gives every day a word, walking the answers in order", () => {
    expect(answerForDay(0, GUESSWORK_ANSWERS)).toBe(GUESSWORK_ANSWERS[0]);
    expect(answerForDay(GUESSWORK_ANSWERS.length + 3, GUESSWORK_ANSWERS)).toBe(
      GUESSWORK_ANSWERS[3],
    );
    expect(answerForDay(-1, GJEJE_ANSWERS)).toBe(GJEJE_ANSWERS[GJEJE_ANSWERS.length - 1]);
  });
});

describe("a move", () => {
  it("packs five letters five bits each, first letter lowest", () => {
    expect(encodeGuess("AAAAA")).toBe(1 + 32 + 1024 + 32768 + 1048576);
    expect(encodeGuess("BAAAA") - encodeGuess("AAAAA")).toBe(1);
    expect(decodeGuess(encodeGuess("SHARK"))).toBe("SHARK");
  });

  it("gives Ç and Ë codes 27 and 28, as the crossword does", () => {
    expect(encodeGuess("ÇAAAA") % 32).toBe(27);
    expect(encodeGuess("ËAAAA") % 32).toBe(28);
    expect(decodeGuess(encodeGuess("ÇELËS"))).toBe("ÇELËS");
    expect(lettersOf("çelës")).toEqual(["Ç", "E", "L", "Ë", "S"]);
  });

  it("decodes nothing that is not five letters", () => {
    expect(decodeGuess(0)).toBeNull();
    expect(decodeGuess(29)).toBeNull();
    expect(decodeGuess(32 ** 5)).toBeNull();
    expect(decodeGuess(-1)).toBeNull();
  });
});

describe("the marks", () => {
  it("mark the right place, then a spare letter elsewhere, then nothing", () => {
    expect(marksFor("CRANE", "TRACE")).toEqual([1, 2, 2, 0, 2]);
    expect(marksFor("TRACE", "TRACE")).toEqual([2, 2, 2, 2, 2]);
    expect(marksFor("BUILD", "TRACE")).toEqual([0, 0, 0, 0, 0]);
  });

  it("mark a repeated letter only as often as the word holds it", () => {
    // One E in the answer: the guess's second E, in place, takes it.
    expect(marksFor("EERIE", "THEME")).toEqual([1, 0, 0, 0, 2]);
    // Two Ls in the guess, one in the answer, elsewhere: only the first is marked.
    expect(marksFor("LLAMA", "PLANE")).toEqual([0, 2, 2, 0, 0]);
    // Two Ls in the answer: both of the guess's Ls are marked.
    expect(marksFor("ALLOW", "LOYAL")).toEqual([1, 1, 1, 1, 0]);
  });

  it("keep each letter's best mark for the keyboard", () => {
    let run = createRun(1, "TRACE");
    run = guess(run, "CRANE", english);
    run = guess(run, "CRACK", english);
    const best = letterMarks(run);
    expect(best.get("C")).toBe(2);
    expect(best.get("R")).toBe(2);
    expect(best.get("N")).toBe(0);
  });
});

describe("a run", () => {
  it("refuses a short guess, an unknown word and anything after the end", () => {
    const run = createRun(1, "TRACE");
    expect(refusal(run, "TRAC", english)).toBe("short");
    expect(refusal(run, "QQQQQ", english)).toBe("unknown");
    expect(refusal(run, "ÇELËS", english)).toBe("short");
    expect(guess(run, "QQQQQ", english)).toBe(run);
    const solved = guess(run, "TRACE", english);
    expect(refusal(solved, "CRANE", english)).toBe("over");
  });

  it("scores sixty for a first-guess solve, ten on the sixth, nothing unsolved", () => {
    const answer = "TRACE";
    expect(scoreOf(guess(createRun(1, answer), answer, english))).toBe(60);
    let run = createRun(1, answer);
    for (const word of ["CRANE", "BUILD", "MOUSE", "LIGHT", "HONEY"])
      run = guess(run, word, english);
    run = guess(run, answer, english);
    expect(run.ending).toBe("solved");
    expect(scoreOf(run)).toBe(10);

    let out = createRun(1, answer);
    for (const word of ["CRANE", "BUILD", "MOUSE", "LIGHT", "HONEY", "PIANO"]) {
      out = guess(out, word, english);
    }
    expect(out.ending).toBe("out");
    expect(scoreOf(out)).toBe(0);
    expect(scoreOf(finish(createRun(1, answer)))).toBe(0);
  });

  it("plays Albanian under gjeje@1 with Ç and Ë", () => {
    const day = GJEJE_ANSWERS.indexOf("ÇELËS");
    expect(day).toBeGreaterThanOrEqual(0);
    let run = createRun(day, answerForDay(day, GJEJE_ANSWERS), GJEJE_RULES_VERSION);
    run = guess(run, "çanta", albanian);
    expect(run.guesses).toEqual(["ÇANTA"]);
    run = guess(run, "ÇELËS", albanian);
    expect(run.ending).toBe("solved");
    expect(submission(run)).toMatchObject({ rulesVersion: "gjeje@1", score: 50, levelsCleared: 1 });
  });

  it("replays from its moves", () => {
    let run = createRun(20766, answerForDay(20766, GUESSWORK_ANSWERS));
    run = guess(run, "CRANE", english);
    run = guess(run, "SLOPE", english);
    const again = replay(20766, run.answer, GUESSWORK_RULES_VERSION, run.moves, english);
    expect(again).toEqual(run);
  });
});
