import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEEP_CUT_MAX_POINTS,
  DEEP_CUT_RULES_VERSION,
  deepCutSubmission,
  deepestTier,
  ratingFor,
  shareGrid,
  tierInfo,
  TIERS,
  totalPoints,
  utcDayNumber,
  type DeepCutTurn,
} from "@/lib/games/deep-cut";
// @ts-expect-error — a plain .mjs script, imported for its exports.
import { answerKey, parseBank } from "../../../scripts/generate-deep-cut-bank.mjs";

const ROOT = resolve(__dirname, "../../..");
const SESSIONS = readFileSync(
  resolve(ROOT, "supabase/migrations/20270102120000_deep_cut_sessions.sql"),
  "utf8",
);

function turn(partial: Partial<DeepCutTurn>): DeepCutTurn {
  return {
    position: 0,
    verdict: "correct",
    answer: "x",
    canonical: "x",
    answerId: 1,
    tier: 1,
    points: 10,
    sharePercent: null,
    commonAnswer: null,
    deepestAnswers: null,
    ...partial,
  };
}

describe("tiers", () => {
  it("run from 10 to 100, as the database's deep_cut_tier_points", () => {
    expect(TIERS.map((tier) => tier.points)).toEqual([10, 20, 40, 60, 80, 100]);
    expect(SESSIONS).toContain(
      "when 1 then 10 when 2 then 20 when 3 then 40\n    when 4 then 60 when 5 then 80 when 6 then 100",
    );
    expect(DEEP_CUT_MAX_POINTS).toBe(7 * 100);
  });

  it("are looked up by number", () => {
    expect(tierInfo(6)?.name).toBe("Abyss");
    expect(tierInfo(null)).toBeNull();
    expect(tierInfo(9)).toBeNull();
  });

  it("match the rules version the database implements", () => {
    expect(SESSIONS).toContain(`select '${DEEP_CUT_RULES_VERSION}'::text`);
  });
});

describe("the daily submission", () => {
  it("sends each matched answer's id, 0 for a miss, and a tenth of the points", () => {
    const turns = [
      turn({ answerId: 41, tier: 5, points: 80 }),
      turn({ verdict: "wrong", answerId: 0, tier: null, points: 0 }),
      turn({ answerId: 7, tier: 1, points: 10 }),
    ];
    expect(deepCutSubmission(turns)).toEqual({
      rulesVersion: "deep-cut@1",
      actions: [41, 0, 7],
      score: 9,
    });
  });

  it("sends a question left open as 0", () => {
    expect(deepCutSubmission([turn({ answerId: 5 })], true).actions).toEqual([5, 0]);
  });
});

describe("the result", () => {
  const turns = [
    turn({ tier: 1, points: 10 }),
    turn({ verdict: "timeout", tier: null, points: 0 }),
    turn({ tier: 6, points: 100 }),
    turn({ tier: 3, points: 40 }),
  ];

  it("totals the points", () => {
    expect(totalPoints(turns)).toBe(150);
  });

  it("shares a spoiler-free grid", () => {
    expect(shareGrid(turns)).toBe("🟨❌🐙🟦");
  });

  it("knows the deepest dive", () => {
    expect(deepestTier(turns)).toBe(6);
    expect(deepestTier([turn({ verdict: "wrong", tier: null })])).toBeNull();
  });

  it("rates a run by its total", () => {
    expect(ratingFor(0).title).toBe("Paddler");
    expect(ratingFor(700).title).toBe("Abyss legend");
    expect(ratingFor(400).title).toBe("Deep diver");
  });

  it("numbers days as the archive does", () => {
    expect(utcDayNumber(Date.UTC(2026, 10, 14, 23, 59))).toBe(20771);
  });
});

describe("the bank", () => {
  it("normalises spellings as deep_cut_key does", () => {
    expect(answerKey("  The Rolls-Royce ")).toBe("rollsroyce");
    expect(answerKey("Côte d'Ivoire")).toBe("cotedivoire");
    expect(answerKey("São Tomé & Príncipe")).toBe("saotomeandprincipe");
    expect(answerKey("C++")).toBe("cplusplus");
    expect(answerKey("C#")).toBe("csharp");
    expect(answerKey("Straße")).toBe("strasse");
  });

  it("is valid and loaded by the bank migration", () => {
    const { questions, problems } = parseBank(
      readFileSync(resolve(ROOT, "scripts/deep-cut/bank.txt"), "utf8"),
    );
    expect(problems).toEqual([]);
    expect(questions.length).toBeGreaterThanOrEqual(21);
    const migration = readFileSync(
      resolve(ROOT, "supabase/migrations/20270102120100_deep_cut_bank.sql"),
      "utf8",
    );
    for (const question of questions) {
      expect(migration).toContain(`select public.deep_cut_load_question('${question.slug}'`);
    }
  });

  it("never reaches the browser", () => {
    // The answers are the score: no client module may import the bank.
    const client = readFileSync(resolve(ROOT, "src/lib/games/deep-cut.ts"), "utf8");
    expect(client).not.toContain("bank.txt");
    expect(client).not.toContain("Delaware");
  });
});
