import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CrosswordRuntime } from "@/components/game/CrosswordRuntime";
import { clearSession } from "@/lib/auth/session";
import { CROSSWORD_MIDIS, CROSSWORD_MINIS } from "@/lib/games/crossword-bank";
import { gridForDay, readPuzzle } from "@/lib/games/crossword";
import { buttonNamed } from "@/test/queries";

/**
 * The daily crossword on screen, driven through the real API client against a
 * stubbed server. The session's seed is day 20000, a Friday: a 5×5 mini.
 */

const DAY = 20000;
const GRID = gridForDay(DAY, CROSSWORD_MINIS, CROSSWORD_MIDIS);
const PUZZLE = readPuzzle(DAY, GRID);
const WHITE = [...GRID].flatMap((letter, cell) => (letter === "#" ? [] : [cell]));

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "cdcdcdcd-1111-4111-8111-cdcdcdcdcdcd",
    gameSlug: "crossword",
    rulesVersion: "crossword@1",
    seed: String(DAY),
    tileCount: 2048,
    startedAt: "2024-10-04T12:00:00.000Z",
    expiresAt: "2024-10-04T14:00:00.000Z",
    ranked: false,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "cdcdcdcd-1111-4111-8111-cdcdcdcdcdcd",
    gameSlug: "crossword",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 912,
    clearedColumns: 1,
    tilesPlaced: WHITE.length,
    durationMs: 52_000,
    ranked: false,
    recordedAt: "2024-10-04T12:00:52.000Z",
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

function mockPlayback(result = resultPayload()) {
  return mockFetch((url) =>
    url.includes("/complete") ? jsonResponse(result) : jsonResponse(sessionPayload(), 201),
  );
}

async function renderRuntime() {
  const root = createRootRoute();
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => <CrosswordRuntime slug="crossword" title="Daily Crossword" />,
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
  return buttonNamed(new RegExp(`^Row ${Math.floor(index / 5) + 1} column ${(index % 5) + 1}[,]`));
}

/** Picks a square and types a letter on the physical keyboard. */
function typeAt(index: number, letter: string) {
  fireEvent.click(cell(index));
  fireEvent.keyDown(cell(index), { key: letter });
}

async function startRun() {
  fireEvent.click(await screen.findByRole("button", { name: "Start today's crossword" }));
  await screen.findByRole("group", { name: "Today's crossword, 5 by 5" });
}

function completionBody(spy: ReturnType<typeof mockFetch>) {
  const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
  return JSON.parse(String(completion?.[1]?.body ?? "{}"));
}

function worthShown() {
  return Number(screen.getByText("Worth").closest("dl")?.querySelector("dd")?.textContent);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("starting a run", () => {
  it("shows the rules with no session, then today's grid and its first clue", async () => {
    const spy = mockPlayback();
    await renderRuntime();

    expect(screen.getByRole("heading", { name: "Today's crossword" })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    await startRun();

    const started = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(started?.[1]?.body))).toEqual({
      gameSlug: "crossword",
      rulesVersion: "crossword@1",
      client: "web/1.0",
    });
    expect(screen.getAllByRole("button", { name: /^Row \d column \d/ })).toHaveLength(WHITE.length);
    const first = PUZZLE.entries[0];
    expect(
      screen.getByRole("button", { name: new RegExp(`^${first.number} Across: `) }),
    ).toBeInTheDocument();
    expect(worthShown()).toBe(1000);
  });

  it("says when today's ranked crossword is already done", async () => {
    mockFetch(() =>
      jsonResponse(
        {
          error: {
            code: "conflict",
            message:
              "You've already played today's challenge. The next one arrives at midnight UTC.",
          },
        },
        409,
      ),
    );
    await renderRuntime();
    fireEvent.click(await screen.findByRole("button", { name: "Start today's crossword" }));
    expect(
      await screen.findByRole("heading", { name: "You've done today's crossword" }),
    ).toBeInTheDocument();
  });
});

describe("the grid", () => {
  it("types letters from the on-screen keyboard and the physical one, and deletes them", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    // 1-Across's first square is selected to begin with (picking it again would
    // switch to down).
    const [a, b] = PUZZLE.entries[0].cells;
    expect(cell(a)).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Q" }));
    expect(cell(a)).toHaveAccessibleName(/, Q$/);
    // The cursor moved on along the entry.
    expect(cell(b)).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(cell(b), { key: "z" });
    expect(cell(b)).toHaveAccessibleName(/, Z$/);
    fireEvent.click(cell(b)); // the cursor had moved past it
    fireEvent.keyDown(cell(b), { key: "Backspace" });
    expect(cell(b)).toHaveAccessibleName(/, empty$/);
  });

  it("checks the grid for a cost, marking the wrong letters", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    const target = WHITE[0];
    typeAt(target, GRID[target] === "Z" ? "Y" : "Z");
    fireEvent.click(screen.getByRole("button", { name: /^Check/ }));
    expect(cell(target)).toHaveAccessibleName(/, wrong$/);
    expect(worthShown()).toBe(950);
  });

  it("reveals the selected letter for a cost, and locks it", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    const target = WHITE[0];
    fireEvent.click(cell(target));
    fireEvent.click(screen.getByRole("button", { name: /^Letter/ }));
    expect(cell(target)).toHaveAccessibleName(new RegExp(`, ${GRID[target]}, revealed$`));
    expect(worthShown()).toBe(900);
  });
});

describe("finishing", () => {
  it("submits the solve as soon as the grid is right, and shows the server's score", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    for (const index of WHITE) typeAt(index, GRID[index]);

    expect(await screen.findByText("912")).toBeInTheDocument();
    const body = completionBody(spy);
    expect(body.progress.rulesVersion).toBe("crossword@1");
    expect(body.progress.actions).toEqual(
      WHITE.map((index) => index * 32 + GRID[index].charCodeAt(0) - 64),
    );
    expect(screen.getByText(/^Solved · Mini 5×5 · Friday$/)).toBeInTheDocument();
  }, 15000);

  it("lets the player give up, which scores nothing", async () => {
    const spy = mockPlayback(resultPayload({ score: 0, clearedColumns: 0 }));
    await renderRuntime();
    await startRun();

    fireEvent.click(screen.getByRole("button", { name: "Give up" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Give up" }));

    expect(await screen.findByText("Not solved today")).toBeInTheDocument();
    expect(completionBody(spy).score).toBe(0);
    // Giving up shows how the grid solves, with every answer beside its clue.
    expect(screen.getByText("Here's how it solves")).toBeInTheDocument();
    for (const answer of ["ARCH", "WIRE", "RAVEN", "AREA", "TERM"]) {
      expect(screen.getByText(answer)).toBeInTheDocument();
    }
  });
});
