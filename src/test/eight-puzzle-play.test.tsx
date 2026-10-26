import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EightPuzzleRuntime } from "@/components/game/EightPuzzleRuntime";
import { clearSession, signIn } from "@/lib/auth/session";

/**
 * 8 Puzzle on screen, driven through the real API client against a stubbed
 * server.
 *
 * Seed 1's first board is 1 6 _ / 5 3 2 / 4 7 8, solved by sliding the tiles on
 * cells 5, 4, 1, 2, 5, 4, 3, 6, 7, 8 (a shortest solution: par 10). Like Zip, the
 * rules show with no session, Start asks for one, and the clock ends the run.
 */

const SOLVE_ONE = [5, 4, 1, 2, 5, 4, 3, 6, 7, 8];
const TILE = /^Tile \d, row \d column \d/;

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "cdcdcdcd-1111-4111-8111-cdcdcdcdcdcd",
    gameSlug: "8-puzzle",
    rulesVersion: "eight-puzzle@1",
    seed: "1",
    tileCount: 8192,
    startedAt: "2026-11-06T12:00:00.000Z",
    expiresAt: "2026-11-07T00:00:00.000Z",
    ranked: false,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "cdcdcdcd-1111-4111-8111-cdcdcdcdcdcd",
    gameSlug: "8-puzzle",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 40,
    clearedColumns: 4,
    tilesPlaced: 60,
    durationMs: 75_000,
    ranked: false,
    recordedAt: "2026-11-06T12:01:15.000Z",
    personalBest: null,
    rank: null,
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

function mockPlayback(sessionOverrides: Record<string, unknown> = {}, result = resultPayload()) {
  return mockFetch((url) =>
    url.includes("/complete")
      ? jsonResponse(result)
      : jsonResponse(sessionPayload(sessionOverrides), 201),
  );
}

async function renderRuntime() {
  const root = createRootRoute();
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => <EightPuzzleRuntime slug="8-puzzle" title="8 Puzzle" />,
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

/** The tile button sitting on a cell. */
function tileAt(cell: number) {
  const row = Math.floor(cell / 3) + 1;
  const column = (cell % 3) + 1;
  return screen.getByRole("button", {
    name: new RegExp(`^Tile \\d, row ${row} column ${column}\\b`),
  });
}

function slide(cells: readonly number[]) {
  for (const cell of cells) fireEvent.click(tileAt(cell));
}

function scoreShown() {
  return screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent;
}

async function startRun() {
  fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
  await screen.findByRole("group", { name: /^Board 1, 3 by 3/ });
}

function sessionCalls(spy: ReturnType<typeof mockFetch>) {
  return spy.mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/sessions"));
}

function completionBody(spy: ReturnType<typeof mockFetch>) {
  const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
  return JSON.parse(String(completion?.[1]?.body ?? "{}"));
}

async function endRun() {
  fireEvent.click(screen.getByRole("button", { name: "End run" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "End run" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("starting a run", () => {
  it("shows the rules with no session, and asks for one only on Start", async () => {
    const spy = mockPlayback();
    await renderRuntime();

    expect(screen.getByRole("heading", { name: "Slide it home" })).toBeInTheDocument();
    expect(screen.getByText(/1 to 8 in reading/)).toBeInTheDocument();
    expect(screen.getByText(/starts at 60 seconds/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await startRun();

    expect(JSON.parse(String(sessionCalls(spy)[0][1]?.body ?? "{}"))).toEqual({
      gameSlug: "8-puzzle",
      rulesVersion: "eight-puzzle@1",
      client: "web/1.0",
    });
    expect(screen.getAllByRole("button", { name: TILE })).toHaveLength(8);
    expect(screen.getByText("0 moves · par 10")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Time left" })).toHaveAttribute(
      "aria-valuenow",
      "60",
    );
  });
});

describe("sliding tiles", () => {
  it("slides a tile next to the gap, and nothing off the gap's row and column", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    // The gap is on cell 2; cell 3 is neither in its row nor in its column.
    fireEvent.click(tileAt(3));
    expect(screen.getByText("0 moves · par 10")).toBeInTheDocument();

    expect(tileAt(5)).toHaveAccessibleName(/^Tile 2, .*Tap to slide it into the gap\./);
    slide([5]);
    expect(tileAt(2)).toHaveAccessibleName(/^Tile 2, row 1 column 3/);
    expect(screen.getByText("1 move · par 10")).toBeInTheDocument();
  });

  it("slides two tiles at once from the far end of the gap's row", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    // The gap is on cell 2. Tapping the 1 on cell 0 slides it and the tile on
    // cell 1 one cell right, as two ordinary slides; the gap ends on cell 0.
    expect(tileAt(0)).toHaveAccessibleName(
      "Tile 1, row 1 column 1, in place. Tap to slide it and the tiles between it and the gap.",
    );
    fireEvent.click(tileAt(0));
    expect(tileAt(1)).toHaveAccessibleName(/^Tile 1, row 1 column 2/);
    expect(screen.getByText("2 moves · par 10")).toBeInTheDocument();
  });

  it("slides with the arrow keys: ArrowUp moves the tile below the gap up", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    const group = screen.getByRole("group", { name: /^Board 1/ });
    expect(document.activeElement).toBe(group);
    fireEvent.keyDown(group, { key: "ArrowUp" });
    expect(tileAt(2)).toHaveAccessibleName(/^Tile 2, row 1 column 3/);
    // ArrowDown moves the tile above the gap down: the same tile, back again.
    fireEvent.keyDown(group, { key: "ArrowDown" });
    expect(tileAt(5)).toHaveAccessibleName(/^Tile 2, row 2 column 3/);
    expect(screen.getByText("2 moves · par 10")).toBeInTheDocument();
  });

  it("solves a board on its last slide, scores ten and deals the next", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    slide(SOLVE_ONE);

    expect(screen.getByRole("group", { name: /^Board 2, 3 by 3/ })).toBeInTheDocument();
    expect(screen.getByText(/Board 1 solved, \+10/)).toBeInTheDocument();
    expect(scoreShown()).toBe("10");
    expect(screen.getByText("0 moves · par 9")).toBeInTheDocument();
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuemax"))).toBe(75);
  });
});

describe("finishing a run", () => {
  it("ends the run when the clock runs out, and submits every slide", async () => {
    const spy = mockPlayback({}, resultPayload({ score: 10, clearedColumns: 1, tilesPlaced: 10 }));
    await renderRuntime();
    await startRun();

    slide(SOLVE_ONE);
    // Seventy-six seconds later: past the 75 the first board earned.
    const later = Date.now() + 76_000;
    vi.spyOn(Date, "now").mockImplementation(() => later);
    slide([4]);

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Time's up")).toBeInTheDocument();
    const body = completionBody(spy);
    expect(body.progress.rulesVersion).toBe("eight-puzzle@1");
    expect(body.progress.actions).toEqual(SOLVE_ONE);
    expect(body.score).toBe(10);
  });

  it("lets the player end the run, and shows the score the server verified", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();
    slide(SOLVE_ONE);
    await endRun();

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Run ended")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("60 slides, 4 boards solved.")).toBeInTheDocument();
    expect(completionBody(spy).score).toBe(10);
  });

  it("goes back to the rules, and asks for a new session on Start", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();
    await endRun();
    fireEvent.click(await screen.findByRole("button", { name: /play again/i }));

    expect(await screen.findByRole("heading", { name: "Slide it home" })).toBeInTheDocument();
    await startRun();
    expect(sessionCalls(spy)).toHaveLength(2);
  });

  it("retries a failed verification with the same submission", async () => {
    let completions = 0;
    const spy = mockFetch((url) => {
      if (!url.includes("/complete")) return jsonResponse(sessionPayload(), 201);
      completions += 1;
      return completions === 1
        ? jsonResponse(
            {
              error: {
                code: "unprocessable_entity",
                message: "That run finished after its clock ran out, so it cannot be scored.",
              },
            },
            422,
          )
        : jsonResponse(resultPayload());
    });
    await renderRuntime();
    await startRun();
    await endRun();

    await screen.findByText("Your run was not verified");
    fireEvent.click(screen.getByRole("button", { name: /try submitting again/i }));
    await screen.findByRole("button", { name: /play again/i });
    const bodies = spy.mock.calls
      .filter((call) => String(call[0]).includes("/complete"))
      .map((call) => String(call[1]?.body ?? ""));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
  });

  it("ranks a signed-in player's run", async () => {
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
    const spy = mockPlayback(
      { ranked: true },
      resultPayload({ ranked: true, rank: 2, personalBest: 90 }),
    );
    await renderRuntime();
    expect(screen.getByText("Signed in: this run can be ranked")).toBeInTheDocument();
    await startRun();
    await endRun();
    await screen.findByRole("button", { name: /play again/i });

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    expect(new Headers(completion?.[1]?.headers).get("Authorization")).toBe(
      "Bearer access-token-1",
    );
    expect(screen.getByText("#2")).toBeInTheDocument();
  });
});
