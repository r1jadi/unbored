import type { ReactElement } from "react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Route as ExploreRoute } from "@/routes/explore";

const Explore = ExploreRoute.options.component as () => ReactElement;

/**
 * Explore is the busiest catalogue screen: three independent reads (the daily
 * challenge, the newest games and the category list) above two sections that
 * have no data behind them at all. It is mounted in a router because every one
 * of its sections is a link.
 */
async function renderExplore() {
  const root = createRootRoute();
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/", component: Explore }),
    createRoute({ getParentRoute: () => root, path: "/search", component: () => <p>Search</p> }),
    createRoute({
      getParentRoute: () => root,
      path: "/games/$id",
      component: () => <p>Game</p>,
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/categories/$slug",
      component: () => <p>Category</p>,
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/categories",
      component: () => <p>Categories</p>,
    }),
    createRoute({ getParentRoute: () => root, path: "/new", component: () => <p>New</p> }),
    createRoute({
      getParentRoute: () => root,
      path: "/trending",
      component: () => <p>Trending</p>,
    }),
    createRoute({ getParentRoute: () => root, path: "/popular", component: () => <p>Popular</p> }),
  ];

  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  render(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
  });
}

function gamePayload(slug: string, title: string, plays = 0) {
  return {
    plays,
    slug,
    title,
    tagline: "One move. One solution.",
    description: "Each level has exactly one move that solves it.",
    instructions: null,
    category: { slug: "logic", name: "Logic" },
    runtime: null,
    playable: false,
    isOfficial: true,
    coverPath: null,
    publishedAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function unavailable() {
  return jsonResponse(
    {
      error: {
        code: "service_unavailable",
        message: "The game catalogue is not available right now.",
        request_id: "req-abc123",
      },
    },
    503,
  );
}

/** Answers a catalogue read, or fails it while `down` is true. */
function catalogFetch(down: boolean) {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (down) return unavailable();
    if (url.includes("/categories")) {
      return jsonResponse({
        items: [
          { slug: "logic", name: "Logic", description: null, gameCount: 1 },
          { slug: "puzzle", name: "Puzzle", description: null, gameCount: 2 },
        ],
      });
    }
    if (url.includes("category=daily")) {
      return jsonResponse({ items: [gamePayload("7-second", "7 Second")], nextCursor: null });
    }
    return jsonResponse({ items: [gamePayload("stack-10", "Stack 10")], nextCursor: null });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** The `Retry` inside one named section, so the test cannot click a neighbour's. */
function retryIn(title: string) {
  const heading = screen.getByRole("heading", { name: title });
  const section = heading.closest("section");
  if (!section) throw new Error(`no section for ${title}`);
  return within(section).getByRole("button", { name: /retry/i });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Explore's catalogue sections", () => {
  it("names each section that failed and shows no stand-in games", async () => {
    catalogFetch(true);

    await renderExplore();

    expect(await screen.findByText("Categories are unavailable right now.")).toBeInTheDocument();
    expect(screen.getByText("The catalogue is unavailable right now.")).toBeInTheDocument();
    expect(screen.getByText("Today's challenge is unavailable right now.")).toBeInTheDocument();

    // The failure is not papered over with the prototype's catalogue: no game
    // card, and no category chip, appears anywhere on the screen.
    expect(screen.queryByText("Stack 10")).not.toBeInTheDocument();
    expect(screen.queryByText("7 Second")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Puzzle" })).not.toBeInTheDocument();

    // No ranking sections are shown when there is nothing to rank.
    expect(screen.queryByRole("heading", { name: "Trending" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Popular" })).not.toBeInTheDocument();
  });

  it("ranks Popular by completed runs and hides empty categories", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/categories")) {
          return jsonResponse({
            items: [
              { slug: "logic", name: "Logic", description: null, gameCount: 1 },
              { slug: "word", name: "Word", description: null, gameCount: 0 },
            ],
          });
        }
        if (url.includes("category=daily")) {
          return jsonResponse({ items: [gamePayload("7-second", "7 Second")], nextCursor: null });
        }
        return jsonResponse({
          items: [
            gamePayload("stack-10", "Stack 10", 3),
            gamePayload("one-move", "One Move", 25),
            gamePayload("color-merge", "Color Merge", 0),
          ],
          nextCursor: null,
        });
      }),
    );

    await renderExplore();

    const heading = await screen.findByRole("heading", { name: "Popular" });
    const section = heading.closest("section");
    if (!section) throw new Error("no Popular section");
    const titles = within(section)
      .getAllByRole("link")
      .map((link) => link.textContent ?? "")
      .filter((text) => text.includes("One Move") || text.includes("Stack 10"));
    // Most played first; a game nobody has finished is not listed at all.
    expect(titles[0]).toContain("One Move");
    expect(titles[1]).toContain("Stack 10");
    expect(within(section).queryByText("Color Merge")).not.toBeInTheDocument();

    // No Trending section, and no chip for a category without games.
    expect(screen.queryByRole("heading", { name: "Trending" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Logic" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Word" })).not.toBeInTheDocument();
  });

  it("recovers a failed section from its own retry, with no reload", async () => {
    let down = true;
    const spy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (down) return unavailable();
      if (url.includes("/categories")) {
        return jsonResponse({
          items: [{ slug: "logic", name: "Logic", description: null, gameCount: 1 }],
        });
      }
      if (url.includes("category=daily")) {
        return jsonResponse({ items: [gamePayload("7-second", "7 Second")], nextCursor: null });
      }
      return jsonResponse({ items: [gamePayload("stack-10", "Stack 10")], nextCursor: null });
    });
    vi.stubGlobal("fetch", spy);

    await renderExplore();
    expect(await screen.findByText("The catalogue is unavailable right now.")).toBeInTheDocument();

    down = false;
    const before = spy.mock.calls.length;
    await act(async () => {
      fireEvent.click(retryIn("New"));
    });

    // The retried section shows its real content, and the request really went
    // out again rather than the screen inventing an answer.
    expect(await screen.findByText("Stack 10")).toBeInTheDocument();
    expect(spy.mock.calls.length).toBeGreaterThan(before);
  });

  it("keeps the sections that loaded and retries only the one that failed", async () => {
    let categoriesDown = true;
    const spy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/categories")) {
        return categoriesDown
          ? unavailable()
          : jsonResponse({
              items: [{ slug: "logic", name: "Logic", description: null, gameCount: 1 }],
            });
      }
      if (url.includes("category=daily")) {
        return jsonResponse({ items: [gamePayload("7-second", "7 Second")], nextCursor: null });
      }
      return jsonResponse({ items: [gamePayload("stack-10", "Stack 10")], nextCursor: null });
    });
    vi.stubGlobal("fetch", spy);

    await renderExplore();

    // One broken read does not take the working ones down with it.
    expect(await screen.findByText("Categories are unavailable right now.")).toBeInTheDocument();
    expect(screen.getByText("Stack 10")).toBeInTheDocument();
    expect(screen.getByText("7 Second")).toBeInTheDocument();

    categoriesDown = false;
    await act(async () => {
      fireEvent.click(retryIn("Categories"));
    });

    await waitFor(() => expect(screen.getByRole("link", { name: "Logic" })).toBeInTheDocument());
    expect(screen.queryByText("Categories are unavailable right now.")).not.toBeInTheDocument();
    // The section that was already fine was not disturbed.
    expect(screen.getByText("Stack 10")).toBeInTheDocument();
  });
});
