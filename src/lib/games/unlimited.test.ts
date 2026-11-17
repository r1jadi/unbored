import { afterEach, describe, expect, it, vi } from "vitest";

import { BALLPARK_PRODUCTS } from "@/lib/games/ballpark-bank";
import { productIndexForDay } from "@/lib/games/ballpark";
import { CROSSWORD_MIDIS, CROSSWORD_MINIS } from "@/lib/games/crossword-bank";
import { gridForDay } from "@/lib/games/crossword";
import { FOURSORT_PUZZLES } from "@/lib/games/foursort-bank";
import { puzzleIndexForDay as foursortIndex } from "@/lib/games/foursort";
import { GJEJE_ANSWERS, GUESSWORK_ANSWERS } from "@/lib/games/guesswork-bank";
import { answerForDay } from "@/lib/games/guesswork";
import { offlineResultNote, practiceLabel } from "@/lib/games/offline";
import { completeRun, startSession } from "@/lib/games/sessions";
import { buildCourse } from "@/lib/games/tee-time";
import {
  UNLIMITED_RECENT,
  hasUnlimited,
  recentKey,
  unlimitedSeed,
  type UnlimitedOptions,
} from "@/lib/games/unlimited";

/**
 * Unlimited in the daily games: a round is practice on a board other than today's,
 * dealt on the device, never sent to the server, and different from the rounds
 * the player has just played.
 */

const TODAY = 20_774;

/** A deterministic `Math.random`: a 32-bit LCG. */
function lcg(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

/** An in-memory `localStorage`. */
function memory(): NonNullable<UnlimitedOptions["storage"]> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

/** Every rules version with an Unlimited, and which board a day deals. */
const BANKS: { rulesVersion: string; size: number; board: (day: number) => string }[] = [
  {
    rulesVersion: "crossword@1",
    size: CROSSWORD_MINIS.length + CROSSWORD_MIDIS.length,
    board: (day) => gridForDay(day, CROSSWORD_MINIS, CROSSWORD_MIDIS),
  },
  {
    rulesVersion: "guesswork@1",
    size: GUESSWORK_ANSWERS.length,
    board: (day) => answerForDay(day, GUESSWORK_ANSWERS),
  },
  {
    rulesVersion: "gjeje@1",
    size: GJEJE_ANSWERS.length,
    board: (day) => answerForDay(day, GJEJE_ANSWERS),
  },
  {
    rulesVersion: "ballpark@1",
    size: BALLPARK_PRODUCTS.length,
    board: (day) => String(productIndexForDay(day)),
  },
  {
    rulesVersion: "foursort@1",
    size: FOURSORT_PUZZLES.length,
    board: (day) => String(foursortIndex(day)),
  },
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("which games have Unlimited", () => {
  it("covers every day-seeded game but Ton Up", () => {
    for (const rules of [
      "crossword@1",
      "fjalekryqi@1",
      "guesswork@1",
      "gjeje@1",
      "ballpark@1",
      "only-once@1",
      "tee-time@1",
      "foursort@1",
      "pixelock@1",
      "then-and-now@1",
      "honeycomb@1",
      "seven-second@1",
    ]) {
      expect(hasUnlimited(rules), rules).toBe(true);
    }
    expect(hasUnlimited("ton-up@1")).toBe(false);
    expect(hasUnlimited("stack-10@3")).toBe(false);
  });

  it("deals no seed for a game without one", async () => {
    expect(await unlimitedSeed("ton-up@1", { today: TODAY, storage: null })).toBeNull();
  });
});

describe("an Unlimited round's board", () => {
  it.each(BANKS)(
    "$rulesVersion never deals a live day's board, nor one of the recent rounds",
    async ({ rulesVersion, size, board }) => {
      const storage = memory();
      const random = lcg(7);
      const live = new Set([TODAY - 1, TODAY, TODAY + 1].map(board));
      const rounds = Math.min(size - live.size - 1, 60);
      const seen: string[] = [];
      for (let round = 0; round < rounds; round += 1) {
        const seed = await unlimitedSeed(rulesVersion, { today: TODAY, random, storage });
        const day = Number(seed);
        expect(Number.isInteger(day) && day >= 1 && day <= TODAY - 2).toBe(true);
        const dealt = board(day);
        expect(live.has(dealt)).toBe(false);
        expect(seen).not.toContain(dealt);
        seen.push(dealt);
      }
      // The memory is the boards themselves, under the game's rules version.
      expect(JSON.parse(storage.data.get(recentKey(rulesVersion))!)).toEqual(seen);
    },
  );

  it("comes round again once a small bank is used up, still missing the live days", async () => {
    const storage = memory();
    const random = lcg(3);
    const board = (day: number) => String(foursortIndex(day));
    const live = new Set([TODAY - 1, TODAY, TODAY + 1].map(board));
    const counts = new Map<string, number>();
    for (let round = 0; round < FOURSORT_PUZZLES.length * 3; round += 1) {
      const dealt = board(
        Number(await unlimitedSeed("foursort@1", { today: TODAY, random, storage })),
      );
      expect(live.has(dealt)).toBe(false);
      counts.set(dealt, (counts.get(dealt) ?? 0) + 1);
    }
    // Every other board is dealt, and evenly: none twice before the rest once.
    expect(counts.size).toBe(FOURSORT_PUZZLES.length - live.size);
    expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(1);
  });

  it("remembers at most a hundred rounds", async () => {
    const storage = memory();
    const random = lcg(11);
    for (let round = 0; round < UNLIMITED_RECENT + 20; round += 1) {
      await unlimitedSeed("guesswork@1", { today: TODAY, random, storage });
    }
    expect(JSON.parse(storage.data.get(recentKey("guesswork@1"))!)).toHaveLength(UNLIMITED_RECENT);
  });

  it("still deals a round when storage is missing or broken", async () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    for (const storage of [null, broken]) {
      const seed = await unlimitedSeed("only-once@1", { today: TODAY, storage });
      expect(Number(seed)).toBeGreaterThan(0);
    }
  });

  it("builds Tee Time a course no live day plays", async () => {
    const random = lcg(5);
    const live = [TODAY - 1, TODAY, TODAY + 1].map((day) => JSON.stringify(buildCourse(day)));
    for (let round = 0; round < 20; round += 1) {
      const day = Number(
        await unlimitedSeed("tee-time@1", { today: TODAY, random, storage: null }),
      );
      expect(live).not.toContain(JSON.stringify(buildCourse(day)));
    }
  });

  it("deals 7 Second a deck from a seed no day uses", async () => {
    const seed = BigInt((await unlimitedSeed("seven-second@1", { random: () => 0.5 }))!);
    expect(seed > 0n && seed < 2n ** 31n).toBe(true);
    // A day's seed is the day times 2654435761 plus seven: far above any round's.
    expect((seed - 7n) % 2_654_435_761n === 0n && seed > 7n).toBe(false);
  });
});

describe("an Unlimited session", () => {
  it("is practice on the device: never sent, never ranked, labelled Unlimited", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const session = await startSession("guesswork", {
      rulesVersion: "guesswork@1",
      unlimited: true,
    });
    expect(session).toMatchObject({
      gameSlug: "guesswork",
      rulesVersion: "guesswork@1",
      ranked: false,
      offline: true,
      unlimited: true,
    });
    expect(practiceLabel(session)).toBe("Unlimited · practice");

    const result = await completeRun(
      session.id,
      { rulesVersion: session.rulesVersion, actions: [1], score: 60 },
      5_000,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ranked: false, offline: true, unlimited: true, score: 60 });
    expect(offlineResultNote(result)).toMatch(/^Unlimited is practice/);
  });

  it("falls back to an ordinary start for a game without Unlimited", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const session = await startSession("ton-up", { rulesVersion: "ton-up@1", unlimited: true });
    expect(session.unlimited).toBeUndefined();
    expect(session.offline).toBe(true);
  });
});
