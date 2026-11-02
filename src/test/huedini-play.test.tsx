import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HuediniRuntime } from "@/components/game/HuediniRuntime";
import { clearSession } from "@/lib/auth/session";
import {
  board,
  createRun,
  encodeMove,
  HUEDINI_RESTART,
  HUEDINI_UNDO,
  move,
  slide,
  solve,
  type Direction,
  type HuediniBlock,
} from "@/lib/games/huedini";

/**
 * Huedini on screen.
 *
 * Driven through the real API client against a stubbed server, so what is
 * asserted is the whole path: the rules show with no session behind them, Start
 * issues one, blocks slide when dragged or steered with the arrow keys, undo and
 * restart are submitted as actions, and the number on the result screen is the
 * one the server verified.
 */

const SEED = "12345";

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    gameSlug: "huedini",
    rulesVersion: "huedini@1",
    seed: SEED,
    tileCount: 8192,
    startedAt: "2026-11-29T12:00:00.000Z",
    expiresAt: "2026-11-30T00:00:00.000Z",
    ranked: false,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "11111111-2222-4333-8444-555555555555",
    gameSlug: "huedini",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 4,
    clearedColumns: 1,
    tilesPlaced: 6,
    durationMs: 21000,
    ranked: false,
    recordedAt: "2026-11-29T12:01:00.000Z",
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
      component: () => <HuediniRuntime slug="huedini" title="Huedini" />,
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

/** The button for a block where it stands now. */
const blockButton = (block: HuediniBlock) =>
  screen.getByRole("button", {
    name: new RegExp(
      ` block, ${block.w} by ${block.h}, row ${block.r + 1}, column ${block.c + 1}\\.`,
    ),
  });

/**
 * Drags a block a little way `dir`, as a finger would. jsdom has no
 * PointerEvent, so the coordinates are carried on a MouseEvent dispatched as a
 * pointer event — the same shape React hands the handler.
 */
function drag(block: HuediniBlock, dir: Direction) {
  const button = blockButton(block);
  const [dx, dy] = [
    [0, -30],
    [30, 0],
    [0, 30],
    [-30, 0],
  ][dir]!;
  const at = (type: string, x: number, y: number) =>
    fireEvent(button, new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  at("pointerdown", 100, 100);
  at("pointermove", 100 + dx, 100 + dy);
  at("pointerup", 100 + dx, 100 + dy);
}

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

describe("Huedini", () => {
  it("shows the rules with no session behind them, and asks for one on Start", async () => {
    const spy = mockPlayback();
    await renderRuntime();

    expect(screen.getByRole("heading", { name: "Every block escapes" })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await startRun();
    const start = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(start?.[1]?.body ?? "{}"))).toMatchObject({
      gameSlug: "huedini",
      rulesVersion: "huedini@1",
    });
  });

  it("draws the board's blocks and gates, and starts the clock at 75 seconds", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    const dealt = board(SEED, 1);
    for (const block of dealt.blocks) expect(blockButton(block)).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: / gate on the / })).toHaveLength(dealt.gates.length);
    expect(screen.getByRole("progressbar", { name: "Time left" })).toHaveAttribute(
      "aria-valuenow",
      "75",
    );
  });

  it("slides a block by dragging and by the arrow keys, undoes and restarts — and submits each", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    const dealt = board(SEED, 1);
    // A block that can slide somewhere without leaving, and a second way it can go.
    const [block, dir] = dealt.blocks
      .flatMap((k) => ([0, 1, 2, 3] as const).map((d) => [k, d] as const))
      .find(([k, d]) => slide(dealt, k, d)?.kind === "stop")!;
    drag(block, dir);
    const after = move(createRun(SEED), block, dir).board;
    const moved = after.blocks.find((k) => k.id === block.id)!;
    expect(blockButton(moved)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(blockButton(block)).toBeInTheDocument();

    // The arrow keys steer a focused block the same way.
    fireEvent.keyDown(blockButton(block), {
      key: ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"][dir],
    });
    expect(blockButton(moved)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(blockButton(block)).toBeInTheDocument();

    await endRun();
    await screen.findByText("Run ended");
    const action = encodeMove(dealt, block, dir);
    expect(submitted(spy)).toMatchObject({
      score: 0,
      progress: { actions: [action, HUEDINI_UNDO, action, HUEDINI_RESTART] },
    });
  });

  it("clears a board, deals the next, and shows the verified score", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    let run = createRun(SEED);
    for (const [id, dir] of solve(run.board)!) {
      const block = run.board.blocks.find((k) => k.id === id)!;
      drag(block, dir);
      run = move(run, block, dir);
    }
    // Test setup turns the level-up beat off, so the next board is dealt at once.
    expect(screen.getByText("Board 2")).toBeInTheDocument();
    expect(screen.getByText("Board 1 cleared. Here comes the next one.")).toBeInTheDocument();

    await endRun();
    await screen.findByText("Run ended");
    // The server's score: 4 units, shown as 40.
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("1 board cleared, 6 moves.")).toBeInTheDocument();
    expect(submitted(spy).score).toBe(board(SEED, 1).blocks.length);
  });
});
