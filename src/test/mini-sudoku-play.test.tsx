import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MiniSudokuRuntime } from "@/components/game/MiniSudokuRuntime";
import { buttonNamed } from "@/test/queries";
import { clearSession } from "@/lib/auth/session";

/**
 * Mini Sudoku on screen, driven through the real API client against a stubbed
 * server.
 *
 * Seed 1's first board — gentle — starts "000503530040006215210030400002623450"
 * (0 empty, 17 empty cells) and is filled by the moves in `LINE_ONE`
 * (`cell × 10 + digit`). Like Sudoku, the rules show with no session, Start asks
 * for one, and only the player ends the run.
 */

const LINE_ONE = [1, 16, 24, 42, 82, 91, 116, 123, 134, 205, 216, 234, 255, 261, 273, 286, 351];
const CELL = /^Row \d column \d,/;

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "edededed-2222-4222-8222-edededededed",
    gameSlug: "mini-sudoku",
    rulesVersion: "mini-sudoku@2",
    seed: "1",
    tileCount: 8192,
    startedAt: "2026-11-26T12:00:00.000Z",
    expiresAt: "2026-11-27T00:00:00.000Z",
    ranked: false,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "edededed-2222-4222-8222-edededededed",
    gameSlug: "mini-sudoku",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 180,
    clearedColumns: 3,
    tilesPlaced: 51,
    durationMs: 240_000,
    ranked: false,
    recordedAt: "2026-11-26T12:04:00.000Z",
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

function mockPlayback(result = resultPayload()) {
  return mockFetch((url) =>
    url.includes("/complete") ? jsonResponse(result) : jsonResponse(sessionPayload(), 201),
  );
}

async function renderRuntime() {
  const root = createRootRoute();
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => <MiniSudokuRuntime slug="mini-sudoku" title="Mini Sudoku" />,
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
  const row = Math.floor(index / 6) + 1;
  const column = (index % 6) + 1;
  return buttonNamed(new RegExp(`^Row ${row} column ${column},`));
}

/** Plays moves through the screen: select the cell, then tap the digit (or Erase). */
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
  await screen.findByRole("group", { name: "Board 1, 6 by 6" });
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

    expect(screen.getByRole("heading", { name: "One to six" })).toBeInTheDocument();
    expect(screen.getByText(/holds the digits 1 to 6 once each/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await startRun();

    const session = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(session?.[1]?.body ?? "{}"))).toEqual({
      gameSlug: "mini-sudoku",
      rulesVersion: "mini-sudoku@2",
      client: "web/1.0",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(screen.getAllByRole("button", { name: CELL })).toHaveLength(36);
    expect(screen.getByText("17 cells left")).toBeInTheDocument();
    expect(screen.getByText("par 1:00")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    // A pad of six digits, not nine.
    expect(document.querySelectorAll('button[aria-label^="Place "]')).toHaveLength(6);
  });
});

describe("the board", () => {
  it("shows the starting cells as fixed and lets the pad fill an empty one", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    // Seed 1's cell 3 starts as a 5; cell 0 is open.
    expect(cell(3)).toHaveAccessibleName(/, 5, fixed/);
    expect(cell(0)).toHaveAccessibleName(/, empty/);
    fireEvent.click(cell(3));
    expect(document.querySelector('button[aria-label^="Place 1,"]')).toBeDisabled();

    fireEvent.click(cell(0));
    fireEvent.click(document.querySelector('button[aria-label^="Place 1,"]')!);
    expect(cell(0)).toHaveAccessibleName(/, 1/);
    expect(screen.getByText("16 cells left")).toBeInTheDocument();
  });

  it("marks a digit that repeats in its row, column or box", { timeout: 15000 }, async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    // Cell 0's row already holds a 5 at cell 3.
    fireEvent.click(cell(0));
    fireEvent.click(document.querySelector('button[aria-label^="Place 5,"]')!);
    // A clash is marked once the board has settled for a few seconds.
    await waitFor(() => expect(cell(0)).toHaveAccessibleName(/repeats/), { timeout: 6000 });
  });

  it("jots notes without making a move", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    fireEvent.click(cell(0));
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    fireEvent.click(document.querySelector('button[aria-label^="Note 1"]')!);
    fireEvent.click(document.querySelector('button[aria-label^="Note 4"]')!);
    expect(cell(0)).toHaveAccessibleName(/notes 1 4/);
    expect(scoreShown()).toBe("0");

    await endRun();
    await screen.findByText("Run ended");
    expect(completionBody(spy).progress.actions).toEqual([]);
  });
});

describe("scoring", () => {
  it(
    "scores a solved board, deals the next, and submits the moves",
    { timeout: 15000 },
    async () => {
      const spy = mockPlayback();
      await renderRuntime();
      await startRun();

      playMoves(LINE_ONE);

      await waitFor(() => expect(scoreShown()).toBe("600"));
      expect(screen.getByRole("group", { name: "Board 2, 6 by 6" })).toBeInTheDocument();

      await endRun();
      await screen.findByText("Run ended");

      expect(completionBody(spy)).toMatchObject({
        progress: { rulesVersion: "mini-sudoku@2", actions: LINE_ONE },
        score: 60,
      });
      // The screen shows the number the server verified, not the client's 600.
      expect(screen.getByText("1800")).toBeInTheDocument();
    },
  );
});
