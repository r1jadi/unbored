import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ALIBI_ANSWERS } from "@/lib/games/alibi-answers";
import { ALIBI_CASES, type AlibiCase, type Text } from "@/lib/games/alibi-bank";
import { alibiBlocks, readBlock } from "@/lib/games/daily-banks-sql";
import {
  accuseCode,
  cardOrder,
  createRun,
  decode,
  MAX_MOVES,
  openCode,
  play,
  potential,
  puzzleIndexForDay,
  refusal,
  replay,
  scoreOf,
  starsOf,
  stop,
  submission,
  suspectOrder,
} from "@/lib/games/alibi";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20270122120000_alibi_sessions.sql"),
  "utf8",
);

/** Day 20406 plays case 6, The Broken Window: four files, the witness lies, the almanac proves it. */
const DAY = 20406;

/** Every text a case shows, in one language. */
function texts(alibiCase: AlibiCase, language: keyof Text): string[] {
  const all: Text[] = [alibiCase.title, alibiCase.setting, alibiCase.setup];
  for (const s of alibiCase.suspects) {
    all.push(s.name, s.role, s.statement);
    if (s.statedAt) all.push(s.statedAt);
  }
  for (const c of alibiCase.cards) all.push(c.title, c.body);
  return all.map((text) => text[language]);
}

const TIME = /\b\d{1,2}:\d{2}\b/g;
const sentences = (text: string) => text.split(/[.!?…]+(?:\s|$)/).filter((s) => s.trim()).length;
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Words a statement and a card could share: lower case, at least three letters, cut to five. */
const STOP = new Set(
  "the and was were you your that this with from have had for not but all are her his him she they them our out off one two six ten its into then than when what who why how did does just only too very ishte isha nga dhe për por një ajo atë kur nuk më të në që deri".split(
    " ",
  ),
);
function stems(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\d:]+/u)
      .filter((w) => w.length >= 3 && !STOP.has(w))
      .map((w) => w.slice(0, 5)),
  );
}

describe("Alibi's bank", () => {
  it("has at least the first ten cases, each with a unique id and an answer", () => {
    expect(ALIBI_CASES.length).toBeGreaterThanOrEqual(10);
    expect(ALIBI_ANSWERS).toHaveLength(ALIBI_CASES.length);
    expect(new Set(ALIBI_CASES.map((c) => c.id)).size).toBe(ALIBI_CASES.length);
  });

  ALIBI_CASES.forEach((alibiCase, i) => {
    describe(alibiCase.id, () => {
      const answer = ALIBI_ANSWERS[i]!;

      it("has three suspects and four to six files, each with its own id", () => {
        expect(alibiCase.suspects).toHaveLength(3);
        expect(alibiCase.cards.length).toBeGreaterThanOrEqual(4);
        expect(alibiCase.cards.length).toBeLessThanOrEqual(6);
        expect(new Set(alibiCase.suspects.map((s) => s.id)).size).toBe(3);
        expect(new Set(alibiCase.cards.map((c) => c.id)).size).toBe(alibiCase.cards.length);
      });

      it("names a culprit and a proof that exist", () => {
        expect(answer.culprit).toBeGreaterThanOrEqual(0);
        expect(answer.culprit).toBeLessThan(3);
        expect(answer.proof).toBeGreaterThanOrEqual(0);
        expect(answer.proof).toBeLessThan(alibiCase.cards.length);
      });

      it("is written in both languages", () => {
        for (const language of ["en", "sq"] as const) {
          for (const text of [...texts(alibiCase, language), answer.solution[language]]) {
            expect(text.trim(), `${language}: ${text}`).not.toBe("");
          }
        }
      });

      it("keeps statements and files short enough for a phone", () => {
        for (const language of ["en", "sq"] as const) {
          for (const s of alibiCase.suspects) {
            expect(sentences(s.statement[language]), s.statement[language]).toBeLessThanOrEqual(4);
          }
          for (const c of alibiCase.cards) {
            expect(words(c.body[language]), c.body[language]).toBeLessThanOrEqual(45);
          }
        }
      });

      it("has the same times in English and Albanian", () => {
        const en = new Set(texts(alibiCase, "en").join(" ").match(TIME) ?? []);
        const sq = new Set(texts(alibiCase, "sq").join(" ").match(TIME) ?? []);
        expect([...sq].sort()).toEqual([...en].sort());
      });

      it("has a proof that touches the culprit's statement, in both languages", () => {
        const culprit = alibiCase.suspects[answer.culprit]!;
        const proof = alibiCase.cards[answer.proof]!;
        for (const language of ["en", "sq"] as const) {
          const said = stems(`${culprit.name[language]} ${culprit.statement[language]}`);
          const shown = stems(`${proof.title[language]} ${proof.body[language]}`);
          const shared = [...said].filter((w) => shown.has(w));
          expect(shared.length, `${language}: nothing shared`).toBeGreaterThan(0);
        }
      });
    });
  });

  it("is the database's copy", () => {
    const blocks = alibiBlocks();
    for (const [name, body] of Object.entries(blocks)) {
      expect(readBlock(MIGRATION, name), name).toBe(body);
    }
  });
});

describe("a move as a code", () => {
  it("opens a file or accuses a suspect with one", () => {
    expect(decode(openCode(3))).toEqual({ kind: "open", card: 3 });
    expect(decode(accuseCode(2, 5))).toEqual({ kind: "accuse", suspect: 2, card: 5 });
    expect(accuseCode(2, 5)).toBe(23);
    expect(decode(24)).toBeNull();
    expect(decode(-1)).toBeNull();
    expect(decode(1.5)).toBeNull();
  });
});

describe("an Alibi run", () => {
  it("plays the day's case", () => {
    const run = createRun(DAY, ALIBI_ANSWERS);
    expect(run.puzzle).toBe(puzzleIndexForDay(DAY));
    expect(run.opened).toHaveLength(4);
    expect(run.answer).toEqual({ culprit: 0, proof: 2 });
    expect(run.solution).toEqual(ALIBI_ANSWERS[run.puzzle]!.solution);
  });

  it("solves with the liar and the proof", () => {
    const run = replay(DAY, [openCode(2), accuseCode(0, 2)], ALIBI_ANSWERS);
    expect(run.ending).toBe("solved");
    expect(scoreOf(run)).toBe(92);
    expect(starsOf(run)).toBe(3);
  });

  it("does not solve with the right suspect and the wrong file", () => {
    const run = replay(DAY, [openCode(0), accuseCode(0, 0)], ALIBI_ANSWERS);
    expect(run.outcome).toBe("playing");
    expect(run.accusations).toEqual([{ suspect: 0, card: 0, correct: false }]);
    expect(potential(run)).toBe(100 - 8 - 30);
  });

  it("closes the case after two wrong accusations, with nothing", () => {
    const run = replay(
      DAY,
      [openCode(0), openCode(1), accuseCode(1, 0), accuseCode(2, 1)],
      ALIBI_ANSWERS,
    );
    expect(run.ending).toBe("out");
    expect(scoreOf(run)).toBe(0);
    expect(starsOf(run)).toBe(0);
  });

  it("gives fewer stars for more files or a second try", () => {
    const many = replay(DAY, [0, 1, 2, accuseCode(0, 2)], ALIBI_ANSWERS);
    expect(scoreOf(many)).toBe(76);
    expect(starsOf(many)).toBe(2);
    const second = replay(DAY, [2, accuseCode(1, 2), accuseCode(0, 2)], ALIBI_ANSWERS);
    expect(scoreOf(second)).toBe(62);
    expect(starsOf(second)).toBe(1);
  });

  it("refuses moves that are not legal", () => {
    const run = createRun(DAY, ALIBI_ANSWERS);
    expect(refusal(run, accuseCode(0, 2))).toBe("closed");
    expect(refusal(run, openCode(4))).toBe("invalid");
    const opened = play(run, openCode(2));
    expect(refusal(opened, openCode(2))).toBe("opened");
    const tried = play(opened, accuseCode(1, 2));
    expect(refusal(tried, accuseCode(1, 2))).toBe("repeat");
    const solved = play(tried, accuseCode(0, 2));
    expect(refusal(solved, openCode(0))).toBe("over");
    expect(play(solved, openCode(0))).toBe(solved);
  });

  it("ends with nothing when the case is closed early", () => {
    const run = stop(play(createRun(DAY, ALIBI_ANSWERS), openCode(1)));
    expect(run.ending).toBe("stopped");
    expect(submission(run)).toEqual({ rulesVersion: "alibi@1", actions: [1], score: 0 });
  });

  it("never needs more moves than the submission bound", () => {
    const run = replay(DAY + 3, [0, 1, 2, 3, 4, accuseCode(0, 4), accuseCode(2, 4)], ALIBI_ANSWERS);
    expect(run.moves.length).toBeLessThanOrEqual(MAX_MOVES);
  });
});

describe("the board's order", () => {
  it("shuffles the suspects and files by the day, the same every time", () => {
    expect(suspectOrder(DAY)).toEqual(suspectOrder(DAY));
    expect([...suspectOrder(DAY)].sort()).toEqual([0, 1, 2]);
    expect([...cardOrder(DAY, 6)].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    const orders = new Set(Array.from({ length: 30 }, (_, d) => suspectOrder(d).join("")));
    expect(orders.size).toBeGreaterThan(3);
  });
});
