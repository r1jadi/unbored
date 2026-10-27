import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryFlashRuntime } from "@/components/game/MemoryFlashRuntime";
import { boardCells, patternAt } from "@/lib/games/memory-flash";
import { buttonNamed } from "@/test/queries";
import { clearSession, signIn } from "@/lib/auth/session";

/**
 * Memory Flash on screen.
 *
 * The screen is mounted in a router because its end-of-run panel is a set of
 * links, and it is driven through the real API client against a stubbed server —
 * so what is asserted here is the whole path: a session is issued, the pattern is
 * shown, the run is rebuilt, the taps are submitted, and the number that appears
 * is the one the server verified.
 *
 * Seed 1 flashes [8], then [8,6]: round one is cell 9, round two cells 9 and 7.
 * The states that matter are the ones a careless implementation fudges:
 *
 *   - no cell is offered while the pattern is showing;
 *   - a score is never shown as verified before it is;
 *   - a guest's run is shown as a guest's run, not quietly ranked;
 *   - a failed submission keeps the run and can be retried.
 */

/** A session issued under Memory Flash rules, per the contract. */
function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "eeeeeeee-1111-4111-8111-eeeeeeeeeeee",
    gameSlug: "memory-flash",
    rulesVersion: "memory-flash@2",
    seed: "1",
    tileCount: 4096,
    startedAt: "2026-10-20T12:00:00.000Z",
    expiresAt: "2026-10-20T14:00:00.000Z",
    ranked: true,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "eeeeeeee-1111-4111-8111-eeeeeeeeeeee",
    gameSlug: "memory-flash",
    // Deliberately not the client's 10: the screen must show the verified number.
    score: 40,
    clearedColumns: 1,
    tilesPlaced: 3,
    durationMs: 3800,
    ranked: true,
    recordedAt: "2026-10-20T12:01:00.000Z",
    personalBest: 100,
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
      component: () => <MemoryFlashRuntime slug="memory-flash" title="Memory Flash" />,
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

/** Taps the cell at `index` (0-based), as the board's own buttons are named. */
function tapCell(index: number) {
  fireEvent.click(buttonNamed(new RegExp(`^Cell ${index + 1},`)));
}

/**
 * Waits out the showing and the effect that switches the board to input.
 *
 * Round one lights one cell, so its turn reads "1 more cell"; the query is the
 * board's own announcement rather than a sleep, which is what makes the test
 * measure the component's timing rather than the machine's.
 */
async function waitForTurn(cells: number) {
  await screen.findByText(
    `Your turn — ${cells} more ${cells === 1 ? "cell" : "cells"} in this pattern.`,
    undefined,
    { timeout: 8000 },
  );
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
    // state before it arrives: a grid must not exist until the server has issued
    // a run, because cells with no session behind them cannot be verified.
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
    expect(screen.queryByText(/Watch the pattern/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Cell 1,/ })).not.toBeInTheDocument();

    await act(async () => {
      release?.();
    });

    await screen.findByText(/Watch the pattern/);
    expect(screen.getByText("Ranked")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Cell \d+,/ })).toHaveLength(16);
    expect(screen.getByText("Round 1")).toBeInTheDocument();
    // The difficulty of the round is the rules', not the screen's invention.
    expect(screen.getByText("4×4")).toBeInTheDocument();
    expect(screen.getByText("700 ms")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("asks for a Memory Flash session, not another game's rules", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await screen.findByText(/Watch the pattern/);

    const start = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(start?.[1]?.body ?? "{}"))).toEqual({
      gameSlug: "memory-flash",
      rulesVersion: "memory-flash@2",
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
    await screen.findByText(/Watch the pattern/);
  });
});

describe("playing the board", () => {
  it("offers no tap while the pattern is showing", async () => {
    mockPlayback();
    await renderRuntime();
    await screen.findByText(/Watch the pattern/);

    // Sixteen cells, every one disabled, every one saying why.
    for (const cell of screen.getAllByRole("button", { name: /^Cell \d+,/ })) {
      expect(cell).toBeDisabled();
      expect(cell).toHaveAccessibleName(/Watch the pattern\./);
    }

    await waitForTurn(1);

    for (const cell of screen.getAllByRole("button", { name: /^Cell \d+,/ })) {
      expect(cell).toBeEnabled();
    }
  });

  it("keeps the cells keyboard reachable, because they are real buttons", async () => {
    mockPlayback();
    await renderRuntime();
    await waitForTurn(1);

    const cells = screen.getAllByRole("button", { name: /^Cell \d+,/ });
    expect(cells).toHaveLength(16);
    for (const cell of cells) {
      // A native button is activated by Enter and Space without a key handler
      // that could swallow the press, and Tab reaches every cell.
      expect(cell.tagName).toBe("BUTTON");
      expect(cell).toHaveAttribute("type", "button");
    }
  });

  it("rebuilds round one and advances to round two", async () => {
    mockPlayback();
    await renderRuntime();
    await waitForTurn(1);

    // Round one is [8]: the ninth cell.
    tapCell(8);

    expect(screen.getByText("Round 2")).toBeInTheDocument();
    await screen.findByText(/Watch the pattern/);
    await waitForTurn(2);

    // The cells already entered are named as such: none yet, so every cell is
    // offered, and the board asks for two cells.
    expect(
      screen.getByRole("button", { name: /^Cell 9, row 3 column 1\. Tap to rebuild/ }),
    ).toBeInTheDocument();
  }, 15000);

  it("plays past the retired tenth pattern, on a board that grows to hold it", async () => {
    const spy = mockPlayback();
    await renderRuntime();

    // Twelve rounds, tapped from the engine's own patterns: the run has to be
    // played, not asserted into existence. Round nine is where the 4×4 board can
    // no longer hold the pattern, so the board grows; round ten was the retired
    // game's last round, and round eleven is the proof it is no longer one.
    for (let round = 1; round <= 12; round += 1) {
      await waitForTurn(round);

      if (round === 9) {
        expect(screen.getByText("5×5")).toBeInTheDocument();
        expect(screen.getByText("604 ms")).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: /^Cell \d+,/ })).toHaveLength(25);
      }

      for (const cell of patternAt("1", round)) tapCell(cell);

      if (round === 10) {
        expect(screen.getByText("Round 11")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /play again/i })).toBeNull();
      }
    }

    // Still playing, at the score the twelve clears earned, on the next board.
    expect(screen.getByText("Round 13")).toBeInTheDocument();
    expect(screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent).toBe("120");
    expect(screen.queryByRole("button", { name: /play again/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Cell \d+,/ })).toHaveLength(25);

    // A wrong tap on round thirteen ends it, and the whole endless line is what
    // gets submitted — 78 taps that cleared twelve patterns, plus the losing one.
    // The tap waits for the flash: a cell is not pressable while it is showing.
    await waitForTurn(13);
    const roundThirteen = patternAt("1", 13);
    const wrong = Array.from({ length: boardCells(13) }, (_, cell) => cell).find(
      (cell) => !roundThirteen.includes(cell),
    );
    tapCell(wrong as number);

    await screen.findByRole("button", { name: /play again/i });
    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.score).toBe(120);
    expect(body.progress.actions).toHaveLength(79);
    expect(body.progress.actions.slice(78)).toEqual([wrong]);
    expect(body.progress.rulesVersion).toBe("memory-flash@2");
  }, 40000);

  it("shows the run's own score as it plays, which is not a claim that anything was saved", async () => {
    mockPlayback();
    await renderRuntime();
    await waitForTurn(1);

    tapCell(8);

    // The score readout next to the Score term — `getByText("10")` would also
    // match nothing else, but the term is the unambiguous anchor.
    const scoreTerm = screen.getByText("Score");
    expect(scoreTerm.closest("dl")?.querySelector("dd")?.textContent).toBe("10");
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });
});

describe("finishing a run", () => {
  it("ends the run on a cell the pattern does not light, and submits that ending", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await waitForTurn(1);

    // Round one is [8]: cell one is not part of it.
    tapCell(0);

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Pattern broken")).toBeInTheDocument();

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toEqual([0]);
    expect(body.progress.rulesVersion).toBe("memory-flash@2");
    expect(body.score).toBe(0);
  });

  it("submits the run and shows the score the server verified", async () => {
    mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(resultPayload({ score: 40, clearedColumns: 1, tilesPlaced: 3 }))
        : jsonResponse(sessionPayload(), 201),
    );
    await renderRuntime();
    await waitForTurn(1);

    // Round one rebuilt, then a wrong tap on round two.
    tapCell(8);
    await waitForTurn(2);
    tapCell(8);
    tapCell(0);

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("Pattern broken")).toBeInTheDocument();
    // The verified 40, not the 10 the board had accumulated.
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("3 cells tapped, 1 rounds cleared.")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument(); // personal best
    expect(screen.getByText("#2")).toBeInTheDocument(); // rank
    expect(screen.getByText(/Verified by replaying your taps on the server/)).toBeInTheDocument();
  }, 15000);

  it("starts a fresh run from the end-of-run screen", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await waitForTurn(1);

    tapCell(0);
    await screen.findByRole("button", { name: /play again/i });

    fireEvent.click(screen.getByRole("button", { name: /play again/i }));

    await screen.findByText(/Watch the pattern/);
    expect(screen.getByText("Round 1")).toBeInTheDocument();
    // A reload's worth of state is gone: the score is back to zero and the board
    // is showing round one again rather than the previous run's pattern.
    expect(screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent).toBe("0");
    const sessions = spy.mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(sessions).toHaveLength(2);
  }, 15000);

  it("reports a guest's run as unranked, and says where it is not", async () => {
    mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(resultPayload({ ranked: false, rank: null, personalBest: null }))
        : jsonResponse(sessionPayload({ ranked: false }), 201),
    );
    await renderRuntime();
    await waitForTurn(1);

    expect(screen.getByText("Guest run")).toBeInTheDocument();

    tapCell(0);
    await screen.findByRole("button", { name: /play again/i });

    expect(
      screen.getByText(/This was a guest run, so it is not on the leaderboard\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in to rank your scores/i })).toBeInTheDocument();
    expect(screen.queryByText("Rank")).not.toBeInTheDocument();
  }, 15000);

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

    tapCell(0);
    await screen.findByText("Your run was not verified");
    expect(
      screen.getByText(/That run expired before it was submitted\. Start a new one\./),
    ).toBeInTheDocument();
    expect(screen.queryByText("40")).not.toBeInTheDocument();

    // Retrying re-sends the same run — which is safe, because the server
    // recognises it — rather than starting over.
    fireEvent.click(screen.getByRole("button", { name: /try submitting again/i }));

    await screen.findByRole("button", { name: /play again/i });
    expect(screen.getByText("40")).toBeInTheDocument();
    const sessions = spy.mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(sessions).toHaveLength(1);
  }, 15000);

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

    tapCell(0);
    await screen.findByRole("button", { name: /play again/i });

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const headers = new Headers(completion?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer access-token-1");
    expect(screen.getByText("#2")).toBeInTheDocument();
  }, 15000);
});
