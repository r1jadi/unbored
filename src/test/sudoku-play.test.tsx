import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SudokuRuntime } from "@/components/game/SudokuRuntime";
import { clearSession, signIn } from "@/lib/auth/session";

/**
 * Sudoku on screen, driven through the real API client against a stubbed server.
 *
 * Seed 1's first board starts with a 5 on cell 2 and fills from the moves in
 * `LINE_ONE` (`cell × 10 + digit`). Like Sun & Moon, the rules show with no
 * session, Start asks for one, and the clock ends the run.
 */

const LINE_ONE = [
  6, 13, 37, 72, 91, 117, 124, 139, 155, 163, 189, 204, 215, 226, 258, 278, 284, 291, 309, 336, 353,
  389, 417, 448, 453, 467, 481, 525, 544, 568, 596, 637, 641, 668, 706, 725, 742, 767, 771, 799,
  804,
];
const CELL = /^Row \d column \d,/;

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "edededed-1111-4111-8111-edededededed",
    gameSlug: "sudoku",
    rulesVersion: "sudoku@1",
    seed: "1",
    tileCount: 8192,
    startedAt: "2026-11-14T12:00:00.000Z",
    expiresAt: "2026-11-15T00:00:00.000Z",
    ranked: false,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "edededed-1111-4111-8111-edededededed",
    gameSlug: "sudoku",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 270,
    clearedColumns: 3,
    tilesPlaced: 130,
    durationMs: 640_000,
    ranked: false,
    recordedAt: "2026-11-14T12:10:40.000Z",
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
      component: () => <SudokuRuntime slug="sudoku" title="Sudoku" />,
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

function cell(index: number) {
  const row = Math.floor(index / 9) + 1;
  const column = (index % 9) + 1;
  return screen.getByRole("button", { name: new RegExp(`^Row ${row} column ${column},`) });
}

function pad(digit: number) {
  return screen.getByRole("button", { name: new RegExp(`^Place ${digit},`) });
}

/**
 * Plays moves through the screen: select the cell, then tap the digit (or Erase).
 * Found by selector rather than by role: a run clicks through dozens of moves,
 * and role queries over ninety buttons are slow in jsdom.
 */
function playMoves(moves: readonly number[]) {
  for (const move of moves) {
    const board = document.querySelector('[role="group"][aria-label^="Board "]');
    fireEvent.click(board!.querySelectorAll("button")[Math.floor(move / 10)]);
    const digit = move % 10;
    fireEvent.click(
      digit === 0
        ? [...document.querySelectorAll("button")].find((button) => button.textContent === "Erase")!
        : document.querySelector(`button[aria-label^="Place ${digit},"]`)!,
    );
  }
}

function scoreShown() {
  return screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent;
}

async function startRun() {
  fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
  await screen.findByRole("group", { name: "Board 1, 9 by 9" });
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

    expect(screen.getByRole("heading", { name: "One to nine" })).toBeInTheDocument();
    expect(screen.getByText(/holds the digits 1 to 9 once each/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await startRun();

    expect(JSON.parse(String(sessionCalls(spy)[0][1]?.body ?? "{}"))).toEqual({
      gameSlug: "sudoku",
      rulesVersion: "sudoku@1",
      client: "web/1.0",
    });
    expect(screen.getAllByRole("button", { name: CELL })).toHaveLength(81);
    expect(screen.getByText("41 cells left")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Time left" })).toHaveAttribute(
      "aria-valuenow",
      "360",
    );
  });
});

describe("the board", () => {
  it("shows the starting cells as fixed, and does not let them change", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    expect(cell(2)).toHaveAccessibleName("Row 1 column 3, 5, fixed");
    fireEvent.click(cell(2));
    expect(cell(2)).toHaveAttribute("aria-pressed", "true");
    expect(pad(1)).toBeDisabled();
    expect(cell(0)).toHaveAccessibleName("Row 1 column 1, empty");
  });

  it("places a digit in the selected cell, replaces it and erases it", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    playMoves([6]);
    expect(cell(0)).toHaveAccessibleName("Row 1 column 1, 6");
    playMoves([7]);
    expect(cell(0)).toHaveAccessibleName("Row 1 column 1, 7");
    playMoves([0]);
    expect(cell(0)).toHaveAccessibleName("Row 1 column 1, empty");
  });

  it("takes digits and moves from the keyboard", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    const group = screen.getByRole("group", { name: "Board 1, 9 by 9" });
    fireEvent.click(cell(0));
    fireEvent.keyDown(group, { key: "6" });
    expect(cell(0)).toHaveAccessibleName("Row 1 column 1, 6");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(cell(1)).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(group, { key: "3" });
    expect(cell(1)).toHaveAccessibleName("Row 1 column 2, 3");
    fireEvent.keyDown(group, { key: "Backspace" });
    expect(cell(1)).toHaveAccessibleName("Row 1 column 2, empty");
  });

  it("marks a digit that repeats once the board has sat still a moment", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    playMoves([5]); // a second 5 in row one
    expect(cell(0)).toHaveAccessibleName("Row 1 column 1, 5");
    expect(screen.queryByText(/Something clashes/)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2900);
    });
    expect(cell(0)).toHaveAccessibleName("Row 1 column 1, 5");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    vi.useRealTimers();
    expect(cell(0)).toHaveAccessibleName("Row 1 column 1, 5, repeats");
    expect(cell(2)).toHaveAccessibleName("Row 1 column 3, 5, fixed, repeats");
    expect(screen.getByText(/Something clashes/)).toBeInTheDocument();

    // Fixing it clears the mark at once: no waiting to be told it is right.
    playMoves([6]);
    expect(cell(0)).toHaveAccessibleName("Row 1 column 1, 6");
    expect(cell(2)).toHaveAccessibleName("Row 1 column 3, 5, fixed");
    expect(screen.queryByText(/Something clashes/)).not.toBeInTheDocument();
  });

  it("solves a board when it is full and right: ninety points and more time", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    playMoves(LINE_ONE);

    expect(screen.getByRole("group", { name: "Board 2, 9 by 9" })).toBeInTheDocument();
    expect(scoreShown()).toBe("90");
    expect(screen.getByText(/Board 1 solved, \+90/)).toBeInTheDocument();
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuemax"))).toBe(540);
  });
});

describe("finishing a run", () => {
  it("ends the run when the clock runs out, and submits every move", async () => {
    const spy = mockPlayback({}, resultPayload({ score: 90, clearedColumns: 1 }));
    await renderRuntime();
    await startRun();

    playMoves(LINE_ONE);
    // Past the 540 seconds the first board earned: the next move finds the clock over.
    const later = Date.now() + 541_000;
    vi.spyOn(Date, "now").mockImplementation(() => later);
    playMoves([11]);

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Time's up")).toBeInTheDocument();
    const body = completionBody(spy);
    expect(body.progress.rulesVersion).toBe("sudoku@1");
    expect(body.progress.actions).toEqual(LINE_ONE);
    expect(body.score).toBe(90);
  });

  it("lets the player end the run, and shows the score the server verified", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();
    playMoves(LINE_ONE);
    await endRun();

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Run ended")).toBeInTheDocument();
    expect(screen.getByText("270")).toBeInTheDocument();
    expect(completionBody(spy).score).toBe(90);
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
      resultPayload({ ranked: true, rank: 2, personalBest: 360 }),
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
