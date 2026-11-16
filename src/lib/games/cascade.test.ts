import { describe, expect, it } from "vitest";

import {
  BOMB_FROM_LEVEL,
  BOMB_POINTS,
  bombEvery,
  bombTimer,
  BURST,
  CASCADE_LEGACY_RULES_VERSION,
  budgetMs,
  CASCADE_RULES_VERSION,
  CASCADE_SIZE,
  colourOf,
  createRun,
  DOWN,
  encodeSwap,
  findSwap,
  finish,
  firstBoard,
  goalFor,
  isSwapLegal,
  replay,
  RIGHT,
  ROW_LINE,
  submission,
  swap,
  swapBetween,
  swapCells,
  type CascadeBoard,
  type CascadeRun,
} from "@/lib/games/cascade";

const rows = (board: CascadeBoard) =>
  Array.from({ length: 8 }, (_, r) => board.slice(r * 8, r * 8 + 8).join("")).join(" ");

/** Whether a board has a line of three anywhere. */
function hasLine(board: CascadeBoard): boolean {
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const colour = colourOf(board[r * 8 + c]);
      if (
        c <= 5 &&
        colourOf(board[r * 8 + c + 1]) === colour &&
        colourOf(board[r * 8 + c + 2]) === colour
      )
        return true;
      if (
        r <= 5 &&
        colourOf(board[(r + 1) * 8 + c]) === colour &&
        colourOf(board[(r + 2) * 8 + c]) === colour
      )
        return true;
    }
  }
  return false;
}

/** A board with no line on it: colour 1 + (column + 2 × row) mod 6. */
const plain = (): number[] =>
  Array.from({ length: 64 }, (_, cell) => 1 + (((cell % 8) + 2 * Math.floor(cell / 8)) % 6));

const onBoard = (board: number[]): CascadeRun => ({ ...createRun("1"), board });

/** Plays a seed's run by always making the first legal swap. */
function autoplay(seed: string, swaps: number, rules = CASCADE_LEGACY_RULES_VERSION): CascadeRun {
  let run = createRun(seed, rules);
  for (let i = 0; i < swaps && run.outcome === "playing"; i += 1) {
    run = swap(run, findSwap(run.board)!);
  }
  return run;
}

describe("the deal", () => {
  it("deals seed 1's first board", () => {
    const { board, rng } = firstBoard("1");
    expect(rows(board)).toBe(
      "51551442 51552235 36242232 52345624 45322634 53145366 12113251 26434112",
    );
    expect(rng).toBe(3036490364);
  });

  it("treats seed 0 like any other seed, through its fallback state", () => {
    expect(rows(firstBoard("0").board)).toBe(
      "34644561 23325461 64322322 14513656 16526324 54134254 11642121 62665426",
    );
  });

  it("never deals a line, and always deals a swap", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const { board } = firstBoard(String(seed));
      expect(hasLine(board)).toBe(false);
      expect(findSwap(board)).not.toBeNull();
    }
  });

  it("is the same for the same seed, and pins the rules", () => {
    expect(createRun("42").board).toEqual(createRun("42").board);
    expect(createRun("42").rulesVersion).toBe(CASCADE_RULES_VERSION);
    expect(createRun("42").board).not.toEqual(createRun("43").board);
  });
});

describe("a swap", () => {
  it("names two neighbours, and nothing off the board", () => {
    expect(swapCells(encodeSwap(0, RIGHT))).toEqual([0, 1]);
    expect(swapCells(encodeSwap(0, DOWN))).toEqual([0, 8]);
    expect(swapCells(encodeSwap(7, RIGHT))).toBeNull();
    expect(swapCells(encodeSwap(63, DOWN))).toBeNull();
    expect(swapCells(128)).toBeNull();
    expect(swapBetween(9, 1)).toBe(encodeSwap(1, DOWN));
    expect(swapBetween(7, 8)).toBeNull();
  });

  it("only counts when it lines up three", () => {
    const run = onBoard(plain());
    expect(isSwapLegal(run.board, encodeSwap(0, RIGHT))).toBe(false);
    expect(swap(run, encodeSwap(0, RIGHT))).toBe(run);
  });

  it("clears a line of three, scores it, and refills from the generator", () => {
    // Row 0 is 1 2 3 4 …; a 1 below cell 2 swapped up makes 1 1 1.
    const board = plain();
    board[1] = 1;
    board[10] = 1;
    const before = onBoard(board);
    const after = swap(before, encodeSwap(2, DOWN));
    const first = after.lastMove!.waves[0];
    expect(first.cleared).toEqual([0, 1, 2]);
    expect(first.created).toEqual([]);
    expect(first.points).toBe(3);
    expect(first.fall.slice(0, 3)).toEqual([1, 1, 1]);
    expect(after.board).not.toContain(0);
    expect(after.actions).toEqual([encodeSwap(2, DOWN)]);
    expect(after.score).toBe(after.lastMove!.waves.reduce((sum, w) => sum + w.points, 0));
  });

  it("leaves a row line where four line up across, in the swapped cell", () => {
    const board = plain();
    board[0] = 6;
    board[1] = 6;
    board[3] = 6;
    board[10] = 6;
    const first = swap(onBoard(board), encodeSwap(2, DOWN)).lastMove!.waves[0];
    expect(first.cleared).toEqual([0, 1, 2, 3]);
    expect(first.created).toEqual([[2, 6 + 8 * ROW_LINE]]);
  });

  it("leaves a burst where five line up", () => {
    const board = plain();
    [0, 1, 3, 4, 10].forEach((cell) => (board[cell] = 5));
    const first = swap(onBoard(board), encodeSwap(2, DOWN)).lastMove!.waves[0];
    expect(first.cleared).toEqual([0, 1, 2, 3, 4]);
    expect(first.created).toEqual([[2, 5 + 8 * BURST]]);
  });

  it("leaves a burst where a row and a column cross", () => {
    // An L: cells 0, 1, 2 across and 2, 10, 18 down, completed by swapping a
    // 6 into cell 2 from cell 3.
    const board = plain();
    [0, 1, 3, 10, 18].forEach((cell) => (board[cell] = 6));
    const first = swap(onBoard(board), encodeSwap(2, RIGHT)).lastMove!.waves[0];
    expect(first.cleared).toEqual([0, 1, 2, 10, 18]);
    expect(first.created).toEqual([[2, 6 + 8 * BURST]]);
  });

  it("fires a line tile caught in a clear, taking its whole row", () => {
    // A row line on cell 16 (row 2), cleared by a line of three down column 0.
    const board = plain();
    board[8] = 2;
    board[16] = 2 + 8 * ROW_LINE;
    board[1] = 2;
    board[0] = 4;
    // Column 0 is now 4 2 2…; swap cell 0 with cell 1 to make 2 2 2 down it.
    const first = swap(onBoard(board), encodeSwap(0, RIGHT)).lastMove!.waves[0];
    for (let c = 0; c < CASCADE_SIZE; c += 1) expect(first.cleared).toContain(16 + c);
    expect(first.cleared).toEqual(expect.arrayContaining([0, 8]));
  });
});

describe("the run", () => {
  it("asks for more tiles every level, and winds the clock back", () => {
    expect([1, 2, 3].map(goalFor)).toEqual([30, 40, 50]);
    expect(budgetMs(0)).toBe(60_000);
    expect(budgetMs(1)).toBe(84_000);
    expect(budgetMs(2)).toBe(106_000);
    expect(budgetMs(8)).toBe(
      60_000 + 24_000 + 22_000 + 20_000 + 18_000 + 16_000 + 14_000 + 12_000 + 10_000,
    );
  });

  it("plays seed 1's first-swap line to the same score every time", () => {
    const run = autoplay("1", 40);
    expect(run.actions).toHaveLength(40);
    expect(run.score).toBe(SEED_1_FORTY.score);
    expect(run.level).toBe(SEED_1_FORTY.level);
    expect(run.cleared).toBe(SEED_1_FORTY.cleared);
    expect(rows(run.board)).toBe(SEED_1_FORTY.board);
  });

  it("carries the rest of a goal over into the next level", () => {
    const run = autoplay("7", 60);
    let goals = 0;
    for (let level = 1; level < run.level; level += 1) goals += goalFor(level);
    expect(run.cleared).toBe(goals + run.progress);
    expect(run.levelsCleared).toBe(run.level - 1);
  });

  it("replays a submission to the same run", () => {
    const played = autoplay("99", 25);
    let replayed = createRun("99", CASCADE_LEGACY_RULES_VERSION);
    for (const action of submission(played).actions) replayed = swap(replayed, action);
    expect(replayed.score).toBe(played.score);
    expect(replayed.board).toEqual(played.board);
  });

  it("stops taking swaps once it is over", () => {
    const run = finish(createRun("1"), "time");
    expect(run.outcome).toBe("over");
    expect(swap(run, findSwap(run.board)!)).toBe(run);
  });
});

/** Seed 1 after forty first-legal swaps: the line the verifier must agree with. */
const SEED_1_FORTY = {
  score: 177,
  level: 4,
  cleared: 150,
  board: "41631262 43151515 15546513 26234642 42556224 53112334 12113251 26434112",
};

describe("bombs (cascade@2)", () => {
  const timersOf = (cells: Record<number, number>): number[] =>
    Array.from({ length: 64 }, (_, cell) => cells[cell] ?? 0);

  it("are the new rules, and the old ones never have any", () => {
    expect(CASCADE_RULES_VERSION).toBe("cascade@2");
    const legacy = autoplay("1", 40);
    expect(legacy.rulesVersion).toBe("cascade@1");
    expect(legacy.timers.every((timer) => timer === 0)).toBe(true);
  });

  it("don't drop on level one", () => {
    let run = createRun("1");
    while (run.level < BOMB_FROM_LEVEL) {
      expect(run.timers.every((timer) => timer === 0)).toBe(true);
      run = swap(run, findSwap(run.board)!);
    }
  });

  it("drop onto the top row every few swaps from level two, with a countdown", () => {
    let run = createRun("1");
    while (run.timers.every((timer) => timer === 0)) run = swap(run, findSwap(run.board)!);
    const cell = run.timers.findIndex((timer) => timer > 0);
    expect(cell).toBeLessThan(8);
    expect(run.lastMove!.dropped).toBe(cell);
    expect(run.timers[cell]).toBe(bombTimer(run.level));
    expect(run.sinceBomb).toBe(0);
  });

  it("count down once a swap, get harder every level, and stay within limits", () => {
    expect([2, 3, 4, 5, 9].map(bombEvery)).toEqual([6, 5, 4, 3, 3]);
    expect([2, 3, 6, 9].map(bombTimer)).toEqual([9, 8, 5, 5]);
    // A bomb far from any line ticks down by one, and nothing else changes it.
    const board = plain();
    board[1] = 1;
    board[10] = 1;
    const run = { ...createRun("1"), board, timers: timersOf({ 63: 4 }) };
    const after = swap(run, encodeSwap(2, DOWN));
    expect(after.timers[63]).toBe(3);
  });

  it("are defused by a match, for a bonus", () => {
    // Row 0 is 1 2 3 …; a 1 below cell 2 swapped up makes 1 1 1 — through the bomb on cell 0.
    const board = plain();
    board[1] = 1;
    board[10] = 1;
    const run = { ...createRun("1"), board, timers: timersOf({ 0: 3 }) };
    const after = swap(run, encodeSwap(2, DOWN));
    const first = after.lastMove!.waves[0];
    expect(first.defused).toBe(1);
    expect(first.points).toBe(3 + BOMB_POINTS);
    expect(after.defused).toBe(1);
    expect(after.timers[0]).toBe(0);
    expect(after.outcome).toBe("playing");
  });

  it("fall with their tile", () => {
    // Row 1 is 3 4 5 6 …; a 3 at cell 9 and one below cell 10, swapped up, make
    // 3 3 3 across cells 8–10. The bomb on cell 0, above the line, falls to cell 8.
    const board = plain();
    board[9] = 3;
    board[18] = 3;
    const run = { ...createRun("1"), board, timers: timersOf({ 0: 5 }) };
    const after = swap(run, encodeSwap(10, DOWN));
    const first = after.lastMove!.waves[0];
    expect(first.cleared).toEqual([8, 9, 10]);
    expect(first.timers[0]).toBe(0);
    expect(first.timers[8]).toBe(5);
    // Then the swap's countdown: one less, wherever it fell to.
    expect(after.timers.indexOf(4)).toBeGreaterThanOrEqual(8);
  });

  it("end the run when a countdown reaches zero", () => {
    const board = plain();
    board[1] = 1;
    board[10] = 1;
    const run = { ...createRun("1"), board, timers: timersOf({ 63: 1 }) };
    const after = swap(run, encodeSwap(2, DOWN));
    expect(after.outcome).toBe("over");
    expect(after.ending).toBe("bomb");
    expect(after.lastMove!.exploded).toEqual([63]);
    // The swap that set it off still scored, and nothing more is taken.
    expect(after.score).toBeGreaterThan(0);
    expect(swap(after, findSwap(after.board)!)).toBe(after);
  });

  it("replays a submission to the same run, bombs and all", () => {
    const played = autoplay("42", 18, CASCADE_RULES_VERSION);
    const replayed = replay("42", submission(played).actions);
    expect(replayed.score).toBe(played.score);
    expect(replayed.board).toEqual(played.board);
    expect(replayed.timers).toEqual(played.timers);
  });

  it("plays seed 1's first-swap line until a bomb ends it", () => {
    const run = autoplay("1", 100, CASCADE_RULES_VERSION);
    expect(run.ending).toBe("bomb");
    expect(run.actions).toHaveLength(SEED_1_BOMBS.swaps);
    expect(run.score).toBe(SEED_1_BOMBS.score);
    expect(run.defused).toBe(SEED_1_BOMBS.defused);
    expect(rows(run.board)).toBe(SEED_1_BOMBS.board);
  });
});

/** Seed 1 under cascade@2, first-legal swaps until a bomb goes off: the verifier's line. */
const SEED_1_BOMBS = {
  swaps: 25,
  score: 137,
  defused: 1,
  board: "32421434 11663413 61453351 43556623 43421422 25363365 33163251 46434112",
};
