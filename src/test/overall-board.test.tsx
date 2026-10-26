import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LeaderboardPage } from "@/components/game/LeaderboardPage";
import { clearSession } from "@/lib/auth/session";
import type { OverallBoard } from "@/lib/games/overall-board";
import { getQueryClient } from "@/lib/query";

/**
 * The Leaderboards tab opens on the all-games board: one rating per player, the
 * sum of their per-game percentiles, ranked by the server. The page renders the
 * response — rows, the game minimum, and a not-yet-ranked caller's progress.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubBoard(board: OverallBoard) {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/v1/games/leaderboard")) return jsonResponse(board);
    if (url.includes("/api/v1/games")) return jsonResponse({ items: [], nextCursor: null });
    return jsonResponse([]);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

async function renderBoards() {
  const root = createRootRoute();
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: "/leaderboards",
      component: () => <LeaderboardPage />,
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/leaderboards/$id",
      component: () => <p>Game board</p>,
    }),
    createRoute({ getParentRoute: () => root, path: "/login", component: () => <p>Log in</p> }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/leaderboards"] }),
  });
  render(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
  });
  return router;
}

const board: OverallBoard = {
  scope: "global",
  period: "all",
  minGames: 3,
  entries: [
    { rank: 1, username: "rija", rating: 280, games: 3 },
    { rank: 2, username: "ana", rating: 250, games: 4 },
  ],
  hasMore: false,
  me: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  getQueryClient().clear();
  clearSession();
});

describe("the all-games board", () => {
  it("is what the Leaderboards tab opens, rather than the first game's board", async () => {
    const spy = stubBoard(board);
    const router = await renderBoards();

    expect(await screen.findByText("@rija")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/leaderboards");
    expect(screen.getByRole("heading", { name: "All games" })).toBeInTheDocument();
    expect(spy.mock.calls.some((call) => String(call[0]).includes("/games/leaderboard"))).toBe(
      true,
    );
  });

  it("shows each player's rating and how many games it covers", async () => {
    stubBoard(board);
    await renderBoards();

    const first = (await screen.findByText("@rija")).closest("li")!;
    expect(first).toHaveTextContent("1");
    expect(first).toHaveTextContent("3 games");
    expect(first).toHaveTextContent("280");
    expect(screen.getByText(/Play 3 games to get ranked/)).toBeInTheDocument();
  });

  it("tells a not-yet-ranked player how many games are left", async () => {
    stubBoard({ ...board, me: { rank: null, rating: 140, games: 2 } });
    await renderBoards();

    expect(
      await screen.findByText(/You're rated in 2 of 3 games \(140 points\)\. Play 1 more game/),
    ).toBeInTheDocument();
  });

  it("says nobody is ranked yet on an empty board", async () => {
    stubBoard({ ...board, entries: [] });
    await renderBoards();

    expect(await screen.findByText("No one is ranked yet")).toBeInTheDocument();
  });
});
