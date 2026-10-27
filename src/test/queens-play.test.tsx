import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QueensRuntime } from "@/components/game/QueensRuntime";
import { buttonNamed } from "@/test/queries";
import { clearSession, signIn } from "@/lib/auth/session";
import { board } from "@/lib/games/queens";

/**
 * Queens on screen.
 *
 * The screen is mounted in a router because its end-of-run panel is a set of
 * links, and it is driven through the real API client against a stubbed server —
 * so what is asserted is the whole path: a session is issued, the rules are shown,
 * boards are solved, the taps are submitted, and the number that appears is the
 * one the server verified.
 *
 * Seed 1's first board (5×5) is solved by cells 1, 8, 10, 19, 22; its second
 * board (6×6) by cells 4, 7, 15, 18, 29, 32. The states that matter:
 *
 *   - no board is playable before the player has read the rules and started;
 *   - a tap cycles X, Queen and empty, and a wrong Queen is a mistake;
 *   - the third mistake, or the player ending the run, submits it;
 *   - a score is never shown as verified before it is;
 *   - a failed submission keeps the run and can be retried.
 */

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "99999999-1111-4111-8111-999999999999",
    gameSlug: "crowns",
    rulesVersion: "queens@1",
    seed: "1",
    tileCount: 8192,
    startedAt: "2026-11-04T12:00:00.000Z",
    expiresAt: "2026-11-05T00:00:00.000Z",
    ranked: true,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "99999999-1111-4111-8111-999999999999",
    gameSlug: "crowns",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 70,
    clearedColumns: 1,
    tilesPlaced: 16,
    durationMs: 61_000,
    ranked: true,
    recordedAt: "2026-11-04T12:01:00.000Z",
    personalBest: 260,
    rank: 3,
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
      component: () => <QueensRuntime slug="crowns" title="Crowns" />,
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

const BOARD_ONE = [1, 8, 10, 19, 22];
const BOARD_TWO = [4, 7, 15, 18, 29, 32];
const CELL = /^Row \d+ column \d+,/;

function cell(index: number, size: number) {
  const row = Math.floor(index / size) + 1;
  const column = (index % size) + 1;
  return buttonNamed(new RegExp(`^Row ${row} column ${column},`));
}

function tapIndex(index: number, size: number) {
  fireEvent.click(cell(index, size));
}

/** Two taps: an X, then a Queen. */
function placeQueen(index: number, size: number) {
  tapIndex(index, size);
  tapIndex(index, size);
}

function scoreShown() {
  return screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent;
}

async function startRun() {
  fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
  await screen.findByRole("group", { name: "Board 1, 5 by 5" });
}

function completionBody(spy: ReturnType<typeof mockFetch>) {
  const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
  return JSON.parse(String(completion?.[1]?.body ?? "{}"));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("starting a run", () => {
  it("issues a session before it shows the rules or a board", async () => {
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

    await act(async () => {
      release?.();
    });

    expect(await screen.findByRole("button", { name: "Start run" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "One crown each" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Board / })).not.toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("asks for a Queens session, not another game's rules", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await screen.findByRole("button", { name: "Start run" });

    const start = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(start?.[1]?.body ?? "{}"))).toEqual({
      gameSlug: "crowns",
      rulesVersion: "queens@1",
      client: "web/1.0",
    });
  });

  it("explains the rules and offers no board until the player starts", async () => {
    mockPlayback();
    await renderRuntime();

    expect(await screen.findByRole("heading", { name: "One crown each" })).toBeInTheDocument();
    expect(screen.getByText(/every row, every column and every colour region/)).toBeInTheDocument();
    expect(screen.getByText(/not even\s+diagonally/)).toBeInTheDocument();
    expect(screen.getByText(/twice for a crown, and a third time to clear it/)).toBeInTheDocument();
    expect(screen.getByText("Signed in: this run can be ranked")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: CELL })).toHaveLength(0);

    await startRun();

    expect(screen.getByText("Board 1")).toBeInTheDocument();
    expect(screen.getByText("5×5")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: CELL })).toHaveLength(25);
    expect(document.activeElement).toBe(cell(0, 5));
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
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByRole("button", { name: "Start run" });
  });
});

describe("playing the board", () => {
  it("draws the engine's regions, one per row", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    const { regions } = board("1", 1);
    regions.forEach((region, index) => {
      expect(cell(index, 5)).toHaveAccessibleName(new RegExp(`, region ${region + 1}, empty`));
    });
  });

  it("cycles a cell through an X, a Queen and empty", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    tapIndex(1, 5);
    expect(cell(1, 5)).toHaveAccessibleName(/marked X\. Tap to place a crown\./);
    tapIndex(1, 5);
    expect(cell(1, 5)).toHaveAccessibleName(/crown\. Tap to clear it\./);
    expect(screen.getByText("1")).toBeInTheDocument(); // one of five Queens
    tapIndex(1, 5);
    expect(cell(1, 5)).toHaveAccessibleName(/, empty\. Tap to mark an X\./);
  });

  it("marks the cells a Queen rules out, without changing them", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    placeQueen(1, 5);
    // Row 1, column 2's neighbours and its row are ruled out; the taps are only two.
    expect(cell(0, 5)).toHaveAccessibleName(/empty, ruled out by a crown/);
    expect(cell(6, 5)).toHaveAccessibleName(/empty, ruled out by a crown/);
    expect(cell(21, 5)).toHaveAccessibleName(/empty, ruled out by a crown/);
    expect(cell(13, 5)).toHaveAccessibleName(/, empty\. Tap/);
  });

  it("counts a wrong Queen as a mistake and locks its cell", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    placeQueen(0, 5);

    expect(screen.getByText("No crown goes there. 2 mistakes left.")).toBeInTheDocument();
    expect(cell(0, 5)).toBeDisabled();
    expect(cell(0, 5)).toHaveAccessibleName(/ruled out by a mistake/);
    expect(screen.getByRole("img", { name: "2 of 3 mistakes left" })).toBeInTheDocument();
  });

  it("solves a board on its last Queen, scores it and deals a larger one", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    BOARD_ONE.forEach((index) => placeQueen(index, 5));

    expect(screen.getByRole("group", { name: "Board 2, 6 by 6" })).toBeInTheDocument();
    expect(screen.getByText("Board 1 solved, +50. Board 2 is 6×6.")).toBeInTheDocument();
    expect(scoreShown()).toBe("50");
    expect(screen.getAllByRole("button", { name: CELL })).toHaveLength(36);
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();

    BOARD_TWO.forEach((index) => placeQueen(index, 6));
    expect(screen.getByRole("group", { name: "Board 3, 6 by 6" })).toBeInTheDocument();
    expect(scoreShown()).toBe("110");
  });

  it("keeps every cell a real button and the board inside a square that fits", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    const group = screen.getByRole("group", { name: "Board 1, 5 by 5" });
    expect(group).toHaveClass("aspect-square", "w-full");
    expect(group.style.maxWidth).toContain("100dvh");
    for (const button of within(group).getAllByRole("button")) {
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");
    }
  });
});

describe("finishing a run", () => {
  it("ends the run on the third mistake and submits every tap", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    BOARD_ONE.forEach((index) => placeQueen(index, 5));
    tapIndex(4, 6);
    tapIndex(4, 6);
    tapIndex(4, 6);
    placeQueen(0, 6);
    placeQueen(1, 6);
    placeQueen(2, 6);

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Out of mistakes")).toBeInTheDocument();

    const body = completionBody(spy);
    expect(body.progress.actions).toEqual([
      1, 1, 8, 8, 10, 10, 19, 19, 22, 22, 4, 4, 4, 0, 0, 1, 1, 2, 2,
    ]);
    expect(body.progress.rulesVersion).toBe("queens@1");
    expect(body.score).toBe(50);
  });

  it("lets the player end the run, keeping the score, after confirming", async () => {
    const spy = mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(resultPayload({ score: 50, tilesPlaced: 11 }))
        : jsonResponse(sessionPayload(), 201),
    );
    await renderRuntime();
    await startRun();

    BOARD_ONE.forEach((index) => placeQueen(index, 5));
    tapIndex(4, 6);

    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    expect(await screen.findByText("End this run?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(spy.mock.calls.some((call) => String(call[0]).includes("/complete"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "End run" }));

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Run ended")).toBeInTheDocument();
    expect(screen.getByText("11 taps, 1 board solved.")).toBeInTheDocument();
    const body = completionBody(spy);
    expect(body.progress.actions).toEqual([1, 1, 8, 8, 10, 10, 19, 19, 22, 22, 4]);
    expect(body.score).toBe(50);
  });

  it("shows the score the server verified, not the client's", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    placeQueen(0, 5);
    placeQueen(2, 5);
    placeQueen(3, 5);

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("70")).toBeInTheDocument();
    expect(screen.getByText("260")).toBeInTheDocument(); // personal best
    expect(screen.getByText("#3")).toBeInTheDocument(); // rank
    expect(screen.getByText(/Verified by replaying your taps on the server/)).toBeInTheDocument();
  });

  it("starts a fresh run from the end-of-run screen, rules first", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    placeQueen(0, 5);
    placeQueen(2, 5);
    placeQueen(3, 5);
    await screen.findByRole("button", { name: /play again/i });

    fireEvent.click(screen.getByRole("button", { name: /play again/i }));

    expect(await screen.findByRole("heading", { name: "One crown each" })).toBeInTheDocument();
    const sessions = spy.mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(sessions).toHaveLength(2);
  });

  it("reports a guest's run as unranked", async () => {
    mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(resultPayload({ ranked: false, rank: null, personalBest: null }))
        : jsonResponse(sessionPayload({ ranked: false }), 201),
    );
    await renderRuntime();
    expect(await screen.findByText("Guest run: verified, but not ranked")).toBeInTheDocument();

    await startRun();
    expect(screen.getByText("Guest run")).toBeInTheDocument();
    placeQueen(0, 5);
    placeQueen(2, 5);
    placeQueen(3, 5);
    await screen.findByRole("button", { name: /play again/i });

    expect(
      screen.getByText(/This was a guest run, so it is not on the leaderboard\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in to rank your scores/i })).toBeInTheDocument();
  });

  it("reports a failed verification and retries the same submission", async () => {
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
    placeQueen(0, 5);
    placeQueen(2, 5);
    placeQueen(3, 5);

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

    const spy = mockPlayback();
    await renderRuntime();
    await startRun();
    placeQueen(0, 5);
    placeQueen(2, 5);
    placeQueen(3, 5);
    await screen.findByRole("button", { name: /play again/i });

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    expect(new Headers(completion?.[1]?.headers).get("Authorization")).toBe(
      "Bearer access-token-1",
    );
  });
});
