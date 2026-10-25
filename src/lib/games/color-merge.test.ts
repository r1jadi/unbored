import { describe, expect, it } from "vitest";

import {
  COLOR_MERGE_CELLS,
  COLOR_MERGE_DIRECTIONS,
  COLOR_MERGE_MAX_SLIDES,
  COLOR_MERGE_OPENING_TILES,
  COLOR_MERGE_RULES_VERSION,
  COLOR_MERGE_SIZE,
  COLOR_MERGE_SLIDES,
  DOWN,
  LEFT,
  RIGHT,
  UP,
  bestShade,
  canMove,
  canSlide,
  createRun,
  finish,
  isDirection,
  openingBoard,
  progress,
  slide,
  slideBoard,
  slideGain,
  spawnBoard,
  spawnPromotedShade,
  spawnPromotionPercent,
  submission,
  tileValue,
  type ColorMergeDirection,
  type ColorMergeRun,
} from "./color-merge";

/**
 * Color Merge's endless rules, asserted rather than assumed.
 *
 * The two vectors that also appear in `tests/security/rls_test.sql` are seed 1's
 * sixty-four-slide line (468 points) and seed 15's fifty-two-slide line (292
 * points). Both run past the retired forty-eight-slide deck, which is the point:
 * the endless engine keeps dealing after the old endpoint. If either copy of the
 * ruleset drifts, an honest submission becomes `score_mismatch` and the
 * disagreement shows up here first.
 */

/** A 4×4 board from at most four rows, padded to the sixteen cells the rules use. */
function boardOf(rows: number[][]): number[] {
  const board = rows.flat();
  while (board.length < COLOR_MERGE_CELLS) board.push(0);
  return board;
}

/** The first row of a board, which is where a horizontal slide acts first. */
function firstRow(board: readonly number[]): number[] {
  return board.slice(0, COLOR_MERGE_SIZE);
}

/** Plays the first direction in `order` that changes the board, until the run ends. */
function playFirstLegal(seed: string, order: readonly ColorMergeDirection[]): ColorMergeRun {
  let run = createRun(seed);
  while (run.outcome === "playing") {
    const direction = order.find((candidate) => canSlide(run, candidate));
    if (direction === undefined) throw new Error("a live run must have a legal slide");
    run = slide(run, direction);
  }
  return run;
}

const ORDER: readonly ColorMergeDirection[] = [DOWN, LEFT, RIGHT, UP];
const LONG_RUN = playFirstLegal("1", ORDER);
const LOCKED_RUN = playFirstLegal("15", [RIGHT, LEFT, UP, DOWN]);

describe("the opening board", () => {
  it("deals two tiles from the seed and leaves the rest empty", () => {
    const board = openingBoard("1");
    expect(board).toHaveLength(COLOR_MERGE_CELLS);
    expect(board.filter((shade) => shade !== 0)).toHaveLength(COLOR_MERGE_OPENING_TILES);
    // A seed beyond 32 bits is still a full-width draw, not a rounded one.
    expect(openingBoard("9223372036854775807")).toEqual([
      0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it("is deterministic: the same seed deals the same board, twice", () => {
    expect(createRun("1").board).toEqual(createRun("1").board);
    expect(createRun("1").board).not.toEqual(createRun("2").board);
  });

  it("opens with nothing played or scored, under the endless rules", () => {
    const run = createRun("1");
    expect(run.rulesVersion).toBe(COLOR_MERGE_RULES_VERSION);
    expect(run.rulesVersion).toBe("color-merge@2");
    expect(run.moves).toEqual([]);
    expect(run.score).toBe(0);
    expect(run.outcome).toBe("playing");
    expect(run.endReason).toBeNull();
  });

  it("never overwrites a tile when it deals", () => {
    const board = spawnBoard("1", 3, openingBoard("1"));
    expect(board.filter((shade) => shade !== 0)).toHaveLength(3);
    expect(openingBoard("1").every((shade, cell) => shade === 0 || board[cell] !== 0)).toBe(true);
  });

  it("leaves a full board unchanged: there is nowhere to put a tile", () => {
    const full = [1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, 1];
    expect(spawnBoard("1", 3, full)).toEqual(full);
  });

  it("refuses a spawn index that is not a whole number from one", () => {
    expect(() => spawnBoard("1", 0, openingBoard("1"))).toThrow(RangeError);
    expect(() => spawnBoard("1", 1.5, openingBoard("1"))).toThrow(RangeError);
    expect(() => spawnPromotionPercent(0)).toThrow(RangeError);
    expect(() => spawnPromotedShade(0)).toThrow(RangeError);
  });
});

describe("the spawn ramp", () => {
  it("opens at the retired game's ten percent and rises one point per five spawns", () => {
    expect(spawnPromotionPercent(1)).toBe(10);
    expect(spawnPromotionPercent(4)).toBe(10);
    expect(spawnPromotionPercent(5)).toBe(11);
    expect(spawnPromotionPercent(6)).toBe(11);
    expect(spawnPromotionPercent(50)).toBe(20);
  });

  it("caps the chance at sixty percent rather than the difficulty", () => {
    expect(spawnPromotionPercent(250)).toBe(60);
    expect(spawnPromotionPercent(600)).toBe(60);
    expect(spawnPromotionPercent(100_000)).toBe(60);
  });

  it("climbs the promoted shade by one every hundred and twenty spawns, without cap", () => {
    expect(spawnPromotedShade(1)).toBe(2);
    expect(spawnPromotedShade(119)).toBe(2);
    expect(spawnPromotedShade(120)).toBe(3);
    expect(spawnPromotedShade(240)).toBe(4);
    expect(spawnPromotedShade(120_000)).toBe(1002);
  });

  it("deals higher tiles later in a run, never merely more of the same", () => {
    // A run of 3,000 spawns is far longer than any session, and the shade still
    // grows: the ceiling on the chance is not a ceiling on difficulty.
    expect(spawnPromotedShade(3_000)).toBeGreaterThan(spawnPromotedShade(1_000));
  });
});

describe("sliding", () => {
  it("compacts a line toward the edge it is slid to", () => {
    expect(firstRow(slideBoard(boardOf([[1, 0, 0, 2]]), LEFT))).toEqual([1, 2, 0, 0]);
    expect(firstRow(slideBoard(boardOf([[1, 0, 0, 2]]), RIGHT))).toEqual([0, 0, 1, 2]);
  });

  it("merges equal neighbours into the next shade", () => {
    expect(firstRow(slideBoard(boardOf([[1, 1, 0, 0]]), LEFT))).toEqual([2, 0, 0, 0]);
    expect(firstRow(slideBoard(boardOf([[0, 0, 2, 2]]), RIGHT))).toEqual([0, 0, 0, 3]);
    expect(
      slideBoard(
        boardOf([
          [1, 0, 0, 0],
          [1, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ]),
        UP,
      ),
    ).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("merges each tile at most once per slide", () => {
    // Four shade-1 tiles are two shade-2 tiles, never one shade-3 tile.
    expect(firstRow(slideBoard(boardOf([[1, 1, 1, 1]]), LEFT))).toEqual([2, 2, 0, 0]);
    expect(firstRow(slideBoard(boardOf([[1, 1, 1, 0]]), LEFT))).toEqual([2, 1, 0, 0]);
  });

  it("merges the pair nearest the edge, leaving the odd tile behind", () => {
    expect(firstRow(slideBoard(boardOf([[2, 1, 1, 0]]), LEFT))).toEqual([2, 2, 0, 0]);
  });

  it("moves tiles that are already at the edge without merging them", () => {
    expect(firstRow(slideBoard(boardOf([[2, 1, 2, 1]]), LEFT))).toEqual([2, 1, 2, 1]);
  });

  it("refuses a board that is not sixteen cells", () => {
    expect(() => slideBoard([1, 2], LEFT)).toThrow(RangeError);
    expect(() => canMove([1, 2])).toThrow(RangeError);
  });
});

describe("a slide as a move", () => {
  it("records the direction and scores the tiles the merge created", () => {
    const run = createRun("1");
    // The opening board's two shade-1 tiles sit side by side, so sliding left
    // merges them into a shade-2 tile worth four points.
    expect(slideGain(run.board, LEFT)).toBe(4);

    const next = slide(run, LEFT);

    expect(next.moves).toEqual([LEFT]);
    expect(next.score).toBe(4);
    // Two tiles became one, and the slide dealt one: still two tiles, and the
    // dealt tile is worth nothing until it merges.
    expect(next.board.filter((shade) => shade !== 0)).toHaveLength(2);
  });

  it("does not record a direction that changes nothing", () => {
    // The opening board is two tiles on the last row: sliding down is a no-op.
    const run = createRun("1");
    expect(canSlide(run, DOWN)).toBe(false);
    expect(slide(run, DOWN)).toBe(run);
    expect(run.moves).toHaveLength(0);
  });

  it("ignores a slide once the run has ended", () => {
    const run = { ...LOCKED_RUN };
    expect(canSlide(run, LEFT)).toBe(false);
    for (const direction of COLOR_MERGE_DIRECTIONS) {
      expect(slide(run, direction)).toBe(run);
    }
  });

  it("ignores a direction that is not one of the four", () => {
    const run = createRun("1");
    expect(isDirection(4)).toBe(false);
    expect(isDirection(-1)).toBe(false);
    expect(slide(run, 4 as ColorMergeDirection)).toBe(run);
  });

  it("tiles only ever double, never shrink", () => {
    let run = createRun("3");
    let previous = bestShade(run.board);
    while (run.outcome === "playing") {
      const direction = COLOR_MERGE_DIRECTIONS.find((candidate) => canSlide(run, candidate));
      run = slide(run, direction as ColorMergeDirection);
      const shade = bestShade(run.board);
      expect(shade).toBeGreaterThanOrEqual(previous);
      previous = shade;
    }
  });
});

describe("the end of a run", () => {
  it("plays straight past the retired forty-eight-slide deck", () => {
    expect(LONG_RUN.outcome).toBe("over");
    expect(LONG_RUN.endReason).toBe("locked");
    expect(LONG_RUN.moves.length).toBeGreaterThan(COLOR_MERGE_SLIDES);
    expect(LONG_RUN.moves).toHaveLength(64);
    expect(LONG_RUN.score).toBe(468);
    expect(LONG_RUN.board).toEqual([2, 3, 1, 2, 1, 4, 3, 1, 2, 1, 4, 3, 6, 4, 2, 1]);
    expect(canMove(LONG_RUN.board)).toBe(false);
  });

  it("never ends at the old deck, only on the board's own lock", () => {
    // The board is still live the slide before the sixty-fourth, and there is no
    // slide number at which the rules end a run by fiat.
    let run = createRun("1");
    while (run.moves.length < COLOR_MERGE_SLIDES) {
      run = slide(
        run,
        ORDER.find((c) => canSlide(run, c))!,
      );
    }
    expect(run.outcome).toBe("playing");
    expect(run.endReason).toBeNull();
    expect(run.moves).toHaveLength(COLOR_MERGE_SLIDES);
  });

  it("ends a second board on its own lock, at fifty-two slides", () => {
    expect(LOCKED_RUN.outcome).toBe("over");
    expect(LOCKED_RUN.endReason).toBe("locked");
    expect(LOCKED_RUN.moves).toHaveLength(52);
    expect(LOCKED_RUN.score).toBe(292);
    expect(LOCKED_RUN.board).toEqual([2, 3, 4, 2, 4, 1, 2, 3, 2, 3, 5, 2, 1, 2, 1, 4]);
    expect(canMove(LOCKED_RUN.board)).toBe(false);
  });

  it("knows a full board with no equal neighbours is locked", () => {
    expect(canMove([1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, 1])).toBe(false);
  });

  it("knows an empty cell or a matching pair is a move", () => {
    expect(canMove([1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, 0])).toBe(true);
    expect(canMove([1, 1, 2, 3, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1])).toBe(true);
  });

  it("stops at the submission bound, without dealing a tile it cannot use", () => {
    // A synthetic run with the bound one slide away: the last slide is replayed
    // and ends the run as `limit`, which is a request ceiling rather than a level.
    const nearly: ColorMergeRun = {
      ...createRun("1"),
      moves: Array.from({ length: COLOR_MERGE_MAX_SLIDES - 1 }, (): ColorMergeDirection => LEFT),
    };
    const before = nearly.board;
    const final = slide(nearly, LEFT);

    expect(final.endReason).toBe("limit");
    expect(final.outcome).toBe("over");
    expect(final.moves).toHaveLength(COLOR_MERGE_MAX_SLIDES);
    expect(final.board).toEqual(slideBoard(before, LEFT));
  });

  it("offers no slide after the bound", () => {
    const spent: ColorMergeRun = {
      ...createRun("1"),
      moves: Array.from({ length: COLOR_MERGE_MAX_SLIDES }, (): ColorMergeDirection => LEFT),
    };
    for (const direction of COLOR_MERGE_DIRECTIONS) {
      expect(canSlide(spent, direction)).toBe(false);
    }
  });
});

describe("what a run submits", () => {
  it("submits the move list, the rules version and the score it computed", () => {
    expect(submission(LONG_RUN)).toEqual({
      rulesVersion: COLOR_MERGE_RULES_VERSION,
      actions: LONG_RUN.moves,
      score: 468,
    });
  });

  it("reports progress from the moves played, the best tile and the ramp", () => {
    expect(progress(LONG_RUN)).toEqual({
      slides: 64,
      best: 64,
      promotionPercent: spawnPromotionPercent(67),
      promotedValue: tileValue(spawnPromotedShade(67)),
    });
    expect(progress(LONG_RUN).promotionPercent).toBe(23);
    expect(progress(LONG_RUN).promotedValue).toBe(4);
  });

  it("reads a shade as the number on its face", () => {
    expect(tileValue(1)).toBe(2);
    expect(tileValue(2)).toBe(4);
    expect(tileValue(5)).toBe(32);
    expect(bestShade([0, 3, 1])).toBe(3);
    expect(bestShade([0, 0])).toBe(0);
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
