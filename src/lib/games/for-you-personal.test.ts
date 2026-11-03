import { describe, expect, it } from "vitest";

import { FRESH_WINDOW_MS, type Game } from "@/lib/games/catalog";
import {
  forYouScores,
  personalOrder,
  WEIGHTS,
  type ForYouSignals,
} from "@/lib/games/for-you-personal";

const NOW = Date.parse("2026-12-03T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** A game with `plays` runs in `category`, published `daysAgo` days before NOW. */
const game = (slug: string, plays: number, category: string, daysAgo = 365) =>
  ({
    slug,
    plays,
    category: { slug: category, name: category },
    publishedAt: new Date(NOW - daysAgo * DAY).toISOString(),
  }) as Game;

const slugs = (games: Game[]) => games.map((g) => g.slug);

const viewer = (overrides: Partial<ForYouSignals> = {}): ForYouSignals => ({
  viewer: "user-1",
  played: [],
  liked: [],
  saved: [],
  ...overrides,
});

const CATALOGUE = [
  game("stack", 900, "puzzle"),
  game("sudoku", 700, "puzzle"),
  game("flutter", 600, "arcade"),
  game("chain", 400, "memory"),
  game("dont-touch", 300, "arcade"),
  game("crossword", 200, "words"),
];

describe("the personal For You order", () => {
  it("leads with popularity for a guest, shuffling only near neighbours", () => {
    // On a log scale 900 to 400 plays are within 0.12 of each other, so the
    // daily jitter (±0.1) may reorder them; it never buries the most played game
    // or lifts the least played to the top.
    for (let day = 0; day < 30; day += 1) {
      const order = slugs(personalOrder(CATALOGUE, null, NOW + day * DAY));
      expect(order.indexOf("stack")).toBeLessThan(4);
      expect(order[0]).not.toBe("crossword");
      expect(order).toHaveLength(CATALOGUE.length);
    }
  });

  it("never puts two games of a category back to back while another is left", () => {
    for (const signals of [null, viewer()]) {
      const order = personalOrder(CATALOGUE, signals, NOW);
      for (let i = 1; i < order.length - 1; i += 1) {
        expect(order[i]!.category!.slug).not.toBe(order[i - 1]!.category!.slug);
      }
    }
  });

  it("leans towards the categories a player plays and likes", () => {
    const fan = viewer({
      played: [{ slug: "chain", at: new Date(NOW - 5 * DAY).toISOString() }],
      liked: ["chain"],
    });
    const guest = forYouScores(CATALOGUE, null, NOW);
    const theirs = forYouScores(CATALOGUE, fan, NOW);
    expect(theirs.get("chain")! - guest.get("chain")!).toBeGreaterThan(
      WEIGHTS.affinity + WEIGHTS.likedOrSaved - 2 * WEIGHTS.jitter - 1e-9,
    );
    expect(slugs(personalOrder(CATALOGUE, fan, NOW))[0]).toBe("chain");
  });

  it("steps back from a game played an hour ago, less so as the day goes", () => {
    const hourAgo = viewer({ played: [{ slug: "stack", at: new Date(NOW - HOUR).toISOString() }] });
    const dayAgo = viewer({
      played: [{ slug: "stack", at: new Date(NOW - 25 * HOUR).toISOString() }],
    });
    expect(slugs(personalOrder(CATALOGUE, hourAgo, NOW))[0]).not.toBe("stack");
    expect(forYouScores(CATALOGUE, hourAgo, NOW).get("stack")!).toBeLessThan(
      forYouScores(CATALOGUE, dayAgo, NOW).get("stack")!,
    );
  });

  it("keeps the third card for a new game, even one nobody has played", () => {
    const withLaunch = [...CATALOGUE, game("checkmate", 0, "strategy", 1)];
    expect(slugs(personalOrder(withLaunch, null, NOW))[2]).toBe("checkmate");
    const old = [...CATALOGUE, game("checkmate", 0, "strategy", FRESH_WINDOW_MS / DAY + 1)];
    expect(slugs(personalOrder(old, null, NOW))[2]).not.toBe("checkmate");
  });

  it("is the same order all day, and may shift the next day", () => {
    const morning = slugs(personalOrder(CATALOGUE, viewer(), NOW - 3 * HOUR));
    const evening = slugs(personalOrder(CATALOGUE, viewer(), NOW + 3 * HOUR));
    expect(evening).toEqual(morning);
    const scoresToday = forYouScores(CATALOGUE, viewer(), NOW);
    const scoresTomorrow = forYouScores(CATALOGUE, viewer(), NOW + DAY);
    expect([...scoresToday.values()]).not.toEqual([...scoresTomorrow.values()]);
  });

  it("shifts differently for two players with the same history", () => {
    const one = forYouScores(CATALOGUE, viewer({ viewer: "a" }), NOW);
    const two = forYouScores(CATALOGUE, viewer({ viewer: "b" }), NOW);
    expect([...one.values()]).not.toEqual([...two.values()]);
  });

  it("does not change the games it is given", () => {
    const input = [...CATALOGUE];
    personalOrder(input, viewer(), NOW);
    expect(input).toEqual(CATALOGUE);
  });
});
