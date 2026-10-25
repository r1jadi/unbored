import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ZipRuntime } from "@/components/game/ZipRuntime";
import { clearSession, signIn } from "@/lib/auth/session";

/**
 * Zip on screen.
 *
 * Driven through the real API client against a stubbed server. Seed 1's first
 * board (5×5) is solved by the path 8, 7, 6, 5, 10, 15, 20, 21, 16, 11, 12, 17,
 * 22, 23, 24, 19, 18, 13, 14, 9, 4, 3, 2, 1, 0; its numbers are 8 → 1, 6 → 2,
 * 16 → 3, 12 → 4, 24 → 5, 14 → 6, 2 → 7 and 0 → 8.
 *
 * What matters here, beyond the shape every game shares:
 *
 *   - the rules show with no session behind them, and Start is what asks for one,
 *     because the server times the run from the session's start;
 *   - the board refuses a move its own rules forbid, even one the verifier would
 *     accept;
 *   - the clock ends the run by itself and submits it.
 */

const BOARD_ONE = [
  8, 7, 6, 5, 10, 15, 20, 21, 16, 11, 12, 17, 22, 23, 24, 19, 18, 13, 14, 9, 4, 3, 2, 1, 0,
];
const CELL = /^Row \d+ column \d+,/;

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "abababab-1111-4111-8111-abababababab",
    gameSlug: "zip",
    rulesVersion: "zip@1",
    seed: "1",
    tileCount: 8192,
    startedAt: "2026-11-05T12:00:00.000Z",
    expiresAt: "2026-11-06T00:00:00.000Z",
    ranked: false,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "abababab-1111-4111-8111-abababababab",
    gameSlug: "zip",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 150,
    clearedColumns: 3,
    tilesPlaced: 90,
    durationMs: 61_000,
    ranked: false,
    recordedAt: "2026-11-05T12:01:00.000Z",
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
      component: () => <ZipRuntime slug="zip" title="Zip" />,
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

function cell(index: number, size = 5) {
  const row = Math.floor(index / size) + 1;
  const column = (index % size) + 1;
  return screen.getByRole("button", { name: new RegExp(`^Row ${row} column ${column},`) });
}

/** A keyboard-style click (detail 0), which is how a cell button taps. */
function tapCells(cells: readonly number[], size = 5) {
  for (const index of cells) fireEvent.click(cell(index, size));
}

function scoreShown() {
  return screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent;
}

async function startRun() {
  fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
  await screen.findByRole("group", { name: "Board 1, 5 by 5" });
}

function sessionCalls(spy: ReturnType<typeof mockFetch>) {
  return spy.mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/sessions"));
}

function completionBody(spy: ReturnType<typeof mockFetch>) {
  const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
  return JSON.parse(String(completion?.[1]?.body ?? "{}"));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("starting a run", () => {
  it("shows the rules with no session, and asks for one only on Start", async () => {
    const spy = mockPlayback();
    await renderRuntime();

    expect(screen.getByRole("heading", { name: "Fill the grid" })).toBeInTheDocument();
    expect(screen.getByText(/visit every cell exactly once/)).toBeInTheDocument();
    expect(screen.getByText(/starts at 60 seconds/)).toBeInTheDocument();
    expect(screen.getByText("Guest run: verified, but not ranked")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await startRun();

    expect(sessionCalls(spy)).toHaveLength(1);
    expect(JSON.parse(String(sessionCalls(spy)[0][1]?.body ?? "{}"))).toEqual({
      gameSlug: "zip",
      rulesVersion: "zip@1",
      client: "web/1.0",
    });
    expect(screen.getAllByRole("button", { name: CELL })).toHaveLength(25);
    expect(screen.getByText("Board 1 — start on 1.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Time left" })).toHaveAttribute(
      "aria-valuenow",
      "60",
    );
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
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await screen.findByText("Couldn't start a run");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByRole("group", { name: "Board 1, 5 by 5" });
  });
});

describe("drawing the path", () => {
  it("starts only on 1, extends to neighbours, and goes back to undo", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    tapCells([0]); // the 8, not the 1
    expect(cell(0)).toHaveAccessibleName(/number 8, empty\.$/);

    tapCells([8, 7, 6, 5]);
    expect(cell(7)).toHaveAccessibleName(/on the path\. Tap to go back to here\./);
    expect(cell(5)).toHaveAccessibleName(/blank, on the path\.$/); // the head is not a move

    tapCells([7]);
    expect(cell(6)).toHaveAccessibleName(/number 2, empty\. Tap to extend the path\./);
    expect(cell(5)).toHaveAccessibleName(/blank, empty/);
  });

  it("refuses a number reached out of order", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    tapCells([8, 7, 2]); // 2 holds the 7
    expect(cell(2)).toHaveAccessibleName(/number 7, empty\.$/);
    expect(cell(7)).toHaveAccessibleName(/on the path/);
  });

  it("solves a board on the last cell of its path, scores it and deals the next", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    tapCells(BOARD_ONE);

    expect(screen.getByRole("group", { name: "Board 2, 5 by 5" })).toBeInTheDocument();
    expect(screen.getByText("Board 1 solved, +50. Start on 1.")).toBeInTheDocument();
    expect(scoreShown()).toBe("50");
    // Sixty seconds plus the twenty-five a 5×5 board buys.
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuemax"))).toBe(85);
  });

  it("draws with a pointer drag across the board", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    const group = screen.getByRole("group", { name: "Board 1, 5 by 5" });
    const original = document.elementFromPoint;
    let under = cell(8);
    document.elementFromPoint = () => under;
    try {
      fireEvent.pointerDown(group, { clientX: 1, clientY: 1, pointerId: 1 });
      for (const index of [7, 6, 5]) {
        under = cell(index);
        fireEvent.pointerMove(group, { clientX: 1, clientY: 1, pointerId: 1 });
      }
      fireEvent.pointerUp(group, { pointerId: 1 });
    } finally {
      document.elementFromPoint = original;
    }
    expect(cell(5)).toHaveAccessibleName(/on the path/);
    expect(cell(10)).toHaveAccessibleName(/Tap to extend the path/);
  });
});

describe("finishing a run", () => {
  it("ends the run when the clock runs out, and submits every cell", async () => {
    const spy = mockPlayback({}, resultPayload({ score: 50, clearedColumns: 1 }));
    await renderRuntime();
    await startRun();

    tapCells(BOARD_ONE);
    tapCells([20, 15]);

    // Eighty-six seconds later: past the 85 the first board earned. The next tap
    // finds the clock over, and the run ends there.
    const later = Date.now() + 86_000;
    vi.spyOn(Date, "now").mockImplementation(() => later);
    tapCells([10]);

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Time's up")).toBeInTheDocument();
    expect(screen.getByText("1 board solved.")).toBeInTheDocument();
    const body = completionBody(spy);
    expect(body.progress.rulesVersion).toBe("zip@1");
    expect(body.progress.actions).toEqual([...BOARD_ONE, 20, 15]);
    expect(body.score).toBe(50);
  });

  it("lets the player end the run after confirming, and shows the verified score", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    tapCells(BOARD_ONE);
    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "End run" }));

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Run ended")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument(); // the server's number
    expect(completionBody(spy).score).toBe(50);
  });

  it("goes back to the rules for a fresh run, and asks for a new session on Start", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();
    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "End run" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /play again/i }));

    expect(await screen.findByRole("heading", { name: "Fill the grid" })).toBeInTheDocument();
    expect(sessionCalls(spy)).toHaveLength(1);
    await startRun();
    expect(sessionCalls(spy)).toHaveLength(2);
  });

  it("explains a refused late run and retries the same submission", async () => {
    let completions = 0;
    const spy = mockFetch((url) => {
      if (!url.includes("/complete")) return jsonResponse(sessionPayload(), 201);
      completions += 1;
      return completions === 1
        ? jsonResponse(
            {
              error: {
                code: "unprocessable",
                message: "That run finished after its clock ran out, so it cannot be scored.",
              },
            },
            422,
          )
        : jsonResponse(resultPayload());
    });
    await renderRuntime();
    await startRun();
    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "End run" }),
    );

    await screen.findByText("Your run was not verified");
    expect(screen.getByText(/after its clock ran out/)).toBeInTheDocument();
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
      resultPayload({ ranked: true, rank: 4, personalBest: 200 }),
    );
    await renderRuntime();
    expect(screen.getByText("Signed in: this run can be ranked")).toBeInTheDocument();
    await startRun();
    expect(screen.getByText("Ranked")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "End run" }),
    );
    await screen.findByRole("button", { name: /play again/i });

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    expect(new Headers(completion?.[1]?.headers).get("Authorization")).toBe(
      "Bearer access-token-1",
    );
    expect(screen.getByText("#4")).toBeInTheDocument();
  });
});
