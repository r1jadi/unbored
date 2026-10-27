import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DontTouchRuntime } from "@/components/game/DontTouchRuntime";
import { buttonNamed } from "@/test/queries";
import { clearSession, signIn } from "@/lib/auth/session";
import { DONT_TOUCH_LANES, cellAt, rowAt } from "@/lib/games/dont-touch";

/**
 * Don't Touch the Black on screen.
 *
 * The screen is mounted in a router because its end-of-run panel is a set of
 * links, and it is driven through the real API client against a stubbed server —
 * so what is asserted here is the whole path: a session is issued, the rules are
 * shown, a row is tapped, the taps are submitted, and the number that appears is
 * the one the server verified.
 *
 * The states that matter are the ones a careless implementation fudges:
 *
 *   - no conveyor is playable before the player has read the rules and started;
 *   - only the row at the line is touchable, and a cleared tile is not touched
 *     twice;
 *   - a black tile ends the run, and the tap that ended it is submitted;
 *   - a white tile that passes the line uncleared ends the run too;
 *   - there is no last row: the conveyor runs past the old twenty-row deck;
 *   - the player can stop a run, and stopping keeps the whites cleared;
 *   - a score is never shown as verified before it is;
 *   - a failed submission keeps the run and can be retried.
 */

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    gameSlug: "dont-touch-the-black",
    rulesVersion: "dont-touch@2",
    seed: "1",
    tileCount: 4095,
    startedAt: "2026-10-23T12:00:00.000Z",
    expiresAt: "2026-10-23T14:00:00.000Z",
    ranked: true,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "11111111-2222-4333-8444-555555555555",
    gameSlug: "dont-touch-the-black",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 990,
    clearedColumns: 0,
    tilesPlaced: 9,
    durationMs: 21000,
    ranked: true,
    recordedAt: "2026-10-23T12:01:00.000Z",
    personalBest: 410,
    rank: 2,
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

/** A server that issues a session and verifies whatever run is submitted. */
function mockPlayback(sessionOverrides: Record<string, unknown> = {}, resultOverrides = {}) {
  return mockFetch((url) =>
    url.includes("/complete")
      ? jsonResponse(resultPayload(resultOverrides))
      : jsonResponse(sessionPayload(sessionOverrides), 201),
  );
}

async function renderRuntime() {
  const root = createRootRoute();
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => (
        <DontTouchRuntime slug="dont-touch-the-black" title="Don't Touch the Black" />
      ),
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

/** The wrapper that owns the keyboard controls. */
function conveyor() {
  return screen.getByLabelText(/^Don't Touch the Black conveyor/);
}

/** Presses Start and returns the live conveyor's controls. */
async function startRun() {
  fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
  await screen.findByLabelText(/^Don't Touch the Black conveyor/);
  return conveyor();
}

/** The button for one tile of a row, whatever its state. */
function tile(row: number, lane: number) {
  return buttonNamed(new RegExp(`^Row ${row}, lane ${lane}`));
}

const WHITE_OPENING_TILE = cellAt(0, 2);
const BLACK_OPENING_TILE = cellAt(0, 1);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("starting a run", () => {
  it("issues a session before it shows the rules or a conveyor", async () => {
    let release: (() => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(jsonResponse(sessionPayload(), 201));
          }),
      ),
    );

    await renderRuntime();

    expect(screen.getByText("Starting a run…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start run" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Don't Touch the Black conveyor/)).not.toBeInTheDocument();

    await act(async () => {
      release?.();
    });

    expect(await screen.findByRole("button", { name: "Start run" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tap white. Only white." })).toBeInTheDocument();
  });

  it("asks for a Don't Touch the Black session, not another game's rules", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await screen.findByRole("button", { name: "Start run" });

    const start = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(start?.[1]?.body ?? "{}"))).toEqual({
      gameSlug: "dont-touch-the-black",
      rulesVersion: "dont-touch@2",
      client: "web/1.0",
    });
  });

  it("explains the rules and does not offer a conveyor until the player starts", async () => {
    mockPlayback();
    await renderRuntime();

    expect(
      await screen.findByRole("heading", { name: "Tap white. Only white." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Never touch a black tile/)).toBeInTheDocument();
    expect(screen.getByText(/tightens the beat/)).toBeInTheDocument();
    expect(screen.getByText("Signed in: this run can be ranked")).toBeInTheDocument();

    await startRun();

    expect(screen.getByText("Row 1")).toBeInTheDocument();
    expect(screen.getByText(/Black tiles: 25% of this row/)).toBeInTheDocument();
    // Seed 1's opening row is white, black, white.
    expect(tile(1, 1)).toHaveAccessibleName(/white/);
    expect(tile(1, 2)).toHaveAccessibleName(/black/);
    expect(tile(1, 3)).toHaveAccessibleName(/white/);
    expect(tile(1, 3)).toBeEnabled();
  });

  it("moves focus onto the conveyor when the rules give way to it", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    expect(document.activeElement).toBe(conveyor());
  });

  it("reports a failed start with a retry rather than an empty conveyor", async () => {
    let attempts = 0;
    mockFetch(() => {
      attempts += 1;
      return attempts === 1
        ? jsonResponse(
            {
              error: {
                code: "service_unavailable",
                message: "Play sessions are not available right now.",
              },
            },
            503,
          )
        : jsonResponse(sessionPayload(), 201);
    });

    await renderRuntime();

    await screen.findByText("Couldn't start a run");
    expect(screen.getByText("Play sessions are not available right now.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByRole("button", { name: "Start run" });
  });
});

describe("tapping the row at the line", () => {
  it("scores a white tile and records the tap", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    fireEvent.click(tile(1, 3));

    expect(screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent).toBe("10");
    expect(screen.getByText("1 cleared")).toBeInTheDocument();
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });

  it("does not score a tile that was already cleared", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    const white = tile(1, 3);
    fireEvent.click(white);
    fireEvent.click(white);

    expect(screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent).toBe("10");
    expect(spy.mock.calls.some((call) => String(call[0]).includes("/complete"))).toBe(false);
  });

  it("does not let a row above the line be tapped", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    // Row 2 is visible so the player can plan, but it is not at the line yet.
    expect(tile(2, 1)).toBeDisabled();
    fireEvent.click(tile(2, 1));

    expect(screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent).toBe("0");
  });

  it("accepts the number keys as lanes", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    fireEvent.keyDown(conveyor(), { key: "3" });

    expect(screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent).toBe("10");
  });

  it("accepts A, S and D as lanes too", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    fireEvent.keyDown(conveyor(), { key: "s" });
    // Lane two of the opening row is black, so this is an ending, not a score.
    expect(await screen.findByText("You touched the black")).toBeInTheDocument();
  });

  it("ends the run on a black tile and submits the tap that ended it", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    fireEvent.click(tile(1, 2));

    const finished = await screen.findByText("You touched the black");
    expect(finished).toBeInTheDocument();

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toEqual([BLACK_OPENING_TILE]);
    expect(body.progress.rulesVersion).toBe("dont-touch@2");
    expect(body.score).toBe(0);
    // The verified number is the server's, not a local tally.
    expect(screen.getByText("990")).toBeInTheDocument();
  });

  it("sends the whites it cleared before a black tap", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    fireEvent.click(tile(1, 3));
    fireEvent.click(tile(1, 2));

    await screen.findByText("You touched the black");
    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toEqual([WHITE_OPENING_TILE, BLACK_OPENING_TILE]);
    expect(body.score).toBe(10);
  });
});

describe("the endless conveyor", () => {
  /** Seed 1's white cells in rows `0` to `rows - 1`, in the order a player clears them. */
  function whitesBefore(rows: number): number[] {
    const cells: number[] = [];
    for (let row = 0; row < rows; row += 1) {
      rowAt("1", row).forEach((black, lane) => {
        if (!black) cells.push(cellAt(row, lane));
      });
    }
    return cells;
  }

  /**
   * Plays the conveyor forward one row at a time, clearing each row's white
   * tiles first — a row that leaves the line with a white on it ends the run.
   * The next timer is scheduled by an effect after each render, so the clock has
   * to give React a turn between rows rather than jumping straight to the end.
   */
  async function advance(rows: number) {
    for (let row = 0; row < rows; row += 1) {
      for (let lane = 0; lane < DONT_TOUCH_LANES; lane += 1) {
        if (!rowAt("1", row)[lane]) fireEvent.click(tile(row + 1, lane + 1));
      }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1700);
      });
    }
  }

  /** Renders, takes over the clock, and presses Start. */
  async function startOnFakeClock() {
    await renderRuntime();
    await screen.findByRole("button", { name: "Start run" });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
  }

  it("keeps running past the old twenty-row deck", async () => {
    const spy = mockPlayback();
    await startOnFakeClock();

    await advance(21);

    // Row twenty-two exists, is at the line, and nothing has been submitted:
    // the conveyor did not stop where the finite deck used to.
    expect(screen.getByText("Row 22")).toBeInTheDocument();
    expect(tile(22, 1)).toBeEnabled();
    expect(spy.mock.calls.some((call) => String(call[0]).includes("/complete"))).toBe(false);
  });

  it("shows the black density rising with the rows", async () => {
    mockPlayback();
    await startOnFakeClock();

    expect(screen.getByText(/Black tiles: 25% of this row/)).toBeInTheDocument();

    await advance(10);

    expect(screen.getByText("Row 11")).toBeInTheDocument();
    expect(screen.getByText(/Black tiles: 26% of this row/)).toBeInTheDocument();
  });

  it("ends the run on a black tile deep into the conveyor", async () => {
    const spy = mockPlayback();
    await startOnFakeClock();

    await advance(11);
    // Seed 1's row twelve (cells 33-35) is white, white, black.
    expect(tile(12, 3)).toHaveAccessibleName(/black/);
    fireEvent.click(tile(12, 3));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("You touched the black")).toBeInTheDocument();
    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toEqual([...whitesBefore(11), cellAt(11, 2)]);
    expect(body.progress.rulesVersion).toBe("dont-touch@2");
  });

  it("ends the run when a white tile passes the line uncleared", async () => {
    const spy = mockPlayback();
    await startOnFakeClock();

    // Seed 1's opening row has two whites. Clear one, let the row go by.
    fireEvent.click(tile(1, 3));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1700);
    });

    expect(screen.getByText("A white tile got past")).toBeInTheDocument();
    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    // Exactly the taps that were made: nothing is invented for the miss.
    expect(body.progress.actions).toEqual([WHITE_OPENING_TILE]);
    expect(body.score).toBe(10);
  });

  it("lets the player stop a run and keeps the whites already cleared", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    fireEvent.click(tile(1, 3));
    fireEvent.click(screen.getByRole("button", { name: "End run" }));

    expect(await screen.findByText("Run ended")).toBeInTheDocument();
    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toEqual([WHITE_OPENING_TILE]);
    expect(body.score).toBe(10);
  });

  it("submits a stopped run that cleared nothing, without inventing a score", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    fireEvent.click(screen.getByRole("button", { name: "End run" }));

    expect(await screen.findByText("Run ended")).toBeInTheDocument();
    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toEqual([]);
    expect(body.score).toBe(0);
  });
});

describe("after a run", () => {
  it("starts a fresh run from the end-of-run screen, rules first", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();
    fireEvent.click(tile(1, 2));
    await screen.findByText("You touched the black");

    fireEvent.click(screen.getByRole("button", { name: /play again/i }));

    expect(
      await screen.findByRole("heading", { name: "Tap white. Only white." }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Don't Touch the Black conveyor/)).not.toBeInTheDocument();
    const sessions = spy.mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(sessions).toHaveLength(2);
  });

  it("reports a guest's run as unranked, and says where it is not", async () => {
    mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(resultPayload({ ranked: false, rank: null, personalBest: null }))
        : jsonResponse(sessionPayload({ ranked: false }), 201),
    );
    await renderRuntime();
    expect(await screen.findByText("Guest run: verified, but not ranked")).toBeInTheDocument();

    await startRun();
    fireEvent.click(tile(1, 3));
    fireEvent.click(tile(1, 2));
    await screen.findByText("You touched the black");

    expect(
      screen.getByText(/This was a guest run, so it is not on the leaderboard\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in to rank your scores/i })).toBeInTheDocument();
    expect(screen.queryByText("Rank")).not.toBeInTheDocument();
  });

  it("reports a failed verification without claiming the run was saved", async () => {
    let completions = 0;
    const spy = mockFetch((url) => {
      if (!url.includes("/complete")) return jsonResponse(sessionPayload(), 201);
      completions += 1;
      return completions === 1
        ? jsonResponse(
            {
              error: {
                code: "conflict",
                message: "That run expired before it was submitted. Start a new one.",
              },
            },
            409,
          )
        : jsonResponse(resultPayload());
    });

    await renderRuntime();
    await startRun();
    fireEvent.click(tile(1, 2));

    await screen.findByText("Your run was not verified");
    expect(
      screen.getByText(/That run expired before it was submitted\. Start a new one\./),
    ).toBeInTheDocument();
    expect(screen.queryByText("990")).not.toBeInTheDocument();

    // Retrying re-sends the same run — which is safe, because the server
    // recognises it — rather than starting over.
    fireEvent.click(screen.getByRole("button", { name: /try submitting again/i }));

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("990")).toBeInTheDocument();
    const sessions = spy.mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(sessions).toHaveLength(1);
    const bodies = spy.mock.calls
      .filter((call) => String(call[0]).includes("/complete"))
      .map((call) => String(call[1]?.body ?? ""));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
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

    const spy = mockPlayback();
    await renderRuntime();
    await startRun();
    fireEvent.click(tile(1, 2));
    await screen.findByText("You touched the black");

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const headers = new Headers(completion?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer access-token-1");
    expect(screen.getByText("#2")).toBeInTheDocument();
  });
});
