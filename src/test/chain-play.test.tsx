import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChainRuntime } from "@/components/game/ChainRuntime";
import { buttonNamed } from "@/test/queries";
import { clearSession, signIn } from "@/lib/auth/session";
import { symbolAt } from "@/lib/games/chain";

// The board's beat is a real rule, asserted in chain.test.ts. Here it is
// compressed so that playing a dozen rounds costs milliseconds rather than the
// better part of a minute; the round's lead-in still runs on real timers.
vi.mock("@/lib/games/chain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/games/chain")>();
  return { ...actual, chainTempo: () => ({ litMs: 1, gapMs: 0 }) };
});

/**
 * Chain on screen.
 *
 * The screen is mounted in a router because its end-of-run panel is a set of
 * links, and it is driven through the real API client against a stubbed server —
 * so what is asserted here is the whole path: a session is issued, the sequence
 * is shown, the run is repeated, the taps are submitted, and the number that
 * appears is the one the server verified.
 *
 * Seed 1 deals 0,0,2,3,…: round one is [0], round two [0,0]. The states that
 * matter are the ones a careless implementation fudges:
 *
 *   - no tap is offered while the sequence is showing;
 *   - a score is never shown as verified before it is;
 *   - a guest's run is shown as a guest's run, not quietly ranked;
 *   - a failed submission keeps the run and can be retried.
 */

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "cccccccc-1111-4111-8111-cccccccccccc",
    gameSlug: "dont-break-the-chain",
    rulesVersion: "chain@2",
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
    gameSlug: "dont-break-the-chain",
    // Deliberately not the client's 3: the screen must show the verified number.
    score: 7,
    clearedColumns: 2,
    tilesPlaced: 4,
    durationMs: 3800,
    ranked: true,
    recordedAt: "2026-10-13T12:01:00.000Z",
    personalBest: 9,
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
      component: () => <ChainRuntime slug="dont-break-the-chain" title="Don't Break the Chain" />,
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

/** Taps the pad at `index` (0-based), as the board's own buttons are named. */
function tapPad(index: number) {
  fireEvent.click(buttonNamed(new RegExp(`^Pad ${index + 1}\\.`)));
}

/** Waits out the showing: round one's sequence, then the player's turn. */
async function waitForTurn(round: number) {
  await screen.findByText(
    `Your turn — repeat ${round} ${round === 1 ? "tap" : "taps"}.`,
    undefined,
    {
      timeout: 8000,
    },
  );
  // The board installs its keydown listener in an effect. The turn text is in
  // the DOM one commit before that effect runs, so a finding query can resume
  // in the gap and a key sent then is dropped. Flush the pending effects so
  // the turn the test acts on is the turn the board is actually listening to.
  await act(async () => {});
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("starting a run", () => {
  it("issues a session before it shows the board", async () => {
    // The session response is held open, which is the only way to observe the
    // state before it arrives: a board must not exist until the server has issued
    // a run, because pads with no session behind them cannot be verified.
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
    expect(screen.queryByText(/Round \d+: watch/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pad 1\./ })).not.toBeInTheDocument();

    await act(async () => {
      release?.();
    });

    await screen.findByText(/Round \d+: watch/);
    expect(screen.getByText("Ranked")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Pad \d\./ })).toHaveLength(4);
    expect(screen.getByText("Round 1")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("asks for a Chain session, not a Stack 10 one", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await screen.findByText(/Round \d+: watch/);

    const start = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(start?.[1]?.body ?? "{}"))).toEqual({
      gameSlug: "dont-break-the-chain",
      rulesVersion: "chain@2",
      client: "web/1.0",
    });
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
    await screen.findByText(/Round \d+: watch/);
  });
});

describe("playing the board", () => {
  it("offers no tap while the sequence is showing", async () => {
    mockPlayback();
    await renderRuntime();
    await screen.findByText(/Round \d+: watch/);

    // Four pads, every one disabled, every one saying why.
    for (const pad of screen.getAllByRole("button", { name: /^Pad \d\./ })) {
      expect(pad).toBeDisabled();
      expect(pad).toHaveAccessibleName(/Watch the sequence\./);
    }

    await waitForTurn(1);

    for (const pad of screen.getAllByRole("button", { name: /^Pad \d\./ })) {
      expect(pad).toBeEnabled();
    }
  });

  it("repeats round one and advances to round two", async () => {
    mockPlayback();
    await renderRuntime();
    await waitForTurn(1);

    // Round one is [0]: the first pad.
    tapPad(0);

    expect(screen.getByText("Round 2")).toBeInTheDocument();
    await screen.findByText(/Round \d+: watch/);
    await waitForTurn(2);

    expect(
      screen.getByRole("button", { name: /^Pad 1\. Tap to repeat step 1 of 2\./ }),
    ).toBeInTheDocument();
  }, 15000);

  it("plays beyond the old tenth round and keeps the run alive", async () => {
    const spy = mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(resultPayload({ score: 66, clearedColumns: 11, tilesPlaced: 67 }))
        : jsonResponse(sessionPayload(), 201),
    );
    await renderRuntime();

    // Eleven complete rounds: one more than the game used to allow. Every tap
    // is the seed's symbol at that position in the round, so this is the same
    // line the SQL suite verifies.
    for (let round = 1; round <= 11; round += 1) {
      await waitForTurn(round);
      expect(screen.getByText(`Round ${round}`)).toBeInTheDocument();
      for (let step = 0; step < round; step += 1) {
        tapPad(symbolAt("1", step));
      }
    }

    // Round twelve is live, and nothing has been submitted: the former tenth
    // round is not an ending, a completion or a cap.
    await waitForTurn(12);
    expect(screen.getByText("Round 12")).toBeInTheDocument();
    expect(spy.mock.calls.some((call) => String(call[0]).includes("/complete"))).toBe(false);

    // One wrong tap ends it, and the whole line is submitted: 66 correct taps,
    // the losing one, and eleven cleared rounds.
    tapPad((symbolAt("1", 0) + 1) % 4);

    await screen.findByRole("button", { name: /play again/i });
    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toHaveLength(67);
    expect(body.score).toBe(66);
    expect(screen.getByText("66")).toBeInTheDocument();
    expect(screen.getByText("67 taps placed, 11 rounds cleared.")).toBeInTheDocument();
  }, 20000);

  it("plays a pad from the keyboard", async () => {
    mockPlayback();
    await renderRuntime();
    await waitForTurn(1);

    fireEvent.keyDown(window, { key: "1" });

    expect(screen.getByText("Round 2")).toBeInTheDocument();
  });

  it("ignores the keyboard while the sequence is showing", async () => {
    mockPlayback();
    await renderRuntime();
    await screen.findByText(/Round \d+: watch/);

    fireEvent.keyDown(window, { key: "1" });

    // Still round one, still showing: the keypress must do nothing.
    expect(screen.getByText("Round 1")).toBeInTheDocument();
    expect(screen.queryByText(/Your turn/)).not.toBeInTheDocument();
  });

  it("shows the run's own score as it plays, which is not a claim that anything was saved", async () => {
    mockPlayback();
    await renderRuntime();
    await waitForTurn(1);

    tapPad(0);

    // The score readout next to the Score term — `getByText("1")` would also
    // match the pads' own number chips.
    const scoreTerm = screen.getByText("Score");
    expect(scoreTerm.closest("dl")?.querySelector("dd")?.textContent).toBe("1");
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });
});

describe("finishing a run", () => {
  it("ends the run on a wrong tap and submits the taps including the losing one", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await waitForTurn(1);

    // Round one is [0]: the second pad breaks the chain.
    tapPad(1);

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Chain broken")).toBeInTheDocument();

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toEqual([1]);
    expect(body.progress.rulesVersion).toBe("chain@2");
    expect(body.score).toBe(0);
  });

  it("submits the run and shows the score the server verified", async () => {
    mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(resultPayload({ score: 7, clearedColumns: 1, tilesPlaced: 3 }))
        : jsonResponse(sessionPayload(), 201),
    );
    await renderRuntime();
    await waitForTurn(1);

    // Round one reproduced, then the wrong tap on round two.
    tapPad(0);
    await waitForTurn(2);
    tapPad(0);
    tapPad(1);

    await waitFor(() =>
      expect(screen.getByText(/Verifying your run|Chain broken/)).toBeInTheDocument(),
    );

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Chain broken")).toBeInTheDocument();
    // The verified 7, not the 2 the board had accumulated.
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("3 taps placed, 1 rounds cleared.")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument(); // personal best
    expect(screen.getByText("#2")).toBeInTheDocument(); // rank
    expect(screen.getByText(/Verified by replaying your taps on the server/)).toBeInTheDocument();
  }, 15000);

  it("starts a fresh run from the end-of-run screen", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await waitForTurn(1);

    tapPad(1);
    await screen.findByRole("button", { name: /play again/i });

    fireEvent.click(screen.getByRole("button", { name: /play again/i }));

    await screen.findByText(/Round \d+: watch/);
    expect(screen.getByText("Round 1")).toBeInTheDocument();
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
    await waitForTurn(1);

    expect(screen.getByText("Guest run")).toBeInTheDocument();

    tapPad(1);
    await screen.findByRole("button", { name: /play again/i });

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
    await waitForTurn(1);

    tapPad(1);
    await screen.findByText("Your run was not verified");
    expect(
      screen.getByText(/That run expired before it was submitted\. Start a new one\./),
    ).toBeInTheDocument();
    expect(screen.queryByText("7")).not.toBeInTheDocument();

    // Retrying re-sends the same run — which is safe, because the server
    // recognises it — rather than starting over.
    fireEvent.click(screen.getByRole("button", { name: /try submitting again/i }));

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("7")).toBeInTheDocument();
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
    await waitForTurn(1);

    tapPad(1);
    await screen.findByRole("button", { name: /play again/i });

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const headers = new Headers(completion?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer access-token-1");
    expect(screen.getByText("#2")).toBeInTheDocument();
  });
});
