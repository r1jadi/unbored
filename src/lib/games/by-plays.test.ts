import { describe, expect, it } from "vitest";

import { byPlays, FEED_QUERY, MAX_PAGE_SIZE, type Game } from "@/lib/games/catalog";

const game = (slug: string, plays: number) => ({ slug, plays }) as Game;

describe("the For You order", () => {
  it("puts the most played game first and the least played last", () => {
    const ordered = byPlays([game("a", 3), game("b", 40), game("c", 0), game("d", 12)]);
    expect(ordered.map((g) => g.slug)).toEqual(["b", "d", "a", "c"]);
  });

  it("keeps unplayed games, after every played one", () => {
    const ordered = byPlays([game("new", 0), game("old", 5)]);
    expect(ordered.map((g) => g.slug)).toEqual(["old", "new"]);
  });

  it("keeps the catalogue's newest-first order between games with equal plays", () => {
    const ordered = byPlays([game("newest", 2), game("middle", 2), game("oldest", 2)]);
    expect(ordered.map((g) => g.slug)).toEqual(["newest", "middle", "oldest"]);
  });

  it("does not change the list it is given", () => {
    const input = [game("a", 1), game("b", 2)];
    byPlays(input);
    expect(input.map((g) => g.slug)).toEqual(["a", "b"]);
  });

  it("reads the whole catalogue in one request so every game is ranked", () => {
    expect(FEED_QUERY.limit).toBe(MAX_PAGE_SIZE);
  });
});
