import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Stack10Runtime } from "@/components/game/Stack10Runtime";
import { buttonNamed } from "@/test/queries";
import { clearSession, signIn } from "@/lib/auth/session";

/**
 * Stack 10 on screen.
 *
 * The screen is mounted in a router because its end-of-run panel is a set of
 * links, and it is driven through the real API client against a stubbed server —
 * so what is asserted here is the whole path: a session is issued, the board is
 * played, the run is submitted, and the number that appears is the one the server
 * verified.
 *
 * The states that matter are the ones a careless implementation fudges:
 *
 *   - an impossible move is not offered (the column is disabled and says why);
 *   - a score is never shown as verified before it is;
 *   - a guest's run is shown as a guest's run, not quietly ranked;
 *   - a failed submission keeps the run and can be retried.
 */

const SEED_ONE_GREEDY = [0, 0, 1, 0, 0, 0, 2, 2, 2, 3, 0, 0, 0, 0];

/** The retired perfect line, then seven more tiles: past the old deck, into the ramp. */
const SEED_ONE_ENDLESS = [
  0, 0, 1, 0, 0, 0, 2, 2, 2, 3, 0, 0, 2, 0, 2, 2, 0, 0, 2, 0, 2, 2, 3, 2, 2, 2, 2, 3, 0, 1, 0, 0, 0,
  0, 0, 2, 1, 2, 1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 3, 1, 1, 2, 1, 1, 0, 0, 2, 3, 0, 1, 0,
  1,
];

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "cccccccc-1111-4111-8111-cccccccccccc",
    gameSlug: "stack-10",
    rulesVersion: "stack-10@2",
    seed: "1",
    tileCount: 4096,
    startedAt: "2026-10-13T12:00:00.000Z",
    expiresAt: "2026-10-13T14:00:00.000Z",
    ranked: true,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "cccccccc-1111-4111-8111-cccccccccccc",
    gameSlug: "stack-10",
    // Deliberately not the client's 55: the screen must show the verified number.
    score: 60,
    clearedColumns: 3,
    tilesPlaced: 14,
    durationMs: 4200,
    ranked: true,
    recordedAt: "2026-10-13T12:01:00.000Z",
    personalBest: 88,
    rank: 4,
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
function mockPlayback(sessionOverrides: Record<string, unknown> = {}) {
  return mockFetch((url) =>
    url.includes("/complete")
      ? jsonResponse(resultPayload())
      : jsonResponse(sessionPayload(sessionOverrides), 201),
  );
}

async function renderRuntime() {
  const root = createRootRoute();
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => <Stack10Runtime slug="stack-10" title="Stack 10" />,
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

/** Presses the column at `index` (0-based), as the board's own buttons are named. */
function pressColumn(index: number) {
  fireEvent.click(buttonNamed(new RegExp(`^Column ${index + 1},`)));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("starting a run", () => {
  it("issues a session before it shows a board", async () => {
    // The session response is held open, which is the only way to observe the
    // state before it arrives: a board must not exist until the server has issued
    // a run, because a screen full of tiles with no session behind it cannot be
    // verified or scored.
    let release: (() => void) | null = null;
    const spy = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(jsonResponse(sessionPayload(), 201));
        }),
    );
    vi.stubGlobal("fetch", spy);

    await renderRuntime();

    expect(screen.getByText("Starting a run…")).toBeInTheDocument();
    expect(screen.queryByText("Next tile")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Column 1,/ })).not.toBeInTheDocument();

    await act(async () => {
      release?.();
    });

    await screen.findByText("Next tile");
    expect(screen.getByText("Ranked")).toBeInTheDocument();
    // Seed 1's first tile, and four columns to put it in.
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Column \d,/ })).toHaveLength(4);
    expect(screen.getByText("Tile 1")).toBeInTheDocument();
    // The opening sixty are the warm-up, so the ramp has not started yet.
    expect(screen.getByText("Warm-up: heavier tiles start after tile 60")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
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
    await screen.findByText("Next tile");
  });
});

describe("playing the board", () => {
  it("places the next tile in the column that was pressed", async () => {
    mockPlayback();
    await renderRuntime();
    await screen.findByText("Next tile");

    pressColumn(1);

    // Column 2 holds the 1, column 1 is untouched, and the run has moved on.
    expect(screen.getByRole("button", { name: /^Column 2, total 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Column 1, total 0/ })).toBeInTheDocument();
    expect(screen.getByText("Tile 2")).toBeInTheDocument();
    // The next tile is 7, and every column is still playable.
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("announces the move that clears a column, and warns about the one that ends the run", async () => {
    mockPlayback();
    await renderRuntime();
    await screen.findByText("Next tile");

    // Tiles arrive 1, 7, 9. Column 1 takes the 1 (total 1) and column 2 the 7
    // (total 7), so the 9 clears the first for 15 (two tiles: 10 + 5) and would
    // push the second to 16.
    pressColumn(0);
    pressColumn(1);

    const clearing = screen.getByRole("button", { name: /^Column 1, total 1\./ });
    expect(clearing).toBeEnabled();
    expect(clearing).toHaveAccessibleName(/clear it for 15 points/);

    // Going past ten is a legal move — it is the move that ends the run — so the
    // column stays pressable and says what will happen. Hiding it would leave a
    // player with no legal move and no way to finish.
    const ending = screen.getByRole("button", { name: /^Column 2, total 7\./ });
    expect(ending).toBeEnabled();
    expect(ending).toHaveAccessibleName(/make 16, which ends the run/);
  });

  it("ends the run when a column is pushed past ten, and submits that ending", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await screen.findByText("Next tile");

    pressColumn(0);
    pressColumn(1);
    pressColumn(1); // the 9 into the column already holding 7

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Run over")).toBeInTheDocument();

    // The losing move is part of the run that was verified, not hidden from it.
    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toEqual([0, 1, 1]);
  });

  it("plays a column from the keyboard", async () => {
    mockPlayback();
    await renderRuntime();
    await screen.findByText("Next tile");

    fireEvent.keyDown(window, { key: "3" });

    expect(screen.getByRole("button", { name: /^Column 3, total 1/ })).toBeInTheDocument();
    expect(screen.getByText("Tile 2")).toBeInTheDocument();
  });

  it("keeps playing past the retired deck and reports the ramp starting", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await screen.findByText("Next tile");

    // The retired perfect line: sixty tiles, and the run is still live.
    await act(async () => {
      SEED_ONE_ENDLESS.slice(0, 60).forEach(pressColumn);
    });

    expect(screen.getByText("Tile 61")).toBeInTheDocument();
    expect(screen.getByText("Heavier tiles can start arriving now")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /play again/i })).not.toBeInTheDocument();

    await act(async () => {
      SEED_ONE_ENDLESS.slice(60, 64).forEach(pressColumn);
    });

    // Four tiles into the ramp the chance is real, and the board says so.
    expect(screen.getByText("Tile 65")).toBeInTheDocument();
    expect(screen.getByText("Heavier tile chance 1% · up to +1")).toBeInTheDocument();
    expect(spy.mock.calls.some((call) => String(call[0]).includes("/complete"))).toBe(false);
  });

  it("shows the run's own score as it plays, which is not a claim that anything was saved", async () => {
    mockPlayback();
    await renderRuntime();
    await screen.findByText("Next tile");

    // 1 + 7 + 2 clears column 1 for 20 points, exactly as the verifier would
    // compute it — and nothing has been sent anywhere yet.
    [0, 0, 1, 0].forEach(pressColumn);

    expect(screen.getByText("Score")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });
});

describe("finishing a run", () => {
  it("submits the run and shows the score the server verified", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await screen.findByText("Next tile");

    await act(async () => {
      SEED_ONE_GREEDY.forEach(pressColumn);
    });

    // While the server is deciding, the screen says so instead of showing a number.
    await waitFor(() =>
      expect(screen.getByText(/Verifying your run|Run over/)).toBeInTheDocument(),
    );

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Run over")).toBeInTheDocument();
    // The verified 60, not the 55 the board had accumulated.
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(
      screen.getByText("A column passed ten after 14 tiles; 3 columns cleared."),
    ).toBeInTheDocument();
    expect(screen.getByText("88")).toBeInTheDocument(); // personal best
    expect(screen.getByText("#4")).toBeInTheDocument(); // rank
    expect(screen.getByText(/Verified by replaying your moves on the server/)).toBeInTheDocument();

    const completions = spy.mock.calls.filter((call) => String(call[0]).includes("/complete"));
    expect(completions).toHaveLength(1);
  });

  it("submits the tiles past the old deck, not a cleared run", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await screen.findByText("Next tile");

    await act(async () => {
      SEED_ONE_ENDLESS.forEach(pressColumn);
    });

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Run over")).toBeInTheDocument();

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.rulesVersion).toBe("stack-10@2");
    expect(body.progress.actions).toHaveLength(67);
    expect(body.progress.actions).toEqual(SEED_ONE_ENDLESS);
    expect(body.score).toBe(435);
  });

  it("starts a fresh run from the end-of-run screen", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await screen.findByText("Next tile");

    await act(async () => {
      SEED_ONE_GREEDY.forEach(pressColumn);
    });
    await screen.findByRole("button", { name: /play again/i });

    fireEvent.click(screen.getByRole("button", { name: /play again/i }));

    await screen.findByText("Next tile");
    expect(screen.getByText("Tile 1")).toBeInTheDocument();
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
    await screen.findByText("Next tile");

    expect(screen.getByText("Guest run")).toBeInTheDocument();

    await act(async () => {
      SEED_ONE_GREEDY.forEach(pressColumn);
    });

    await screen.findByRole("button", { name: /play again/i });
    expect(
      screen.getByText(/This was a guest run, so it is not on the leaderboard\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in to rank your scores/i })).toBeInTheDocument();
    // No rank or personal best is shown for a run that has none.
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
    await screen.findByText("Next tile");

    await act(async () => {
      SEED_ONE_GREEDY.forEach(pressColumn);
    });

    await screen.findByText("Your run was not verified");
    expect(
      screen.getByText(/That run expired before it was submitted\. Start a new one\./),
    ).toBeInTheDocument();
    expect(screen.queryByText("60")).not.toBeInTheDocument();

    // Retrying re-sends the same run — which is safe, because the server
    // recognises it — rather than starting over.
    fireEvent.click(screen.getByRole("button", { name: /try submitting again/i }));

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("60")).toBeInTheDocument();
    const sessions = spy.mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(sessions).toHaveLength(1);
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
    await screen.findByText("Next tile");

    await act(async () => {
      SEED_ONE_GREEDY.forEach(pressColumn);
    });
    await screen.findByRole("button", { name: /play again/i });

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const headers = new Headers(completion?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer access-token-1");
    expect(screen.getByText("#4")).toBeInTheDocument();
  });
});
