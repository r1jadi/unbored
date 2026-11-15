import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BALLPARK_PRODUCTS } from "@/lib/games/ballpark-bank";
import {
  closeness,
  createRun,
  direction,
  dollars,
  giveUp,
  guess,
  parsePrice,
  productOf,
  replay,
  scoreOf,
} from "@/lib/games/ballpark";
import { ballparkBlocks, readBlock } from "@/lib/games/daily-banks-sql";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20270104120100_ballpark_sessions.sql"),
  "utf8",
);

describe("Ballpark's shelf", () => {
  it("is the one the migration holds", () => {
    for (const [name, body] of Object.entries(ballparkBlocks())) {
      expect(readBlock(MIGRATION, name), name).toBe(body);
    }
  });

  it("prices every product sensibly", () => {
    expect(BALLPARK_PRODUCTS.length).toBeGreaterThanOrEqual(90);
    for (const product of BALLPARK_PRODUCTS) {
      expect(Number.isInteger(product.cents) && product.cents > 0, product.name).toBe(true);
    }
  });
});

describe("a Ballpark run", () => {
  it("marks a guess by how close it is, in exact cents", () => {
    expect(closeness(105, 100)).toBe("hit");
    expect(closeness(95, 100)).toBe("hit");
    expect(closeness(106, 100)).toBe("close");
    expect(closeness(125, 100)).toBe("close");
    expect(closeness(126, 100)).toBe("far");
    expect(direction(50, 100)).toBe("higher");
    expect(direction(150, 100)).toBe("lower");
    expect(direction(100, 100)).toBeNull();
  });

  it("scores (7 − k) × 10 for a hit on guess k", () => {
    const day = 20406;
    const price = productOf(createRun(day)).cents;
    const run = replay(day, [price * 3, price * 2, price]);
    expect(run.ending).toBe("solved");
    expect(scoreOf(run)).toBe(40);
    expect(guess(run, price)).toBe(run);
  });

  it("ends after six misses, or when given up, scoring nothing", () => {
    const day = 20500;
    const price = productOf(createRun(day)).cents;
    const out = replay(
      day,
      Array.from({ length: 6 }, () => price * 3),
    );
    expect(out.ending).toBe("out");
    expect(scoreOf(out)).toBe(0);
    expect(scoreOf(giveUp(createRun(day)))).toBe(0);
  });

  it("reads prices the way people type them", () => {
    expect(parsePrice("12")).toBe(1200);
    expect(parsePrice("$1,299.99")).toBe(129999);
    expect(parsePrice("4.5")).toBe(450);
    expect(parsePrice(".99")).toBe(99);
    expect(parsePrice("abc")).toBeNull();
    expect(parsePrice("0")).toBeNull();
    expect(dollars(129999)).toBe("$1,299.99");
  });
});
