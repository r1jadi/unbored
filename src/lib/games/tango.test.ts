import { describe, expect, it } from "vitest";

import {
  board,
  budgetMs,
  canTap,
  conflicts,
  createRun,
  EMPTY,
  finish,
  givenCount,
  MOON,
  solution,
  solutions,
  startCells,
  submission,
  SUN,
  tap,
  TANGO_MAX_ACTIONS,
  TANGO_ROWS,
  TANGO_RULES_VERSION,
  type TangoRun,
  type TangoValue,
} from "@/lib/games/tango";

/**
 * The engine's tests are pinned to the *database's* numbers.
 *
 * `public.complete_tango_run` replays the submitted taps against each board's
 * solution, from its starting cells. The solutions, starting cells and scored
 * lines below are the ones `tests/security/rls_test.sql` asserts for the same
 * seeds. The signs are the client's alone, and are tested for the property that
 * matters: the solution is the board's only one.
 */

/** Seed 1's first two boards: 1 is a sun, 2 a moon, 0 an empty cell. */
const SOLUTION_ONE = "211221211221122112122121211212122112";
const START_ONE = "200020001000000002000100010000020102";
const SOLUTION_TWO = "121212211212122121121221212112212121";
const START_TWO = "000010011210000101100000000000000000";

/** Taps that fill seed 1's first board: once for a sun, twice for a moon. */
const LINE_ONE = [
  1, 2, 3, 3, 5, 6, 6, 7, 9, 9, 10, 10, 11, 12, 13, 13, 14, 14, 15, 16, 18, 19, 19, 20, 20, 22, 22,
  23, 24, 24, 26, 27, 27, 28, 29, 29, 30, 32, 32, 34,
];

const digits = (text: string) => text.split("").map(Number);

/** Taps that fill a board from its start: once for a sun, twice for a moon. */
function fillLine(seed: string, level: number): number[] {
  const answer = solution(seed, level);
  const start = startCells(seed, level);
  return answer.flatMap((value, cell) => (start[cell] ? [] : new Array<number>(value).fill(cell)));
}

function playLine(seed: string, line: readonly number[]): TangoRun {
  return line.reduce((run, cell) => tap(run, cell), createRun(seed));
}

describe("the boards are the verifier's boards", () => {
  it("lists the fourteen rows a solution may use, in the verifier's order", () => {
    expect(TANGO_ROWS).toHaveLength(14);
    expect(TANGO_ROWS[0]).toEqual([2, 2, 1, 2, 1, 1]);
    expect(TANGO_ROWS[13]).toEqual([1, 1, 2, 1, 2, 2]);
  });

  it("draws seed 1's first two boards in the order the SQL suite documents", () => {
    expect(solution("1", 1)).toEqual(digits(SOLUTION_ONE));
    expect(startCells("1", 1)).toEqual(digits(START_ONE));
    expect(solution("1", 2)).toEqual(digits(SOLUTION_TWO));
    expect(startCells("1", 2)).toEqual(digits(START_TWO));
  });

  it("replays a seed larger than a JS safe integer exactly", () => {
    expect(solution("9223372036854775807", 1).join("")).toBe(
      "121122212112212211121221121122212211",
    );
  });

  it("treats a zero seed as the verifier's fallback state", () => {
    expect(solution("0", 3)).toEqual(solution("2654435769", 3));
  });

  it("refuses a seed that is not a whole number, and a level before the first", () => {
    expect(() => solution("1.5", 1)).toThrow(TypeError);
    expect(() => solution("1", 0)).toThrow(RangeError);
  });

  it("starts with nine cells filled, one fewer a board, down to three", () => {
    expect([1, 2, 6, 7, 50].map(givenCount)).toEqual([9, 8, 4, 3, 3]);
    for (const level of [1, 4, 9]) {
      const start = startCells("4242", level);
      const answer = solution("4242", level);
      expect(start.filter((value) => value !== EMPTY)).toHaveLength(givenCount(level));
      start.forEach((value, cell) => {
        if (value !== EMPTY) expect(value).toBe(answer[cell]);
      });
    }
  });

  it("solves by the rules: three of each per line, never three alike in a row", () => {
    for (let level = 1; level <= 20; level += 1) {
      const answer = solution("31337", level);
      for (let line = 0; line < 6; line += 1) {
        const across = answer.slice(line * 6, line * 6 + 6);
        const down = Array.from({ length: 6 }, (_, index) => answer[index * 6 + line]);
        for (const group of [across, down]) {
          expect(group.filter((value) => value === SUN)).toHaveLength(3);
          for (let index = 2; index < 6; index += 1) {
            expect(group[index] === group[index - 1] && group[index] === group[index - 2]).toBe(
              false,
            );
          }
        }
      }
    }
  });

  it("adds signs until the solution is the only one", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const level of [1, 5, 9]) {
        const drawn = board(String(seed * 7919), level);
        expect(solutions(drawn.start, drawn.signs)).toEqual([drawn.solution]);
        for (const sign of drawn.signs) {
          expect(drawn.solution[sign.a] === drawn.solution[sign.b]).toBe(sign.same);
        }
      }
    }
  });
});

describe("conflicts", () => {
  it("marks three alike in a row, a line with four of a symbol, and a broken sign", () => {
    const cells = new Array<TangoValue>(36).fill(EMPTY);
    cells[0] = SUN;
    cells[1] = SUN;
    cells[2] = SUN;
    expect([...conflicts(cells, [])].sort((a, b) => a - b)).toEqual([0, 1, 2]);

    const four = new Array<TangoValue>(36).fill(EMPTY);
    for (const cell of [0, 2, 4, 5]) four[cell] = MOON;
    expect(conflicts(four, []).has(0)).toBe(true);

    const signed = new Array<TangoValue>(36).fill(EMPTY);
    signed[6] = SUN;
    signed[7] = MOON;
    expect([...conflicts(signed, [{ a: 6, b: 7, same: true }])]).toEqual([6, 7]);
    expect(conflicts(signed, [{ a: 6, b: 7, same: false }]).size).toBe(0);
  });
});

describe("the clock", () => {
  it("starts at two minutes and adds forty-five seconds per solved board", () => {
    expect([0, 1, 2].map(budgetMs)).toEqual([120_000, 165_000, 210_000]);
  });
});

describe("a run", () => {
  it("starts on board one with its givens filled and the pinned rules version", () => {
    expect(createRun("1")).toMatchObject({
      seed: "1",
      rulesVersion: TANGO_RULES_VERSION,
      level: 1,
      cells: digits(START_ONE),
      score: 0,
      outcome: "playing",
    });
    expect(TANGO_RULES_VERSION).toBe("tango@1");
  });

  it("cycles a cell: sun, moon, empty", () => {
    let run = tap(createRun("1"), 1);
    expect(run.cells[1]).toBe(SUN);
    run = tap(run, 1);
    expect(run.cells[1]).toBe(MOON);
    run = tap(run, 1);
    expect(run.cells[1]).toBe(EMPTY);
    expect(run.taps).toEqual([1, 1, 1]);
  });

  it("does not let a starting cell change", () => {
    const run = createRun("1"); // cell 0 starts as a moon
    expect(canTap(run, 0)).toBe(false);
    expect(tap(run, 0)).toBe(run);
    expect(canTap(run, 36)).toBe(false);
  });

  it("solves a board when it matches the solution: sixty points and the next board", () => {
    expect(fillLine("1", 1)).toEqual(LINE_ONE);
    const run = playLine("1", LINE_ONE);
    expect(run).toMatchObject({
      level: 2,
      levelsCleared: 1,
      score: 60,
      cells: digits(START_TWO),
    });
  });

  it("scores seed 1's two-board line at 120, as the SQL suite does", () => {
    const run = playLine("1", [...LINE_ONE, ...fillLine("1", 2)]);
    expect(run).toMatchObject({ level: 3, levelsCleared: 2, score: 120 });
  });

  it("ends where the player stops or the clock runs out, keeping the score", () => {
    const stopped = finish(playLine("1", [...LINE_ONE, 0, 0]), "stopped");
    expect(stopped).toMatchObject({ score: 60, outcome: "over", ending: "stopped" });
    expect(tap(stopped, 2)).toBe(stopped);
    expect(finish(stopped, "time")).toBe(stopped);
  });

  it("ends a run at the submission bound", () => {
    const almost: TangoRun = { ...createRun("1"), taps: new Array(TANGO_MAX_ACTIONS - 1).fill(1) };
    expect(tap(almost, 1)).toMatchObject({ outcome: "over", ending: "bound" });
  });

  it("assembles the submission from the run", () => {
    const run = finish(playLine("1", LINE_ONE), "stopped");
    expect(submission(run)).toEqual({
      rulesVersion: "tango@1",
      actions: LINE_ONE,
      score: 60,
      tapsPlaced: LINE_ONE.length,
      levelsCleared: 1,
    });
  });
});
