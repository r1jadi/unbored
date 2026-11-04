import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ColorMergeRuntime } from "@/components/game/ColorMergeRuntime";
import { clearSession, signIn } from "@/lib/auth/session";
import {
  COLOR_MERGE_SLIDES,
  DOWN,
  LEFT,
  RIGHT,
  UP,
  canSlide,
  createRun,
  slide,
  type ColorMergeDirection,
} from "@/lib/games/color-merge";

/**
 * Color Merge on screen.
 *
 * The screen is mounted in a router because its end-of-run panel is a set of
 * links, and it is driven through the real API client against a stubbed server —
 * so what is asserted here is the whole path: a session is issued, the rules are
 * shown, the board is slid, the directions are submitted, and the number that
 * appears is the one the server verified.
 *
 * The states that matter are the ones a careless implementation fudges:
 *
 *   - no board is playable before the player has read the rules and started;
 *   - a direction that would not move the board is not offered and not recorded;
 *   - a score is never shown as verified before it is;
 *   - a guest's run is shown as a guest's run, not quietly ranked;
 *   - a failed submission keeps the run and can be retried.
 *   - the run keeps dealing past the retired forty-eight-slide deck, and only a
 *     locked board ends it.
 */

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "99999999-1111-4111-8111-999999999999",
    gameSlug: "color-merge",
    rulesVersion: "color-merge@2",
    seed: "1",
    tileCount: 4096,
    startedAt: "2026-10-22T12:00:00.000Z",
    expiresAt: "2026-10-22T14:00:00.000Z",
    ranked: true,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "99999999-1111-4111-8111-999999999999",
    gameSlug: "color-merge",
    // Deliberately not the client's 468: the screen must show the verified number.
    score: 400,
    clearedColumns: 0,
    tilesPlaced: RUN.length,
    durationMs: 62000,
    ranked: true,
    recordedAt: "2026-10-22T12:01:00.000Z",
    personalBest: 512,
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
      component: () => <ColorMergeRuntime slug="color-merge" title="Color Merge" />,
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

const KEYS: Record<ColorMergeDirection, string> = {
  [UP]: "ArrowUp",
  [RIGHT]: "ArrowRight",
  [DOWN]: "ArrowDown",
  [LEFT]: "ArrowLeft",
};

/**
 * Seed 1's endless line, played the way a screen test can play it: the first
 * direction that changes the board, in the order down, left, right, up. The run
 * ends when the board locks — sixty-four slides in, well past the retired deck.
 */
function runLine(): ColorMergeDirection[] {
  const order: ColorMergeDirection[] = [DOWN, LEFT, RIGHT, UP];
  const moves: ColorMergeDirection[] = [];
  let current = createRun("1");
  while (current.outcome === "playing") {
    const direction = order.find((candidate) => canSlide(current, candidate));
    if (direction === undefined) throw new Error("a live run must have a legal slide");
    moves.push(direction);
    current = slide(current, direction);
  }
  return moves;
}

const RUN = runLine();

/** The wrapper that owns the keyboard controls. */
function boardControls() {
  return screen.getByLabelText(/^Color Merge board/);
}

/** Presses Start and returns the live board's controls. */
async function startRun() {
  fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
  await screen.findByRole("grid");
  return boardControls();
}

/** Plays a direction with the arrow keys, exactly as a keyboard player would. */
function press(direction: ColorMergeDirection) {
  fireEvent.keyDown(boardControls(), { key: KEYS[direction] });
}

/** Drags a finger across the board from one point to another. */
function swipe(el: HTMLElement, fromX: number, fromY: number, toX: number, toY: number) {
  fireEvent(el, new MouseEvent("pointerdown", { bubbles: true, clientX: fromX, clientY: fromY }));
  fireEvent(el, new MouseEvent("pointerup", { bubbles: true, clientX: toX, clientY: toY }));
}

/**
 * A touch gesture that starts on one element and lifts on another, the way a
 * finger leaves the grid when it swipes off its edge. Pointer capture is what
 * delivers the release back to the board in a real browser; this shapes the two
 * events the handler actually receives.
 */
function touchSwipe(
  from: HTMLElement,
  to: HTMLElement,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
) {
  const down = new MouseEvent("pointerdown", {
    bubbles: true,
    clientX: fromX,
    clientY: fromY,
  });
  Object.defineProperty(down, "pointerId", { value: 9 });
  Object.defineProperty(down, "pointerType", { value: "touch" });
  fireEvent(from, down);

  const up = new MouseEvent("pointerup", { bubbles: true, clientX: toX, clientY: toY });
  Object.defineProperty(up, "pointerId", { value: 9 });
  Object.defineProperty(up, "pointerType", { value: "touch" });
  fireEvent(to, up);
}

/** Plays the whole run through the keyboard and waits for verification. */
async function playRun() {
  for (const direction of RUN) press(direction);
  await screen.findByRole("button", { name: /play again/i });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("starting a run", () => {
  it("issues a session before it shows the rules or a board", async () => {
    // The session response is held open, which is the only way to observe the
    // state before it arrives: rules with no session behind them would be a
    // promise the screen could not keep.
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
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();

    await act(async () => {
      release?.();
    });

    expect(await screen.findByRole("button", { name: "Start run" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Merge the shades" })).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("asks for a Color Merge session, not another game's rules", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await screen.findByRole("button", { name: "Start run" });

    const start = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(start?.[1]?.body ?? "{}"))).toEqual({
      gameSlug: "color-merge",
      rulesVersion: "color-merge@2",
      client: "web/1.0",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it("explains the rules and does not offer a board until the player starts", async () => {
    mockPlayback();
    await renderRuntime();

    expect(await screen.findByRole("heading", { name: "Merge the shades" })).toBeInTheDocument();
    expect(screen.getByText(/Two equal colours become the next shade/)).toBeInTheDocument();
    expect(screen.getByText(/No final slide/)).toBeInTheDocument();
    expect(screen.getByText("Signed in: this run can be ranked")).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();

    await startRun();

    expect(screen.getByRole("grid", { name: /0 slides played/ })).toBeInTheDocument();
    // Seed 1 opens with two shade-1 tiles on the last row, side by side.
    expect(screen.getByRole("gridcell", { name: "Row 4 column 1, 2" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "Row 4 column 2, 2" })).toBeInTheDocument();
  });

  it("moves focus onto the board when the rules give way to it", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    expect(document.activeElement).toBe(boardControls());
  });

  it("reports a failed start with a retry rather than an empty board", async () => {
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

describe("sliding the board", () => {
  it("merges the two opening tiles on a left slide and scores the merge", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    press(LEFT);

    // The two 2s merge into a 4 — the tile that was created is the score.
    expect(screen.getByRole("gridcell", { name: "Row 4 column 1, 4" })).toBeInTheDocument();
    expect(screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent).toBe("40");
    expect(screen.getByText("Slide 1")).toBeInTheDocument();
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });

  it("accepts WASD as well as the arrow keys", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    fireEvent.keyDown(boardControls(), { key: "a" });

    expect(screen.getByText("Slide 1")).toBeInTheDocument();
  });

  it("does not record or score a slide that cannot move the board", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();

    // The opening tiles are on the bottom row: sliding down changes nothing.
    expect(screen.getByRole("button", { name: "Slide down" })).toBeDisabled();
    press(DOWN);

    expect(screen.getByText("Slide 0")).toBeInTheDocument();
    expect(screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent).toBe("0");
    expect(spy.mock.calls.some((call) => String(call[0]).includes("/complete"))).toBe(false);
  });

  it("offers every direction as a real button, for touch and for keyboards", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    for (const [name] of [["Slide up"], ["Slide right"], ["Slide down"], ["Slide left"]] as const) {
      const button = screen.getByRole("button", { name });
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");
    }

    fireEvent.click(screen.getByRole("button", { name: "Slide left" }));
    expect(screen.getByText("Slide 1")).toBeInTheDocument();
  });

  it("keeps the arrow keys working after a d-pad press disables its own button", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    // Sliding left turns the pair into a single tile at the left wall, so the
    // button that was just pressed becomes disabled. Focus must not fall to the
    // body with it: the wrapper is the only element that listens for keys.
    const left = screen.getByRole("button", { name: "Slide left" });
    left.focus();
    fireEvent.click(left);

    expect(document.activeElement).toBe(boardControls());

    press(RIGHT);
    expect(screen.getByText("Slide 2")).toBeInTheDocument();
  });

  it("slides on a swipe", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    // jsdom has no PointerEvent, so the coordinates are carried on a MouseEvent
    // dispatched as a pointer event — the same shape React hands the handler.
    swipe(screen.getByRole("grid"), 200, 300, 80, 302);

    expect(screen.getByText("Slide 1")).toBeInTheDocument();
    // A leftward swipe merges the opening pair, which is the left move.
    expect(screen.getByRole("gridcell", { name: "Row 4 column 1, 4" })).toBeInTheDocument();
  });

  it("ignores a tap, which is not a swipe", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    swipe(screen.getByRole("grid"), 200, 300, 205, 306);

    expect(screen.getByText("Slide 0")).toBeInTheDocument();
  });

  it("takes over the gesture from the browser, so a finger swipe is not a scroll", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    // Without `touch-action: none`, a touch drag is claimed by panning: the
    // pointer is cancelled before release and the board never sees the swipe.
    // (jsdom does not serialise the property, so it is read off the declaration.)
    expect(screen.getByRole("grid").style.touchAction).toBe("none");
  });

  it("swipes with a finger that lifts after leaving the board", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    const grid = screen.getByRole("grid");
    const cell = screen.getByRole("gridcell", { name: "Row 4 column 1, 2" });
    touchSwipe(cell, grid, 200, 300, 80, 302);

    expect(screen.getByText("Slide 1")).toBeInTheDocument();
    // The opening pair merged into the 4 at the left wall.
    expect(screen.getByRole("gridcell", { name: "Row 4 column 1, 4" })).toBeInTheDocument();
  });

  it("swipes up as well as sideways", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    swipe(screen.getByRole("grid"), 200, 300, 202, 150);

    expect(screen.getByText("Slide 1")).toBeInTheDocument();
    // The pair rose to the top row, and the slide dealt one tile beside it.
    expect(screen.getByRole("gridcell", { name: "Row 1 column 1, 2" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "Row 1 column 2, 2" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "Row 4 column 1, empty" })).toBeInTheDocument();
  });
});

describe("finishing a run", () => {
  it("plays past the old deck, ends on a locked board, and submits every slide", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();
    expect(RUN.length).toBeGreaterThan(COLOR_MERGE_SLIDES);
    await playRun();

    expect(screen.getByText("The board locked")).toBeInTheDocument();
    // The verified 400, not the 468 the board accumulated.
    expect(screen.getByText("4000")).toBeInTheDocument();
    expect(screen.getByText(`${RUN.length} slides, best tile 64.`)).toBeInTheDocument();
    expect(screen.getByText("5120")).toBeInTheDocument(); // personal best
    expect(screen.getByText("#3")).toBeInTheDocument(); // rank
    expect(screen.getByText(/Verified by replaying your slides on the server/)).toBeInTheDocument();

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toEqual(RUN);
    expect(body.progress.actions).toHaveLength(64);
    expect(body.progress.rulesVersion).toBe("color-merge@2");
    expect(body.score).toBe(468);
  });

  it("shows the spawn ramp climbing while the run goes on", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    // Spawn three is the next tile: a ten percent chance it arrives promoted,
    // and at spawn three a promoted tile is still a 4.
    expect(screen.getByText(/10% chance it arrives as a 4/)).toBeInTheDocument();

    for (const direction of RUN.slice(0, 3)) press(direction);

    // Three slides on, the chance has risen: the board is being squeezed even
    // while the tiles themselves are still cheap.
    expect(screen.getByText(/11% chance it arrives as a 4/)).toBeInTheDocument();
    expect(screen.getByText("Slide 3")).toBeInTheDocument();
  });

  it("starts a fresh run from the end-of-run screen, rules first", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await startRun();
    await playRun();

    fireEvent.click(screen.getByRole("button", { name: /play again/i }));

    // A new run starts from nothing: the rules are shown again, and no board is
    // playable until the new session has arrived and Start is pressed.
    expect(await screen.findByRole("heading", { name: "Merge the shades" })).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
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
    await playRun();

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
    for (const direction of RUN.slice(0, -1)) press(direction);
    // The last slide ends the run; verification is attempted once and refused.
    press(RUN[RUN.length - 1]);

    await screen.findByText("Your run was not verified");
    expect(
      screen.getByText(/That run expired before it was submitted\. Start a new one\./),
    ).toBeInTheDocument();
    expect(screen.queryByText("400")).not.toBeInTheDocument();

    // Retrying re-sends the same run — which is safe, because the server
    // recognises it — rather than starting over.
    fireEvent.click(screen.getByRole("button", { name: /try submitting again/i }));

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("4000")).toBeInTheDocument();
    const sessions = spy.mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(sessions).toHaveLength(1);
    const bodies = spy.mock.calls
      .filter((call) => String(call[0]).includes("/complete"))
      .map((call) => String(call[1]?.body ?? ""));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
  });

  it("ranks a signed-in player's run", async () => {
    // A real token in the store, so the API calls carry it and the run is ranked.
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
    await playRun();

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const headers = new Headers(completion?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer access-token-1");
    expect(screen.getByText("#3")).toBeInTheDocument();
  });
});
