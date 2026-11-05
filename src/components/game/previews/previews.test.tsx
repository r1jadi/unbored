import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentType } from "react";

import { isLocked, isSolved as isBoltedSolved, moveAmount } from "@/lib/games/bolted";
import { swapCells } from "@/lib/games/cascade";
import { matingMoves } from "@/lib/games/chess";
import {
  slideBoard,
  UP,
  DOWN,
  LEFT,
  RIGHT,
  type ColorMergeDirection,
} from "@/lib/games/color-merge";
import { CHECKMATE_BANK } from "@/lib/games/checkmate-bank";
import { CROSSWORD_MIDIS, CROSSWORD_MINIS } from "@/lib/games/crossword-bank";
import { DECANT_DEPTH, isSolved as isDecantSolved, pourAmount } from "@/lib/games/decant";
import { canPlace, place } from "@/lib/games/gridburst";
import { HUEDINI_BANK } from "@/lib/games/huedini-bank";
import { conflicts as miniConflicts, isSolved as isMiniSolved } from "@/lib/games/mini-sudoku";
import { MINI_SUDOKU_BANK } from "@/lib/games/mini-sudoku-bank";
import { solutions as queensSolutions } from "@/lib/games/queens";
import {
  conflicts as sudokuConflicts,
  isSolved as isSudokuSolved,
  type SudokuDigit,
} from "@/lib/games/sudoku";
import { SUDOKU_BANK } from "@/lib/games/sudoku-bank";
import { conflicts as tangoConflicts, solutions as tangoSolutions } from "@/lib/games/tango";
import {
  columnAt,
  UPDRAFT_GLIDER_RADIUS,
  UPDRAFT_GROUND,
  UPDRAFT_WIDTH,
} from "@/lib/games/updraft";
import { solutions as zipSolutions } from "@/lib/games/zip";

import {
  BOLTED_PREVIEW_BEATS,
  BOLTED_PREVIEW_MOVES,
  BOLTED_PREVIEW_START,
  BoltedPreview,
} from "./BoltedPreview";
import { CASCADE_PREVIEW_BEATS, CascadePreview } from "./CascadePreview";
import { CHAIN_PREVIEW_BEATS, ChainPreview } from "./ChainPreview";
import {
  CHECKMATE_PREVIEW_BEATS,
  CHECKMATE_PREVIEW_FEN,
  CHECKMATE_PREVIEW_IS_MATE,
  CHECKMATE_PREVIEW_MOVE,
  CHECKMATE_PREVIEW_START,
  CheckmatePreview,
} from "./CheckmatePreview";
import {
  COLOR_MERGE_PREVIEW_BEATS,
  COLOR_MERGE_PREVIEW_BOARD,
  ColorMergePreview,
  slidingTiles,
} from "./ColorMergePreview";
import {
  CROSSWORD_PREVIEW,
  CROSSWORD_PREVIEW_BEATS,
  CROSSWORD_PREVIEW_GRID,
  CrosswordPreview,
} from "./CrosswordPreview";
import {
  DECANT_PREVIEW_BEATS,
  DECANT_PREVIEW_POURS,
  DECANT_PREVIEW_START,
  DecantPreview,
} from "./DecantPreview";
import { DONT_TOUCH_PREVIEW_BEATS, DontTouchPreview } from "./DontTouchPreview";
import { EIGHT_PUZZLE_PREVIEW_BEATS, EightPuzzlePreview } from "./EightPuzzlePreview";
import {
  GRIDBURST_PREVIEW_BEATS,
  GridburstPreview,
  gridburstPreviewStart,
} from "./GridburstPreview";
import { HUEDINI_PREVIEW_BEATS, HUEDINI_PREVIEW_CODE, HuediniPreview } from "./HuediniPreview";
import { MEMORY_FLASH_PREVIEW_BEATS, MemoryFlashPreview } from "./MemoryFlashPreview";
import {
  MINI_SUDOKU_PREVIEW_BEATS,
  MINI_SUDOKU_PREVIEW_OPEN,
  MINI_SUDOKU_PREVIEW_SOLVED,
  MiniSudokuPreview,
} from "./MiniSudokuPreview";
import { ONE_MOVE_PREVIEW_BEATS, OneMovePreview } from "./OneMovePreview";
import {
  QUEENS_PREVIEW_BEATS,
  QUEENS_PREVIEW_REGIONS,
  QUEENS_PREVIEW_SIZE,
  QUEENS_PREVIEW_SOLUTION,
  QueensPreview,
} from "./QueensPreview";
import { SCATTER_PREVIEW_BEATS, ScatterPreview } from "./ScatterPreview";
import { SEVEN_SECOND_PREVIEW_BEATS, SevenSecondPreview } from "./SevenSecondPreview";
import { STACK10_PREVIEW_BEATS, Stack10Preview } from "./Stack10Preview";
import {
  SUDOKU_PREVIEW_BEATS,
  SUDOKU_PREVIEW_OPEN,
  SUDOKU_PREVIEW_SOLVED,
  SudokuPreview,
} from "./SudokuPreview";
import {
  TANGO_PREVIEW_BEATS,
  TANGO_PREVIEW_SIGNS,
  TANGO_PREVIEW_SOLVED,
  TANGO_PREVIEW_START,
  TangoPreview,
} from "./TangoPreview";
import {
  UPDRAFT_PREVIEW_COLUMNS,
  UPDRAFT_PREVIEW_FRAMES,
  UPDRAFT_PREVIEW_SEED,
  UPDRAFT_PREVIEW_TICKS,
  UpdraftPreview,
} from "./UpdraftPreview";
import {
  ZIP_PREVIEW_BEATS,
  ZIP_PREVIEW_NUMBERS,
  ZIP_PREVIEW_PATH,
  ZIP_PREVIEW_SIZE,
  ZipPreview,
} from "./ZipPreview";

/**
 * A preview claims to show the real game. These pin that claim: if the rules
 * change so a script could no longer happen, this fails rather than the feed
 * quietly advertising a game that does not exist.
 */

type Row = {
  name: string;
  beats: readonly { ms: number; fading?: boolean }[];
  Preview: ComponentType<{ playing: boolean }>;
};

const SCRIPTED: Row[] = [
  { name: "7-second", beats: SEVEN_SECOND_PREVIEW_BEATS, Preview: SevenSecondPreview },
  { name: "8-puzzle", beats: EIGHT_PUZZLE_PREVIEW_BEATS, Preview: EightPuzzlePreview },
  { name: "bolted", beats: BOLTED_PREVIEW_BEATS, Preview: BoltedPreview },
  { name: "cascade", beats: CASCADE_PREVIEW_BEATS, Preview: CascadePreview },
  { name: "checkmate", beats: CHECKMATE_PREVIEW_BEATS, Preview: CheckmatePreview },
  { name: "color-merge", beats: COLOR_MERGE_PREVIEW_BEATS, Preview: ColorMergePreview },
  { name: "crossword", beats: CROSSWORD_PREVIEW_BEATS, Preview: CrosswordPreview },
  { name: "crowns", beats: QUEENS_PREVIEW_BEATS, Preview: QueensPreview },
  { name: "decant", beats: DECANT_PREVIEW_BEATS, Preview: DecantPreview },
  { name: "dont-break-the-chain", beats: CHAIN_PREVIEW_BEATS, Preview: ChainPreview },
  { name: "dont-touch-the-black", beats: DONT_TOUCH_PREVIEW_BEATS, Preview: DontTouchPreview },
  { name: "gridburst", beats: GRIDBURST_PREVIEW_BEATS, Preview: GridburstPreview },
  { name: "huedini", beats: HUEDINI_PREVIEW_BEATS, Preview: HuediniPreview },
  { name: "memory-flash", beats: MEMORY_FLASH_PREVIEW_BEATS, Preview: MemoryFlashPreview },
  { name: "mini-sudoku", beats: MINI_SUDOKU_PREVIEW_BEATS, Preview: MiniSudokuPreview },
  { name: "one-move", beats: ONE_MOVE_PREVIEW_BEATS, Preview: OneMovePreview },
  { name: "scatter", beats: SCATTER_PREVIEW_BEATS, Preview: ScatterPreview },
  { name: "stack-10", beats: STACK10_PREVIEW_BEATS, Preview: Stack10Preview },
  { name: "sudoku", beats: SUDOKU_PREVIEW_BEATS, Preview: SudokuPreview },
  { name: "sun-and-moon", beats: TANGO_PREVIEW_BEATS, Preview: TangoPreview },
  { name: "trail", beats: ZIP_PREVIEW_BEATS, Preview: ZipPreview },
];

const loopMs = (beats: readonly { ms: number }[]) => beats.reduce((sum, beat) => sum + beat.ms, 0);

describe.each(SCRIPTED)("the $name preview", ({ name, beats, Preview }) => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("loops in three to five seconds, fading as it ends", () => {
    expect(loopMs(beats)).toBeGreaterThanOrEqual(3000);
    expect(loopMs(beats)).toBeLessThanOrEqual(4900);
    expect(beats[beats.length - 1].fading).toBe(true);
    expect(beats.slice(0, -1).some((beat) => beat.fading)).toBe(false);
  });

  it("draws every beat and starts over", () => {
    render(<Preview playing />);
    for (const beat of [...beats, beats[0]]) {
      expect(screen.getByTestId(`${name}-preview`)).toBeTruthy();
      act(() => void vi.advanceTimersByTime(beat.ms));
    }
  });
});

describe("the Gridburst preview", () => {
  it("is three legal placements, scored by the real rules", () => {
    let run = gridburstPreviewStart();
    const moves = GRIDBURST_PREVIEW_BEATS.flatMap((beat) => (beat.moving ? [beat.moving] : []));
    expect(moves).toHaveLength(3);
    const gains = moves.map(({ slot, cell }) => {
      expect(canPlace(run, slot, cell)).toBe(true);
      const next = place(run, slot, cell);
      const gain = next.score - run.score;
      run = next;
      return gain;
    });
    expect(gains).toEqual([13, 4, 82]);
    expect(run.lines).toBe(3);
    expect(run.combo).toBe(2);
  });

  it("floats exactly the points the rules gave, and only on a burst", () => {
    const floated = GRIDBURST_PREVIEW_BEATS.flatMap((beat) =>
      beat.gain === null ? [] : [{ gain: beat.gain, popped: beat.popping.length }],
    );
    expect(floated).toEqual([
      { gain: 13, popped: 8 },
      { gain: 82, popped: 16 },
    ]);
  });
});

describe("the Decant preview", () => {
  it("is all legal pours, and they sort a board the game could deal", () => {
    expect(DECANT_PREVIEW_BEATS.filter((beat) => beat.pour)).toHaveLength(
      DECANT_PREVIEW_POURS.length,
    );
    for (const beat of DECANT_PREVIEW_BEATS) {
      if (beat.pour) expect(beat.pour.amount).toBeGreaterThan(0);
    }
    expect(pourAmount(DECANT_PREVIEW_START, 3, 2)).toBe(1);
    expect(isDecantSolved(DECANT_PREVIEW_START)).toBe(false);
    expect(isDecantSolved(DECANT_PREVIEW_BEATS[DECANT_PREVIEW_BEATS.length - 1].tubes)).toBe(true);

    const counts = new Map<number, number>();
    for (const unit of DECANT_PREVIEW_START.flat()) counts.set(unit, (counts.get(unit) ?? 0) + 1);
    expect([...counts.values()].every((count) => count === DECANT_DEPTH)).toBe(true);
    expect(DECANT_PREVIEW_START).toHaveLength(counts.size + 2);
  });
});

describe("the Flutter preview", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("flies the whole loop without crashing and clears columns", () => {
    expect(UPDRAFT_PREVIEW_FRAMES).toHaveLength(UPDRAFT_PREVIEW_TICKS);
    for (let tick = 1; tick < UPDRAFT_PREVIEW_FRAMES.length; tick += 1) {
      expect(UPDRAFT_PREVIEW_FRAMES[tick].distance).toBeGreaterThan(
        UPDRAFT_PREVIEW_FRAMES[tick - 1].distance,
      );
      expect(UPDRAFT_PREVIEW_FRAMES[tick].y + UPDRAFT_GLIDER_RADIUS).toBeLessThan(UPDRAFT_GROUND);
    }
    expect(UPDRAFT_PREVIEW_FRAMES[UPDRAFT_PREVIEW_FRAMES.length - 1].score).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("draws enough columns to the end of the loop", () => {
    const last = UPDRAFT_PREVIEW_FRAMES[UPDRAFT_PREVIEW_FRAMES.length - 1];
    const next = columnAt(UPDRAFT_PREVIEW_SEED, UPDRAFT_PREVIEW_COLUMNS);
    expect(next.x - last.distance).toBeGreaterThanOrEqual(UPDRAFT_WIDTH);
  });

  it("renders", () => {
    render(<UpdraftPreview playing={false} />);
    expect(screen.getByTestId("updraft-preview")).toBeTruthy();
  });
});

describe("the Stack 10 preview", () => {
  it("clears a column at exactly ten, at least twice", () => {
    const clears = STACK10_PREVIEW_BEATS.filter((beat) => beat.clearing !== null);
    expect(clears.length).toBeGreaterThanOrEqual(2);
    for (const beat of clears) {
      const column = beat.columns[beat.clearing as number];
      expect(column.reduce((sum, tile) => sum + tile, 0)).toBe(10);
      expect(beat.gain).toBe(10 + 5 * (column.length - 1));
    }
  });

  it("never passes ten", () => {
    for (const beat of STACK10_PREVIEW_BEATS) {
      for (const column of beat.columns) {
        expect(column.reduce((sum, tile) => sum + tile, 0)).toBeLessThanOrEqual(10);
      }
    }
  });
});

describe("the Color Merge preview", () => {
  it.each([UP, RIGHT, DOWN, LEFT] as ColorMergeDirection[])(
    "moves each tile where the rules put it, sliding %i",
    (direction) => {
      const after = slideBoard(COLOR_MERGE_PREVIEW_BOARD, direction);
      const landed = new Map<number, number[]>();
      for (const tile of slidingTiles(COLOR_MERGE_PREVIEW_BOARD, direction)) {
        landed.set(tile.to, [...(landed.get(tile.to) ?? []), tile.shade]);
      }
      after.forEach((shade, cell) => {
        const tiles = landed.get(cell) ?? [];
        if (shade === 0) expect(tiles).toEqual([]);
        else if (tiles.length === 1) expect(tiles).toEqual([shade]);
        else expect(tiles).toEqual([shade - 1, shade - 1]);
      });
    },
  );

  it("merges more than once", () => {
    const gains = COLOR_MERGE_PREVIEW_BEATS.filter((beat) => beat.gain !== null);
    expect(gains.length).toBeGreaterThanOrEqual(2);
  });
});

describe("the Cascade preview", () => {
  it("swaps neighbours, clears tiles, and sets off a chain", () => {
    const swaps = CASCADE_PREVIEW_BEATS.filter((beat) => beat.swapping);
    expect(swaps.length).toBeGreaterThanOrEqual(1);
    for (const beat of swaps) {
      const [from, to] = beat.swapping as [number, number];
      const row = Math.floor(from / 8);
      expect(swapCells(from * 2 + (to - from === 1 && Math.floor(to / 8) === row ? 0 : 1))).toEqual(
        [from, to],
      );
    }
    expect(Math.max(...CASCADE_PREVIEW_BEATS.map((beat) => beat.wave))).toBeGreaterThanOrEqual(2);
  });
});

describe("the Bolted preview", () => {
  it("is all legal moves, and locks every bolt it fills", () => {
    let bolts = BOLTED_PREVIEW_START;
    for (const [from, to] of BOLTED_PREVIEW_MOVES) {
      expect(moveAmount(bolts, from, to)).toBeGreaterThan(0);
      bolts = BOLTED_PREVIEW_BEATS.find(
        (beat) => beat.carrying?.from === from && beat.carrying.to === to && beat.bolts !== bolts,
      )!.bolts;
    }
    expect(isBoltedSolved(bolts)).toBe(true);
    expect(bolts.filter(isLocked)).toHaveLength(3);
  });
});

describe("the Scatter preview", () => {
  it("jams once, then clears the whole board for its bonus", () => {
    expect(SCATTER_PREVIEW_BEATS.filter((beat) => beat.jammed !== null)).toHaveLength(1);
    const last = SCATTER_PREVIEW_BEATS[SCATTER_PREVIEW_BEATS.length - 1];
    expect(last.cells.every((tile) => tile === null)).toBe(true);
    expect(SCATTER_PREVIEW_BEATS.some((beat) => beat.gain === 6)).toBe(true);
  });
});

describe("the Huedini preview", () => {
  it("is not one of the bank's boards", () => {
    expect(HUEDINI_BANK).not.toContain(HUEDINI_PREVIEW_CODE);
  });

  it("sends every block out through its gate", () => {
    expect(HUEDINI_PREVIEW_BEATS.filter((beat) => beat.leaving)).toHaveLength(4);
    expect(HUEDINI_PREVIEW_BEATS[HUEDINI_PREVIEW_BEATS.length - 1].blocks).toEqual([]);
  });
});

describe("the 8 Puzzle preview", () => {
  it("ends solved, for the points the rules give", () => {
    const end = EIGHT_PUZZLE_PREVIEW_BEATS[EIGHT_PUZZLE_PREVIEW_BEATS.length - 1];
    expect(end.tiles).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0]);
    expect(EIGHT_PUZZLE_PREVIEW_BEATS.filter((beat) => beat.gain !== null)).toHaveLength(1);
  });
});

describe("the Sudoku preview", () => {
  it("is a real solved grid, not one the bank deals", () => {
    const grid = SUDOKU_PREVIEW_SOLVED as SudokuDigit[];
    expect(sudokuConflicts(grid).size).toBe(0);
    expect(isSudokuSolved(grid)).toBe(true);
    const start = SUDOKU_PREVIEW_BEATS[0].cells.join("");
    expect(SUDOKU_BANK).not.toContain(start);
    expect(SUDOKU_PREVIEW_OPEN.every((cell) => SUDOKU_PREVIEW_BEATS[0].cells[cell] === 0)).toBe(
      true,
    );
  });
});

describe("the Mini Sudoku preview", () => {
  it("is a real solved grid, not one the bank deals", () => {
    const grid = MINI_SUDOKU_PREVIEW_SOLVED as Parameters<typeof isMiniSolved>[0];
    expect(miniConflicts(grid).size).toBe(0);
    expect(isMiniSolved(grid)).toBe(true);
    expect(MINI_SUDOKU_BANK).not.toContain(MINI_SUDOKU_PREVIEW_BEATS[0].cells.join(""));
    expect(new Set(MINI_SUDOKU_PREVIEW_OPEN).size).toBe(MINI_SUDOKU_PREVIEW_OPEN.length);
  });
});

describe("the Queens preview", () => {
  it("has exactly the one solution it shows", () => {
    expect(queensSolutions(QUEENS_PREVIEW_SIZE, QUEENS_PREVIEW_REGIONS)).toEqual([
      QUEENS_PREVIEW_SOLUTION,
    ]);
  });
});

describe("the Sun and Moon preview", () => {
  it("is a solved grid whose signs hold and whose start has one answer", () => {
    expect(tangoConflicts(TANGO_PREVIEW_SOLVED, TANGO_PREVIEW_SIGNS).size).toBe(0);
    expect(tangoSolutions(TANGO_PREVIEW_START, TANGO_PREVIEW_SIGNS)).toEqual([
      [...TANGO_PREVIEW_SOLVED],
    ]);
    const end = TANGO_PREVIEW_BEATS[TANGO_PREVIEW_BEATS.length - 1];
    expect(end.cells).toEqual(TANGO_PREVIEW_SOLVED);
  });
});

describe("the Trail preview", () => {
  it("draws a line through every cell that the board allows", () => {
    expect(new Set(ZIP_PREVIEW_PATH).size).toBe(ZIP_PREVIEW_SIZE * ZIP_PREVIEW_SIZE);
    const found = zipSolutions(ZIP_PREVIEW_SIZE, ZIP_PREVIEW_NUMBERS, [], 500);
    expect(found).toContainEqual(ZIP_PREVIEW_PATH);
  });
});

describe("the Crossword preview", () => {
  it("is in neither bank, and every entry is one of its words", () => {
    expect(CROSSWORD_MINIS).not.toContain(CROSSWORD_PREVIEW_GRID);
    expect(CROSSWORD_MIDIS).not.toContain(CROSSWORD_PREVIEW_GRID);
    const words = (across: boolean) =>
      CROSSWORD_PREVIEW.entries.filter((e) => e.across === across).map((e) => e.answer);
    expect(words(true)).toEqual(["TOAST", "ROBIN", "DRYER"]);
    expect(words(false)).toEqual(["TIRED", "ABBEY", "TENOR"]);
  });

  it("ends with the grid filled", () => {
    const end = CROSSWORD_PREVIEW_BEATS[CROSSWORD_PREVIEW_BEATS.length - 1];
    end.letters.forEach((letter, cell) => {
      expect(letter).toBe(CROSSWORD_PREVIEW_GRID[cell] === "#" ? "" : CROSSWORD_PREVIEW_GRID[cell]);
    });
  });
});

describe("the Checkmate preview", () => {
  it("is mate in one, the only one, and not a bank position", () => {
    expect(CHECKMATE_PREVIEW_MOVE).not.toBeNull();
    expect(CHECKMATE_PREVIEW_IS_MATE).toBe(true);
    expect(matingMoves(CHECKMATE_PREVIEW_START)).toHaveLength(1);
    const placement = CHECKMATE_PREVIEW_FEN.split(" ")[0];
    expect(CHECKMATE_BANK.some((entry) => entry.startsWith(`${placement} `))).toBe(false);
  });
});

describe("the One Move preview", () => {
  it("restores a checkerboard every time, and the board grows", () => {
    const solved = ONE_MOVE_PREVIEW_BEATS.filter((beat) => beat.gain !== null);
    expect(solved).toHaveLength(3);
    for (const beat of solved) {
      beat.cells.forEach((dark, cell) => {
        const row = Math.floor(cell / beat.size);
        expect(dark).toBe((row + (cell % beat.size)) % 2 === 0);
      });
    }
    expect(new Set(ONE_MOVE_PREVIEW_BEATS.map((beat) => beat.size)).size).toBeGreaterThan(1);
  });
});

describe("the Don't Touch the Black preview", () => {
  it("clears whites only, for ten points each", () => {
    const last = DONT_TOUCH_PREVIEW_BEATS[DONT_TOUCH_PREVIEW_BEATS.length - 1];
    expect(last.cleared.length).toBeGreaterThan(5);
    expect(last.score).toBe(last.cleared.length * 10);
  });
});

describe("the 7 Second preview", () => {
  it("answers correctly and keeps the clock alive", () => {
    const last = SEVEN_SECOND_PREVIEW_BEATS[SEVEN_SECOND_PREVIEW_BEATS.length - 1];
    expect(last.score).toBe(50);
    expect(SEVEN_SECOND_PREVIEW_BEATS.every((beat) => beat.remaining > 0)).toBe(true);
    for (const beat of SEVEN_SECOND_PREVIEW_BEATS) {
      if (beat.pressed !== null) expect(beat.pressed).toBe(beat.dealt.correct);
    }
  });
});

describe("the Memory Flash preview", () => {
  it("rebuilds each pattern, for the round's points", () => {
    const cleared = MEMORY_FLASH_PREVIEW_BEATS.filter((beat) => beat.gain !== null);
    expect(cleared).toHaveLength(2);
    for (const beat of cleared) expect(beat.entered).toHaveLength(beat.round);
  });
});

describe("the Chain preview", () => {
  it("scores one point for each tap it repeats back", () => {
    const last = CHAIN_PREVIEW_BEATS[CHAIN_PREVIEW_BEATS.length - 1];
    expect(last.score).toBe(1 + 2 + 3);
  });
});
