import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UpdraftRuntime } from "@/components/game/UpdraftRuntime";
import { clearSession } from "@/lib/auth/session";
import { UPDRAFT_TICK_MS, replay } from "@/lib/games/updraft";

/**
 * Flutter (slug `updraft`) on screen.
 *
 * Driven through the real API client against a stubbed server, with the
 * animation clock under the test's control: every frame is advanced by hand, so
 * what is asserted is the whole path — a session is issued, the rules are shown,
 * the glider waits for its first flap, the world runs in fixed ticks, the flaps
 * are submitted against the ticks they landed on, and the number on the result
 * screen is the one the server verified.
 */

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    gameSlug: "updraft",
    rulesVersion: "updraft@1",
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
    gameSlug: "updraft",
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
    now += UPDRAFT_TICK_MS + 0.001;
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
      component: () => <UpdraftRuntime slug="updraft" title="Flutter" />,
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
  return screen.getByRole("button", { name: /^Flutter field/ });
}

describe("Flutter", () => {
  it("asks for a Flutter session and shows the rules before the field", async () => {
    const spy = mockPlayback();
    await renderRuntime();

    expect(await screen.findByRole("heading", { name: "Ride the updraft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Flutter field/ })).not.toBeInTheDocument();
    const start = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(start?.[1]?.body ?? "{}"))).toEqual({
      gameSlug: "updraft",
      rulesVersion: "updraft@1",
      client: "web/1.0",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it("waits for the first flap: no time passes before it", async () => {
    const spy = mockPlayback({ score: 0 });
    await renderRuntime();
    const field = await startRun();

    expect(document.activeElement).toBe(field);
    expect(screen.getByText("Tap to flap")).toBeInTheDocument();
    await runFrames(120);
    expect(submitted(spy)).toBeNull();

    // Ending it there is a stop before tick zero: nothing flown, nothing scored.
    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    await screen.findByText("Run ended");
    expect(submitted(spy)).toMatchObject({ score: 0, progress: { actions: [1] } });
  });

  it("flies in fixed ticks and submits the flaps against the ticks they landed on", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    const field = await startRun();

    fireEvent.pointerDown(field);
    await runFrames(10);
    fireEvent.keyDown(field, { key: " " });
    // Let it fall to the ground.
    await runFrames(200);

    const body = submitted(spy);
    expect(body).not.toBeNull();
    const actions: number[] = body.progress.actions;
    expect(actions[0]).toBe(0);
    expect(actions).toHaveLength(2);
    // The submission is exactly what the server's replay will fly.
    const flown = replay("1", actions);
    expect(flown.endReason).toBe("crash");
    expect(body.score).toBe(flown.score);

    // The verified score, not the client's, scaled for display.
    expect(await screen.findByText("You hit the wall")).toBeInTheDocument();
    expect(screen.getByText("70")).toBeInTheDocument();
    expect(screen.getByText("#3")).toBeInTheDocument();
  });

  it("does not record two flaps on one tick", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    const field = await startRun();

    fireEvent.pointerDown(field);
    fireEvent.pointerDown(field);
    fireEvent.keyDown(field, { key: "ArrowUp" });
    await runFrames(200);

    expect(submitted(spy).progress.actions).toEqual([0]);
  });
});
