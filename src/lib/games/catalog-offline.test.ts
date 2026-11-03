import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchCategories, fetchGame, fetchGames } from "@/lib/games/catalog";

/**
 * The catalogue offline: once a page has read it online, the feed, a game and
 * the categories still load when the network is gone — from the device's own
 * copy, whether or not a service worker controls the page.
 */

function game(slug: string, category: string) {
  return {
    slug,
    title: slug,
    runtime: slug,
    playable: true,
    plays: 1,
    isOfficial: true,
    updatedAt: "2026-11-01T00:00:00Z",
    category: { slug: category, name: category },
  };
}

const LIST = {
  items: [game("stack-10", "puzzle"), game("updraft", "arcade"), game("sudoku", "logic")],
  nextCursor: null,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function goOffline() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the catalogue offline", () => {
  it("answers the feed, a category and a game from the last list read online", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(LIST)));
    await fetchGames({ limit: 100 });

    goOffline();
    // The feed asks with a different query than the one that was saved.
    const feed = await fetchGames({ limit: 100, sort: "latest" });
    expect(feed.items.map((item) => item.slug)).toEqual(["stack-10", "updraft", "sudoku"]);
    expect(feed.nextCursor).toBeNull();

    const arcade = await fetchGames({ category: "arcade", limit: 5 });
    expect(arcade.items.map((item) => item.slug)).toEqual(["updraft"]);

    expect((await fetchGame("sudoku")).slug).toBe("sudoku");
  });

  it("answers the categories from the last read", async () => {
    const categories = { items: [{ slug: "puzzle", name: "Puzzle", gameCount: 3 }] };
    vi.stubGlobal("fetch", vi.fn(async () => json(categories)));
    await fetchCategories();

    goOffline();
    expect((await fetchCategories()).items.map((item) => item.slug)).toEqual(["puzzle"]);
  });

  it("keeps the error when there is nothing saved, or the API refused", async () => {
    goOffline();
    await expect(fetchGames({ limit: 100 })).rejects.toMatchObject({ code: "network_error" });

    vi.stubGlobal("fetch", vi.fn(async () => json(LIST)));
    await fetchGames({ limit: 100 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { code: "not_found", message: "No such game." } }, 404)),
    );
    await expect(fetchGame("stack-10")).rejects.toMatchObject({ status: 404 });
  });

  it("does not answer a search offline", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(LIST)));
    await fetchGames({ limit: 100 });

    goOffline();
    await expect(fetchGames({ q: "stack" })).rejects.toMatchObject({ code: "network_error" });
  });
});
