import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CascadeRuntime } from "@/components/game/CascadeRuntime";
import { clearSession } from "@/lib/auth/session";
import { findSwap, firstBoard, isSwapLegal, swapCells } from "@/lib/games/cascade";

/**
 * Cascade on screen.
 *
 * Driven through the real API client against a stubbed server, so what is
 * asserted is the whole path: the rules show with no session behind them, Start
 * issues one, tiles are swapped by tapping one and then a neighbour, a swap that
 * lines nothing up is not submitted, and the number on the result screen is the
 * one the server verified. Motion is reduced, so a swap settles at once.
 */

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    gameSlug: "cascade",
    rulesVersion: "cascade@1",
    seed: "1",
    tileCount: 4096,
    startedAt: "2026-11-27T12:00:00.000Z",
    expiresAt: "2026-11-28T00:00:00.000Z",
    ranked: false,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "11111111-2222-4333-8444-555555555555",
    gameSlug: "cascade",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 3,
    clearedColumns: 1,
    tilesPlaced: 6,
    durationMs: 21000,
    ranked: false,
    recordedAt: "2026-11-27T12:01:00.000Z",
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
      component: () => <CascadeRuntime slug="cascade" title="Cascade" />,
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

const cellButton = (cell: number) =>
  screen.getByRole("button", {
    name: new RegExp(`^Row ${Math.floor(cell / 8) + 1}, column ${(cell % 8) + 1}:`),
  });

/** A tap on a cell, the way a finger makes one. */
function tapCell(cell: number) {
  fireEvent.pointerDown(cellButton(cell), { button: 0, clientX: 0, clientY: 0 });
  fireEvent.pointerUp(cellButton(cell));
}

async function startRun() {
  fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
  await screen.findByRole("group", { name: /^Level 1 board/ });
}

beforeEach(() => {
  const plain = window.matchMedia;
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    ...plain(query),
    matches: query.includes("prefers-reduced-motion"),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("Cascade", () => {
  it("shows the rules with no session behind them, and asks for one on Start", async () => {
    const spy = mockPlayback();
    await renderRuntime();

    expect(screen.getByRole("heading", { name: "Line them up" })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await startRun();
    const start = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(start?.[1]?.body ?? "{}"))).toMatchObject({
      gameSlug: "cascade",
      rulesVersion: "cascade@1",
    });
  });

  it("deals seed 1's first board, tile by tile", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    // Seed 1 starts 5 1 5 5 …: a violet hexagon, a red circle, two hexagons.
    expect(cellButton(0)).toHaveAccessibleName("Row 1, column 1: violet hexagon");
    expect(cellButton(1)).toHaveAccessibleName("Row 1, column 2: red circle");
    expect(screen.getAllByRole("button", { name: /^Row \d, column \d:/ })).toHaveLength(64);
  });

  it("swaps two neighbours by tapping, and does not submit a swap that lines nothing up", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    const { board } = firstBoard("1");
    let refused = 0;
    while (swapCells(refused) === null || isSwapLegal(board, refused)) refused += 1;
    const [a, b] = swapCells(refused)!;
    tapCell(a);
    expect(cellButton(a)).toHaveAttribute("aria-pressed", "true");
    tapCell(b);
    expect(cellButton(a)).toHaveAttribute("aria-pressed", "false");

    const legal = findSwap(board)!;
    const [from, to] = swapCells(legal)!;
    tapCell(from);
    tapCell(to);

    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    fireEvent.click(await screen.findByRole("button", { name: "End run" }));
    await screen.findByText("Run ended");

    expect(submitted(spy)).toMatchObject({ progress: { actions: [legal] } });
    expect(submitted(spy).score).toBeGreaterThanOrEqual(3);
  });

  it("shows the verified score at the end", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    fireEvent.click(await screen.findByRole("button", { name: "End run" }));

    // The result screen, with the server's score: 3, shown as 30.
    await screen.findByText("Run ended");
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("1 level cleared, 6 tiles matched.")).toBeInTheDocument();
  });
});
