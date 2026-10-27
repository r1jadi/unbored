import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRun as createColorMerge, canSlide } from "@/lib/games/color-merge";
import {
  createRun as createEightPuzzle,
  fewestMoves,
  lineTaps,
  tap as slideTile,
} from "@/lib/games/eight-puzzle";
import {
  HINT_COOLDOWN_MS,
  HINT_IDLE_MS,
  colorMergeHint,
  eightPuzzleHint,
  oneMoveHint,
  queensHint,
  stack10Hint,
  zipHint,
} from "@/lib/games/hints";
import { createRun as createOneMove, tap as tapOneMove, winningCell } from "@/lib/games/one-move";
import {
  boardSize as queensSize,
  createRun as createQueens,
  solution as queensSolution,
  tap as tapQueens,
} from "@/lib/games/queens";
import { createRun as createStack10, type Stack10Run } from "@/lib/games/stack10";
import { createRun as createZip, solution as zipSolution, tap as tapZip } from "@/lib/games/zip";
import { tangoHint, tangoRight } from "@/lib/games/hints";
import {
  createRun as createTango,
  solution as tangoSolution,
  SUN,
  tap as tapTango,
} from "@/lib/games/tango";
import { sudokuHint, sudokuRight } from "@/lib/games/hints";
import {
  createRun as createSudoku,
  candidates as sudokuCandidates,
  canFinish as sudokuCanFinish,
  place as placeSudoku,
} from "@/lib/games/sudoku";
import { useHint } from "@/lib/games/use-hint";

describe("hints", () => {
  it("Stack 10: prefers the column the tile clears", () => {
    const run = createStack10(1);
    const tile = run.nextTile!;
    const columns = run.columns.map((column, index) =>
      index === 2 ? { tiles: [10 - tile], sum: 10 - tile } : column,
    );
    expect(stack10Hint({ ...run, columns } as Stack10Run)).toEqual({
      column: 2,
      reason: `The ${tile} makes column 3 exactly 10, which clears it.`,
    });
  });

  it("Color Merge: points at a slide that moves the board", () => {
    const run = createColorMerge(1);
    const hint = colorMergeHint(run);
    expect(hint).not.toBeNull();
    expect(canSlide(run, hint!.direction)).toBe(true);
    expect(hint!.reason).toMatch(/^(Sliding|No slide)/);
  });

  it("One Move: names the row first, then the cell", () => {
    const run = createOneMove(1);
    const cell = winningCell(run.seed, run.level);
    expect(oneMoveHint(run, 0)).toMatchObject({ kind: "row", row: Math.floor(cell / 3), size: 3 });
    expect(oneMoveHint(run, 0)?.reason).toMatch(
      new RegExp(`^Row ${Math.floor(cell / 3) + 1} has the most cells out of the checkerboard`),
    );
    expect(oneMoveHint(run, 1)).toMatchObject({ kind: "cell", cell });
    expect(oneMoveHint(run, 1)?.reason).toMatch(/exactly the cross a tap here flips back/);
    // The cell hint is the move that clears the board.
    expect(tapOneMove(run, cell).levelsCleared).toBe(1);
  });

  it("Crowns: names the rule, outlines what it is about, and is never wrong", () => {
    // Following the hints alone solves boards, without a single mistake: every
    // crown hinted is on the solution, and every X hinted is off it.
    for (const seed of [1, 202, 303, 404]) {
      let run = createQueens(seed);
      for (let step = 0; step < 200 && run.levelsCleared < 1; step += 1) {
        const hint = queensHint(run)!;
        const size = queensSize(run.level);
        const onSolution =
          queensSolution(run.seed, run.level)[Math.floor(hint.cell / size)] === hint.cell % size;
        expect(onSolution).toBe(hint.kind === "crown");
        expect(hint.reason.length).toBeGreaterThan(20);
        expect(hint.focus.length).toBeGreaterThan(0);
        const want = hint.kind === "crown" ? "queen" : "mark";
        const level = run.level;
        for (
          let tap = 0;
          tap < 3 && run.level === level && run.cells[hint.cell] !== want;
          tap += 1
        ) {
          run = tapQueens(run, hint.cell);
        }
      }
      expect(run).toMatchObject({ levelsCleared: 1, mistakes: 0 });
    }
  });

  it("Zip: the next cell of the solution, or back to the last one that agreed", () => {
    let run = createZip(1);
    const route = zipSolution(run.seed, 1);
    expect(zipHint(run)).toEqual({ cell: route[0], back: false });
    run = tapZip(run, route[0]);
    expect(zipHint(run)).toEqual({ cell: route[1], back: false });
  });

  it("8 Puzzle: a slide on a shortest way to solved", () => {
    const run = createEightPuzzle(1);
    const before = fewestMoves(run.tiles);
    const hint = eightPuzzleHint(run);
    expect(hint).not.toBeNull();
    expect(fewestMoves(slideTile(run, hint!.cell).tiles)).toBe(before - 1);
    expect(hint!.reason).toMatch(
      before === 1 ? /solves the board/ : new RegExp(`leaves ${before - 1} slides? to solve`),
    );
  });
});

describe("8 Puzzle line slides", () => {
  it("expands a tap two cells from the gap into two adjacent slides, nearest first", () => {
    const run = { ...createEightPuzzle(1), tiles: [1, 2, 0, 4, 5, 3, 7, 8, 6] };
    expect(lineTaps(run, 0)).toEqual([1, 0]);
    expect(lineTaps(run, 1)).toEqual([1]);
    // Down the gap's column, the same way.
    expect(lineTaps(run, 8)).toEqual([5, 8]);
    // Off the gap's row and column there is no slide.
    expect(lineTaps(run, 3)).toEqual([]);
  });
});

describe("useHint", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers a hint after the idle wait, then waits between hints", () => {
    vi.useFakeTimers();
    const compute = vi.fn((asked: number) => asked);
    const { result, rerender } = renderHook(
      ({ progress }) => useHint({ progress, active: true, compute }),
      { initialProps: { progress: 0 } },
    );

    expect(result.current.offered).toBe(false);
    act(() => vi.advanceTimersByTime(HINT_IDLE_MS));
    expect(result.current.offered).toBe(true);

    act(() => result.current.ask());
    expect(result.current.hint).toBe(0);
    expect(result.current.waitSeconds).toBe(HINT_COOLDOWN_MS / 1000);

    // Asking during the wait does nothing.
    act(() => result.current.ask());
    expect(compute).toHaveBeenCalledTimes(1);

    // The countdown ticks once a second, as it does on screen.
    for (let second = 0; second < HINT_COOLDOWN_MS / 1000; second += 1) {
      act(() => vi.advanceTimersByTime(1000));
    }
    expect(result.current.waitSeconds).toBe(0);
    act(() => result.current.ask());
    expect(result.current.hint).toBe(1);

    // A right move clears the hint and starts the idle wait again.
    rerender({ progress: 1 });
    expect(result.current.hint).toBeNull();
    expect(result.current.offered).toBe(false);
  });
});

describe("tangoHint", () => {
  it("names the rule that forces the cell, and is never wrong", () => {
    for (const seed of ["1", "7", "42", "4242"]) {
      let run = createTango(seed);
      for (let step = 0; step < 100 && run.levelsCleared < 1; step += 1) {
        const hint = tangoHint(run)!;
        expect(hint.value).toBe(tangoSolution(run.seed, run.level)[hint.cell]);
        expect(hint.fix).toBe(false);
        const level = run.level;
        for (
          let tap = 0;
          tap < 3 && run.level === level && run.cells[hint.cell] !== hint.value;
          tap += 1
        ) {
          run = tapTango(run, hint.cell);
        }
      }
      expect(run.levelsCleared).toBe(1);
    }
  });

  it("explains a sign next to a filled cell", () => {
    // Seed 1's first board: the first hint reads a sign.
    expect(tangoHint(createTango("1"))?.reason).toMatch(
      /^The [=×] sign between this cell and row \d, column \d means they (match|differ), and that one is a (sun|moon)\.$/,
    );
  });

  it("points at a symbol placed wrong before anything else, and says why", () => {
    const wrong = tapTango(tapTango(createTango("1"), 1), 1); // a moon where a sun goes
    expect(tangoHint(wrong)).toMatchObject({ cell: 1, value: SUN, fix: true });
    expect(tangoHint(wrong)?.reason).toMatch(/breaks a rule|can't be finished/);
  });

  it("counts a right symbol as progress, and a wrong one as none", () => {
    const fresh = createTango("1");
    expect(tangoRight(fresh)).toBe(0);
    expect(tangoRight(tapTango(fresh, 1))).toBe(1);
    expect(tangoRight(tapTango(tapTango(fresh, 1), 1))).toBe(0);
  });
});

describe("sudokuHint", () => {
  // Seed 1's first board: cell 4 starts as a 9, and cell 2 takes a 2.
  it("says why a repeated digit has to go", () => {
    const wrong = placeSudoku(createSudoku("1"), 2, 9); // a second 9 in row one
    expect(sudokuHint(wrong)).toEqual({
      cell: 2,
      action: "clear",
      digit: 9,
      reason: "This 9 can't stay: there's already a 9 in row 1.",
    });
  });

  it("says when a digit leaves the board unfinishable", () => {
    // A digit that fits its row, column and box but leaves no way to finish.
    let run = createSudoku("1");
    let found = false;
    for (let cell = 0; cell < 81 && !found; cell += 1) {
      if (run.cells[cell] !== 0) continue;
      for (const digit of sudokuCandidates(run.cells, cell)) {
        const trial = [...run.cells];
        trial[cell] = digit;
        if (sudokuCanFinish(trial)) continue;
        run = placeSudoku(run, cell, digit);
        expect(sudokuHint(run)).toEqual({
          cell,
          action: "clear",
          digit,
          reason: `With a ${digit} here, the rest of the board can't be finished. Clear it.`,
        });
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("explains the only place for a digit, and following the hints solves the board", () => {
    let run = createSudoku("1");
    expect(sudokuHint(run)?.reason).toMatch(
      /^This is the only place in (its box|row \d|column \d) where a \d fits/,
    );
    for (let step = 0; step < 81 && run.levelsCleared < 1; step += 1) {
      const hint = sudokuHint(run)!;
      expect(hint.action).toBe("place");
      const trial = [...run.cells];
      trial[hint.cell] = hint.digit;
      expect(sudokuCanFinish(trial)).toBe(true);
      run = placeSudoku(run, hint.cell, hint.digit);
    }
    expect(run.levelsCleared).toBe(1);
  });

  it("counts a digit that fits as progress, and a clashing one as none", () => {
    const fresh = createSudoku("1");
    expect(sudokuRight(fresh)).toBe(0);
    expect(sudokuRight(placeSudoku(fresh, 2, 2))).toBe(1);
    expect(sudokuRight(placeSudoku(fresh, 2, 9))).toBe(0);
  });
});
