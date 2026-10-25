import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OneMoveRuntime } from "@/components/game/OneMoveRuntime";
import { RunProgressContext } from "@/lib/games/run-progress";
import { Play } from "@/routes/play.$id";

/**
 * Leaving a game, as the player actually does it.
 *
 * The play screen is mounted in a router over a memory history, so every
 * assertion here is about the history the browser would keep — not just about
 * which page happened to render:
 *
 *   - the quit control on the start screen goes straight to the feed;
 *   - the quit control during a live run asks first, and only then goes to the feed;
 *   - the feed it lands on replaced the game, so Back cannot drop the player into
 *     the run they just quit;
 *   - "Back to One Move" still reaches the game's info page, and does not stack a
 *     second copy of it;
 *   - the phone/browser Back button is left alone: one step back, every time.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)),
  );
}

/** The catalogue entry and the session the One Move screen needs to be playable. */
function stubBackend() {
  mockFetch((url) => {
    if (url.includes("/complete")) {
      return jsonResponse({
        sessionId: "ffffffff-1111-4111-8111-ffffffffffff",
        gameSlug: "one-move",
        score: 0,
        clearedColumns: 0,
        tilesPlaced: 1,
        durationMs: 1200,
        ranked: false,
        recordedAt: "2026-10-23T12:01:00.000Z",
        personalBest: null,
        rank: null,
        duplicate: false,
      });
    }
    if (url.includes("/sessions")) {
      return jsonResponse(
        {
          id: "ffffffff-1111-4111-8111-ffffffffffff",
          gameSlug: "one-move",
          rulesVersion: "one-move@2",
          seed: "1",
          tileCount: 4096,
          startedAt: "2026-10-23T12:00:00.000Z",
          expiresAt: "2026-10-23T14:00:00.000Z",
          ranked: false,
        },
        201,
      );
    }
    if (url.includes("/games/one-move")) {
      return jsonResponse({
        slug: "one-move",
        title: "One Move",
        playable: true,
        runtime: "one-move",
        plays: 0,
      });
    }
    return jsonResponse({ message: "Not stubbed." }, 500);
  });
}

function renderPlay(initialEntries: string[]) {
  const root = createRootRoute();
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/", component: () => <p>For You</p> }),
    createRoute({
      getParentRoute: () => root,
      path: "/games/$id",
      component: () => <p>Game info</p>,
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/play/$id",
      component: () => <Play id="one-move" />,
    }),
    createRoute({ getParentRoute: () => root, path: "/explore", component: () => <p>Explore</p> }),
  ];

  const router = createRouter({
    routeTree: root.addChildren(routes),
    // A copy: the router rewrites the entries it is given, and the fixture is
    // shared between tests.
    history: createMemoryHistory({
      initialEntries: [...initialEntries],
      initialIndex: initialEntries.length - 1,
    }),
  });

  render(<RouterProvider router={router} />);
  return router;
}

/** Feed → game info → play, which is how a player reaches a game. */
const ENTERED_A_GAME = ["/", "/games/one-move", "/play/one-move"];

async function load(router: ReturnType<typeof renderPlay>) {
  await act(async () => {
    await router.load();
  });
}

async function press(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
  });
}

async function goBack(router: ReturnType<typeof renderPlay>) {
  await act(async () => {
    router.history.back();
  });
}

function pathname(router: ReturnType<typeof renderPlay>) {
  return router.state.location.pathname;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("quitting a game", () => {
  it("goes straight to the feed from the start screen, with no confirmation", async () => {
    stubBackend();
    const router = renderPlay(ENTERED_A_GAME);
    await load(router);

    await screen.findByRole("button", { name: "Start run" });
    await press(screen.getByRole("button", { name: "Quit game" }));

    await waitFor(() => expect(pathname(router)).toBe("/"));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    // The game was replaced by the feed, so Back lands on the info page the
    // player came through — never back inside the game they just left.
    await goBack(router);
    await waitFor(() => expect(pathname(router)).toBe("/games/one-move"));
  });

  it("asks before ending a live run and stays put when the player keeps playing", async () => {
    stubBackend();
    const router = renderPlay(ENTERED_A_GAME);
    await load(router);

    await press(await screen.findByRole("button", { name: "Start run" }));
    await screen.findByRole("group", { name: "Board 1, 3 by 3" });

    await press(screen.getByRole("button", { name: "Quit game" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("End this run?");
    expect(dialog).toHaveTextContent(/saves your score so far/);

    await press(screen.getByRole("button", { name: "Keep playing" }));

    expect(pathname(router)).toBe("/play/one-move");
    expect(screen.getByRole("group", { name: "Board 1, 3 by 3" })).toBeInTheDocument();
  });

  it("ends and saves the run once the player confirms, then leaves in one tap", async () => {
    stubBackend();
    const router = renderPlay(ENTERED_A_GAME);
    await load(router);

    await press(await screen.findByRole("button", { name: "Start run" }));
    await screen.findByRole("group", { name: "Board 1, 3 by 3" });
    // Board one restored: a run with a score worth keeping.
    await press(screen.getByRole("button", { name: /^Row 3 column 2,/ }));

    await press(screen.getByRole("button", { name: "Quit game" }));
    await press(await screen.findByRole("button", { name: "End run and save" }));

    // The run was submitted as it stood, and the verified result is shown.
    await screen.findByText("Run ended");
    const fetchSpy = vi.mocked(fetch);
    const completion = fetchSpy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toEqual([7]);
    expect(body.score).toBe(10);
    expect(pathname(router)).toBe("/play/one-move");

    // With the run saved there is nothing left to protect: quitting is one tap,
    // and it replaces the game so Back does not land inside it.
    await press(screen.getByRole("button", { name: "Quit game" }));
    await waitFor(() => expect(pathname(router)).toBe("/"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await goBack(router);
    await waitFor(() => expect(pathname(router)).toBe("/games/one-move"));
  });

  it("does not ask when the run has already ended", async () => {
    stubBackend();
    const router = renderPlay(ENTERED_A_GAME);
    await load(router);

    // A wrong tap ends the run: the board is replaced by the verified result, so
    // there is no longer any progress to protect.
    await press(await screen.findByRole("button", { name: "Start run" }));
    await screen.findByRole("group", { name: "Board 1, 3 by 3" });
    await press(screen.getByRole("button", { name: /^Row 1 column 2,/ }));
    await screen.findByText(/One move missed/i);

    await press(screen.getByRole("button", { name: "Quit game" }));

    await waitFor(() => expect(pathname(router)).toBe("/"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("going back to the game", () => {
  it("reaches the info page without stacking a second copy of it", async () => {
    stubBackend();
    const router = renderPlay(ENTERED_A_GAME);
    await load(router);

    const backToGame = await screen.findByRole("link", { name: "Back to One Move" });
    // Inside `<Button asChild>`, so the link has to keep the button's classes.
    expect(backToGame.className).toContain("inline-flex");
    await press(backToGame);
    await waitFor(() => expect(pathname(router)).toBe("/games/one-move"));

    // The play screen was replaced by the info page, so Back returns to the feed.
    // A pushed link would have left the game in between.
    await goBack(router);
    await waitFor(() => expect(pathname(router)).toBe("/"));
  });

  it("leaves the browser Back button as one honest step", async () => {
    stubBackend();
    const router = renderPlay(ENTERED_A_GAME);
    await load(router);

    await press(await screen.findByRole("button", { name: "Start run" }));
    await screen.findByRole("group", { name: "Board 1, 3 by 3" });

    // Back during a live run is not intercepted: it goes one step back, to the
    // info page, exactly as history says.
    await goBack(router);
    await waitFor(() => expect(pathname(router)).toBe("/games/one-move"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("the progress report", () => {
  it("is off while the rules are showing and on once a run is live", async () => {
    stubBackend();
    const report = vi.fn();
    const root = createRootRoute();
    const routes = [
      createRoute({
        getParentRoute: () => root,
        path: "/",
        component: () => (
          <RunProgressContext.Provider value={report}>
            <OneMoveRuntime slug="one-move" title="One Move" />
          </RunProgressContext.Provider>
        ),
      }),
      createRoute({ getParentRoute: () => root, path: "/games/$id", component: () => <p>Game</p> }),
    ];
    const router = createRouter({
      routeTree: root.addChildren(routes),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router} />);
    await act(async () => {
      await router.load();
    });

    await screen.findByRole("button", { name: "Start run" });
    expect(report).toHaveBeenLastCalledWith(false, undefined);

    // A live run is reported with the runtime's way to end it and save it.
    await press(screen.getByRole("button", { name: "Start run" }));
    await screen.findByRole("group", { name: "Board 1, 3 by 3" });
    expect(report).toHaveBeenLastCalledWith(true, expect.any(Function));
  });
});
