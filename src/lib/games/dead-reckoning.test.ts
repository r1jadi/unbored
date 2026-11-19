import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CATEGORIES,
  ESTIMATES,
  MAX_ESTIMATE,
  NAME_ROUNDS,
  niceTarget,
  PUZZLES,
  ROUNDS,
} from "@/lib/games/dead-reckoning-bank";
import {
  answer,
  createRun,
  decode,
  encode,
  matches,
  nearest,
  parseEstimate,
  puzzleOf,
  rate,
  replay,
  roundScore,
  roundView,
  scoreOf,
  stop,
  submission,
  timeOut,
} from "@/lib/games/dead-reckoning";
import { deadReckoningBlocks, readBlock } from "@/lib/games/daily-banks-sql";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20270121120000_dead_reckoning_sessions.sql"),
  "utf8",
);

describe("Dead Reckoning's bank", () => {
  it("is the one the migration holds", () => {
    for (const [name, body] of Object.entries(deadReckoningBlocks())) {
      expect(readBlock(MIGRATION, name), name).toBe(body);
    }
  });

  it("holds whole, positive values that fit a move", () => {
    for (const category of CATEGORIES) {
      const names = new Set<string>();
      for (const entry of category.entries) {
        expect(Number.isInteger(entry.value) && entry.value > 0, entry.name).toBe(true);
        expect(names.has(entry.name), `${entry.name} twice`).toBe(false);
        names.add(entry.name);
      }
    }
    for (const estimate of ESTIMATES) {
      expect(Number.isInteger(estimate.answer), estimate.question).toBe(true);
      expect(estimate.answer > 0 && estimate.answer <= MAX_ESTIMATE, estimate.question).toBe(true);
    }
    expect(new Set(ESTIMATES.map((e) => e.question)).size).toBe(ESTIMATES.length);
  });

  it("deals every day four lists, three different estimates and one golden round", () => {
    expect(PUZZLES).toHaveLength(120);
    for (const puzzle of PUZZLES) {
      expect(puzzle.rounds).toHaveLength(ROUNDS);
      const names = puzzle.rounds.flatMap((r) => (r.kind === "name" ? [r.category] : []));
      const estimates = puzzle.rounds.flatMap((r) => (r.kind === "estimate" ? [r.estimate] : []));
      expect(new Set(names).size).toBe(NAME_ROUNDS);
      expect(new Set(estimates).size).toBe(ROUNDS - NAME_ROUNDS);
      expect(puzzle.golden).toBeGreaterThanOrEqual(0);
      expect(puzzle.golden).toBeLessThan(ROUNDS);
    }
  });

  it("always has a Dialed answer for a name round", () => {
    for (const puzzle of PUZZLES) {
      puzzle.rounds.forEach((_, i) => {
        const view = roundView(puzzle, i);
        if (!view.category) return;
        const best = nearest(view)[0]!;
        expect(rate(best.value, view.target, view.scale)).toBe("dialed");
      });
    }
  });

  it("asks for round numbers", () => {
    expect(niceTarget(6190, "ratio")).toBe(6200);
    expect(niceTarget(8849, "ratio")).toBe(8850);
    expect(niceTarget(17098246, "ratio")).toBe(17_100_000);
    expect(niceTarget(1879, "year")).toBe(1880);
    expect(niceTarget(1756, "year")).toBe(1756);
  });
});

describe("a Dead Reckoning run", () => {
  it("rates by the error, a year against a century", () => {
    expect(rate(1000, 1000, "ratio")).toBe("dialed");
    expect(rate(1010, 1000, "ratio")).toBe("dialed");
    expect(rate(1011, 1000, "ratio")).toBe("sharp");
    expect(rate(1070, 1000, "ratio")).toBe("near");
    expect(rate(1150, 1000, "ratio")).toBe("warm");
    expect(rate(700, 1000, "ratio")).toBe("rough");
    expect(rate(699, 1000, "ratio")).toBe("miss");
    expect(rate(1880, 1879, "year")).toBe("dialed");
    expect(rate(1882, 1879, "year")).toBe("sharp");
    expect(rate(1990, 1879, "year")).toBe("miss");
  });

  it("drains points with the clock and doubles the golden round", () => {
    const day = 20406;
    const puzzle = puzzleOf(createRun(day));
    const view = roundView(puzzle, 0);
    const right = view.category ? view.category.entries.indexOf(nearest(view)[0]!) : view.target;
    const full = roundScore(view, { answer: right, seconds: 30 });
    const late = roundScore(view, { answer: right, seconds: 0 });
    expect(full).toBe(view.golden ? 200 : 100);
    expect(late).toBe(view.golden ? 80 : 40);
    expect(roundScore(view, { answer: null, seconds: 30 })).toBe(0);
  });

  it("scores a perfect day 800 and replays its submission", () => {
    const day = 20406;
    let run = createRun(day);
    for (let i = 0; i < ROUNDS; i++) {
      const view = roundView(puzzleOf(run), i);
      const right = view.category ? view.category.entries.indexOf(nearest(view)[0]!) : view.target;
      run = answer(run, right, 30);
    }
    expect(run.ending).toBe("done");
    expect(scoreOf(run)).toBe(800);
    const sent = submission(run);
    expect(sent.score).toBe(800);
    expect(scoreOf(replay(day, sent.actions))).toBe(800);
    expect(answer(run, 0, 30)).toBe(run);
  });

  it("turns down answers that are not one, and keeps a stopped run's points", () => {
    const run = createRun(20407);
    const view = roundView(puzzleOf(run), 0);
    expect(answer(run, -1, 10)).toBe(run);
    expect(answer(run, view.category ? 9999 : MAX_ESTIMATE + 1, 10)).toBe(run);
    const out = timeOut(run);
    expect(out.answers).toEqual([{ answer: null, seconds: 0 }]);
    expect(stop(out).ending).toBe("stopped");
    expect(scoreOf(stop(out))).toBe(0);
  });

  it("packs a move as (answer + 1) × 32 + seconds", () => {
    expect(encode({ answer: null, seconds: 0 })).toBe(0);
    expect(encode({ answer: 5, seconds: 12 })).toBe(204);
    expect(decode(204)).toEqual({ answer: 5, seconds: 12 });
    expect(decode(31)).toBeNull();
    expect(decode(-1)).toBeNull();
    expect(decode(encode({ answer: MAX_ESTIMATE, seconds: 30 }))).toEqual({
      answer: MAX_ESTIMATE,
      seconds: 30,
    });
  });

  it("suggests names by prefix, word and alias, ignoring accents", () => {
    const mountains = CATEGORIES.find((c) => c.id === "mountains")!;
    expect(matches(mountains, "ever")[0]!.entry.name).toBe("Mount Everest");
    expect(matches(mountains, "mckinley")[0]!.entry.name).toBe("Denali");
    expect(matches(mountains, "huascaran")[0]!.entry.name).toBe("Huascarán");
    expect(matches(mountains, "")).toEqual([]);
  });

  it("reads estimates the way people type them", () => {
    expect(parseEstimate("1,250")).toBe(1250);
    expect(parseEstimate(" 42 ")).toBe(42);
    expect(parseEstimate("1 391 400")).toBe(1391400);
    expect(parseEstimate("12.5")).toBeNull();
    expect(parseEstimate("10000000")).toBeNull();
    expect(parseEstimate("abc")).toBeNull();
  });
});
