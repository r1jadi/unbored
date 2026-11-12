import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FlipsideRuntime } from "@/components/game/FlipsideRuntime";
import { clearSession } from "@/lib/auth/session";
import { FLIPSIDE_TICK_MS, replay } from "@/lib/games/flipside";

/**
 * Flipside on screen, through the real API client against a stubbed server, with
 * the animation clock under the test's control: a session is issued, the rules
 * are shown, the runner waits for its first tap, the world runs in fixed ticks,
 * the taps are submitted against the ticks they landed on, and the result screen
 * shows the number the server verified.
 */

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    gameSlug: "flipside",
    rulesVersion: "flipside@1",
    seed: "1",
    tileCount: 8192,
    startedAt: "2026-11-20T12:00:00.000Z",
    expiresAt: "2026-11-20T14:00:00.000Z",
    ranked: true,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "11111111-2222-4333-8444-555555555555",
    gameSlug: "flipside",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 7,
    clearedColumns: 7,
    tilesPlaced: 1,
    durationMs: 21000,
    ranked: true,
    recordedAt: "2026-11-20T12:01:00.000Z",
    personalBest: 12,
    rank: 3,
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

function mockPlayback(resultOverrides: Record<string, unknown> = {}) {
  const spy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
    String(input).includes("/complete")
      ? jsonResponse(resultPayload(resultOverrides))
      : jsonResponse(sessionPayload(), 201),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** The body of the run that was submitted, if one was. */
function submitted(spy: ReturnType<typeof mockPlayback>) {
  const call = spy.mock.calls.find((c) => String(c[0]).includes("/complete"));
  return call ? JSON.parse(String(call[1]?.body)) : null;
}

// ── The animation clock, by hand ────────────────────────────────────────────

let now = 0;
let nextFrame = 1;
const frames = new Map<number, FrameRequestCallback>();

beforeEach(() => {
  now = 0;
  nextFrame = 1;
  frames.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

/** Runs `count` display frames, one tick's worth of time apart. */
async function runFrames(count: number) {
  for (let i = 0; i < count; i += 1) {
    now += FLIPSIDE_TICK_MS + 0.001;
    const due = [...frames.values()];
    frames.clear();
    await act(async () => {
      due.forEach((callback) => callback(now));
    });
  }
}

async function renderRuntime() {
  const root = createRootRoute();
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => <FlipsideRuntime slug="flipside" title="Flipside" />,
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

async function startRun() {
  fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
  return screen.getByRole("button", { name: /^Flipside tunnel/ });
}

describe("Flipside", () => {
  it("asks for a Flipside session and shows the rules before the tunnel", async () => {
    const spy = mockPlayback();
    await renderRuntime();

    expect(await screen.findByRole("heading", { name: "Flip the tunnel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Flipside tunnel/ })).not.toBeInTheDocument();
    const start = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(start?.[1]?.body ?? "{}"))).toMatchObject({
      gameSlug: "flipside",
      rulesVersion: "flipside@1",
    });
  });

  it("waits for the first tap: no time passes before it", async () => {
    const spy = mockPlayback({ score: 0 });
    await renderRuntime();
    const field = await startRun();

    expect(document.activeElement).toBe(field);
    expect(screen.getByText("Tap to flip")).toBeInTheDocument();
    await runFrames(120);
    expect(submitted(spy)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    await screen.findByText("Run ended");
    expect(submitted(spy)).toMatchObject({ score: 0, progress: { actions: [1] } });
  });

  it("runs in fixed ticks and submits the taps against the ticks they landed on", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    const field = await startRun();

    // Up to the ceiling, then back down to the floor — and on into the first hole.
    fireEvent.pointerDown(field);
    await runFrames(60);
    fireEvent.keyDown(field, { key: " " });
    await runFrames(400);

    const body = submitted(spy);
    expect(body).not.toBeNull();
    const actions: number[] = body.progress.actions;
    expect(actions[0]).toBe(0);
    expect(actions).toHaveLength(2);
    const run = replay("1", actions);
    expect(run.endReason).toBe("crash");
    expect(body.score).toBe(run.score);

    // The verified score, not the client's, scaled for display.
    expect(await screen.findByText("Wiped out")).toBeInTheDocument();
    expect(screen.getByText("70")).toBeInTheDocument();
    expect(screen.getByText("#3")).toBeInTheDocument();
  });

  it("does not record a second tap while one waits", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    const field = await startRun();

    fireEvent.pointerDown(field);
    fireEvent.pointerDown(field);
    fireEvent.keyDown(field, { key: "ArrowUp" });
    // On the ceiling it rides over the floor holes, into the first ceiling spikes.
    await runFrames(900);

    expect(submitted(spy).progress.actions[0]).toBe(0);
    expect(submitted(spy).progress.actions).toHaveLength(1);
  });
});
