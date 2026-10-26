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
} from "@/lib/games/queens";
import { createRun as createStack10, type Stack10Run } from "@/lib/games/stack10";
import { createRun as createZip, solution as zipSolution, tap as tapZip } from "@/lib/games/zip";
import { useHint } from "@/lib/games/use-hint";

describe("hints", () => {
  it("Stack 10: prefers the column the tile clears", () => {
    const run = createStack10(1);
    const tile = run.nextTile!;
    const columns = run.columns.map((column, index) =>
      index === 2 ? { tiles: [10 - tile], sum: 10 - tile } : column,
    );
    expect(stack10Hint({ ...run, columns } as Stack10Run)).toBe(2);
  });

  it("Color Merge: points at a slide that moves the board", () => {
    const run = createColorMerge(1);
    const direction = colorMergeHint(run);
    expect(direction).not.toBeNull();
    expect(canSlide(run, direction!)).toBe(true);
  });

  it("One Move: names the row first, then the cell", () => {
    const run = createOneMove(1);
    const cell = winningCell(run.seed, run.level);
    expect(oneMoveHint(run, 0)).toEqual({ kind: "row", row: Math.floor(cell / 3), size: 3 });
    expect(oneMoveHint(run, 1)).toEqual({ kind: "cell", cell });
    // The cell hint is the move that clears the board.
    expect(tapOneMove(run, cell).levelsCleared).toBe(1);
  });

  it("Queens: points at the next Queen of the solution", () => {
    const run = createQueens(1);
    const size = queensSize(1);
    expect(queensHint(run)).toBe(queensSolution(run.seed, 1)[0]);
    expect(size).toBeGreaterThan(0);
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
    const cell = eightPuzzleHint(run);
    expect(cell).not.toBeNull();
    expect(fewestMoves(slideTile(run, cell!).tiles)).toBe(before - 1);
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
