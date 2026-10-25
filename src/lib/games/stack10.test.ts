import { describe, expect, it } from "vitest";

import {
  canPlace,
  createRun,
  finish,
  heavyBonus,
  place,
  pressurePercent,
  progress,
  STACK10_COLUMNS,
  STACK10_MAX_TILES,
  STACK10_RULES_VERSION,
  STACK10_TILES,
  submission,
  tileAt,
  type Stack10Run,
} from "@/lib/games/stack10";

/**
 * The engine's tests are pinned to the *database's* numbers.
 *
 * `public.complete_stack10_run` is the authority: it replays the submitted action
 * list and derives the score. Every vector below is either asserted by
 * `tests/security/rls_test.sql` for the same seed and line, or computed here from
 * the rules independently of this module. That is what makes a green suite worth
 * something — it proves agreement with the verifier, not self-consistency.
 *
 * The vectors are also written down in `docs/games/README.md`.
 */

/** Seed 1's retired deck, as `tests/security/rls_test.sql` documents it. */
const SEED_ONE_TILES = [1, 7, 9, 2, 2, 5, 4, 6, 7, 8, 3, 4, 3, 5];

/** The greedy line the SQL suite submits with seed 1: 55 points, 14 tiles, over. */
const SEED_ONE_GREEDY = [0, 0, 1, 0, 0, 0, 2, 2, 2, 3, 0, 0, 0, 0];

/** The retired perfect line for seed 1: all sixty tiles placed, 420 points. */
const SEED_ONE_PERFECT = [
  0, 0, 1, 0, 0, 0, 2, 2, 2, 3, 0, 0, 2, 0, 2, 2, 0, 0, 2, 0, 2, 2, 3, 2, 2, 2, 2, 3, 0, 1, 0, 0, 0,
  0, 0, 2, 1, 2, 1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 3, 1, 1, 2, 1, 1, 0,
];

/**
 * The retired line played straight into the ramp: seven more tiles, the last of
 * which overflows. Sixty-seven tiles, 435 points, twenty-six clears — the vector
 * that proves the former endpoint no longer ends anything.
 */
const SEED_ONE_ENDLESS = [...SEED_ONE_PERFECT, 0, 2, 3, 0, 1, 0, 1];

/** Plays a whole line and returns the finished run. */
function playLine(seed: string, line: number[]): Stack10Run {
  return line.reduce((run, column) => place(run, column), createRun(seed));
}

describe("the deck and its ramp", () => {
  it("draws seed 1's retired deck in the order the SQL suite documents", () => {
    SEED_ONE_TILES.forEach((tile, index) => {
      expect(tileAt("1", index)).toBe(tile);
    });
  });

  it("keeps the first sixty tiles as the deck that shipped", () => {
    // The retired deck's last tile, and the first tile past it.
    expect(tileAt("1", 59)).toBe(4);
    expect(tileAt("1", STACK10_TILES)).toBe(9);
    expect(pressurePercent(59)).toBe(0);
    expect(pressurePercent(60)).toBe(0);
  });

  it("shows the next tile before the player chooses, because the tile does not depend on the column", () => {
    const run = createRun("1");
    expect(run.nextTile).toBe(SEED_ONE_TILES[0]);
    // The same tile whichever column the move goes into, so a board can display it.
    expect(place(run, 0).nextTile).toBe(SEED_ONE_TILES[1]);
    expect(place(run, 3).nextTile).toBe(SEED_ONE_TILES[1]);
  });

  it("replays a seed larger than a JS safe integer exactly", () => {
    // `game_sessions.seed` is a bigint: the database's default draws from 2^63-1.
    // Rounding it to a double would draw a different deck and the verifier would
    // reject every honest run, so the engine works in BigInt. These tiles come from
    // the generator directly, not from this module.
    const seed = "9223372036854775807";
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => tileAt(seed, i))).toEqual([6, 2, 9, 4, 5, 3, 6, 1]);
    expect(createRun(seed).nextTile).toBe(6);
  });

  it("a rounded seed would have drawn a different deck, which is the bug this guards", () => {
    const exact = [0, 1, 2, 3, 4].map((i) => tileAt("9223372036854775807", i));
    const rounded = [0, 1, 2, 3, 4].map((i) => tileAt(Number("9223372036854775807"), i));
    expect(rounded).not.toEqual(exact);
  });

  it("treats a degenerate zero seed the way the verifier does", () => {
    // The verifier substitutes 0x9E3779B9 for a zero state; a seed of 0 and the seed
    // that is congruent to it must therefore play identically.
    expect([0, 1, 2, 3].map((i) => tileAt(0, i))).toEqual([5, 7, 7, 3]);
    expect([0, 1, 2, 3].map((i) => tileAt("4294967296", i))).toEqual([5, 7, 7, 3]);
  });

  it("refuses a seed that is not a whole number", () => {
    expect(() => createRun("not-a-seed")).toThrow(TypeError);
    expect(() => tileAt(1.5, 0)).toThrow(TypeError);
    expect(() => tileAt("1", -1)).toThrow(RangeError);
    expect(() => pressurePercent(-1)).toThrow(RangeError);
    expect(() => heavyBonus(1.5)).toThrow(RangeError);
  });
});

describe("the pressure ramp", () => {
  it("does not promote anything in the retired deck", () => {
    for (let placed = 0; placed < STACK10_TILES; placed += 1) {
      expect(pressurePercent(placed)).toBe(0);
    }
  });

  it("starts at tile sixty-one and rises one point every four tiles", () => {
    expect(pressurePercent(STACK10_TILES)).toBe(0);
    expect(pressurePercent(63)).toBe(0);
    expect(pressurePercent(64)).toBe(1);
    expect(pressurePercent(100)).toBe(10);
    expect(pressurePercent(200)).toBe(35);
    expect(pressurePercent(240)).toBe(45);
  });

  it("caps the chance at sixty percent rather than the difficulty", () => {
    expect(pressurePercent(300)).toBe(60);
    expect(pressurePercent(600)).toBe(60);
    expect(pressurePercent(100_000)).toBe(60);
  });

  it("raises the weight a promoted tile gains every 240 tiles, without cap", () => {
    expect(heavyBonus(0)).toBe(1);
    expect(heavyBonus(239)).toBe(1);
    expect(heavyBonus(240)).toBe(2);
    expect(heavyBonus(480)).toBe(3);
    expect(heavyBonus(1920)).toBe(9);
    expect(heavyBonus(100_000)).toBe(417);
  });

  it("draws heavier tiles as the run goes on, and never one above nine", () => {
    // These tiles are the generator's own numbers for seed 1, promotion included.
    expect([60, 64, 100, 240, 300, 480].map((i) => tileAt("1", i))).toEqual([9, 4, 4, 9, 1, 9]);
    for (const placed of [64, 100, 240, 300, 480, 1000, 4095]) {
      const tile = tileAt("1", placed);
      expect(tile).toBeGreaterThanOrEqual(1);
      expect(tile).toBeLessThanOrEqual(9);
    }
  });
});

describe("clearing is the arithmetic the verifier scores with", () => {
  it("scores the documented greedy run at 55 over 14 tiles", () => {
    const run = playLine("1", SEED_ONE_GREEDY);

    // Three clears: 1+7+2 (three tiles, 20), 4+6 (two tiles, 15) and 3+4+3 (three
    // tiles, 20), all inside the retired deck, where the tiles are unchanged.
    expect(run.clearedColumns).toBe(3);
    expect(run.score).toBe(55);
    expect(run.actions).toHaveLength(14);
    expect(run.outcome).toBe("over");
    expect(run.endReason).toBe("overflow");
    expect(run.nextTile).toBeNull();
  });

  it("adds the score at the move that cleared, not at the end", () => {
    let run = createRun("1");
    [0, 0, 1].forEach((column) => {
      run = place(run, column);
    });
    expect(run.score).toBe(0);
    expect(run.columns[0].sum).toBe(8);

    run = place(run, 0); // 8 + 2 = 10: clears a three-tile column for 20
    expect(run.score).toBe(20);
    expect(run.columns[0]).toEqual({ tiles: [], sum: 0 });
    expect(run.clearedColumns).toBe(1);
  });

  it("scores a two-tile clear at 15 and a three-tile clear at 20", () => {
    const run = playLine("1", SEED_ONE_GREEDY.slice(0, 8));
    // 20 for the three-tile clear, 15 for the two-tile one (4 + 6 in column 2).
    expect(run.score).toBe(35);
    expect(run.clearedColumns).toBe(2);
    expect(run.columns[2]).toEqual({ tiles: [], sum: 0 });
  });

  it("ends the run when a column passes ten, and keeps the score already earned", () => {
    const run = playLine("1", SEED_ONE_GREEDY);
    // The fourteenth tile is a 5 into a column already holding 7.
    expect(run.columns[0].sum).toBe(12);
    expect(run.score).toBe(55);
  });
});

describe("the run beyond the retired deck", () => {
  it("plays the old perfect line to sixty tiles without ending", () => {
    const run = playLine("1", SEED_ONE_PERFECT);

    // The retired rules called this a clear. The endless rules do not: the run is
    // still live, with a next tile waiting.
    expect(run.actions).toHaveLength(STACK10_TILES);
    expect(run.outcome).toBe("playing");
    expect(run.endReason).toBeNull();
    expect(run.nextTile).not.toBeNull();
    expect(run.score).toBe(420);
    expect(run.clearedColumns).toBe(25);
    expect(run.columns.reduce((sum, column) => sum + column.tiles.length, 0)).toBe(1);
    expect(run.columns.every((column) => column.sum <= 10)).toBe(true);
  });

  it("keeps playing past sixty, into the ramp", () => {
    const run = playLine("1", SEED_ONE_ENDLESS);

    expect(run.actions).toHaveLength(67);
    expect(run.actions.slice(0, STACK10_TILES)).toEqual(SEED_ONE_PERFECT);
    expect(run.outcome).toBe("over");
    expect(run.endReason).toBe("overflow");
    expect(run.score).toBe(435);
    expect(run.clearedColumns).toBe(26);
    expect(run.nextTile).toBeNull();
  });

  it("can end one tile past the old deck", () => {
    const run = playLine("1", [...SEED_ONE_PERFECT, 1]);

    expect(run.actions).toHaveLength(61);
    expect(run.outcome).toBe("over");
    expect(run.endReason).toBe("overflow");
    // The overflowing tile scores nothing; the sixty tiles before it scored 420.
    expect(run.score).toBe(420);
  });

  it("never produces the retired cleared outcome", () => {
    expect(createRun("1").outcome).toBe("playing");
    expect(playLine("1", SEED_ONE_PERFECT).outcome).not.toBe("cleared");
    expect(STACK10_RULES_VERSION).toBe("stack-10@2");
  });

  it("stops at the submission bound, and offers no move after it", () => {
    // A synthetic run with the bound one tile away: the last tile is placed and
    // ends the run as `limit`, which is a request ceiling rather than a level.
    const nearly: Stack10Run = {
      ...createRun("1"),
      actions: Array.from({ length: STACK10_MAX_TILES - 1 }, (): number => 0),
    };
    const final = place(nearly, 0);

    expect(final.outcome).toBe("over");
    expect(final.endReason).toBe("limit");
    expect(final.actions).toHaveLength(STACK10_MAX_TILES);
    expect(final.nextTile).toBeNull();

    const spent: Stack10Run = {
      ...createRun("1"),
      actions: Array.from({ length: STACK10_MAX_TILES }, (): number => 0),
    };
    expect(canPlace(spent, 0)).toBe(false);
    expect(place(spent, 0)).toBe(spent);
  });
});

describe("an impossible move is not a move", () => {
  it("refuses a column that does not exist, and returns the same run", () => {
    const run = createRun("1");
    expect(place(run, -1)).toBe(run);
    expect(place(run, STACK10_COLUMNS)).toBe(run);
    expect(place(run, 1.5)).toBe(run);
    expect(canPlace(run, 0)).toBe(true);
    expect(canPlace(run, STACK10_COLUMNS)).toBe(false);
  });

  it("refuses to keep playing after the run has ended", () => {
    const run = playLine("1", SEED_ONE_GREEDY);
    expect(run.outcome).toBe("over");
    expect(canPlace(run, 0)).toBe(false);
    expect(place(run, 0)).toBe(run);
    expect(run.actions).toHaveLength(14);
  });

  it("does not mutate the run it was given", () => {
    const before = createRun("1");
    const after = place(before, 0);
    expect(before.actions).toEqual([]);
    expect(before.columns[0]).toEqual({ tiles: [], sum: 0 });
    expect(before.score).toBe(0);
    expect(after.actions).toEqual([0]);
    expect(after.columns[0]).toEqual({ tiles: [1], sum: 1 });
  });
});

describe("the submission is the run", () => {
  it("sends the action list, the score and the rules version the session pinned", () => {
    const run = playLine("1", SEED_ONE_ENDLESS);
    expect(submission(run)).toEqual({
      rulesVersion: STACK10_RULES_VERSION,
      actions: SEED_ONE_ENDLESS,
      score: 435,
      tilesPlaced: 67,
      clearedColumns: 26,
    });
  });

  it("reports progress and the ramp without a total, because there is no deck", () => {
    expect(progress(createRun("1"))).toEqual({
      placed: 0,
      pressurePercent: 0,
      heavyBonus: 1,
    });
    const beyond = playLine("1", SEED_ONE_PERFECT);
    expect(progress(beyond)).toEqual({ placed: 60, pressurePercent: 0, heavyBonus: 1 });
    expect(progress({ ...beyond, actions: Array.from({ length: 300 }, () => 0) })).toEqual({
      placed: 300,
      pressurePercent: 60,
      heavyBonus: 2,
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
