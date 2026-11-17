/**
 * Unlimited: after the daily, as many more boards as the player likes, as practice.
 *
 * Deep Cut's Unlimited deals fresh questions after the day's seven. The other daily
 * games deal their board from a seed on the device, so their Unlimited is dealt
 * here, the way the archive (`archive.ts`) deals a past day: never ranked, never
 * submitted, never saved. Today's board stays the one ranked attempt.
 *
 * Each round gets a seed whose board is different from:
 *   - the live days' (yesterday, today and tomorrow, the player's own), so
 *     Unlimited never gives away today's board or spoils tomorrow's; and
 *   - the player's recent Unlimited rounds, kept in `localStorage` as a
 *     convenience: lost storage only means a board may come round sooner.
 *
 * A bank game's seed is a past day number, so its board is that day's (`d mod n`,
 * or the crossword's weekday walk), and each game's own engine says which board a
 * day is. Tee Time builds a new course from any day, and 7 Second deals a deck
 * from any seed, so neither needs a bank or a memory.
 *
 * Ton Up is left out: five categories are too few for a fresh board a round.
 */

import { localDayNumber } from "@/lib/games/crossword";

/** How a run is started: today's ranked board, or an Unlimited round of practice. */
export type PlayMode = "daily" | "unlimited";

/** Which board a seed deals, as a string, and how many boards there are. */
type Bank = {
  readonly size: number;
  readonly key: (day: number) => string;
};

/** Every board is different: no bank to remember. */
const ENDLESS: Bank = { size: Number.POSITIVE_INFINITY, key: String };

/** The daily games with an Unlimited, by rules version, and each one's boards. */
const GAMES: readonly { pattern: RegExp; bank: () => Promise<Bank> }[] = [
  {
    pattern: /^crossword@/,
    bank: () =>
      Promise.all([import("@/lib/games/crossword"), import("@/lib/games/crossword-bank")]).then(
        ([engine, bank]) => ({
          size: bank.CROSSWORD_MINIS.length + bank.CROSSWORD_MIDIS.length,
          key: (day) => engine.gridForDay(day, bank.CROSSWORD_MINIS, bank.CROSSWORD_MIDIS),
        }),
      ),
  },
  {
    pattern: /^fjalekryqi@/,
    bank: () =>
      Promise.all([import("@/lib/games/crossword"), import("@/lib/games/fjalekryqi-bank")]).then(
        ([engine, bank]) => ({
          size: bank.FJALEKRYQI_MINIS.length + bank.FJALEKRYQI_MIDIS.length,
          key: (day) => engine.gridForDay(day, bank.FJALEKRYQI_MINIS, bank.FJALEKRYQI_MIDIS),
        }),
      ),
  },
  {
    pattern: /^guesswork@/,
    bank: () =>
      Promise.all([import("@/lib/games/guesswork"), import("@/lib/games/guesswork-bank")]).then(
        ([engine, bank]) => ({
          size: bank.GUESSWORK_ANSWERS.length,
          key: (day) => engine.answerForDay(day, bank.GUESSWORK_ANSWERS),
        }),
      ),
  },
  {
    pattern: /^gjeje@/,
    bank: () =>
      Promise.all([import("@/lib/games/guesswork"), import("@/lib/games/guesswork-bank")]).then(
        ([engine, bank]) => ({
          size: bank.GJEJE_ANSWERS.length,
          key: (day) => engine.answerForDay(day, bank.GJEJE_ANSWERS),
        }),
      ),
  },
  {
    pattern: /^ballpark@/,
    bank: () =>
      Promise.all([import("@/lib/games/ballpark"), import("@/lib/games/ballpark-bank")]).then(
        ([engine, bank]) => ({
          size: bank.BALLPARK_PRODUCTS.length,
          key: (day) => String(engine.productIndexForDay(day)),
        }),
      ),
  },
  {
    pattern: /^only-once@/,
    bank: () =>
      Promise.all([import("@/lib/games/only-once"), import("@/lib/games/only-once-bank")]).then(
        ([engine, bank]) => ({
          size: bank.ONLY_ONCE_PUZZLES.length,
          key: (day) => String(engine.puzzleIndexForDay(day)),
        }),
      ),
  },
  {
    pattern: /^foursort@/,
    bank: () =>
      Promise.all([import("@/lib/games/foursort"), import("@/lib/games/foursort-bank")]).then(
        ([engine, bank]) => ({
          size: bank.FOURSORT_PUZZLES.length,
          key: (day) => String(engine.puzzleIndexForDay(day)),
        }),
      ),
  },
  {
    pattern: /^pixelock@/,
    bank: () =>
      Promise.all([import("@/lib/games/pixelock"), import("@/lib/games/pixelock-bank")]).then(
        ([engine, bank]) => ({
          size: bank.PIXELOCK_PICTURES.length,
          key: (day) => String(engine.pictureIndexForDay(day)),
        }),
      ),
  },
  {
    pattern: /^then-and-now@/,
    bank: () =>
      Promise.all([
        import("@/lib/games/then-and-now"),
        import("@/lib/games/then-and-now-bank"),
      ]).then(([engine, bank]) => ({
        size: bank.THEN_AND_NOW_PUZZLES.length,
        key: (day) => String(engine.puzzleIndexForDay(day)),
      })),
  },
  {
    pattern: /^honeycomb@/,
    bank: () =>
      Promise.all([import("@/lib/games/honeycomb"), import("@/lib/games/honeycomb-bank")]).then(
        ([engine, bank]) => ({
          size: bank.HONEYCOMB_PUZZLES.length,
          key: (day) => String(engine.puzzleIndexForDay(day)),
        }),
      ),
  },
  { pattern: /^tee-time@/, bank: () => Promise.resolve(ENDLESS) },
];

/** 7 Second's seed is hashed from the day, so any other seed is a deck no day deals. */
const SEVEN_SECOND = /^seven-second@/;

/** How many recent rounds a game remembers, at most. */
export const UNLIMITED_RECENT = 100;
/** Random draws before giving up on a board the player hasn't seen lately. */
const DRAWS = 2000;

/** Whether a game has an Unlimited mode, by the rules version it plays. */
export function hasUnlimited(rulesVersion: string): boolean {
  return SEVEN_SECOND.test(rulesVersion) || GAMES.some((game) => game.pattern.test(rulesVersion));
}

/** Where a game's recent rounds are kept. Its rules version, so new rules start afresh. */
export function recentKey(rulesVersion: string): string {
  return `unbored:unlimited:${rulesVersion}`;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readRecent(storage: Storage | null, key: string): string[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeRecent(storage: Storage | null, key: string, recent: readonly string[]): void {
  try {
    storage?.setItem(key, JSON.stringify(recent.slice(-UNLIMITED_RECENT)));
  } catch {
    // Storage is a convenience: without it a board may simply come round sooner.
  }
}

export type UnlimitedOptions = {
  /** The player's day number. */
  today?: number;
  /** A number in [0, 1), as `Math.random`. */
  random?: () => number;
  storage?: Storage | null;
};

/**
 * The seed of a new Unlimited round, as the decimal string a session carries, or
 * null for a game without an Unlimited.
 */
export async function unlimitedSeed(
  rulesVersion: string,
  {
    today = localDayNumber(Date.now()),
    random = Math.random,
    storage = browserStorage(),
  }: UnlimitedOptions = {},
): Promise<string | null> {
  if (SEVEN_SECOND.test(rulesVersion)) {
    // A non-zero 31-bit seed. The day's is the day times a 32-bit constant plus
    // seven, far above that, so no round is ever a day's deck.
    return String(Math.floor(random() * 0x7fffffff) + 1);
  }
  const game = GAMES.find((entry) => entry.pattern.test(rulesVersion));
  if (!game) return null;
  const bank = await game.bank();

  // A past day: from day 1 up to the day before yesterday.
  const span = Math.max(1, today - 2);
  const draw = () => 1 + Math.min(span - 1, Math.floor(random() * span));
  const live = new Set([today - 1, today, today + 1].map((day) => bank.key(day)));
  if (!Number.isFinite(bank.size)) {
    for (let tries = 0; tries < DRAWS; tries += 1) {
      const day = draw();
      if (!live.has(bank.key(day))) return String(day);
    }
    return String(Math.max(1, today - 2));
  }

  const key = recentKey(rulesVersion);
  const recent = readRecent(storage, key);
  // Remember fewer rounds than the bank has boards beyond the live ones, so a
  // board is always left to deal.
  const remembered = Math.max(0, Math.min(UNLIMITED_RECENT, bank.size - live.size - 1));
  const avoid = new Set([...live, ...(remembered > 0 ? recent.slice(-remembered) : [])]);
  for (const avoiding of [avoid, live]) {
    for (let tries = 0; tries < DRAWS; tries += 1) {
      const day = draw();
      const board = bank.key(day);
      if (avoiding.has(board)) continue;
      writeRecent(storage, key, [...recent.filter((item) => item !== board), board]);
      return String(day);
    }
  }
  // A bank too small to miss the live days: any past day will do.
  return String(draw());
}
