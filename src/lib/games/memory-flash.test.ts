import { describe, expect, it } from "vitest";

import {
  boardCells,
  boardSide,
  canTap,
  createRun,
  finish,
  leadInMs,
  MEMORY_FLASH_MAX_ACTIONS,
  MEMORY_FLASH_GROWTH_ROUNDS,
  MEMORY_FLASH_RULES_VERSION,
  MEMORY_FLASH_START_SIDE,
  patternAt,
  progress,
  showMs,
  submission,
  tap,
  type MemoryFlashRun,
} from "@/lib/games/memory-flash";

/**
 * The engine's tests are pinned to the *database's* numbers.
 *
 * `public.complete_memory_flash_run` is the authority: it replays the submitted
 * tap list against the seed's patterns and derives the score. Every vector below
 * is either asserted by `tests/security/rls_test.sql` for the same seed and line,
 * or computed here from the rules independently of this module. That is what makes
 * a green suite worth something — it proves agreement with the verifier, not
 * self-consistency.
 *
 * The vectors are also written down in `docs/games/README.md`.
 */

/**
 * Seed 1's first eight patterns, in draw order. These are the patterns the
 * retired `memory-flash@1` game showed: they are on the 4×4 board, and they are
 * the proof that an endless run opens with the game that shipped.
 */
const SEED_ONE_PATTERNS_4X4 = [
  [8],
  [8, 6],
  [3, 0, 8],
  [6, 2, 8, 5],
  [13, 0, 7, 1, 8],
  [3, 14, 15, 13, 7, 2],
  [15, 2, 11, 14, 8, 10, 0],
  [11, 2, 1, 10, 5, 12, 3, 13],
];

/**
 * Seed 1's rounds nine to twelve. The board is 5×5 from round nine, so the draw
 * is reduced modulo twenty-five instead of sixteen and the patterns are not the
 * retired game's: this is the point where an endless run first differs from it.
 */
const SEED_ONE_PATTERNS_5X5 = [
  [22, 15, 5, 18, 6, 21, 4, 11, 7],
  [4, 3, 20, 22, 6, 13, 19, 10, 5, 16],
  [3, 16, 6, 12, 22, 0, 21, 8, 4, 2, 15],
  [19, 3, 23, 15, 24, 21, 6, 7, 11, 17, 9, 22],
];

const SEED_ONE_PATTERNS = [...SEED_ONE_PATTERNS_4X4, ...SEED_ONE_PATTERNS_5X5];

/**
 * The line the SQL suite submits with seed 1: twelve patterns, 78 taps, 120
 * points. It passes the retired game's tenth pattern and keeps going, which is
 * what "endless" has to mean.
 */
const SEED_ONE_ENDLESS = SEED_ONE_PATTERNS.flat();

/** Round one reproduced, then a cell round two does not light. */
const SEED_ONE_BROKEN = [8, 0];

/** Plays a whole line and returns the finished run. */
function playLine(seed: string, line: number[]): MemoryFlashRun {
  return line.reduce((run, cell) => tap(run, cell), createRun(seed));
}

describe("the patterns are the verifier's patterns", () => {
  it("lights seed 1's first eight patterns exactly as the retired game did", () => {
    SEED_ONE_PATTERNS_4X4.forEach((pattern, index) => {
      expect(patternAt("1", index + 1)).toEqual(pattern);
    });
  });

  it("lights seed 1's patterns past the former tenth round", () => {
    SEED_ONE_PATTERNS.forEach((pattern, index) => {
      expect(patternAt("1", index + 1)).toEqual(pattern);
    });
    expect(patternAt("1", 10)).toEqual(SEED_ONE_PATTERNS_5X5[1]);
    expect(patternAt("1", 12)).toEqual(SEED_ONE_PATTERNS_5X5[3]);
  });

  it("lights exactly `round` distinct cells, all on that round's board", () => {
    for (let round = 1; round <= 40; round += 1) {
      const pattern = patternAt("1", round);
      expect(pattern).toHaveLength(round);
      expect(new Set(pattern).size).toBe(round);
      for (const cell of pattern) {
        expect(Number.isInteger(cell)).toBe(true);
        expect(cell).toBeGreaterThanOrEqual(0);
        expect(cell).toBeLessThan(boardCells(round));
      }
    }
  });

  it("keeps generating valid patterns arbitrarily far out", () => {
    // No final round exists; the pattern is a pure function of the seed and the
    // round, so a hundredth or a two-hundredth pattern is as real as the first.
    for (const round of [41, 64, 100, 200]) {
      const pattern = patternAt("1", round);
      expect(pattern).toHaveLength(round);
      expect(new Set(pattern).size).toBe(round);
      const side = boardSide(round);
      expect(side * side).toBeGreaterThanOrEqual(round);
      for (const cell of pattern) expect(cell).toBeLessThan(side * side);
    }
  });

  it("reads the high bits, so patterns do not repeat a sixteen-draw cycle", () => {
    // `state % cells` on the low bits would walk a fixed cycle of the low four
    // bits. Seed 1's first sixteen rounds cover every cell of the boards they
    // are played on, and the first thirty-two draws are not a repeat of the
    // first sixteen — which is what a low-bit cycle would produce.
    const drawn = Array.from({ length: 16 }, (_, i) => patternAt("1", i + 1)).flat();
    expect(new Set(drawn).size).toBe(25);
    expect(drawn.slice(0, 16)).not.toEqual(drawn.slice(16, 32));
  });

  it("replays the pattern of a seed larger than a JS safe integer exactly", () => {
    // `game_sessions.seed` is a bigint: the database's default draws from 2^63-1.
    // Rounding it to a double would flash different patterns and the verifier
    // would reject every honest run, so the engine works in BigInt. These
    // patterns come from the generator directly, not from this module.
    const seed = "9223372036854775807";
    expect(Array.from({ length: 4 }, (_, i) => patternAt(seed, i + 1))).toEqual([
      [5],
      [7, 3],
      [15, 5, 4],
      [5, 0, 2, 11],
    ]);
  });

  it("a rounded seed would have flashed a different pattern, which is the bug this guards", () => {
    const exact = patternAt("9223372036854775807", 10);
    const rounded = patternAt(Number("9223372036854775807"), 10);
    expect(rounded).not.toEqual(exact);
  });

  it("treats a degenerate zero seed the way the verifier does", () => {
    // 0 and 0x9E3779B9 both normalise to the same state in SQL.
    expect(patternAt("0", 5)).toEqual(patternAt("2654435769", 5));
  });

  it("reduces a negative seed the way the verifier does", () => {
    expect(patternAt("-1", 5)).toEqual(patternAt("4294967295", 5));
  });

  it("refuses a seed that is not a whole number", () => {
    expect(() => patternAt("1.5", 1)).toThrow(TypeError);
    expect(() => patternAt(1.5, 1)).toThrow(TypeError);
    expect(() => patternAt("not-a-seed", 1)).toThrow(TypeError);
  });

  it("refuses a round before the first, rather than inventing one", () => {
    expect(() => patternAt("1", 0)).toThrow(RangeError);
    expect(() => patternAt("1", 1.5)).toThrow(RangeError);
    expect(() => patternAt("1", -1)).toThrow(RangeError);
  });
});

describe("the board grows with the pattern", () => {
  it("starts at 4×4 for the rounds the shipped game played", () => {
    for (let round = 1; round <= 8; round += 1) {
      expect(boardSide(round)).toBe(4);
      expect(boardCells(round)).toBe(16);
    }
  });

  it("gains a row and a column every eight rounds, without cap", () => {
    expect(boardSide(9)).toBe(5);
    expect(boardSide(16)).toBe(5);
    expect(boardSide(17)).toBe(6);
    expect(boardSide(24)).toBe(6);
    expect(boardSide(25)).toBe(7);
    expect(boardSide(41)).toBe(9);
    expect(boardSide(81)).toBe(14);
    expect(boardSide(1000)).toBe(4 + Math.floor(999 / MEMORY_FLASH_GROWTH_ROUNDS));
  });

  it("always holds at least as many cells as the pattern lights", () => {
    for (let round = 1; round <= 400; round += 1) {
      expect(boardCells(round)).toBeGreaterThanOrEqual(round);
    }
  });
});

describe("the flash shortens", () => {
  it("shows round one for exactly the shipped 700 ms", () => {
    expect(showMs(1)).toBe(700);
    expect(leadInMs(1)).toBe(250);
  });

  it("shortens every round until a floor, instead of ending", () => {
    expect(showMs(10)).toBe(592);
    expect(showMs(25)).toBe(412);
    expect(showMs(26)).toBe(400);
    expect(showMs(80)).toBe(400);
    expect(leadInMs(10)).toBe(205);
    expect(leadInMs(27)).toBe(120);
    expect(leadInMs(80)).toBe(120);

    for (let round = 2; round <= 80; round += 1) {
      expect(showMs(round)).toBeLessThanOrEqual(showMs(round - 1));
      expect(leadInMs(round)).toBeLessThanOrEqual(leadInMs(round - 1));
    }
  });
});

describe("a run", () => {
  it("starts on round one with the pinned rules version and no score", () => {
    const run = createRun("1");
    expect(run.seed).toBe("1");
    expect(run.rulesVersion).toBe(MEMORY_FLASH_RULES_VERSION);
    expect(run.rulesVersion).toBe("memory-flash@2");
    expect(run.round).toBe(1);
    expect(run.entered).toEqual([]);
    expect(run.taps).toEqual([]);
    expect(run.score).toBe(0);
    expect(run.roundsCleared).toBe(0);
    expect(run.outcome).toBe("playing");
  });

  it("keeps the seed exactly as the database sent it", () => {
    expect(createRun("9223372036854775807").seed).toBe("9223372036854775807");
    expect(createRun(42).seed).toBe("42");
  });

  it("clears a round when its pattern is rebuilt, and scores it", () => {
    const run = playLine("1", [8]);
    expect(run.score).toBe(10);
    expect(run.roundsCleared).toBe(1);
    expect(run.round).toBe(2);
    expect(run.entered).toEqual([]);
    expect(run.outcome).toBe("playing");
  });

  it("does not care about the order of a pattern", () => {
    // Round two is [8, 6]: the reverse order must clear it, because a pattern is
    // a set. Only drawing one cell twice is a mistake.
    const reversed = playLine("1", [8, 6, 8]);
    expect(reversed.outcome).toBe("playing");
    expect(reversed.round).toBe(3);
    expect(reversed.score).toBe(20);
  });

  it("keeps a partial round's taps but scores nothing for it", () => {
    const run = playLine("1", [8, 8]);
    expect(run.round).toBe(2);
    expect(run.entered).toEqual([8]);
    expect(run.score).toBe(10);
  });

  it("ends the run on a cell the pattern does not light, keeping the losing tap", () => {
    const run = playLine("1", SEED_ONE_BROKEN);
    expect(run.outcome).toBe("over");
    expect(run.taps).toEqual(SEED_ONE_BROKEN);
    expect(run.score).toBe(10);
    expect(run.roundsCleared).toBe(1);
  });

  it("ends the run on a cell already entered, rather than counting it twice", () => {
    // Round two is [8, 6]. Tapping 8 twice is a mistake: it lights no new cell.
    const run = playLine("1", [8, 8, 8]);
    expect(run.outcome).toBe("over");
    expect(run.taps).toEqual([8, 8, 8]);
    expect(run.score).toBe(10);
  });

  it("plays past the retired tenth pattern instead of clearing the game", () => {
    const run = playLine("1", SEED_ONE_ENDLESS);
    expect(run.outcome).toBe("playing");
    expect(run.roundsCleared).toBe(12);
    expect(run.score).toBe(120); // twelve rounds at ten points
    expect(run.taps).toHaveLength(SEED_ONE_ENDLESS.length);
    expect(run.taps).toHaveLength(78);
    expect(run.round).toBe(13);
    expect(run.outcome).not.toBe("cleared");
  });

  it("opens the next round on the grown board when the pattern outgrows it", () => {
    const afterEight = playLine("1", SEED_ONE_PATTERNS_4X4.flat());
    expect(afterEight.round).toBe(9);
    expect(progress(afterEight)).toMatchObject({ round: 9, side: 5, cells: 25 });

    // Cell 22 only exists on the 5×5 board, and it is part of round nine.
    expect(canTap(afterEight, 22)).toBe(true);
    expect(canTap(createRun("1"), 22)).toBe(false);
  });

  it("offers no cell outside the round's board, and no tap once the run has ended", () => {
    const over = playLine("1", SEED_ONE_BROKEN);
    expect(canTap(over, 8)).toBe(false);
    expect(tap(over, 8)).toBe(over);

    const fresh = createRun("1");
    expect(canTap(fresh, -1)).toBe(false);
    expect(canTap(fresh, 16)).toBe(false);
    expect(canTap(fresh, 1.5)).toBe(false);
    expect(tap(fresh, 16)).toBe(fresh);

    const grown = playLine("1", SEED_ONE_PATTERNS_4X4.flat());
    expect(canTap(grown, 25)).toBe(false);
    expect(tap(grown, 25)).toBe(grown);
  });

  it("ends a run at the submission bound rather than offering a tap it cannot carry", () => {
    const atBound: MemoryFlashRun = {
      ...createRun("1"),
      taps: Array.from({ length: MEMORY_FLASH_MAX_ACTIONS }, () => 0),
      entered: [],
      round: 91,
      score: 900,
      roundsCleared: 90,
    };
    expect(canTap(atBound, 0)).toBe(false);
    expect(tap(atBound, 0)).toBe(atBound);
  });

  it("ends a run whose last allowed tap is correct, instead of stranding it", () => {
    // Round 91 starts with 4095 taps already placed, so its first correct tap is
    // the submission's last. The server ends the run there; a client that left it
    // `playing` would offer a board with no pressable cell and never submit.
    const firstCell = patternAt("1", 91)[0];
    const atBound: MemoryFlashRun = {
      ...createRun("1"),
      taps: Array.from({ length: MEMORY_FLASH_MAX_ACTIONS - 1 }, () => 0),
      entered: [],
      round: 91,
      score: 900,
      roundsCleared: 90,
    };
    const ended = tap(atBound, firstCell);
    expect(ended.outcome).toBe("over");
    expect(ended.taps).toHaveLength(MEMORY_FLASH_MAX_ACTIONS);
    expect(ended.score).toBe(900);
    expect(ended.entered).toEqual([firstCell]);
    expect(canTap(ended, firstCell)).toBe(false);
  });

  it("is a replay, not a sequence of side effects: the same line produces the same run", () => {
    const first = playLine("1", SEED_ONE_BROKEN);
    const second = playLine("1", SEED_ONE_BROKEN);
    expect(second).toEqual(first);
  });

  it("assembles the submission from the run, so the claim cannot be edited on the way out", () => {
    const run = playLine("1", SEED_ONE_BROKEN);
    expect(submission(run)).toEqual({
      rulesVersion: MEMORY_FLASH_RULES_VERSION,
      actions: SEED_ONE_BROKEN,
      score: 10,
      tapsPlaced: 2,
      roundsCleared: 1,
    });
  });

  it("reports the round, its board and the cells left, not a countdown to an ending", () => {
    expect(progress(createRun("1"))).toEqual({
      taps: 0,
      round: 1,
      side: 4,
      cells: 16,
      entered: 0,
    });

    const halfway = playLine("1", SEED_ONE_PATTERNS.slice(0, 4).flat());
    expect(progress(halfway)).toEqual({
      taps: 10,
      round: 5,
      side: 4,
      cells: 16,
      entered: 0,
    });
  });
});

describe("ending a run", () => {
  it("stops where the player ends it, keeping the score and the line as it stands", () => {
    const run = createRun("1");
    const stopped = finish(run);
    expect(stopped).toMatchObject({ outcome: "over", stopped: true, score: run.score });
    expect(submission(stopped)).toEqual(submission(run));
  });

  it("leaves a run that is already over exactly as it is", () => {
    const stopped = finish(createRun("1"));
    expect(finish(stopped)).toBe(stopped);
  });
});
