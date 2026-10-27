import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { FeedItem } from "@/components/game/FeedItem";
import { OneMoveRuntime } from "@/components/game/OneMoveRuntime";
import { ZipRuntime } from "@/components/game/ZipRuntime";
import { clearSession } from "@/lib/auth/session";
import type { Game } from "@/lib/games/catalog";
import { GAME_RULES } from "@/lib/games/rules";
import { useEightPuzzleRun, useZipRun } from "@/lib/games/sessions";
import { Route as PlayRoute } from "@/routes/play.$id";

/**
 * Tap to play starts the game; Rules shows how to play it.
 *
 * From the feed, a player who taps to play has already chosen to play, so the
 * game opens with `?start=1` and skips its own rules screen — and Play again
 * skips it too. The rules are one tap away instead, in a sheet on the feed.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubSessions(gameSlug: string, rulesVersion: string) {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/complete")) {
      return jsonResponse({
        sessionId: "34343434-1111-4111-8111-343434343434",
        gameSlug,
        score: 0,
        clearedColumns: 0,
        tilesPlaced: 1,
        durationMs: 1000,
        ranked: false,
        recordedAt: "2026-10-26T12:00:00.000Z",
        personalBest: null,
        rank: null,
        duplicate: false,
      });
    }
    if (url.endsWith("/api/v1/sessions")) {
      return jsonResponse(
        {
          id: "34343434-1111-4111-8111-343434343434",
          gameSlug,
          rulesVersion,
          seed: "1",
          tileCount: 4096,
          startedAt: "2026-10-26T12:00:00.000Z",
          expiresAt: "2026-10-27T00:00:00.000Z",
          ranked: false,
        },
        201,
      );
    }
    // Engagement reads and anything else: an empty, successful answer.
    return jsonResponse([]);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

async function renderAt(node: ReactNode) {
  const root = createRootRoute();
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/", component: () => <>{node}</> }),
    createRoute({ getParentRoute: () => root, path: "/games/$id", component: () => <p>Game</p> }),
    createRoute({ getParentRoute: () => root, path: "/play/$id", component: () => <p>Play</p> }),
    createRoute({ getParentRoute: () => root, path: "/login", component: () => <p>Log in</p> }),
    createRoute({
      getParentRoute: () => root,
      path: "/leaderboards/$id",
      component: () => <p>Board</p>,
    }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
  });
  return router;
}

const crowns: Game = {
  slug: "crowns",
  title: "Crowns",
  tagline: "One crown per row, column and colour.",
  instructions: "Place exactly one crown in each row, each column and each region.",
  runtime: "queens",
  playable: true,
  plays: 0,
  isOfficial: true,
  updatedAt: "2026-10-26T12:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("the feed card", () => {
  it("offers Tap to play, which starts the game, and the rules", async () => {
    stubSessions("crowns", "queens@1");
    await renderAt(<FeedItem game={crowns} />);

    const play = screen.getByRole("link", { name: /Tap to play/ });
    expect(play).toHaveAttribute("href", "/play/crowns?start=true");
    // The board itself starts the game the same way.
    expect(screen.getByRole("link", { name: "Play Crowns" })).toHaveAttribute(
      "href",
      "/play/crowns?start=true",
    );
    // The title is the way to the game's page.
    expect(screen.getByRole("link", { name: "Crowns" })).toHaveAttribute("href", "/games/crowns");
    expect(screen.getByRole("button", { name: /^Rules$/ })).toBeInTheDocument();
  });

  it("shows the game's full rules in a sheet, with Tap to play at the bottom", async () => {
    stubSessions("crowns", "queens@1");
    await renderAt(<FeedItem game={crowns} />);

    fireEvent.click(screen.getByRole("button", { name: /^Rules$/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("How to play Crowns")).toBeInTheDocument();
    expect(within(sheet).getByText(GAME_RULES.queens.summary)).toBeInTheDocument();
    for (const rule of GAME_RULES.queens.rules) {
      expect(within(sheet).getByText(rule.lead)).toBeInTheDocument();
      expect(within(sheet).getByText(rule.text, { exact: false })).toBeInTheDocument();
    }
    expect(within(sheet).getByRole("link", { name: /Tap to play/ })).toHaveAttribute(
      "href",
      "/play/crowns?start=true",
    );
  });
});

describe("starting straight away", () => {
  it("opens One Move on its first board, with no rules screen in the way", async () => {
    const spy = stubSessions("one-move", "one-move@2");
    await renderAt(<OneMoveRuntime slug="one-move" title="One Move" autoStart />);

    expect(await screen.findByRole("group", { name: "Board 1, 3 by 3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start run" })).toBeNull();
    expect(spy.mock.calls.some((call) => String(call[0]).endsWith("/api/v1/sessions"))).toBe(true);
  });

  it("skips the rules again on Play again", async () => {
    stubSessions("one-move", "one-move@2");
    await renderAt(<OneMoveRuntime slug="one-move" title="One Move" autoStart />);
    await screen.findByRole("group", { name: "Board 1, 3 by 3" });

    // A wrong tap ends the run; Play again goes straight to a new first board.
    fireEvent.click(screen.getByRole("button", { name: /^Row 1 column 1,/ }));
    fireEvent.click(await screen.findByRole("button", { name: /play again/i }));

    expect(await screen.findByRole("group", { name: "Board 1, 3 by 3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start run" })).toBeNull();
  });

  it("asks for Trail's timed session at once, rather than on a Start press", async () => {
    const spy = stubSessions("trail", "zip@1");
    await renderAt(<ZipRuntime slug="trail" title="Trail" autoStart />);

    expect(await screen.findByRole("group", { name: "Board 1, 5 by 5" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Fill the grid" })).toBeNull();
    expect(
      spy.mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/sessions")),
    ).toHaveLength(1);
  });

  // The rules used to render for one frame before an effect pressed Start, which
  // showed as a flash of the Start run screen when the play screen's code had to
  // load first. No render of a Tap to play run may be the rules.
  it.each([
    ["Trail", useZipRun, "trail", "zip@1"],
    ["8 Puzzle", useEightPuzzleRun, "eight-puzzle", "eight-puzzle@1"],
  ] as const)("never renders %s's rules, even for a frame", async (_name, hook, slug, rules) => {
    stubSessions(slug, rules);
    const seen: string[] = [];
    const { result } = renderHook(() => {
      const state = hook(slug, true);
      seen.push(state.status);
      return state;
    });
    await waitFor(() => expect(result.current.status).toBe("playing"));

    act(() => result.current.restart());
    await waitFor(() => expect(result.current.status).toBe("playing"));
    expect(seen).not.toContain("intro");
  });

  it("still shows the rules first when the game is opened without ?start", async () => {
    stubSessions("one-move", "one-move@2");
    await renderAt(<OneMoveRuntime slug="one-move" title="One Move" />);

    expect(await screen.findByRole("button", { name: "Start run" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: GAME_RULES["one-move"].heading }),
    ).toBeInTheDocument();
  });
});

describe("the play route's ?start", () => {
  const validate = PlayRoute.options.validateSearch as (search: Record<string, unknown>) => {
    start?: boolean;
  };

  it("reads start=1 and start=true as start, and anything else as not", () => {
    expect(validate({ start: "1" })).toEqual({ start: true });
    expect(validate({ start: 1 })).toEqual({ start: true });
    expect(validate({ start: true })).toEqual({ start: true });
    expect(validate({})).toEqual({});
    expect(validate({ start: "yes" })).toEqual({});
  });
});
