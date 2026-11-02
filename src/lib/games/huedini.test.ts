import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  apply,
  board,
  budgetMs,
  createRun,
  decode,
  encodeMove,
  finish,
  HUEDINI_RESTART,
  HUEDINI_RULES_VERSION,
  HUEDINI_UNDO,
  move,
  replay,
  restart,
  slide,
  solve,
  submission,
  tierIndex,
  undo,
  type HuediniBoard,
  type HuediniRun,
} from "@/lib/games/huedini";
import { HUEDINI_BANK, HUEDINI_PER_TIER } from "@/lib/games/huedini-bank";

/** A board as the verifier's `huedini_board` returns it, flat. */
function flat(b: HuediniBoard): number[] {
  return [
    b.side,
    b.walls.length,
    ...b.walls,
    b.gates.length,
    ...b.gates.flatMap((g) => [g.edge, g.start, g.colour]),
    b.blocks.length,
    ...b.blocks.flatMap((k) => [k.r, k.c, k.h, k.w, k.colour]),
  ];
}

/** A live run on a hand-made board. */
function on(code: string): HuediniRun {
  const b = decode(code);
  return { ...createRun(1), board: b, dealt: b.blocks.length };
}

describe("the Huedini bank", () => {
  it("holds four tiers of forty boards, each a valid encoding", () => {
    expect(HUEDINI_BANK).toHaveLength(4 * HUEDINI_PER_TIER);
    for (const code of HUEDINI_BANK) {
      const b = decode(code);
      expect([5, 6, 7]).toContain(b.side);
      expect(b.blocks.length).toBeGreaterThanOrEqual(3);
      // Every block has a gate of its colour.
      for (const block of b.blocks) {
        expect(b.gates.some((gate) => gate.colour === block.colour)).toBe(true);
      }
    }
  });

  // The generator wrote each board's shortest solution next to it; the game's
  // own rules must find the same length, so the two copies of the rules agree.
  it("can clear every board, in exactly the moves the generator found", () => {
    const source = readFileSync(resolve(__dirname, "huedini-bank.ts"), "utf8");
    const lengths = [...source.matchAll(/^ {2}"[^"]+", \/\/ (\d+) moves$/gm)].map((m) =>
      Number(m[1]),
    );
    expect(lengths).toHaveLength(HUEDINI_BANK.length);
    HUEDINI_BANK.forEach((code, index) => {
      expect(solve(decode(code))?.length, code).toBe(lengths[index]);
    });
  }, 60_000);
});

describe("a board", () => {
  it("comes from the level's tier, with its colours relabelled", () => {
    expect([1, 2, 3, 5, 6, 9, 10, 40].map(tierIndex)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    for (let level = 1; level <= 12; level += 1) {
      const dealt = board("12345", level);
      const tier = HUEDINI_BANK.slice(
        tierIndex(level) * HUEDINI_PER_TIER,
        (tierIndex(level) + 1) * HUEDINI_PER_TIER,
      ).map(decode);
      // Same layout as some entry of the tier: positions and sizes match.
      const shape = (b: HuediniBoard) =>
        JSON.stringify([b.side, b.walls, b.blocks.map((k) => [k.r, k.c, k.h, k.w])]);
      expect(tier.map(shape)).toContain(shape(dealt));
    }
  });

  it("is a function of the seed and the level", () => {
    expect(flat(board("12345", 1))).toEqual(flat(board(12345, 1)));
    expect(flat(board("12345", 3))).not.toEqual(flat(board("54321", 3)));
  });

  // The verifier must deal exactly these: they are checked against
  // `public.huedini_board` when the migration is tested.
  it("deals the pinned boards", () => {
    expect(flat(board("12345", 1)).join(",")).toMatchInlineSnapshot(
      `"5,1,12,3,0,0,3,0,3,5,1,3,4,3,1,1,1,2,5,2,1,2,1,3,3,3,1,1,4"`,
    );
    expect(flat(board("987654321", 4)).join(",")).toMatchInlineSnapshot(
      `"6,1,14,4,0,0,6,1,0,2,2,0,3,3,0,4,5,0,3,1,1,6,1,0,1,2,2,1,4,2,1,2,3,3,1,1,3,3,4,1,1,4"`,
    );
    expect(flat(board("-7", 11)).join(",")).toMatchInlineSnapshot(
      `"7,3,11,37,40,5,0,3,2,1,3,5,2,1,1,2,5,3,3,0,4,7,0,3,1,2,2,1,1,2,2,5,3,5,1,1,2,4,1,1,1,4,4,4,2,1,3,6,1,1,2,1,6,4,1,2,3"`,
    );
  });
});

describe("a slide", () => {
  // 5×5. a: 1×2 at row 0, columns 1–2; b: 1×1 at row 2, column 0; a wall at row 2,
  // column 3. Gates: colour 1 on the top edge at columns 1–2; colour 2 on the right
  // edge at rows 2–3.
  const b = decode("5|.aa.......b..#...........|12|011122");

  it("decodes the hand-made board", () => {
    expect(b.blocks).toEqual([
      { id: 0, r: 0, c: 1, h: 1, w: 2, colour: 1 },
      { id: 1, r: 2, c: 0, h: 1, w: 1, colour: 2 },
    ]);
    expect(b.walls).toEqual([13]);
  });

  it("goes until a wall stops it", () => {
    expect(slide(b, b.blocks[1]!, 1)).toEqual({ kind: "stop", r: 2, c: 2, distance: 2 });
  });

  it("stops at the edge when no gate of its colour covers it", () => {
    expect(slide(b, b.blocks[1]!, 2)).toEqual({ kind: "stop", r: 4, c: 0, distance: 2 });
    expect(slide(b, b.blocks[0]!, 2)).toEqual({ kind: "stop", r: 4, c: 1, distance: 4 });
  });

  it("leaves through a gate of its colour that covers its whole width", () => {
    // The 1×2 block sits under its two-cell gate already.
    expect(slide(b, b.blocks[0]!, 0)).toMatchObject({ kind: "exit", distance: 0 });
  });

  it("does not move when it is already against something", () => {
    expect(slide(b, b.blocks[1]!, 3)).toBeNull();
  });

  it("stops against another block", () => {
    // b sits right under a's right half.
    const stacked = decode("5|.aa....b.................|12|011122");
    expect(slide(stacked, stacked.blocks[1]!, 0)).toBeNull();
    expect(slide(stacked, stacked.blocks[0]!, 2)).toBeNull();
    expect(slide(stacked, stacked.blocks[1]!, 2)).toEqual({
      kind: "stop",
      r: 4,
      c: 2,
      distance: 3,
    });
  });
});

describe("a run", () => {
  it("starts on board one with the pinned rules version and the opening clock", () => {
    const run = createRun("12345");
    expect(run.rulesVersion).toBe(HUEDINI_RULES_VERSION);
    expect(HUEDINI_RULES_VERSION).toBe("huedini@1");
    expect(run.level).toBe(1);
    expect(run.dealt).toBe(run.board.blocks.length);
    expect(budgetMs(0)).toBe(75_000);
    // Board 1 cleared adds board 2's 30 s at 120%; board 2 adds board 3's 40 s at 110%.
    expect(budgetMs(1)).toBe(75_000 + 36_000);
    expect(budgetMs(2)).toBe(75_000 + 36_000 + 44_000);
  });

  it("moves a block, undoes it and restarts the board, as actions", () => {
    const run = on("5|.aa.......b..#...........|12|011122");
    const [, b] = run.board.blocks;
    const slid = move(run, b!, 1);
    expect(slid.board.blocks[1]).toMatchObject({ r: 2, c: 2 });
    expect(slid.actions).toEqual([encodeMove(run.board, b!, 1)]);
    expect(slid.moves).toBe(1);

    const back = undo(slid);
    expect(back.board).toEqual(run.board);
    expect(back.moves).toBe(0);
    expect(undo(back)).toBe(back);

    const again = restart(move(back, back.board.blocks[1]!, 2));
    expect(again.actions.slice(-2)).toEqual([encodeMove(run.board, b!, 2), HUEDINI_RESTART]);
    expect(again.moves).toBe(0);
    expect(back.actions.at(-1)).toBe(HUEDINI_UNDO);
  });

  it("ignores a move that cannot happen", () => {
    const run = on("5|.aa.......b..#...........|12|011122");
    expect(move(run, run.board.blocks[1]!, 3)).toBe(run);
    expect(apply(run, 999)).toBe(run);
  });

  it("clears a board for a unit a block and deals the next", () => {
    const run = createRun("12345");
    let played = run;
    for (const [id, dir] of solve(run.board)!) {
      played = move(
        played,
        played.board.blocks.find((k) => k.id === id)!,
        dir,
      );
    }
    expect(played.levelsCleared).toBe(1);
    expect(played.level).toBe(2);
    expect(played.score).toBe(run.dealt);
    expect(played.exits).toBe(run.dealt);
    expect(flat(played.board)).toEqual(flat(board("12345", 2)));
  });

  it("replays to the same state it was played to", () => {
    let run = createRun("777");
    for (let round = 0; round < 3; round += 1) {
      const path = solve(run.board)!;
      // A detour first: a move, then its undo.
      const block = run.board.blocks.find((k) =>
        [0, 1, 2, 3].some((d) => slide(run.board, k, d as 0)),
      )!;
      const dir = ([0, 1, 2, 3] as const).find((d) => slide(run.board, block, d))!;
      run = undo(move(run, block, dir));
      for (const [id, d] of path)
        run = move(
          run,
          run.board.blocks.find((k) => k.id === id)!,
          d,
        );
    }
    const again = replay("777", run.actions);
    expect(again.score).toBe(run.score);
    expect(again.level).toBe(run.level);
    expect(flat(again.board)).toEqual(flat(run.board));
  });

  it("can be ended at any time, keeping its score", () => {
    const run = finish(createRun("12345"), "stopped");
    expect(run.outcome).toBe("over");
    expect(run.ending).toBe("stopped");
    expect(submission(run)).toEqual({ rulesVersion: "huedini@1", actions: [], score: 0 });
  });
});
