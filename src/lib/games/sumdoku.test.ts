import { describe, expect, it } from "vitest";

import { sumdokuHint } from "@/lib/games/sumdoku-hints";
import { SUMDOKU_BANK, SUMDOKU_PER_TIER, SUMDOKU_TIERS } from "@/lib/games/sumdoku-bank";
import {
  board,
  candidates,
  canPlace,
  conflicts,
  createRun,
  EMPTY,
  finish,
  isEditable,
  parMs,
  peers,
  place,
  replay,
  solution,
  submission,
  SUMDOKU_PAR_MS,
  SUMDOKU_RULES_VERSION,
  tierOf,
  type SumdokuBoard,
  type SumdokuDigit,
  type SumdokuRun,
} from "@/lib/games/sumdoku";

/**
 * The engine's tests are pinned to the *database's* numbers: the boards below are
 * the ones `tests/security/verifier_vectors.sql` asserts `public.sumdoku_board`
 * deals, and the scored lines are what `public.complete_sumdoku_run` replays.
 */

/** Seed 1's first two boards: starting cells then solution, in reading order. */
const BOARD_ONE = "000000001300000000000020400060000005342156561342253614614523435261126435";
const BOARD_TWO = "300000006002000000000040000000500030325614146352654123231546413265562431";

/** The moves that fill seed 1's first and second boards, as `cell × 10 + digit`. */
const LINE_ONE = [
  3, 14, 22, 31, 45, 56, 65, 76, 104, 112, 122, 135, 143, 156, 161, 174, 186, 191, 204, 215, 233,
  253, 265, 272, 291, 301, 312, 326, 334, 343,
];
const LINE_TWO = [
  12, 25, 36, 41, 54, 61, 74, 93, 105, 126, 135, 144, 151, 162, 173, 182, 193, 201, 215, 236, 244,
  251, 263, 272, 286, 295, 316, 322, 334, 351,
];

function play(run: SumdokuRun, moves: readonly number[]): SumdokuRun {
  return moves.reduce((current, move) => place(current, Math.floor(move / 10), move % 10), run);
}

/** How many ways a board can be finished, counting no further than two. */
function countSolutions(drawn: SumdokuBoard): number {
  const grid: SumdokuDigit[] = [...drawn.start];
  let found = 0;
  const search = () => {
    let best = -1;
    let options: SumdokuDigit[] = [];
    for (let cell = 0; cell < 36; cell += 1) {
      if (grid[cell] !== EMPTY) continue;
      const fits = candidates(drawn, grid, cell);
      if (best < 0 || fits.length < options.length) {
        best = cell;
        options = fits;
      }
    }
    if (best < 0) {
      found += 1;
      return;
    }
    for (const digit of options) {
      grid[best] = digit;
      search();
      grid[best] = EMPTY;
      if (found > 1) return;
    }
  };
  search();
  return found;
}

describe("the bank", () => {
  it("holds four tiers of 30 well-formed puzzles", () => {
    expect(SUMDOKU_TIERS).toEqual(["gentle", "easy", "medium", "hard"]);
    expect(SUMDOKU_BANK).toHaveLength(SUMDOKU_TIERS.length * SUMDOKU_PER_TIER);
    for (const text of SUMDOKU_BANK) {
      expect(text).toMatch(/^[1-6]{36}[0-9a-z]{36}[01]{36}$/);
    }
    expect(new Set(SUMDOKU_BANK).size).toBe(SUMDOKU_BANK.length);
  });

  it("gives six digits in gentle boards, three in easy, and none after", () => {
    const givens = [6, 3, 0, 0];
    SUMDOKU_BANK.forEach((text, index) => {
      const count = [...text.slice(72)].filter((bit) => bit === "1").length;
      expect(count, `puzzle ${index}`).toBe(givens[Math.floor(index / SUMDOKU_PER_TIER)]);
    });
  });

  it("has every puzzle uniquely solvable, its cages in one piece and without repeats", () => {
    // Through the engine, as a run sees them: sixty distinct boards from every
    // tier, mirrors included. The generator checked every entry; this checks the
    // engine reads them back as it meant.
    const seen = new Set<string>();
    for (let seed = 1; seen.size < 60 && seed < 2000; seed += 1) {
      for (const level of [1, 3, 6, 10]) {
        const drawn = board(seed, level);
        const key = drawn.solution.join("") + drawn.cageOf.join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        expect(countSolutions(drawn), `seed ${seed} board ${level}`).toBe(1);
        for (const cage of drawn.cages) {
          const digits = cage.cells.map((cell) => drawn.solution[cell]);
          expect(new Set(digits).size).toBe(digits.length);
          // Connected: a walk from the first cell reaches every cell.
          const reached = new Set([cage.cells[0]]);
          const queue = [cage.cells[0]];
          while (queue.length) {
            const cell = queue.pop()!;
            for (const next of [
              cell - 6,
              cell + 6,
              cell % 6 ? cell - 1 : -1,
              cell % 6 < 5 ? cell + 1 : -1,
            ]) {
              if (cage.cells.includes(next) && !reached.has(next)) {
                reached.add(next);
                queue.push(next);
              }
            }
          }
          expect(reached.size).toBe(cage.cells.length);
        }
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(60);
  });
});

describe("a board", () => {
  it("is the one the database deals for seed 1", () => {
    const one = board(1, 1);
    expect(one.start.join("") + one.solution.join("")).toBe(BOARD_ONE);
    const two = board(1, 2);
    expect(two.start.join("") + two.solution.join("")).toBe(BOARD_TWO);
  });

  it("follows the tiers: gentle, easy, medium, then hard", () => {
    expect([1, 2, 3, 5, 6, 9, 10, 40].map(tierOf)).toEqual([
      "gentle",
      "gentle",
      "easy",
      "easy",
      "medium",
      "medium",
      "hard",
      "hard",
    ]);
  });

  it("has cage totals that match its solution", () => {
    const drawn = board(7, 4);
    for (const cage of drawn.cages) {
      expect(cage.cells.reduce((sum, cell) => sum + drawn.solution[cell], 0)).toBe(cage.total);
    }
    expect(drawn.cages.flatMap((cage) => cage.cells).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 36 }, (_, cell) => cell),
    );
  });
});

describe("the rules on a board", () => {
  it("marks a digit repeated in a cage, and a cage that goes over its total", () => {
    const drawn = board(1, 7);
    const cage = drawn.cages.find((c) => c.cells.length >= 2)!;
    const cells: SumdokuDigit[] = new Array(36).fill(EMPTY);
    cells[cage.cells[0]] = 6;
    cells[cage.cells[1]] = 6;
    const marked = conflicts(drawn, cells);
    expect(marked.has(cage.cells[0])).toBe(true);
    expect(marked.has(cage.cells[1])).toBe(true);
  });

  it("never offers a candidate that clashes with a peer", () => {
    const drawn = board(3, 2);
    const cells = [...drawn.start];
    for (let cell = 0; cell < 36; cell += 1) {
      if (cells[cell] !== EMPTY) continue;
      for (const digit of candidates(drawn, cells, cell)) {
        expect(peers(cell).some((other) => cells[other] === digit)).toBe(false);
      }
      expect(candidates(drawn, cells, cell)).toContain(drawn.solution[cell]);
    }
  });
});

describe("a run", () => {
  it("scores sixty a board on the database's lines", () => {
    let run = createRun(1);
    expect(run.rulesVersion).toBe(SUMDOKU_RULES_VERSION);
    run = play(run, LINE_ONE);
    expect(run.score).toBe(60);
    expect(run.level).toBe(2);
    expect(run.levelsCleared).toBe(1);
    run = play(run, LINE_TWO);
    expect(run.score).toBe(120);
    expect(run.moves).toHaveLength(LINE_ONE.length + LINE_TWO.length);
  });

  it("refuses givens, unchanged cells and digits above six", () => {
    const run = createRun(1);
    const given = run.cells.findIndex((value) => value !== EMPTY);
    expect(canPlace(run, given, 1)).toBe(false);
    const open = run.cells.findIndex((value) => value === EMPTY);
    expect(canPlace(run, open, 0)).toBe(false);
    expect(canPlace(run, open, 7)).toBe(false);
    expect(place(run, given, 1)).toBe(run);
  });

  it("does not count a full board that is wrong", () => {
    let run = createRun(5);
    const answer = solution(5, 1);
    const open = run.cells.map((_, cell) => cell).filter((cell) => isEditable(run, cell));
    const [first, second] = open.filter((cell) => answer[cell] !== answer[open[0]]).length
      ? [open[0], open.find((cell) => answer[cell] !== answer[open[0]])!]
      : [open[0], open[1]];
    for (const cell of open) {
      const digit =
        cell === first ? answer[second] : cell === second ? answer[first] : answer[cell];
      run = place(run, cell, digit);
    }
    expect(run.levelsCleared).toBe(0);
    expect(run.cells.every((value) => value !== EMPTY)).toBe(true);
  });

  it("replays from its moves, and submits the points before the bonus", () => {
    const played = play(createRun(1), [...LINE_ONE, 12, 25, 12]);
    const again = replay("1", played.moves);
    expect(again).toEqual(played);
    const ended = finish(played);
    expect(ended.outcome).toBe("over");
    expect(ended.ending).toBe("stopped");
    expect(submission(ended)).toMatchObject({ score: 60, levelsCleared: 1 });
  });

  it("has par times that grow with the tiers", () => {
    expect(SUMDOKU_PAR_MS).toEqual([75_000, 90_000, 120_000, 150_000]);
    expect(parMs(0)).toBe(0);
    expect(parMs(2)).toBe(150_000);
    expect(parMs(3)).toBe(240_000);
    expect(parMs(10)).toBe(150_000 + 270_000 + 480_000 + 150_000);
  });
});

describe("the hints", () => {
  it("point at a wrong digit first, then lead to the solution", () => {
    let run = createRun(1);
    const answer = solution(1, 1);
    const open = run.cells.findIndex((value, cell) => value === EMPTY && isEditable(run, cell));
    const wrong = ([1, 2, 3, 4, 5, 6] as const).find((digit) => digit !== answer[open])!;
    run = place(run, open, wrong);
    expect(sumdokuHint(run)).toMatchObject({ cell: open, action: "clear" });

    // Following the hints alone solves the board.
    run = createRun(1);
    for (let step = 0; step < 60 && run.level === 1; step += 1) {
      const hint = sumdokuHint(run)!;
      run = place(run, hint.cell, hint.action === "place" ? hint.digit : EMPTY);
    }
    expect(run.levelsCleared).toBe(1);
  });
});
