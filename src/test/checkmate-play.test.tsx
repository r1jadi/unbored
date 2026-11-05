import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CheckmateRuntime } from "@/components/game/CheckmateRuntime";
import { buttonNamed } from "@/test/queries";
import { clearSession } from "@/lib/auth/session";
import { CHECKMATE_SKIP, puzzleFor } from "@/lib/games/checkmate";
import { legalMoves, parseFen, squareName } from "@/lib/games/chess";

/**
 * Checkmate on screen.
 *
 * Driven through the real API client against a stubbed server, so what is
 * asserted is the whole path: the rules show with no session behind them, Start
 * issues one, pieces are moved by tapping, a wrong move and a skip are submitted
 * as they are, and the number on the result screen is the one the server
 * verified. Motion is reduced, so a move lands at once.
 */

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    gameSlug: "checkmate",
    rulesVersion: "checkmate@1",
    seed: "1",
    tileCount: 2048,
    startedAt: "2026-12-03T12:00:00.000Z",
    expiresAt: "2026-12-04T00:00:00.000Z",
    ranked: false,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "11111111-2222-4333-8444-555555555555",
    gameSlug: "checkmate",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 10,
    clearedColumns: 1,
    tilesPlaced: 1,
    durationMs: 21000,
    ranked: false,
    recordedAt: "2026-12-03T12:01:00.000Z",
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
      component: () => <CheckmateRuntime slug="checkmate" title="Checkmate" />,
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

const square = (index: number) => buttonNamed(new RegExp(`^${squareName(index)}(,|$)`));

/** Taps a piece, then where it goes. */
function moveBy(from: number, to: number) {
  fireEvent.click(square(from));
  fireEvent.click(square(to));
}

async function startRun() {
  fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
  await screen.findByRole("group", { name: /^Puzzle 1:/ });
}

async function endRun() {
  fireEvent.click(screen.getByRole("button", { name: "End run" }));
  fireEvent.click(await screen.findByRole("button", { name: "End run" }));
  await screen.findByText("Run ended");
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

describe("Checkmate", () => {
  it("shows the rules with no session behind them, and asks for one on Start", async () => {
    const spy = mockPlayback();
    await renderRuntime();

    expect(screen.getByRole("heading", { name: "Find the mate" })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await startRun();
    const start = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(start?.[1]?.body ?? "{}"))).toMatchObject({
      gameSlug: "checkmate",
      rulesVersion: "checkmate@1",
    });
  });

  it("marks a piece's legal moves, takes a wrong move, then the mate, and skips", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    const puzzle = puzzleFor("1", 1);
    const answer = puzzle.answers[0];
    const [from, to] = [Math.floor(answer / 64), answer % 64];
    const wrong = legalMoves(parseFen(puzzle.fen)).find((m) => m.from * 64 + m.to !== answer)!;

    fireEvent.click(square(from));
    expect(square(from)).toHaveAttribute("aria-pressed", "true");
    expect(square(to)).toHaveAccessibleName(/a legal move/);
    fireEvent.click(square(from));

    moveBy(wrong.from, wrong.to);
    expect(screen.getByText(/^0 solved · 1 wrong$/)).toBeInTheDocument();
    moveBy(from, to);
    expect(screen.getByRole("group", { name: /^Puzzle 2:/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Skip this puzzle/ }));
    expect(screen.getByRole("group", { name: /^Puzzle 3:/ })).toBeInTheDocument();

    await endRun();
    expect(submitted(spy)).toMatchObject({
      score: 10,
      progress: { actions: [wrong.from * 64 + wrong.to, answer, CHECKMATE_SKIP] },
    });
  });

  it("shows the verified score at the end", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();
    await endRun();

    // The result screen, with the server's score: 10, shown as 100.
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("1 mate found, 1 wrong move.")).toBeInTheDocument();
  });
});
