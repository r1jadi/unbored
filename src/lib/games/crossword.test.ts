import { describe, expect, it } from "vitest";

import { CROSSWORD_CLUES, CROSSWORD_MIDIS, CROSSWORD_MINIS } from "@/lib/games/crossword-bank";
import {
  check,
  CHECK_MOVE,
  createRun,
  CROSSWORD_MAX_ACTIONS,
  CROSSWORD_RULES_VERSION,
  dayNumber,
  enter,
  entriesAt,
  estimate,
  finish,
  gridForDay,
  isWeekend,
  readPuzzle,
  reveal,
  REVEAL_BASE,
  scoreFor,
  submission,
  weekdayOf,
  weekendsBefore,
  wrongCells,
  type CrosswordRun,
} from "@/lib/games/crossword";

/**
 * The engine's tests are pinned to the *database's* days and moves.
 *
 * `public.crossword_grid` picks a day's grid from the same bank, and
 * `public.complete_crossword_run` replays the same moves; the days below are the
 * ones `tests/security/rls_test.sql` asserts. Day 20000 is a Friday (a mini) and
 * 20001 a Saturday (a midi).
 */
const FRIDAY = 20000;
const SATURDAY = 20001;

const gridOf = (day: number) => gridForDay(day, CROSSWORD_MINIS, CROSSWORD_MIDIS);

/** The moves that solve a day's grid, letter by letter in reading order. */
function solveLine(day: number): number[] {
  return [...gridOf(day)].flatMap((letter, cell) =>
    letter === "#" ? [] : [cell * 32 + letter.charCodeAt(0) - 64],
  );
}

function play(day: number, moves: readonly number[]): CrosswordRun {
  return moves.reduce(
    (run, move) => {
      if (move === CHECK_MOVE) return check(run);
      if (move >= REVEAL_BASE) return reveal(run, move - REVEAL_BASE);
      const code = move % 32;
      return enter(run, Math.floor(move / 32), code ? String.fromCharCode(64 + code) : "");
    },
    createRun(day, gridOf(day)),
  );
}

describe("the days", () => {
  it("counts days from 1970-01-01, which was a Thursday", () => {
    expect(dayNumber(0)).toBe(0);
    expect(dayNumber(Date.UTC(2026, 9, 28, 23, 59))).toBe(dayNumber(Date.UTC(2026, 9, 28)));
    expect(weekdayOf(0)).toBe(4);
    expect([FRIDAY, SATURDAY, SATURDAY + 1, SATURDAY + 2].map(weekdayOf)).toEqual([5, 6, 0, 1]);
    expect([FRIDAY, SATURDAY, SATURDAY + 1, SATURDAY + 2].map(isWeekend)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it("counts the weekend days before a day", () => {
    expect(weekendsBefore(0)).toBe(0);
    expect(weekendsBefore(2)).toBe(0); // Thursday, Friday
    expect(weekendsBefore(4)).toBe(2); // and the first Saturday and Sunday
    expect(weekendsBefore(7)).toBe(2);
    expect(weekendsBefore(14)).toBe(4);
  });

  it("gives weekdays the minis in turn and weekends the midis", () => {
    expect(gridOf(FRIDAY)).toHaveLength(25);
    expect(gridOf(SATURDAY)).toHaveLength(49);
    expect(gridOf(SATURDAY + 1)).toHaveLength(49);
    // Friday's mini is followed by Monday's, the next in the bank.
    const friday = CROSSWORD_MINIS.indexOf(gridOf(FRIDAY));
    expect(gridOf(SATURDAY + 2)).toBe(CROSSWORD_MINIS[(friday + 1) % CROSSWORD_MINIS.length]);
    const saturday = CROSSWORD_MIDIS.indexOf(gridOf(SATURDAY));
    expect(gridOf(SATURDAY + 1)).toBe(CROSSWORD_MIDIS[(saturday + 1) % CROSSWORD_MIDIS.length]);
  });

  it("covers a year without repeating a puzzle", () => {
    const year = Array.from({ length: 365 }, (_, offset) => gridOf(FRIDAY + offset));
    expect(new Set(year).size).toBe(365);
  });
});

describe("the bank", () => {
  it("holds a year of weekdays and a year of weekends", () => {
    expect(CROSSWORD_MINIS.length).toBeGreaterThanOrEqual(261);
    expect(CROSSWORD_MIDIS.length).toBeGreaterThanOrEqual(104);
  });

  it("makes every entry a clued word of three to seven letters, used once a puzzle", () => {
    for (const grid of [...CROSSWORD_MINIS, ...CROSSWORD_MIDIS]) {
      const puzzle = readPuzzle(0, grid);
      const answers = puzzle.entries.map((entry) => entry.answer);
      expect(new Set(answers).size).toBe(answers.length);
      for (const entry of puzzle.entries) {
        expect(entry.answer.length).toBeGreaterThanOrEqual(3);
        expect(entry.answer.length).toBeLessThanOrEqual(7);
        expect(CROSSWORD_CLUES[entry.answer]).toBeTruthy();
      }
      // Every white square is in an across and a down entry.
      [...grid].forEach((letter, cell) => {
        if (letter === "#") return;
        const { across, down } = entriesAt(puzzle, cell);
        expect(across && down).toBeTruthy();
      });
    }
  });
});

describe("reading a grid", () => {
  it("numbers the squares that start an entry, in reading order", () => {
    const puzzle = readPuzzle(0, "#SPA#TOAST" + "OWNER" + "#TEN#" + "#####");
    expect(puzzle.side).toBe(5);
    // S P A start downs (1–3); T starts TOAST and TO (4); the last T starts TR (5).
    expect(puzzle.numbers.slice(0, 10)).toEqual([0, 1, 2, 3, 0, 4, 0, 0, 0, 5]);
    expect(puzzle.entries.filter((entry) => entry.across).map((entry) => entry.answer)).toEqual([
      "SPA",
      "TOAST",
      "OWNER",
      "TEN",
    ]);
    expect(puzzle.entries.filter((entry) => !entry.across).map((entry) => entry.answer)).toEqual([
      "SOWT",
      "PANE",
      "ASEN",
      "TO",
      "TR",
    ]);
  });
});

describe("the score", () => {
  it("holds the base through the grace period, then slips four points a second", () => {
    expect(scoreFor(5, 0, 0, 0)).toBe(1000);
    expect(scoreFor(5, 30, 0, 0)).toBe(1000);
    expect(scoreFor(5, 31, 0, 0)).toBe(996);
    expect(scoreFor(5, 255, 0, 0)).toBe(100);
    expect(scoreFor(5, 9999, 0, 0)).toBe(100);
    expect(scoreFor(7, 60, 0, 0)).toBe(2000);
    expect(scoreFor(7, 9999, 0, 0)).toBe(200);
  });

  it("takes 50 off a check and 100 off a revealed letter, never below zero", () => {
    expect(scoreFor(5, 0, 2, 3)).toBe(600);
    expect(scoreFor(5, 9999, 1, 5)).toBe(0);
  });
});

describe("a run", () => {
  it("starts empty on the day's grid, pinned to the rules", () => {
    const run = createRun(String(FRIDAY), gridOf(FRIDAY));
    expect(run).toMatchObject({
      seed: String(FRIDAY),
      rulesVersion: CROSSWORD_RULES_VERSION,
      checks: 0,
      reveals: 0,
      outcome: "playing",
    });
    expect(run.letters.every((letter) => letter === "")).toBe(true);
    expect(CROSSWORD_RULES_VERSION).toBe("crossword@1");
  });

  it("puts letters in white squares, clears them, and ignores a move that changes nothing", () => {
    const grid = gridOf(FRIDAY);
    const cell = grid.indexOf(grid.replace(/#/g, "")[0]);
    let run = createRun(FRIDAY, grid);
    run = enter(run, cell, "q");
    expect(run.letters[cell]).toBe("Q");
    expect(run.moves).toEqual([cell * 32 + 17]);
    expect(enter(run, cell, "Q")).toBe(run);
    run = enter(run, cell, "");
    expect(run.moves).toEqual([cell * 32 + 17, cell * 32]);
    const black = grid.indexOf("#");
    if (black >= 0) expect(enter(run, black, "A")).toBe(run);
  });

  it("solves when every square matches, and refuses moves after", () => {
    const line = solveLine(FRIDAY);
    const run = play(FRIDAY, line);
    expect(run).toMatchObject({ outcome: "over", ending: "solved" });
    expect(run.moves).toEqual(line);
    expect(enter(run, 0, "A")).toBe(run);
    expect(check(run)).toBe(run);
  });

  it("solves a weekend midi the same way", () => {
    expect(play(SATURDAY, solveLine(SATURDAY))).toMatchObject({ ending: "solved" });
  });

  it("checks the grid at a cost, and the screen marks what is wrong", () => {
    const grid = gridOf(FRIDAY);
    const cell = grid.search(/[A-Z]/);
    const wrongLetter = grid[cell] === "Z" ? "Y" : "Z";
    const run = check(enter(createRun(FRIDAY, grid), cell, wrongLetter));
    expect(run.checks).toBe(1);
    expect(run.moves[run.moves.length - 1]).toBe(CHECK_MOVE);
    expect([...wrongCells(run)]).toEqual([cell]);
  });

  it("reveals a letter, locks it, and counts it", () => {
    const grid = gridOf(FRIDAY);
    const cell = grid.search(/[A-Z]/);
    const run = reveal(createRun(FRIDAY, grid), cell);
    expect(run.letters[cell]).toBe(grid[cell]);
    expect(run.revealed[cell]).toBe(true);
    expect(run.reveals).toBe(1);
    expect(run.moves).toEqual([REVEAL_BASE + cell]);
    expect(enter(run, cell, "")).toBe(run);
    expect(reveal(run, cell)).toBe(run);
  });

  it("scores a run that is given up at nothing", () => {
    const run = finish(createRun(FRIDAY, gridOf(FRIDAY)));
    expect(run).toMatchObject({ outcome: "over", ending: "stopped" });
    expect(estimate(run, 10)).toBe(0);
    expect(submission(run, 10)).toMatchObject({ score: 0, levelsCleared: 0 });
  });

  it("ends a run at the submission bound", () => {
    const run: CrosswordRun = {
      ...createRun(FRIDAY, gridOf(FRIDAY)),
      moves: new Array(CROSSWORD_MAX_ACTIONS - 1).fill(CHECK_MOVE),
    };
    expect(check(run)).toMatchObject({ outcome: "over", ending: "bound" });
  });

  it("assembles the submission with the screen's estimate", () => {
    const line = solveLine(FRIDAY);
    const run = play(FRIDAY, [CHECK_MOVE, ...line]);
    expect(submission(run, 40)).toEqual({
      rulesVersion: "crossword@1",
      actions: [CHECK_MOVE, ...line],
      score: 1000 - 4 * 10 - 50,
      tapsPlaced: line.length + 1,
      levelsCleared: 1,
    });
  });
});
