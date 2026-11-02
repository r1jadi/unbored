import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DecantRuntime } from "@/components/game/DecantRuntime";
import { clearSession } from "@/lib/auth/session";
import {
  DECANT_EXTRA_TUBE,
  DECANT_RESTART,
  DECANT_UNDO,
  board,
  encodePour,
  solve,
} from "@/lib/games/decant";

/**
 * Decant on screen.
 *
 * Driven through the real API client against a stubbed server, so what is
 * asserted is the whole path: the rules show with no session behind them, Start
 * issues one, tubes are picked up and poured by tapping, undo, restart and the
 * extra tube are submitted as actions, and the number on the result screen is the
 * one the server verified.
 */

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    gameSlug: "decant",
    rulesVersion: "decant@2",
    seed: "1",
    tileCount: 8192,
    startedAt: "2026-11-21T12:00:00.000Z",
    expiresAt: "2026-11-22T00:00:00.000Z",
    ranked: false,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "11111111-2222-4333-8444-555555555555",
    gameSlug: "decant",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 3,
    clearedColumns: 1,
    tilesPlaced: 6,
    durationMs: 21000,
    ranked: false,
    recordedAt: "2026-11-21T12:01:00.000Z",
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
      component: () => <DecantRuntime slug="decant" title="Decant" />,
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

const tube = (n: number) => screen.getByRole("button", { name: new RegExp(`^Tube ${n} `) });

async function startRun() {
  fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
  await screen.findByRole("group", { name: /^Board 1,/ });
}

/** Taps two tubes: picks the first up and pours it into the second. */
function pourTubes(from: number, to: number) {
  fireEvent.click(tube(from + 1));
  fireEvent.click(tube(to + 1));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("Decant", () => {
  it("shows the rules with no session behind them, and asks for one on Start", async () => {
    const spy = mockPlayback();
    await renderRuntime();

    expect(screen.getByRole("heading", { name: "Pour until it's sorted" })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await startRun();
    const start = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(start?.[1]?.body ?? "{}"))).toMatchObject({
      gameSlug: "decant",
      rulesVersion: "decant@2",
    });
  });

  it("deals seed 1's first board: three full tubes and two empty ones", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    // 2133, bottom to top: orange, red, yellow, yellow.
    expect(tube(1)).toHaveAccessibleName(/^Tube 1 \(key 1\): orange, red, yellow, yellow/);
    expect(tube(4)).toHaveAccessibleName(/empty/);
    expect(tube(5)).toHaveAccessibleName(/empty/);
  });

  it("picks a tube up, pours it, undoes, restarts and buys a tube — and submits each", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    const [first] = solve(board("1", 1))!;
    fireEvent.click(tube(first[0] + 1));
    expect(tube(first[0] + 1)).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(tube(first[1] + 1));
    expect(screen.getByText("3 colours · 1 pour")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("3 colours · 0 pours")).toBeInTheDocument();
    pourTubes(...first);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    fireEvent.click(screen.getByRole("button", { name: /^Add an empty tube/ }));
    expect(tube(6)).toHaveAccessibleName(/empty/);
    expect(screen.getByRole("button", { name: /^Add an empty tube/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    fireEvent.click(await screen.findByRole("button", { name: "End run" }));
    await screen.findByText("Run ended");

    expect(submitted(spy)).toMatchObject({
      score: 0,
      progress: {
        actions: [
          encodePour(...first),
          DECANT_UNDO,
          encodePour(...first),
          DECANT_RESTART,
          DECANT_EXTRA_TUBE,
        ],
      },
    });
  });

  it("sorts a board, deals the next, and shows the verified score", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    for (const [from, to] of solve(board("1", 1))!) pourTubes(from, to);
    // Test setup turns the level-up beat off, so the next board is dealt at once.
    expect(screen.getByText("Board 2")).toBeInTheDocument();
    expect(screen.getByText("Board 1 sorted, +30.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    fireEvent.click(await screen.findByRole("button", { name: "End run" }));

    // The result screen, with the server's score: 3 colours, shown as 30.
    await screen.findByText("Run ended");
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("1 board sorted, 6 pours.")).toBeInTheDocument();
    expect(submitted(spy).score).toBe(3);
  });
});
