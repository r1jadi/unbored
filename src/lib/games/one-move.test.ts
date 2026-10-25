import { describe, expect, it } from "vitest";

import {
  boardPattern,
  boardSize,
  canTap,
  cellCount,
  createRun,
  finish,
  crossCells,
  ONE_MOVE_MAX_ACTIONS,
  ONE_MOVE_RULES_VERSION,
  progress,
  solvedCell,
  submission,
  tap,
  winningCell,
  type OneMoveRun,
} from "@/lib/games/one-move";

/**
 * The engine's tests are pinned to the *database's* numbers.
 *
 * `public.complete_one_move_run` is the authority: it replays the submitted taps
 * against the seed's winning cells and derives the score. Every vector below is
 * either asserted by `tests/security/rls_test.sql` for the same seed and line, or
 * computed here from the rules independently of this module. That makes a green
 * suite worth something — it proves agreement with the verifier, not
 * self-consistency.
 *
 * The vectors are also written down in `docs/games/README.md`.
 */

/**
 * Seed 1's winning cells, in level order. Levels one to twelve are the retired
 * game's cells, on its 3×3, 4×4 and 5×5 boards; levels thirteen to twenty are the
 * proof that the board keeps growing — 6×6 for 13–16 and 7×7 for 17–20.
 */
const SEED_ONE_CENTERS = [7, 8, 7, 7, 0, 8, 6, 2, 5, 18, 13, 5, 11, 21, 33, 20, 20, 9, 47, 39];

/** The endless line the SQL suite submits: twenty boards, then a miss on 21. */
const SEED_ONE_ENDLESS = [...SEED_ONE_CENTERS, 0];

/** Plays a whole line and returns the finished run. */
function playLine(seed: string, line: number[]): OneMoveRun {
  return line.reduce((run, cell) => tap(run, cell), createRun(seed));
}

/** Whether flipping `candidate`'s cross on `cells` restores the checkerboard. */
function restores(level: number, cells: readonly boolean[], candidate: number): boolean {
  const flipped = new Set(crossCells(level, candidate));
  return cells.every(
    (dark, index) => (flipped.has(index) ? !dark : dark) === solvedCell(level, index),
  );
}

describe("the winning cell is the verifier's cell", () => {
  it("draws seed 1's winning cells in the order the SQL suite documents", () => {
    SEED_ONE_CENTERS.forEach((cell, index) => {
      expect(winningCell("1", index + 1)).toBe(cell);
    });
  });

  it("grows the board past the retired 5×5 and never stops growing", () => {
    expect(Array.from({ length: 20 }, (_, i) => boardSize(i + 1))).toEqual([
      3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7,
    ]);
    expect(cellCount(1)).toBe(9);
    expect(cellCount(5)).toBe(16);
    expect(cellCount(9)).toBe(25);
    expect(cellCount(13)).toBe(36);
    expect(cellCount(17)).toBe(49);
    expect(cellCount(21)).toBe(64);
    // No final level: the side keeps climbing every four levels.
    expect(boardSize(65)).toBe(19);
    expect(boardSize(1000)).toBe(3 + Math.floor(999 / 4));
  });

  it("replays a seed larger than a JS safe integer exactly", () => {
    // `game_sessions.seed` is a bigint: the database's default draws from 2^63-1.
    // Rounding it to a double would win on different cells and the verifier
    // would reject every honest run, so the engine works in BigInt.
    const seed = "9223372036854775807";
    expect(Array.from({ length: 20 }, (_, i) => winningCell(seed, i + 1))).toEqual([
      1, 8, 6, 6, 5, 4, 5, 0, 24, 13, 3, 7, 20, 0, 2, 20, 35, 25, 13, 32,
    ]);
  });

  it("a rounded seed would have won on a different cell, which is the bug this guards", () => {
    expect(winningCell(Number("9223372036854775807"), 13)).not.toBe(
      winningCell("9223372036854775807", 13),
    );
  });

  it("treats a degenerate zero seed the way the verifier does", () => {
    for (let level = 1; level <= 20; level += 1) {
      expect(winningCell("0", level)).toBe(winningCell("2654435769", level));
    }
  });

  it("reduces a negative seed the way the verifier does", () => {
    for (let level = 1; level <= 20; level += 1) {
      expect(winningCell("-1", level)).toBe(winningCell("4294967295", level));
    }
  });

  it("refuses a seed that is not a whole number", () => {
    expect(() => winningCell("1.5", 1)).toThrow(TypeError);
    expect(() => winningCell(1.5, 1)).toThrow(TypeError);
    expect(() => winningCell("not-a-seed", 1)).toThrow(TypeError);
  });

  it("refuses a level before the first, rather than inventing one", () => {
    expect(() => winningCell("1", 0)).toThrow(RangeError);
    expect(() => winningCell("1", 1.5)).toThrow(RangeError);
    expect(() => winningCell("1", -1)).toThrow(RangeError);
  });
});

describe("a board has exactly one winning move", () => {
  it("flips a cross: the cell, its neighbours, and no cell off the board", () => {
    // A corner on the 3×3 board has three cells in its cross, an edge four, the
    // middle five.
    expect(crossCells(1, 0).sort((a, b) => a - b)).toEqual([0, 1, 3]);
    expect(crossCells(1, 1).sort((a, b) => a - b)).toEqual([0, 1, 2, 4]);
    expect(crossCells(1, 4).sort((a, b) => a - b)).toEqual([1, 3, 4, 5, 7]);
    // A corner of the 5×5 board, same truncation rule.
    expect(crossCells(9, 24).sort((a, b) => a - b)).toEqual([19, 23, 24]);
    // And a corner of a board the retired game never showed.
    expect(crossCells(13, 35).sort((a, b) => a - b)).toEqual([29, 34, 35]);
    for (const level of [1, 5, 9, 13, 17]) {
      for (const cell of crossCells(level, 0)) {
        expect(cell).toBeGreaterThanOrEqual(0);
        expect(cell).toBeLessThan(cellCount(level));
      }
    }
  });

  it("shows a checkerboard with the winning cross flipped, and nothing else", () => {
    for (let level = 1; level <= 20; level += 1) {
      const board = boardPattern("1", level);
      const flipped = new Set(crossCells(level, board.center));
      expect(board.center).toBe(winningCell("1", level));
      expect(board.cells).toHaveLength(cellCount(level));
      board.cells.forEach((dark, index) => {
        expect(dark).toBe(
          flipped.has(index) ? !solvedCell(level, index) : solvedCell(level, index),
        );
      });
      // Not already solved, or there would be nothing to find.
      expect(board.cells.some((dark, index) => dark !== solvedCell(level, index))).toBe(true);
    }
  });

  it("is restored by exactly one tap on every board of seed 1", () => {
    for (let level = 1; level <= 20; level += 1) {
      const board = boardPattern("1", level);
      const winners = Array.from({ length: cellCount(level) }, (_, cell) => cell).filter((cell) =>
        restores(level, board.cells, cell),
      );
      expect(winners).toEqual([board.center]);
    }
  });

  it("is restored by exactly one tap on the board where the retired game ended", () => {
    const seed = "9223372036854775807";
    for (const level of [12, 13, 20, 21]) {
      const board = boardPattern(seed, level);
      const winners = Array.from({ length: cellCount(level) }, (_, cell) => cell).filter((cell) =>
        restores(level, board.cells, cell),
      );
      expect(winners).toEqual([board.center]);
    }
  });
});

describe("a run", () => {
  it("starts on board one with the pinned rules version and no score", () => {
    const run = createRun("1");
    expect(run.seed).toBe("1");
    expect(run.rulesVersion).toBe(ONE_MOVE_RULES_VERSION);
    expect(run.rulesVersion).toBe("one-move@2");
    expect(run.level).toBe(1);
    expect(run.taps).toEqual([]);
    expect(run.score).toBe(0);
    expect(run.levelsCleared).toBe(0);
    expect(run.outcome).toBe("playing");
  });

  it("keeps the seed exactly as the database sent it", () => {
    expect(createRun("9223372036854775807").seed).toBe("9223372036854775807");
    expect(createRun(42).seed).toBe("42");
  });

  it("restores a board and scores it when the winning cell is tapped", () => {
    const run = playLine("1", [7]);
    expect(run.score).toBe(10);
    expect(run.levelsCleared).toBe(1);
    expect(run.level).toBe(2);
    expect(run.outcome).toBe("playing");
  });

  it("ends the run on any other cell, keeping the losing tap", () => {
    const run = playLine("1", [0]);
    expect(run.outcome).toBe("over");
    expect(run.taps).toEqual([0]);
    expect(run.score).toBe(0);
    expect(run.levelsCleared).toBe(0);
  });

  it("does not let a cell from the previous board win the next one", () => {
    // Board one wins on 7; board two wins on 8. A player who taps 7 again has not
    // found board two's move.
    const run = playLine("1", [7, 7]);
    expect(run.outcome).toBe("over");
    expect(run.score).toBe(10);
    expect(run.levelsCleared).toBe(1);
    expect(run.level).toBe(2);
  });

  it("plays past the retired twelfth board instead of clearing the game", () => {
    const run = playLine("1", SEED_ONE_CENTERS);
    expect(run.outcome).toBe("playing");
    expect(run.levelsCleared).toBe(20);
    expect(run.score).toBe(200); // twenty boards at ten points
    expect(run.taps).toHaveLength(20);
    expect(run.level).toBe(21); // on the 8×8 board
    expect(run.outcome).not.toBe("cleared");
  });

  it("deals a larger board on the level the retired game never reached", () => {
    const afterTwelve = playLine("1", SEED_ONE_CENTERS.slice(0, 12));
    expect(afterTwelve.level).toBe(13);
    expect(progress(afterTwelve)).toMatchObject({ level: 13, side: 6, cells: 36 });
    // Cell 33 only exists on the 6×6 board, and it is board thirteen's move.
    expect(winningCell("1", 13)).toBe(11);
    expect(canTap(afterTwelve, 35)).toBe(true);
    expect(canTap(afterTwelve, 36)).toBe(false);
  });

  it("keeps the boards restored before a losing tap", () => {
    const run = playLine("1", [7, 8, 7, 0]);
    expect(run.outcome).toBe("over");
    expect(run.score).toBe(30);
    expect(run.levelsCleared).toBe(3);
    expect(run.taps).toEqual([7, 8, 7, 0]);
  });

  it("ends the endless line on the miss after twenty boards", () => {
    const run = playLine("1", SEED_ONE_ENDLESS);
    expect(run.outcome).toBe("over");
    expect(run.score).toBe(200);
    expect(run.levelsCleared).toBe(20);
    expect(run.taps).toHaveLength(21);
    expect(run.taps.at(-1)).toBe(0);
    expect(run.level).toBe(21);
  });

  it("offers no tap once the run has ended, off the current board, or past the bound", () => {
    const over = playLine("1", [0]);
    expect(canTap(over, 7)).toBe(false);
    expect(tap(over, 7)).toBe(over);

    const fresh = createRun("1");
    expect(canTap(fresh, -1)).toBe(false);
    expect(canTap(fresh, 9)).toBe(false);
    expect(canTap(fresh, 1.5)).toBe(false);
    expect(tap(fresh, 9)).toBe(fresh);

    // The board grows, so the same engine accepts a cell that only exists later…
    const fifth = playLine("1", SEED_ONE_CENTERS.slice(0, 4));
    expect(fifth.level).toBe(5);
    expect(canTap(fifth, 15)).toBe(true);
    // …but not a cell past the current board's edge.
    expect(canTap(fifth, 16)).toBe(false);

    // The retired game ended here; this one offers board thirteen's cells.
    const thirteenth = playLine("1", SEED_ONE_CENTERS.slice(0, 12));
    expect(canTap(thirteenth, 35)).toBe(true);
    expect(canTap(thirteenth, 36)).toBe(false);
  });

  it("ends a run at the submission bound rather than offering a tap it cannot carry", () => {
    const atBound: OneMoveRun = {
      ...createRun("1"),
      taps: Array.from({ length: ONE_MOVE_MAX_ACTIONS }, () => 0),
      level: ONE_MOVE_MAX_ACTIONS + 1,
      score: ONE_MOVE_MAX_ACTIONS * 10,
      levelsCleared: ONE_MOVE_MAX_ACTIONS,
    };
    expect(canTap(atBound, 0)).toBe(false);
    expect(tap(atBound, 0)).toBe(atBound);
  });

  it("ends a run whose last allowed tap is correct, instead of stranding it", () => {
    // The server ends the run at the bound; a client that left it `playing`
    // would offer a board with no pressable cell and never submit.
    const level = ONE_MOVE_MAX_ACTIONS;
    const correct = winningCell("1", level);
    const atBound: OneMoveRun = {
      ...createRun("1"),
      taps: Array.from({ length: ONE_MOVE_MAX_ACTIONS - 1 }, () => 0),
      level,
      score: 40950,
      levelsCleared: ONE_MOVE_MAX_ACTIONS - 1,
    };
    const ended = tap(atBound, correct);
    expect(ended.outcome).toBe("over");
    expect(ended.taps).toHaveLength(ONE_MOVE_MAX_ACTIONS);
    expect(ended.score).toBe(40960);
    expect(ended.levelsCleared).toBe(ONE_MOVE_MAX_ACTIONS);
    expect(canTap(ended, correct)).toBe(false);
  });

  it("is a replay, not a sequence of side effects: the same line produces the same run", () => {
    const first = playLine("1", [7, 8, 0]);
    const second = playLine("1", [7, 8, 0]);
    expect(second).toEqual(first);
  });

  it("assembles the submission from the run, so the claim cannot be edited on the way out", () => {
    const run = playLine("1", [7, 0]);
    expect(submission(run)).toEqual({
      rulesVersion: ONE_MOVE_RULES_VERSION,
      actions: [7, 0],
      score: 10,
      tapsPlaced: 2,
      levelsCleared: 1,
    });
  });

  it("reports the level, its board and the taps left, not a countdown to an ending", () => {
    expect(progress(createRun("1"))).toEqual({
      taps: 0,
      total: ONE_MOVE_MAX_ACTIONS,
      level: 1,
      side: 3,
      cells: 9,
    });
    const halfway = playLine("1", SEED_ONE_CENTERS.slice(0, 16));
    expect(progress(halfway)).toMatchObject({ taps: 16, level: 17, side: 7, cells: 49 });
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
