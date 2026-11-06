import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act as reactAct, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MinefieldRuntime } from "@/components/game/MinefieldRuntime";
import { clearSession } from "@/lib/auth/session";
import {
  act,
  CLOSED,
  createRun,
  MINE,
  MINEFIELD_FLAG_OFFSET,
  minesFor,
} from "@/lib/games/minefield";

/**
 * Minefield on screen.
 *
 * Driven through the real API client against a stubbed server, so what is asserted
 * is the whole path: the rules show with no session behind them, Start issues one,
 * cells open and flag, every action is submitted, no lives end the run, and the
 * number on the result screen is the one the server verified.
 */

const SEED = "12345";
const FIRST = 27;

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    gameSlug: "minefield",
    rulesVersion: "minefield@1",
    seed: SEED,
    tileCount: 4096,
    startedAt: "2026-12-18T12:00:00.000Z",
    expiresAt: "2026-12-19T00:00:00.000Z",
    ranked: false,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "11111111-2222-4333-8444-555555555555",
    gameSlug: "minefield",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 77,
    clearedColumns: 1,
    tilesPlaced: 9,
    durationMs: 21000,
    ranked: false,
    recordedAt: "2026-12-18T12:01:00.000Z",
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
      component: () => <MinefieldRuntime slug="minefield" title="Minefield" />,
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
  await reactAct(async () => {
    await router.load();
  });
  return router;
}

const cellButton = (cell: number, side = 8) =>
  screen.getByRole("button", {
    name: new RegExp(`^Row ${Math.floor(cell / side) + 1}, column ${(cell % side) + 1}: `),
  });

async function startRun() {
  fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
  await screen.findByRole("group", { name: /^Board 1,/ });
}

/** The first mine still closed on this run's board. */
function closedMine(run: ReturnType<typeof createRun>) {
  return run.cells.findIndex((state, at) => state === CLOSED && run.numbers![at] === MINE);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("Minefield", () => {
  it("shows the rules with no session behind them, and asks for one on Start", async () => {
    const spy = mockPlayback();
    await renderRuntime();

    expect(screen.getByRole("heading", { name: "Read the numbers" })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await startRun();
    const start = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(start?.[1]?.body ?? "{}"))).toMatchObject({
      gameSlug: "minefield",
      rulesVersion: "minefield@1",
    });
  });

  it("deals a closed 8×8 board, with three lives and its mines to find", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    expect(screen.getAllByRole("button", { name: /^Row / })).toHaveLength(64);
    expect(screen.getAllByRole("button", { name: /: closed\.$/ })).toHaveLength(64);
    expect(screen.getByRole("img", { name: "3 lives left" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: `${minesFor(1)} mines left` })).toBeInTheDocument();
  });

  it("opens an area on the first tap, scores it, and names each number", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    const after = act(createRun(SEED), FIRST);
    fireEvent.click(cellButton(FIRST));

    expect(cellButton(FIRST)).toHaveAccessibleName("Row 4, column 4: no mines nearby.");
    expect(screen.getByText(String(after.score * 10))).toBeInTheDocument();
    const numbered = after.cells.findIndex((state, at) => state === 2 && after.numbers![at]! > 0);
    expect(cellButton(numbered).textContent).toBe(String(after.numbers![numbered]));
  });

  it("flags in flag mode, and on a right click, and a flag protects its cell", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    fireEvent.click(screen.getByRole("button", { name: "Flag" }));
    expect(screen.getByRole("button", { name: "Flag" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(cellButton(0));
    expect(cellButton(0)).toHaveAccessibleName("Row 1, column 1: flagged.");
    expect(screen.getByRole("img", { name: `${minesFor(1) - 1} mines left` })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    fireEvent.click(cellButton(0));
    expect(cellButton(0)).toHaveAccessibleName("Row 1, column 1: flagged.");

    fireEvent.contextMenu(cellButton(1));
    expect(cellButton(1)).toHaveAccessibleName("Row 1, column 2: flagged.");
    fireEvent.contextMenu(cellButton(1));
    expect(cellButton(1)).toHaveAccessibleName("Row 1, column 2: closed.");
  });

  it("flags on a long press, and does not also open the cell", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    fireEvent.pointerDown(cellButton(0), { pointerType: "touch" });
    await reactAct(() => new Promise((resolve) => setTimeout(resolve, 400)));
    fireEvent.pointerUp(cellButton(0), { pointerType: "touch" });
    fireEvent.click(cellButton(0));
    expect(cellButton(0)).toHaveAccessibleName("Row 1, column 1: flagged.");
  });

  it("moves between cells with the arrow keys, and flags with F", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    cellButton(0).focus();
    fireEvent.keyDown(cellButton(0), { key: "ArrowRight" });
    expect(cellButton(1)).toHaveFocus();
    fireEvent.keyDown(cellButton(1), { key: "ArrowDown" });
    expect(cellButton(9)).toHaveFocus();
    fireEvent.keyDown(cellButton(9), { key: "f" });
    expect(cellButton(9)).toHaveAccessibleName("Row 2, column 2: flagged.");
  });

  it("takes a life for a mine and says so", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    const first = act(createRun(SEED), FIRST);
    fireEvent.click(cellButton(FIRST));
    const mine = closedMine(first);
    fireEvent.click(cellButton(mine));

    expect(cellButton(mine)).toHaveAccessibleName(/: mine\.$/);
    expect(screen.getByRole("img", { name: "2 lives left" })).toBeInTheDocument();
    expect(screen.getByText("A mine! 2 lives left.")).toBeInTheDocument();
  });

  it("ends a run when the player does, submits every action, and shows the verified score", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    fireEvent.contextMenu(cellButton(0));
    fireEvent.click(cellButton(FIRST));
    const after = act(act(createRun(SEED), MINEFIELD_FLAG_OFFSET), FIRST);

    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    fireEvent.click(await screen.findByRole("button", { name: "End run" }));

    await screen.findByText("Run ended");
    expect(submitted(spy)).toMatchObject({
      score: after.score,
      progress: { actions: [MINEFIELD_FLAG_OFFSET, FIRST] },
    });
    // The server's score: 77 units, shown as 770.
    expect(screen.getByText("770")).toBeInTheDocument();
    expect(screen.getByText("9 cells opened, 1 board cleared.")).toBeInTheDocument();
  });

  it("ends the run on the last life, and shows the board with its mines", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    let run = act(createRun(SEED), FIRST);
    fireEvent.click(cellButton(FIRST));
    while (run.outcome === "playing") {
      const mine = closedMine(run);
      run = act(run, mine);
      fireEvent.click(cellButton(mine));
    }

    await screen.findByText("Out of lives");
    expect(submitted(spy)).toMatchObject({ progress: { actions: run.actions } });
    expect(
      screen.getByRole("img", { name: "The board you ended on, with its mines shown." }),
    ).toBeInTheDocument();
  });

  it("clears a board and deals the next one", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    let run = act(createRun(SEED), FIRST);
    fireEvent.click(cellButton(FIRST));
    for (let cell = 0; run.level === 1 && cell < 64; cell += 1) {
      if (run.cells[cell] === CLOSED && run.numbers![cell] !== MINE) {
        run = act(run, cell);
        fireEvent.click(cellButton(cell));
      }
    }

    expect(run.level).toBe(2);
    await screen.findByRole("group", { name: /^Board 2,/ });
    expect(screen.getByText("Board 1 cleared.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /: closed\.$/ })).toHaveLength(64);
  });
});
