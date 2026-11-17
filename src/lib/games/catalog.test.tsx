import { act, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as mock from "@/lib/mock";
import {
  categoryPath,
  coverUrl,
  fetchCategories,
  fetchGame,
  fetchGames,
  isDaily,
  titleFromSlug,
  useCategories,
  useGame,
  useGames,
  type Game,
} from "@/lib/games/catalog";

/** The shape `GET /games/{slug}` answers with, per the contract. */
function gamePayload(overrides: Partial<Game> = {}): Game {
  return {
    slug: "stack-10",
    title: "Stack 10",
    tagline: "Make every column add up to ten.",
    description: "Drop numbered tiles into columns.",
    instructions: "Tap a column to drop the next tile.",
    category: { slug: "puzzle", name: "Puzzle" },
    runtime: null,
    playable: false,
    // Completed runs, counted by the database: zero until somebody finishes one.
    plays: 0,
    isOfficial: true,
    coverPath: null,
    publishedAt: "2026-09-01T12:00:00+00:00",
    updatedAt: "2026-09-01T12:00:00+00:00",
    ...overrides,
  };
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code: string, message: string) {
  return jsonResponse({ error: { code, message, request_id: "req-abc123" } }, status);
}

function requestUrl(spy: ReturnType<typeof mockFetch>, index = 0): URL {
  const call = spy.mock.calls[index];
  if (!call) throw new Error(`no request at index ${index}`);
  return new URL(String(call[0]));
}

function requestHeaders(spy: ReturnType<typeof mockFetch>, index = 0): Headers {
  const call = spy.mock.calls[index];
  if (!call) throw new Error(`no request at index ${index}`);
  return new Headers(call[1]?.headers);
}

/**
 * A minimal `renderHook`: it renders a component whose only job is to call the
 * hook, and hands back the latest result through a ref. Avoiding the library's
 * own helper keeps this test independent of its version.
 */
function renderHook<T>(hook: () => T) {
  const ref: { current: T } = { current: undefined as unknown as T };
  function Probe() {
    const value = hook();
    const latest = useRef(value);
    latest.current = value;
    ref.current = latest.current;
    return null;
  }
  const utils = render(<Probe />);
  return {
    get result() {
      return ref.current;
    },
    ...utils,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchGames", () => {
  it("asks for a published page and sends every filter", async () => {
    const spy = mockFetch(() => jsonResponse({ items: [gamePayload()], nextCursor: "next-page" }));

    const page = await fetchGames({ limit: 5, category: "puzzle", q: "stack", sort: "latest" });

    const url = requestUrl(spy);
    expect(url.pathname).toBe("/api/v1/games");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("category")).toBe("puzzle");
    expect(url.searchParams.get("q")).toBe("stack");
    expect(url.searchParams.get("sort")).toBe("latest");
    expect(page.items[0].slug).toBe("stack-10");
    expect(page.nextCursor).toBe("next-page");
  });

  it("sends no parameters at all for an unfiltered page", async () => {
    const spy = mockFetch(() => jsonResponse({ items: [], nextCursor: null }));

    await fetchGames();

    const url = requestUrl(spy);
    expect(url.pathname).toBe("/api/v1/games");
    expect(url.search).toBe("");
  });

  it("carries no credentials: the catalogue is public", async () => {
    const spy = mockFetch(() => jsonResponse({ items: [], nextCursor: null }));

    await fetchGames();

    const headers = requestHeaders(spy);
    expect(headers.get("Authorization")).toBeNull();
    // Not even the publishable key: the browser talks to the gateway, and the
    // gateway's games service holds the Supabase credential.
    expect(headers.get("apikey")).toBeNull();
  });
});

describe("fetchGame", () => {
  it("addresses a game by its slug", async () => {
    const spy = mockFetch(() => jsonResponse(gamePayload()));
    const game = await fetchGame("stack-10");
    expect(requestUrl(spy).pathname).toBe("/api/v1/games/stack-10");
    expect(game.playable).toBe(false);
  });

  it("escapes a slug so it cannot address another endpoint", async () => {
    const spy = mockFetch(() => jsonResponse(gamePayload()));
    await fetchGame("../categories");
    expect(requestUrl(spy).pathname).toBe("/api/v1/games/..%2Fcategories");
  });
});

describe("fetchCategories", () => {
  it("reads real counts", async () => {
    const spy = mockFetch(() =>
      jsonResponse({
        items: [
          { slug: "puzzle", name: "Puzzle", description: "Fit and clear.", gameCount: 2 },
          { slug: "word", name: "Word", description: null, gameCount: 0 },
        ],
      }),
    );

    const page = await fetchCategories();

    expect(requestUrl(spy).pathname).toBe("/api/v1/categories");
    expect(page.items[0].gameCount).toBe(2);
    // A category with no published game is present with a zero — an answer, not
    // an absence.
    expect(page.items[1].gameCount).toBe(0);
  });
});

describe("useGames", () => {
  it("loads a page and exposes it as ready", async () => {
    mockFetch(() => jsonResponse({ items: [gamePayload()], nextCursor: null }));

    const hook = renderHook(() => useGames());

    await waitFor(() => expect(hook.result.status).toBe("ready"));
    expect(hook.result.items.map((g) => g.slug)).toEqual(["stack-10"]);
    expect(hook.result.nextCursor).toBeNull();
  });

  it("reports a failure with no items and retries the request", async () => {
    const spy = mockFetch(() =>
      errorResponse(503, "service_unavailable", "The game catalogue is not available right now."),
    );

    const hook = renderHook(() => useGames());
    await waitFor(() => expect(hook.result.status).toBe("error"));

    // The whole point: a failed read is a failure, not a substitute catalogue.
    expect(hook.result.items).toEqual([]);
    expect(hook.result.nextCursor).toBeNull();

    act(() => hook.result.retry());
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(1));
  });

  it("shows the API's own message, which is written to be read by a person", async () => {
    mockFetch(() =>
      errorResponse(503, "service_unavailable", "The game catalogue is not available right now."),
    );

    const hook = renderHook(() => useGames());
    await waitFor(() => expect(hook.result.status).toBe("error"));
    expect(hook.result.error?.message).toBe("The game catalogue is not available right now.");
    expect(hook.result.error?.status).toBe(503);
  });

  it("drops the previous results when the query changes", async () => {
    mockFetch((url) =>
      jsonResponse(
        url.includes("category=arcade")
          ? {
              items: [
                gamePayload({ slug: "dont-touch-the-black", title: "Don't Touch the Black" }),
              ],
              nextCursor: null,
            }
          : { items: [gamePayload()], nextCursor: null },
      ),
    );

    let latest!: ReturnType<typeof useGames>;
    function QueryProbe({ category }: { category: string }) {
      latest = useGames({ category });
      return null;
    }

    const view = render(<QueryProbe category="puzzle" />);
    await waitFor(() => expect(latest.status).toBe("ready"));
    expect(latest.items[0].slug).toBe("stack-10");

    // Showing the previous filter's games under the new heading is how a screen
    // ends up lying about what it lists.
    view.rerender(<QueryProbe category="arcade" />);
    await waitFor(() => expect(latest.items[0]?.slug).toBe("dont-touch-the-black"));
    expect(latest.items).toHaveLength(1);
  });

  it("appends the next page without losing the first", async () => {
    mockFetch((url) =>
      jsonResponse(
        url.includes("cursor=")
          ? {
              items: [gamePayload({ slug: "memory-flash", title: "Memory Flash" })],
              nextCursor: null,
            }
          : { items: [gamePayload()], nextCursor: "page-2" },
      ),
    );

    const hook = renderHook(() => useGames({ limit: 1 }));
    await waitFor(() => expect(hook.result.status).toBe("ready"));
    expect(hook.result.nextCursor).toBe("page-2");

    act(() => hook.result.loadMore());
    await waitFor(() => expect(hook.result.items.length).toBe(2));
    expect(hook.result.items.map((g) => g.slug)).toEqual(["stack-10", "memory-flash"]);
  });

  it("keeps what it loaded when a continuation fails", async () => {
    mockFetch((url) =>
      url.includes("cursor=")
        ? errorResponse(
            503,
            "service_unavailable",
            "The game catalogue is not available right now.",
          )
        : jsonResponse({ items: [gamePayload()], nextCursor: "page-2" }),
    );

    const hook = renderHook(() => useGames({ limit: 1 }));
    await waitFor(() => expect(hook.result.status).toBe("ready"));

    act(() => hook.result.loadMore());
    await waitFor(() => expect(hook.result.loadMoreError).toBeDefined());

    // A failed "load more" must not blank out the page the visitor is reading.
    expect(hook.result.items.map((g) => g.slug)).toEqual(["stack-10"]);
    expect(hook.result.status).toBe("ready");
  });
});

describe("useGame", () => {
  it("reports a published record as ready", async () => {
    mockFetch(() => jsonResponse(gamePayload()));
    const hook = renderHook(() => useGame("stack-10"));
    await waitFor(() => expect(hook.result.status).toBe("ready"));
    if (hook.result.status !== "ready") throw new Error("expected a ready game");
    expect(hook.result.game.title).toBe("Stack 10");
    expect(hook.result.game.playable).toBe(false);
  });

  it("reports 404 as missing rather than as an error", async () => {
    mockFetch(() => errorResponse(404, "not_found", "No such game."));
    const hook = renderHook(() => useGame("never-made"));
    // An unknown slug and an unpublished game are the same 404 by design, so
    // retrying could not help and the UI says "no such game".
    await waitFor(() => expect(hook.result.status).toBe("missing"));
  });

  it("keeps a transport failure as an error so it can be retried", async () => {
    mockFetch(() =>
      errorResponse(503, "service_unavailable", "The game catalogue is not available right now."),
    );
    const hook = renderHook(() => useGame("stack-10"));
    await waitFor(() => expect(hook.result.status).toBe("error"));
  });
});

describe("useCategories", () => {
  it("reports an error rather than an empty list when the read fails", async () => {
    mockFetch(() =>
      errorResponse(503, "service_unavailable", "The game catalogue is not available right now."),
    );
    const hook = renderHook(() => useCategories());
    await waitFor(() => expect(hook.result.status).toBe("error"));
    if (hook.result.status === "error") {
      expect(hook.result.error.status).toBe(503);
    }
  });
});

describe("presentation helpers", () => {
  it("builds a public URL from a cover path and nothing when there is none", () => {
    expect(coverUrl({ coverPath: "stack-10/cover.webp" })).toBe(
      "https://project.supabase.co/storage/v1/object/public/game-assets/stack-10/cover.webp",
    );
    expect(coverUrl({ coverPath: null })).toBeUndefined();
    expect(coverUrl(undefined)).toBeUndefined();
  });

  it("derives the daily flag from the category, not a flag of its own", () => {
    expect(isDaily({ category: { slug: "daily", name: "Daily" } })).toBe(true);
    expect(isDaily({ category: { slug: "puzzle", name: "Puzzle" } })).toBe(false);
    expect(isDaily({ category: null })).toBe(false);
  });

  it("links to a category only when the game has one", () => {
    expect(categoryPath({ category: { slug: "puzzle", name: "Puzzle" } })).toBe(
      "/categories/puzzle",
    );
    expect(categoryPath({ category: null })).toBeUndefined();
  });

  it("renders a slug as a readable heading", () => {
    expect(titleFromSlug("stack-10")).toBe("Stack 10");
    expect(titleFromSlug("dont-break-the-chain")).toBe("Don't Break the Chain");
    expect(titleFromSlug("dont-touch-the-black")).toBe("Don't Touch the Black");
    expect(titleFromSlug("7-second")).toBe("7 Second");
    expect(titleFromSlug("the-end")).toBe("The End");
    // Names that are not a reading of the slug.
    expect(titleFromSlug("updraft")).toBe("Flutter");
    expect(titleFromSlug("then-and-now")).toBe("Then & Now");
  });
});

/**
 * The guard this whole phase turns on.
 *
 * `mock.ts` was the prototype catalogue: seven games with invented play counts,
 * likes, comment totals, personal bests, session times and creators. Every one of
 * those screens now reads the API, and the fixtures are gone rather than kept
 * behind a fallback — because a fallback is exactly what would put a fabricated
 * number back on screen when a request fails.
 *
 * This asserts the module's surface directly, so re-adding a catalogue fixture
 * fails here rather than only in review.
 */
describe("no catalogue fixtures remain", () => {
  it("exposes no game catalogue from the prototype fixture module", () => {
    for (const name of ["games", "getGame", "categories", "leaderboard", "Game", "GameId"]) {
      expect(name in mock, `mock.ts must not export ${name}`).toBe(false);
    }
  });

  it("keeps only the fixtures for features that genuinely have no backend", () => {
    for (const name of ["users", "getUser", "comments", "notifications", "achievements"]) {
      expect(name in mock, `mock.ts should still export ${name}`).toBe(true);
    }
  });
});
