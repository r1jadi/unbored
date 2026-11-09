import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SumdokuRuntime } from "@/components/game/SumdokuRuntime";
import { board } from "@/lib/games/sumdoku";
import { buttonNamed } from "@/test/queries";
import { clearSession } from "@/lib/auth/session";

/**
 * Sumdoku on screen, driven through the real API client against a stubbed server.
 *
 * Seed 1's first board — gentle — starts "000000001300000000000020400060000005"
 * (0 empty: six givens, 30 empty cells) and is filled by the moves in `LINE_ONE`
 * (`cell × 10 + digit`). As Mini Sudoku: the rules show with no session, Start
 * asks for one, and only the player ends the run.
 */

const LINE_ONE = [
  3, 14, 22, 31, 45, 56, 65, 76, 104, 112, 122, 135, 143, 156, 161, 174, 186, 191, 204, 215, 233,
  253, 265, 272, 291, 301, 312, 326, 334, 343,
];
const CELL = /^Row \d column \d,/;

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "edededed-2222-4222-8222-edededededed",
    gameSlug: "sumdoku",
    rulesVersion: "sumdoku@1",
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
    gameSlug: "sumdoku",
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
      component: () => <SumdokuRuntime slug="sumdoku" title="Sumdoku" />,
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

    expect(screen.getByRole("heading", { name: "Add it up" })).toBeInTheDocument();
    expect(screen.getByText(/add up to the small total in its corner/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await startRun();

    const session = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(session?.[1]?.body ?? "{}"))).toMatchObject({
      gameSlug: "sumdoku",
      rulesVersion: "sumdoku@1",
    });
    expect(screen.getAllByRole("button", { name: CELL })).toHaveLength(36);
    expect(screen.getByText("30 cells left")).toBeInTheDocument();
    expect(screen.getByText("par 1:15")).toBeInTheDocument();
    expect(document.querySelectorAll('button[aria-label^="Place "]')).toHaveLength(6);
  });
});

describe("the board", () => {
  it("names every cell's cage and shows each cage's total once", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    const drawn = board(1, 1);
    const first = drawn.cages[drawn.cageOf[0]];
    expect(cell(0)).toHaveAccessibleName(
      new RegExp(`cage of ${first.cells.length} adding to ${first.total}`),
    );
    // Cell 8 starts as a 1.
    expect(cell(8)).toHaveAccessibleName(/, 1, fixed/);
    // Selecting a cell says what its cage needs.
    fireEvent.click(cell(0));
    expect(
      screen.getByText(
        new RegExp(`This cage: ${first.cells.length} cells adding to ${first.total}`),
      ),
    ).toBeInTheDocument();
  });

  it("marks a digit that repeats in its cage or row", { timeout: 15000 }, async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    // Cell 9 starts as a 3, so a 3 in cell 6 (its row) repeats.
    fireEvent.click(cell(6));
    fireEvent.click(document.querySelector('button[aria-label^="Place 3,"]')!);
    await waitFor(() => expect(cell(6)).toHaveAccessibleName(/repeats/), { timeout: 6000 });
  });
});

describe("scoring", () => {
  it(
    "scores a solved board, deals the next, and submits the moves",
    { timeout: 20000 },
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
        progress: { rulesVersion: "sumdoku@1", actions: LINE_ONE },
        score: 60,
      });
      // The screen shows the number the server verified, not the client's 600.
      expect(screen.getByText("1800")).toBeInTheDocument();
    },
  );
});
