import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readBlock, tonUpBlocks } from "@/lib/games/daily-banks-sql";
import { TON_UP_CATEGORIES } from "@/lib/games/ton-up-bank";
import {
  categoryIndexForDay,
  createRun,
  refusal,
  replay,
  scoreOf,
  stand,
  submission,
  suggestions,
  throwDart,
  waysToTon,
} from "@/lib/games/ton-up";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20270104120000_ton_up_sessions.sql"),
  "utf8",
);

/** The first day that plays category `index`. */
function dayFor(index: number): number {
  let day = 20000;
  while (categoryIndexForDay(day) !== index) day += 1;
  return day;
}

/** An answer's index in a category by name. */
function idOf(category: number, name: string): number {
  const id = TON_UP_CATEGORIES[category]!.answers.findIndex((a) => a.name === name);
  if (id < 0) throw new Error(name);
  return id;
}

describe("Ton Up's bank", () => {
  it("is the one the migration holds", () => {
    for (const [name, body] of Object.entries(tonUpBlocks())) {
      expect(readBlock(MIGRATION, name), name).toBe(body);
    }
  });

  it("knows its facts", () => {
    const elements = TON_UP_CATEGORIES[0]!.answers;
    expect(elements).toHaveLength(118);
    const value = (name: string) => elements.find((a) => a.name === name)!.value;
    expect([value("Iron"), value("Silver"), value("Tin"), value("Gold"), value("Lead")]).toEqual([
      26, 47, 50, 79, 82,
    ]);
    expect(value("Uranium")).toBe(92);
    const presidents = TON_UP_CATEGORIES[1]!.answers;
    expect(presidents).toHaveLength(47);
    expect(presidents.find((a) => a.name === "Abraham Lincoln")!.value).toBe(16);
    expect(presidents.find((a) => a.name === "John F. Kennedy")!.value).toBe(35);
    const states = TON_UP_CATEGORIES[2]!.answers;
    expect(states.find((a) => a.name === "Hawaii")!.value).toBe(50);
  });

  it("gives every category a way to hit 100, and unique names", () => {
    for (const category of TON_UP_CATEGORIES) {
      expect(waysToTon(category), category.title).toBeGreaterThan(0);
      const names = category.answers.map((a) => a.name);
      expect(new Set(names).size, category.title).toBe(names.length);
    }
  });
});

describe("a Ton Up run", () => {
  it("adds each dart and ends on a ton, scoring more for fewer darts", () => {
    const day = dayFor(1); // presidents
    let run = createRun(day);
    run = throwDart(run, idOf(1, "Franklin D. Roosevelt"));
    run = throwDart(run, idOf(1, "Harry S. Truman"));
    expect(run.total).toBe(65);
    expect(run.outcome).toBe("playing");
    run = throwDart(run, idOf(1, "John F. Kennedy"));
    expect(run.total).toBe(100);
    expect(run.ending).toBe("ton");
    expect(scoreOf(run)).toBe(125);
  });

  it("busts past 100 and scores nothing", () => {
    const day = dayFor(0); // elements
    const run = replay(day, [idOf(0, "Mendelevium")]);
    expect(run.total).toBe(101);
    expect(run.ending).toBe("bust");
    expect(scoreOf(run)).toBe(0);
  });

  it("refuses a repeat, and stands on what it has", () => {
    const day = dayFor(2);
    const run = throwDart(createRun(day), 4);
    expect(refusal(run, 4)).toBe("used");
    expect(throwDart(run, 4)).toBe(run);
    const stood = stand(run);
    expect(stood.ending).toBe("stood");
    expect(scoreOf(stood)).toBe(5);
    expect(submission(stood)).toMatchObject({ actions: [4], score: 5 });
    expect(throwDart(stood, 5)).toBe(stood);
  });

  it("ends after the third dart", () => {
    const run = replay(dayFor(0), [0, 1, 2]);
    expect(run.outcome).toBe("over");
    expect(run.ending).toBe("stood");
    expect(scoreOf(run)).toBe(6);
  });

  it("suggests answers by name and alias", () => {
    const presidents = TON_UP_CATEGORIES[1]!;
    expect(suggestions(presidents, "jfk")[0]!.answer.name).toBe("John F. Kennedy");
    expect(suggestions(presidents, "linc")[0]!.answer.name).toBe("Abraham Lincoln");
    const elements = TON_UP_CATEGORIES[0]!;
    expect(suggestions(elements, "aluminum")[0]!.answer.name).toBe("Aluminium");
  });
});
