import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  alphabetFor,
  createRun,
  CROSSWORD_RULES_VERSION,
  enter,
  FJALEKRYQI_RULES_VERSION,
  gridForDay,
  keyboardFor,
  LETTER_STRIDE,
  readPuzzle,
} from "@/lib/games/crossword";
import { FJALEKRYQI_CLUES, FJALEKRYQI_MIDIS, FJALEKRYQI_MINIS } from "@/lib/games/fjalekryqi-bank";

/**
 * Fjalekryqi, the Albanian crossword: the crossword's rules over an Albanian
 * bank and alphabet. What it adds is checked here — Ç and Ë as letters 27 and
 * 28, a bank whose every entry is clued and solvable, and a database copy of
 * the bank that matches this one square for square.
 */

const MIGRATION = join(
  __dirname,
  "../../../supabase/migrations/20261201120000_fjalekryqi_sessions.sql",
);

function sqlBank(name: "minis" | "midis"): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf(`-- ${name}:begin`);
  const end = sql.indexOf(`-- ${name}:end`);
  return [...sql.slice(start, end).matchAll(/'([^']+)'/g)].map((match) => match[1]!);
}

/** Every run of two or more white squares, across and down: what the app clues. */
function runs(grid: string): number[][] {
  const side = Math.round(Math.sqrt(grid.length));
  const found: number[][] = [];
  for (const across of [true, false]) {
    for (let line = 0; line < side; line += 1) {
      let run: number[] = [];
      for (let step = 0; step <= side; step += 1) {
        const cell = across ? line * side + step : step * side + line;
        if (step < side && grid[cell] !== "#") run.push(cell);
        else {
          if (run.length >= 2) found.push(run);
          run = [];
        }
      }
    }
  }
  return found;
}

describe("the alphabet", () => {
  it("is Albanian's single letters for Fjalekryqi, and A–Z for the crossword", () => {
    const albanian = alphabetFor(FJALEKRYQI_RULES_VERSION);
    expect([...albanian].sort().join("")).toBe("ABCDEFGHIJKLMNOPQRSTUVXYZÇË");
    expect([...alphabetFor(CROSSWORD_RULES_VERSION)].sort().join("")).toBe(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    );
    expect(keyboardFor(FJALEKRYQI_RULES_VERSION)).toEqual(["QERTZUIOPÇ", "ASDFGHJKLË", "YXCVBNM"]);
  });

  it("writes Ç as 27 and Ë as 28, and refuses them in the English crossword", () => {
    const grid = FJALEKRYQI_MINIS[0]!;
    const cell = [...grid].findIndex((square) => square !== "#");
    const albanian = createRun(20000, grid, FJALEKRYQI_RULES_VERSION);

    expect(enter(albanian, cell, "ç").moves).toEqual([cell * LETTER_STRIDE + 27]);
    expect(enter(albanian, cell, "Ë").moves).toEqual([cell * LETTER_STRIDE + 28]);
    expect(enter(albanian, cell, "W")).toBe(albanian);

    const english = createRun(20000, grid, CROSSWORD_RULES_VERSION);
    expect(enter(english, cell, "Ç")).toBe(english);
  });
});

describe("the bank", () => {
  it("is the database's bank, square for square", () => {
    expect(sqlBank("minis")).toEqual([...FJALEKRYQI_MINIS]);
    expect(sqlBank("midis")).toEqual([...FJALEKRYQI_MIDIS]);
  });

  it("has 5×5 minis and 7×7 midis in its alphabet", () => {
    const letters = new RegExp(`^[#${alphabetFor(FJALEKRYQI_RULES_VERSION)}]+$`, "u");
    for (const grid of FJALEKRYQI_MINIS) expect(grid).toMatch(letters);
    for (const grid of FJALEKRYQI_MIDIS) expect(grid).toMatch(letters);
    expect(FJALEKRYQI_MINIS.every((grid) => grid.length === 25)).toBe(true);
    expect(FJALEKRYQI_MIDIS.every((grid) => grid.length === 49)).toBe(true);
  });

  it("clues every entry, and never has a two-square run the app would clue", () => {
    for (const grid of [...FJALEKRYQI_MINIS, ...FJALEKRYQI_MIDIS]) {
      for (const run of runs(grid)) {
        expect(run.length).toBeGreaterThanOrEqual(3);
        const answer = run.map((cell) => grid[cell]).join("");
        expect(FJALEKRYQI_CLUES[answer], answer).toBeTruthy();
      }
      for (const entry of readPuzzle(0, grid).entries) {
        expect(FJALEKRYQI_CLUES[entry.answer], entry.answer).toBeTruthy();
      }
    }
  });

  it("is solved by typing every answer in", () => {
    for (const day of [20000, 20001, 20002, 20005]) {
      const grid = gridForDay(day, FJALEKRYQI_MINIS, FJALEKRYQI_MIDIS);
      let run = createRun(day, grid, FJALEKRYQI_RULES_VERSION);
      [...grid].forEach((square, cell) => {
        if (square !== "#") run = enter(run, cell, square);
      });
      expect(run.outcome).toBe("over");
      expect(run.ending).toBe("solved");
      expect(run.rulesVersion).toBe(FJALEKRYQI_RULES_VERSION);
    }
  });
});
