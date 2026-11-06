import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FuseboxRuntime } from "@/components/game/FuseboxRuntime";
import { clearSession } from "@/lib/auth/session";
import {
  chargedCells,
  createRun,
  FUSEBOX_CELLS,
  missedTap,
  refundFor,
  replay,
  settle,
  tap,
  type FuseboxRun,
} from "@/lib/games/fusebox";

/**
 * Fusebox on screen.
 *
 * Driven through the real API client against a stubbed server, so what is asserted
 * is the whole path: the rules show with no session behind them, Start issues one,
 * a tap spends a spark, every tap is submitted, no sparks end the run, and the
 * number on the result screen is the one the server verified.
 */

const SEED = "12345";

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    gameSlug: "fusebox",
    rulesVersion: "fusebox@1",
    seed: SEED,
    tileCount: 4096,
    startedAt: "2026-12-16T12:00:00.000Z",
    expiresAt: "2026-12-17T00:00:00.000Z",
    ranked: false,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "11111111-2222-4333-8444-555555555555",
    gameSlug: "fusebox",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 77,
    clearedColumns: 1,
    tilesPlaced: 9,
    durationMs: 21000,
    ranked: false,
    recordedAt: "2026-12-16T12:01:00.000Z",
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
      component: () => <FuseboxRuntime slug="fusebox" title="Fusebox" />,
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
    name: new RegExp(`^Row ${Math.floor(cell / 6) + 1}, column ${(cell % 6) + 1}: `),
  });

async function startRun() {
  fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
  await screen.findByRole("group", { name: /^Board 1,/ });
}

/** A tap that pops nothing on this board, or null. */
function quietTap(run: FuseboxRun): number | null {
  for (let cell = 0; cell < FUSEBOX_CELLS; cell += 1) {
    const settled = settle(run.cells, cell);
    if (settled.pops === 0 && chargedCells(settled.cells) > 4) return cell;
  }
  return null;
}

/** The tap with the longest chain. */
function bestTap(run: FuseboxRun): number {
  let best = 0;
  for (let cell = 0; cell < FUSEBOX_CELLS; cell += 1) {
    if (settle(run.cells, cell).pops > settle(run.cells, best).pops) best = cell;
  }
  return best;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("Fusebox", () => {
  it("shows the rules with no session behind them, and asks for one on Start", async () => {
    const spy = mockPlayback();
    await renderRuntime();

    expect(screen.getByRole("heading", { name: "One tap, one chain" })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await startRun();
    const start = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(start?.[1]?.body ?? "{}"))).toMatchObject({
      gameSlug: "fusebox",
      rulesVersion: "fusebox@1",
    });
  });

  it("deals the seed's first board as 36 buttons, with ten sparks", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    expect(screen.getAllByRole("button", { name: /^Row / })).toHaveLength(36);
    expect(screen.getByRole("img", { name: "10 sparks left" })).toBeInTheDocument();
    const first = createRun(SEED).cells[0]!;
    expect(cellButton(0)).toHaveAccessibleName(new RegExp(`charge ${first.charge}\\.$`));
  });

  it("spends a spark on a tap and charges the cell", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    const run = createRun(SEED);
    const quiet = quietTap(run)!;
    fireEvent.click(cellButton(quiet));
    expect(screen.getByRole("img", { name: "9 sparks left" })).toBeInTheDocument();
    expect(cellButton(quiet)).toHaveAccessibleName(
      new RegExp(`charge ${run.cells[quiet]!.charge + 1}\\.$`),
    );
  });

  it("plays a chain into the score and says what it paid", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    const run = createRun(SEED);
    const cell = bestTap(run);
    const after = tap(run, cell);
    expect(after.last!.pops).toBeGreaterThan(0);
    fireEvent.click(cellButton(cell));

    expect(screen.getByText(String(after.score * 10))).toBeInTheDocument();
    expect(screen.getByRole("img", { name: `${after.sparks} sparks left` })).toBeInTheDocument();
    if (after.last!.refund === 1) {
      expect(screen.getByText(`${after.last!.pops} pops: 1 spark back.`)).toBeInTheDocument();
    }
  });

  it("ends a run when the player does, submits every tap, and shows the verified score", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    const first = createRun(SEED);
    const cell = bestTap(first);
    const after = tap(first, cell);
    fireEvent.click(cellButton(cell));

    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    fireEvent.click(await screen.findByRole("button", { name: "End run" }));

    await screen.findByText("Run ended");
    expect(submitted(spy)).toMatchObject({
      score: after.score,
      progress: { actions: [cell] },
    });
    // The server's score: 77 units, shown as 770.
    expect(screen.getByText("770")).toBeInTheDocument();
    expect(screen.getByText("9 cells popped, 1 board cleared.")).toBeInTheDocument();
    expect(screen.queryByText("One tap could have saved this run")).not.toBeInTheDocument();
  });

  it("ends the run when the sparks run out, and shows the tap that would have saved it", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    // Keep tapping quietly until the sparks are gone, on the board on screen.
    let run = createRun(SEED);
    while (run.outcome === "playing") {
      const cell = quietTap(run) ?? 0;
      run = tap(run, cell);
      fireEvent.click(cellButton(cell));
    }

    await screen.findByText("Out of sparks");
    expect(submitted(spy)).toMatchObject({ progress: { actions: run.actions } });

    const missed = missedTap(replay(SEED, run.actions));
    if (missed && refundFor(missed.pops, run.level) > 0) {
      expect(screen.getByText("One tap could have saved this run")).toBeInTheDocument();
      expect(
        screen.getByRole("img", {
          name: `The missed tap: row ${Math.floor(missed.cell / 6) + 1}, column ${(missed.cell % 6) + 1}.`,
        }),
      ).toBeInTheDocument();
    }
  });
});
