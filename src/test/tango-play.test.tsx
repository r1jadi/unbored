import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TangoRuntime } from "@/components/game/TangoRuntime";
import { clearSession, signIn } from "@/lib/auth/session";
import { board } from "@/lib/games/tango";

/**
 * Tango on screen, driven through the real API client against a stubbed server.
 *
 * Seed 1's first board starts with a moon on cell 0 and fills from the taps in
 * `LINE_ONE` (once for a sun, twice for a moon). Like Zip and 8 Puzzle, the rules
 * show with no session, Start asks for one, and the clock ends the run.
 */

const LINE_ONE = [
  1, 2, 3, 3, 5, 6, 6, 7, 9, 9, 10, 10, 11, 12, 13, 13, 14, 14, 15, 16, 18, 19, 19, 20, 20, 22, 22,
  23, 24, 24, 26, 27, 27, 28, 29, 29, 30, 32, 32, 34,
];
const CELL = /^Row \d column \d,/;

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "efefefef-1111-4111-8111-efefefefefef",
    gameSlug: "sun-and-moon",
    rulesVersion: "tango@1",
    seed: "1",
    tileCount: 8192,
    startedAt: "2026-11-11T12:00:00.000Z",
    expiresAt: "2026-11-12T00:00:00.000Z",
    ranked: false,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "efefefef-1111-4111-8111-efefefefefef",
    gameSlug: "sun-and-moon",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 180,
    clearedColumns: 3,
    tilesPlaced: 130,
    durationMs: 140_000,
    ranked: false,
    recordedAt: "2026-11-11T12:02:20.000Z",
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

function mockPlayback(sessionOverrides: Record<string, unknown> = {}, result = resultPayload()) {
  return mockFetch((url) =>
    url.includes("/complete")
      ? jsonResponse(result)
      : jsonResponse(sessionPayload(sessionOverrides), 201),
  );
}

async function renderRuntime() {
  const root = createRootRoute();
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => <TangoRuntime slug="sun-and-moon" title="Sun & Moon" />,
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
  const row = Math.floor(index / 6) + 1;
  const column = (index % 6) + 1;
  return screen.getByRole("button", { name: new RegExp(`^Row ${row} column ${column},`) });
}

function tapCells(cells: readonly number[]) {
  for (const index of cells) fireEvent.click(cell(index));
}

function scoreShown() {
  return screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent;
}

async function startRun() {
  fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
  await screen.findByRole("group", { name: "Board 1, 6 by 6" });
}

function sessionCalls(spy: ReturnType<typeof mockFetch>) {
  return spy.mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/sessions"));
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

    expect(screen.getByRole("heading", { name: "Suns and moons" })).toBeInTheDocument();
    expect(screen.getByText(/three of each, and no three alike/)).toBeInTheDocument();
    expect(screen.getByText(/= means they match, × means they differ/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    await startRun();

    expect(JSON.parse(String(sessionCalls(spy)[0][1]?.body ?? "{}"))).toEqual({
      gameSlug: "sun-and-moon",
      rulesVersion: "tango@1",
      client: "web/1.0",
    });
    expect(screen.getAllByRole("button", { name: CELL })).toHaveLength(36);
    expect(screen.getByText("27 cells left")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Time left" })).toHaveAttribute(
      "aria-valuenow",
      "120",
    );
  });
});

describe("the board", () => {
  it("shows the starting cells as fixed, and does not let them change", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    expect(cell(0)).toHaveAccessibleName("Row 1 column 1, moon, fixed.");
    expect(cell(0)).toBeDisabled();
    expect(cell(1)).toHaveAccessibleName(/^Row 1 column 2, empty\. Tap to place a sun\./);
  });

  it("cycles a cell through a sun, a moon and empty", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    tapCells([1]);
    expect(cell(1)).toHaveAccessibleName(/sun\. Tap to make it a moon\./);
    tapCells([1]);
    expect(cell(1)).toHaveAccessibleName(/moon\. Tap to clear it\./);
    tapCells([1]);
    expect(cell(1)).toHaveAccessibleName(/empty\. Tap to place a sun\./);
  });

  it("marks cells that break a rule", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    // Cell 0 is a moon; moons on 1 and 2 make three alike in a row.
    tapCells([1, 1, 2, 2]);
    expect(cell(1)).toHaveAccessibleName(/moon, breaks a rule/);
    expect(cell(0)).toHaveAccessibleName(/moon, fixed, breaks a rule/);
    expect(screen.getByText("Something clashes: the red cells break a rule.")).toBeInTheDocument();
  });

  it("shows the board's signs", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    const { signs } = board("1", 1);
    const group = screen.getByRole("group", { name: "Board 1, 6 by 6" });
    expect(within(group).getAllByText(/^[=×]$/)).toHaveLength(signs.length);
  });

  it("solves a board when it matches the solution: sixty points and more time", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    tapCells(LINE_ONE);

    expect(screen.getByRole("group", { name: "Board 2, 6 by 6" })).toBeInTheDocument();
    expect(scoreShown()).toBe("60");
    expect(screen.getByText(/Board 1 solved, \+60/)).toBeInTheDocument();
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuemax"))).toBe(165);
  });
});

describe("finishing a run", () => {
  it("ends the run when the clock runs out, and submits every tap", async () => {
    const spy = mockPlayback({}, resultPayload({ score: 60, clearedColumns: 1 }));
    await renderRuntime();
    await startRun();

    tapCells(LINE_ONE);
    // Past the 165 seconds the first board earned: the next tap finds the clock over.
    const later = Date.now() + 166_000;
    vi.spyOn(Date, "now").mockImplementation(() => later);
    tapCells([0]); // empty on board two

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Time's up")).toBeInTheDocument();
    const body = completionBody(spy);
    expect(body.progress.rulesVersion).toBe("tango@1");
    expect(body.progress.actions).toEqual(LINE_ONE);
    expect(body.score).toBe(60);
  });

  it("lets the player end the run, and shows the score the server verified", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();
    tapCells(LINE_ONE);
    await endRun();

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Run ended")).toBeInTheDocument();
    expect(screen.getByText("180")).toBeInTheDocument();
    expect(completionBody(spy).score).toBe(60);
  });

  it("ranks a signed-in player's run", async () => {
    mockFetch(() =>
      jsonResponse({
        session: { userId: "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f", role: "user" },
        tokens: {
          accessToken: "access-token-1",
          refreshToken: "refresh-token-1",
          tokenType: "bearer",
        },
      }),
    );
    await signIn("player@example.com", "correct-horse");
    const spy = mockPlayback(
      { ranked: true },
      resultPayload({ ranked: true, rank: 2, personalBest: 240 }),
    );
    await renderRuntime();
    expect(screen.getByText("Signed in: this run can be ranked")).toBeInTheDocument();
    await startRun();
    await endRun();
    await screen.findByRole("button", { name: /play again/i });

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    expect(new Headers(completion?.[1]?.headers).get("Authorization")).toBe(
      "Bearer access-token-1",
    );
    expect(screen.getByText("#2")).toBeInTheDocument();
  });
});
