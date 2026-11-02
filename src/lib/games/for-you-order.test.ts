import { describe, expect, it } from "vitest";

import { forYouOrder, FRESH_WINDOW_MS, isFresh, type Game } from "@/lib/games/catalog";

const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

/** A game with `plays` runs, published `daysAgo` days before NOW. */
const game = (slug: string, plays: number, daysAgo = 365) =>
  ({ slug, plays, publishedAt: new Date(NOW - daysAgo * DAY).toISOString() }) as Game;

const slugs = (games: Game[]) => games.map((g) => g.slug);

describe("the For You order", () => {
  it("is the most played order when nothing is new", () => {
    const ordered = forYouOrder([game("a", 3), game("b", 40), game("c", 0), game("d", 12)], NOW);
    expect(slugs(ordered)).toEqual(["b", "d", "a", "c"]);
  });

  it("keeps the two most played on top and gives a new game the third card", () => {
    const ordered = forYouOrder(
      [game("new", 0, 1), game("p1", 90), game("p2", 80), game("p3", 70), game("p4", 60)],
      NOW,
    );
    expect(slugs(ordered)).toEqual(["p1", "p2", "new", "p3", "p4"]);
  });

  it("spreads several new games every third card, the most played of them first", () => {
    const ordered = forYouOrder(
      [
        game("n1", 0, 1),
        game("n2", 4, 3),
        ...[90, 80, 70, 60, 50].map((plays, i) => game(`p${i + 1}`, plays)),
      ],
      NOW,
    );
    expect(slugs(ordered)).toEqual(["p1", "p2", "n2", "p3", "p4", "n1", "p5"]);
  });

  it("lets a new game that is already popular climb above its slot", () => {
    const ordered = forYouOrder([game("p1", 90), game("hit", 85, 2), game("p2", 10)], NOW);
    expect(slugs(ordered)).toEqual(["p1", "hit", "p2"]);
  });

  it("ranks a game on plays alone once its fresh window has closed", () => {
    const ordered = forYouOrder(
      [game("p1", 90), game("p2", 80), game("p3", 70), game("old-launch", 0, 15)],
      NOW,
    );
    expect(slugs(ordered)).toEqual(["p1", "p2", "p3", "old-launch"]);
  });

  it("lists every game exactly once, when the catalogue is mostly new", () => {
    const ordered = forYouOrder([game("n1", 0, 1), game("n2", 0, 2), game("p1", 5)], NOW);
    expect(slugs(ordered)).toEqual(["p1", "n1", "n2"]);
  });

  it("does not change the list it is given", () => {
    const input = [game("a", 1), game("b", 2, 1)];
    forYouOrder(input, NOW);
    expect(slugs(input)).toEqual(["a", "b"]);
  });
});

describe("a fresh game", () => {
  it("is one published inside the window", () => {
    expect(isFresh({ publishedAt: new Date(NOW - FRESH_WINDOW_MS + 1).toISOString() }, NOW)).toBe(
      true,
    );
    expect(isFresh({ publishedAt: new Date(NOW - FRESH_WINDOW_MS).toISOString() }, NOW)).toBe(
      false,
    );
  });

  it("needs a publication date", () => {
    expect(isFresh({ publishedAt: null }, NOW)).toBe(false);
    expect(isFresh({ publishedAt: "not a date" }, NOW)).toBe(false);
  });
});
