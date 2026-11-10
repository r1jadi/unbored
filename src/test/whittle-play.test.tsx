import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WhittleRuntime } from "@/components/game/WhittleRuntime";
import { buttonNamed } from "@/test/queries";
import { clearSession } from "@/lib/auth/session";

/**
 * Whittle on screen, driven through the real API client against a stubbed server.
 *
 * Seed 1's first board is solved by crossing out the cells in `LINE_ONE`
 * (`cell × 10 + mark`). The rules show with no session, Start asks for one, and
 * only the player ends the run.
 */

const LINE_ONE = [21, 31, 51, 91, 111, 131, 171, 181, 201, 221, 231, 241];
const CELL = /^Row \d column \d,/;

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "edededed-3333-4333-8333-edededededed",
    gameSlug: "whittle",
    rulesVersion: "whittle@1",
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
    sessionId: "edededed-3333-4333-8333-edededededed",
    gameSlug: "whittle",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 150,
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
      component: () => <WhittleRuntime slug="whittle" title="Whittle" />,
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
  const row = Math.floor(index / 5) + 1;
  const column = (index % 5) + 1;
  return buttonNamed(new RegExp(`^Row ${row} column ${column},`));
}

/** Plays crosses through the screen: one tap on each cell. */
function crossOut(moves: readonly number[]) {
  for (const move of moves) fireEvent.click(cell(Math.floor(move / 10)));
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

    expect(screen.getByRole("heading", { name: "Cross it out" })).toBeInTheDocument();
    expect(screen.getByText(/must add up to it/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await startRun();

    const session = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(session?.[1]?.body ?? "{}"))).toMatchObject({
      gameSlug: "whittle",
      rulesVersion: "whittle@1",
    });
    expect(screen.getAllByRole("button", { name: CELL })).toHaveLength(25);
    expect(screen.getByText("0 of 10 targets met")).toBeInTheDocument();
    expect(screen.getByText("par 1:00")).toBeInTheDocument();
  });
});

describe("the board", () => {
  it("shows every target with what its line makes now", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    // Seed 1, board 1: row 1 is 8 6 4 6 7 and has to make 21.
    expect(cell(0)).toHaveAccessibleName("Row 1 column 1, 8");
    expect(screen.getByRole("img", { name: "Row 1 target 21, now 31" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Column 1 target 16, now 23" })).toBeInTheDocument();
  });

  it("cycles a tap through crossed out, circled and clear, and Undo steps back", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    fireEvent.click(cell(2));
    expect(cell(2)).toHaveAccessibleName("Row 1 column 3, 4, crossed out");
    expect(screen.getByRole("img", { name: "Row 1 target 21, now 27" })).toBeInTheDocument();
    fireEvent.click(cell(2));
    expect(cell(2)).toHaveAccessibleName("Row 1 column 3, 4, circled");
    expect(screen.getByRole("img", { name: "Row 1 target 21, now 31" })).toBeInTheDocument();
    fireEvent.click(cell(2));
    expect(cell(2)).toHaveAccessibleName("Row 1 column 3, 4");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cell(2)).toHaveAccessibleName("Row 1 column 3, 4, circled");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cell(2)).toHaveAccessibleName("Row 1 column 3, 4, crossed out");
  });

  it("lights a target once its line adds up", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    // Row 1 loses its 4 and a 6: 31 − 10 = 21.
    crossOut([21, 31]);
    expect(screen.getByRole("img", { name: "Row 1 target 21, met" })).toBeInTheDocument();
    expect(screen.getByText("1 of 10 targets met")).toBeInTheDocument();
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

      crossOut(LINE_ONE);

      await waitFor(() => expect(scoreShown()).toBe("500"));
      expect(screen.getByRole("group", { name: "Board 2, 5 by 5" })).toBeInTheDocument();

      await endRun();
      await screen.findByText("Run ended");

      expect(completionBody(spy)).toMatchObject({
        progress: { rulesVersion: "whittle@1", actions: LINE_ONE },
        score: 50,
      });
      // The screen shows the number the server verified, not the client's 500.
      expect(screen.getByText("1500")).toBeInTheDocument();
    },
  );
});
