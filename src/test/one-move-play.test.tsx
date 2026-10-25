import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OneMoveRuntime } from "@/components/game/OneMoveRuntime";
import { clearSession, signIn } from "@/lib/auth/session";

/**
 * One Move on screen.
 *
 * The screen is mounted in a router because its end-of-run panel is a set of
 * links, and it is driven through the real API client against a stubbed server —
 * so what is asserted here is the whole path: a session is issued, the rules are
 * shown, boards are restored, the taps are submitted, and the number that appears
 * is the one the server verified.
 *
 * Seed 1 wins on cells 7, 8, 7, 7, 0, 8, 6, 2, 5, 18, 13, 5, 11, 21, 33, 20,
 * 20, 9, 47, 39. The states that matter are the ones a careless implementation
 * fudges:
 *
 *   - no board is playable before the player has read the rules and started;
 *   - a score is never shown as verified before it is;
 *   - a guest's run is shown as a guest's run, not quietly ranked;
 *   - a failed submission keeps the run and can be retried.
 */

/** A session issued under One Move rules, per the contract. */
function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "ffffffff-1111-4111-8111-ffffffffffff",
    gameSlug: "one-move",
    rulesVersion: "one-move@2",
    seed: "1",
    tileCount: 4096,
    startedAt: "2026-10-21T12:00:00.000Z",
    expiresAt: "2026-10-21T14:00:00.000Z",
    ranked: true,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "ffffffff-1111-4111-8111-ffffffffffff",
    gameSlug: "one-move",
    // Deliberately not the client's 10: the screen must show the verified number.
    score: 40,
    clearedColumns: 1,
    tilesPlaced: 2,
    durationMs: 3800,
    ranked: true,
    recordedAt: "2026-10-21T12:01:00.000Z",
    personalBest: 120,
    rank: 2,
    duplicate: false,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** A server that issues a session and verifies whatever run is submitted. */
function mockPlayback(sessionOverrides: Record<string, unknown> = {}) {
  return mockFetch((url) =>
    url.includes("/complete")
      ? jsonResponse(resultPayload())
      : jsonResponse(sessionPayload(sessionOverrides), 201),
  );
}

async function renderRuntime() {
  const root = createRootRoute();
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => <OneMoveRuntime slug="one-move" title="One Move" />,
    }),
    createRoute({ getParentRoute: () => root, path: "/games/$id", component: () => <p>Game</p> }),
    createRoute({
      getParentRoute: () => root,
      path: "/leaderboards/$id",
      component: () => <p>Board</p>,
    }),
    createRoute({ getParentRoute: () => root, path: "/login", component: () => <p>Sign in</p> }),
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

/** Seed 1's winning cells, in level order. */
const SEED_ONE_PERFECT = [7, 8, 7, 7, 0, 8, 6, 2, 5, 18, 13, 5, 11, 21, 33, 20, 20, 9, 47, 39];

/** The side of each level's board, matching `boardSize` in the engine. */
function sizeOf(level: number): number {
  return 3 + Math.floor((level - 1) / 4);
}

/** Clicks the cell at a board index, addressed by the row and column it names. */
function tapIndex(index: number, level: number) {
  const size = sizeOf(level);
  const row = Math.floor(index / size) + 1;
  const column = (index % size) + 1;
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(`^Row ${row} column ${column},`) }),
  );
}

/** Presses Start and returns the live board. */
async function startRun() {
  fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
  await screen.findByRole("group", { name: "Board 1, 3 by 3" });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("starting a run", () => {
  it("issues a session before it shows the rules or a board", async () => {
    // The session response is held open, which is the only way to observe the
    // state before it arrives: rules with no session behind them would be a
    // promise the screen could not keep.
    let release: (() => void) | null = null;
    const spy = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(jsonResponse(sessionPayload(), 201));
        }),
    );
    vi.stubGlobal("fetch", spy);

    await renderRuntime();

    expect(screen.getByText("Starting a run…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start run" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Board / })).not.toBeInTheDocument();

    await act(async () => {
      release?.();
    });

    expect(await screen.findByRole("button", { name: "Start run" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "One move away" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Board / })).not.toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("asks for a One Move session, not another game's rules", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await screen.findByRole("button", { name: "Start run" });

    const start = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(start?.[1]?.body ?? "{}"))).toEqual({
      gameSlug: "one-move",
      rulesVersion: "one-move@2",
      client: "web/1.0",
    });
  });

  it("explains the rules and does not offer a board until the player starts", async () => {
    mockPlayback();
    await renderRuntime();

    expect(await screen.findByRole("heading", { name: "One move away" })).toBeInTheDocument();
    expect(
      screen.getByText(/flips one cell and the cells above, below, left and right/),
    ).toBeInTheDocument();
    expect(screen.getByText(/A wrong tap/)).toBeInTheDocument();
    expect(screen.getByText("Signed in: this run can be ranked")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /^Row \d+ column \d+,/ })).toHaveLength(0);

    await startRun();

    expect(screen.getByText("Board 1")).toBeInTheDocument();
    expect(screen.getByText("3×3")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Row \d+ column \d+,/ })).toHaveLength(9);
  });

  it("moves focus onto the first cell when the rules give way to the board", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Row 1 column 1,/ }));
  });

  it("reports a failed start with a retry rather than an empty board", async () => {
    let attempts = 0;
    mockFetch(() => {
      attempts += 1;
      return attempts === 1
        ? jsonResponse(
            {
              error: {
                code: "service_unavailable",
                message: "Play sessions are not available right now.",
              },
            },
            503,
          )
        : jsonResponse(sessionPayload(), 201);
    });

    await renderRuntime();

    await screen.findByText("Couldn't start a run");
    expect(screen.getByText("Play sessions are not available right now.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByRole("button", { name: "Start run" });
  });
});

describe("playing the board", () => {
  it("restores a board on its one winning cell and grows the next one", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    // Board one wins on cell 7: row three, column two.
    tapIndex(7, 1);

    expect(screen.getByText("Board 2")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Board 2, 3 by 3" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Row \d+ column \d+,/ })).toHaveLength(9);
    expect(screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent).toBe("10");
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();

    // Board two wins on cell 8: row three, column three.
    tapIndex(8, 2);
    expect(screen.getByText("Board 3")).toBeInTheDocument();
  });

  it("keeps every cell a real button, so the board is keyboard reachable", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    const cells = screen.getAllByRole("button", { name: /^Row \d+ column \d+,/ });
    expect(cells).toHaveLength(9);
    for (const cell of cells) {
      // A native button is activated by Enter and Space, and Tab reaches every
      // cell, without a key handler that could swallow the press or the scroll.
      expect(cell.tagName).toBe("BUTTON");
      expect(cell).toHaveAttribute("type", "button");
      expect(cell).toBeEnabled();
    }
  });

  it("grows the board at every fourth level and keeps going past 5×5", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    SEED_ONE_PERFECT.slice(0, 4).forEach((index, levelIndex) => {
      tapIndex(index, levelIndex + 1);
    });

    expect(screen.getByRole("group", { name: "Board 5, 4 by 4" })).toBeInTheDocument();
    expect(screen.getByText("4×4")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Row \d+ column \d+,/ })).toHaveLength(16);

    SEED_ONE_PERFECT.slice(4, 12).forEach((index, levelIndex) => {
      tapIndex(index, levelIndex + 5);
    });

    expect(screen.getByRole("group", { name: "Board 13, 6 by 6" })).toBeInTheDocument();
    expect(screen.getByText("6×6")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Row \d+ column \d+,/ })).toHaveLength(36);

    SEED_ONE_PERFECT.slice(12, 16).forEach((index, levelIndex) => {
      tapIndex(index, levelIndex + 13);
    });

    expect(screen.getByRole("group", { name: "Board 17, 7 by 7" })).toBeInTheDocument();
    expect(screen.getByText("7×7")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Row \d+ column \d+,/ })).toHaveLength(49);
  });
});

describe("finishing a run", () => {
  it("ends the run on a wrong cell, and submits that ending", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    // Board one wins on 7; cell 0 is a corner, not the move.
    tapIndex(0, 1);

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("One move missed")).toBeInTheDocument();

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toEqual([0]);
    expect(body.progress.rulesVersion).toBe("one-move@2");
    expect(body.score).toBe(0);
  });

  it("submits the run and shows the score the server verified", async () => {
    mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(resultPayload({ score: 40, clearedColumns: 1, tilesPlaced: 2 }))
        : jsonResponse(sessionPayload(), 201),
    );
    await renderRuntime();
    await startRun();

    tapIndex(7, 1);
    tapIndex(0, 2);

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("One move missed")).toBeInTheDocument();
    // The verified 40, not the 10 the board had accumulated.
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("2 taps, 1 board restored.")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument(); // personal best
    expect(screen.getByText("#2")).toBeInTheDocument(); // rank
    expect(screen.getByText(/Verified by replaying your taps on the server/)).toBeInTheDocument();
  });

  it("plays past the retired twelfth board and submits the endless line", async () => {
    const spy = mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(resultPayload({ score: 200, clearedColumns: 20, tilesPlaced: 21 }))
        : jsonResponse(sessionPayload(), 201),
    );
    await renderRuntime();
    await startRun();

    SEED_ONE_PERFECT.forEach((index, levelIndex) => {
      tapIndex(index, levelIndex + 1);
    });

    // Twenty boards restored, and the game is still asking for twenty-one. The
    // retired game ended at twelve; this screen has no such state.
    expect(screen.getByText("Board 21")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Board 21, 8 by 8" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Row \d+ column \d+,/ })).toHaveLength(64);
    expect(screen.queryByRole("button", { name: /play again/i })).toBeNull();

    // Board twenty-one wins on 7; a corner is not the move, and ends the run.
    tapIndex(0, 21);

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("One move missed")).toBeInTheDocument();
    expect(screen.getByText("21 taps, 20 boards restored.")).toBeInTheDocument();

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toEqual([...SEED_ONE_PERFECT, 0]);
    expect(body.progress.actions).toHaveLength(21);
    expect(body.progress.rulesVersion).toBe("one-move@2");
    expect(body.score).toBe(200);
  });

  it("ends the run where the player stops, and saves the score so far", async () => {
    const spy = mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(resultPayload({ score: 20, clearedColumns: 2, tilesPlaced: 2 }))
        : jsonResponse(sessionPayload(), 201),
    );
    await renderRuntime();
    await startRun();

    tapIndex(7, 1);
    tapIndex(8, 2);
    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Your score of 20 is kept");
    fireEvent.click(within(dialog).getByRole("button", { name: "End run" }));

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Run ended")).toBeInTheDocument();
    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toEqual([7, 8]);
    expect(body.score).toBe(20);
  });

  it("starts a fresh run from the end-of-run screen, rules first", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    tapIndex(0, 1);
    await screen.findByRole("button", { name: /play again/i });

    fireEvent.click(screen.getByRole("button", { name: /play again/i }));

    // A new run starts from nothing: the rules are shown again, and no board is
    // playable until the new session has arrived and Start is pressed.
    expect(await screen.findByRole("heading", { name: "One move away" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Board / })).not.toBeInTheDocument();
    const sessions = spy.mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(sessions).toHaveLength(2);
  });

  it("reports a guest's run as unranked, and says where it is not", async () => {
    mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(resultPayload({ ranked: false, rank: null, personalBest: null }))
        : jsonResponse(sessionPayload({ ranked: false }), 201),
    );
    await renderRuntime();
    expect(await screen.findByText("Guest run: verified, but not ranked")).toBeInTheDocument();

    await startRun();
    tapIndex(0, 1);
    await screen.findByRole("button", { name: /play again/i });

    expect(
      screen.getByText(/This was a guest run, so it is not on the leaderboard\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in to rank your scores/i })).toBeInTheDocument();
    expect(screen.queryByText("Rank")).not.toBeInTheDocument();
  });

  it("reports a failed verification without claiming the run was saved", async () => {
    let completions = 0;
    const spy = mockFetch((url) => {
      if (!url.includes("/complete")) return jsonResponse(sessionPayload(), 201);
      completions += 1;
      return completions === 1
        ? jsonResponse(
            {
              error: {
                code: "conflict",
                message: "That run expired before it was submitted. Start a new one.",
              },
            },
            409,
          )
        : jsonResponse(resultPayload());
    });

    await renderRuntime();
    await startRun();

    tapIndex(0, 1);
    await screen.findByText("Your run was not verified");
    expect(
      screen.getByText(/That run expired before it was submitted\. Start a new one\./),
    ).toBeInTheDocument();
    expect(screen.queryByText("40")).not.toBeInTheDocument();

    // Retrying re-sends the same run — which is safe, because the server
    // recognises it — rather than starting over.
    fireEvent.click(screen.getByRole("button", { name: /try submitting again/i }));

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("40")).toBeInTheDocument();
    const sessions = spy.mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(sessions).toHaveLength(1);
    const bodies = spy.mock.calls
      .filter((call) => String(call[0]).includes("/complete"))
      .map((call) => String(call[1]?.body ?? ""));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
  });

  it("ranks a signed-in player's run", async () => {
    // A real token in the store, so the API calls carry it and the run is ranked.
    mockFetch(() =>
      jsonResponse({
        session: { userId: "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f", role: "user" },
        tokens: {
          accessToken: "access-token-1",
          refreshToken: "refresh-token-1",
          tokenType: "bearer",
        },
      }),
    );
    await signIn("player@example.com", "correct-horse");

    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    tapIndex(0, 1);
    await screen.findByRole("button", { name: /play again/i });

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const headers = new Headers(completion?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer access-token-1");
    expect(screen.getByText("#2")).toBeInTheDocument();
  });
});
