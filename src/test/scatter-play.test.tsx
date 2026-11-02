import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScatterRuntime } from "@/components/game/ScatterRuntime";
import { clearSession } from "@/lib/auth/session";
import { board, canExit, createRun, sideFor, solve, tap } from "@/lib/games/scatter";

/**
 * Scatter on screen.
 *
 * Driven through the real API client against a stubbed server, so what is
 * asserted is the whole path: the rules show with no session behind them, Start
 * issues one, tiles escape or jam when tapped, every tap is submitted, three jams
 * end the run, and the number on the result screen is the one the server verified.
 */

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    gameSlug: "scatter",
    rulesVersion: "scatter@1",
    seed: "12345",
    tileCount: 4096,
    startedAt: "2026-11-28T12:00:00.000Z",
    expiresAt: "2026-11-29T00:00:00.000Z",
    ranked: false,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "11111111-2222-4333-8444-555555555555",
    gameSlug: "scatter",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 13,
    clearedColumns: 1,
    tilesPlaced: 8,
    durationMs: 21000,
    ranked: false,
    recordedAt: "2026-11-28T12:01:00.000Z",
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

function mockPlayback() {
  const spy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
    String(input).includes("/complete")
      ? jsonResponse(resultPayload())
      : jsonResponse(sessionPayload(), 201),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function submitted(spy: ReturnType<typeof mockPlayback>) {
  const call = spy.mock.calls.find((c) => String(c[0]).includes("/complete"));
  return call ? JSON.parse(String(call[1]?.body)) : null;
}

async function renderRuntime() {
  const root = createRootRoute();
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => <ScatterRuntime slug="scatter" title="Scatter" />,
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

/** The tile button on a cell of a `side`-wide board. */
const tile = (cell: number, side = 4) =>
  screen.getByRole("button", {
    name: new RegExp(`^Row ${Math.floor(cell / side) + 1}, column ${(cell % side) + 1}: `),
  });

async function startRun() {
  fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
  await screen.findByRole("group", { name: /^Board 1,/ });
}

async function endRun() {
  fireEvent.click(screen.getByRole("button", { name: "End run" }));
  fireEvent.click(await screen.findByRole("button", { name: "End run" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("Scatter", () => {
  it("shows the rules with no session behind them, and asks for one on Start", async () => {
    const spy = mockPlayback();
    await renderRuntime();

    expect(screen.getByRole("heading", { name: "Clear the way" })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await startRun();
    const start = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(start?.[1]?.body ?? "{}"))).toMatchObject({
      gameSlug: "scatter",
      rulesVersion: "scatter@1",
    });
  });

  it("deals seed 12345's first board: eight tiles on a 4×4 grid", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    expect(screen.getByText("8 tiles left")).toBeInTheDocument();
    // Cell 2 of the pinned board holds 2: a tile pointing right.
    expect(tile(2)).toHaveAccessibleName(/tile pointing right/);
    expect(screen.getAllByRole("button", { name: /^Row / })).toHaveLength(8);
  });

  it("sends a free tile off and jams a blocked one, and submits both taps", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    // A free tile whose escape leaves some tile still blocked: an escape can open lanes.
    const cells = board("12345", 1);
    const blockedAfter = (cell: number) => {
      const after = tap(createRun("12345"), cell).cells;
      return after.findIndex((t, other) => t !== null && !canExit(after, 4, other));
    };
    const free = cells.findIndex((_, cell) => canExit(cells, 4, cell) && blockedAfter(cell) >= 0);
    const blocked = blockedAfter(free);

    fireEvent.click(tile(free));
    expect(screen.getByText("7 tiles left")).toBeInTheDocument();
    fireEvent.click(tile(blocked));
    expect(screen.getByText(/^Jammed/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "1 of 3 jams" })).toBeInTheDocument();

    await endRun();
    await screen.findByText("Run ended");
    expect(submitted(spy)).toMatchObject({ score: 1, progress: { actions: [free, blocked] } });
  });

  it("ends the run on the third jam and submits it", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    const cells = board("12345", 1);
    const blocked = cells.findIndex((t, cell) => t && !canExit(cells, 4, cell));
    for (let i = 0; i < 3; i += 1) fireEvent.click(tile(blocked));

    await screen.findByText("Out of jams");
    expect(submitted(spy)).toMatchObject({
      score: 0,
      progress: { actions: [blocked, blocked, blocked] },
    });
  });

  it("clears a board, deals the next, and shows the verified score", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    for (const cell of solve(board("12345", 1), sideFor(1))!) fireEvent.click(tile(cell));
    // Test setup turns the level-up beat off, so the next board is dealt at once.
    expect(screen.getByText("Board 2")).toBeInTheDocument();
    expect(screen.getByText("Board 1 cleared, +50.")).toBeInTheDocument();

    await endRun();
    await screen.findByText("Run ended");
    // The server's score: 13 units, shown as 130.
    expect(screen.getByText("130")).toBeInTheDocument();
    expect(screen.getByText("8 tiles sent off, 1 board cleared.")).toBeInTheDocument();
    expect(submitted(spy).score).toBe(8 + 5);
  });
});
