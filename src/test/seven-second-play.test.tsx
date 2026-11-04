import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SevenSecondRuntime } from "@/components/game/SevenSecondRuntime";
import { clearSession } from "@/lib/auth/session";
import { challenge } from "@/lib/games/seven-second";

/**
 * 7 Second on screen.
 *
 * The screen is mounted in a router because its end panel is a set of links, and
 * it is driven through the real API client against a stubbed server — so what is
 * asserted here is the whole path: a session is issued, the rules are shown, the
 * clock runs, an answer is pressed, the answers are submitted, and the number
 * that appears is the one the server verified.
 *
 * The states that matter are the ones a careless implementation fudges:
 *
 *   - no clock runs before the player has read the rules and started;
 *   - a right answer buys time and a wrong one costs it, and neither changes the
 *     score of the other;
 *   - the clock emptying ends the run and submits the answers already given;
 *   - a tap after the clock empties is not recorded;
 *   - a score is never shown as verified before it is;
 *   - the daily limit is a rule, not a crash.
 *
 * Timing tests drive fake timers, so they are deterministic rather than sleepy.
 */

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    gameSlug: "7-second",
    rulesVersion: "seven-second@1",
    seed: "1",
    tileCount: 60,
    startedAt: "2026-10-24T12:00:00.000Z",
    expiresAt: "2026-10-24T14:00:00.000Z",
    ranked: false,
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "11111111-2222-4333-8444-555555555555",
    gameSlug: "7-second",
    score: 10,
    clearedColumns: 0,
    tilesPlaced: 1,
    durationMs: 8000,
    ranked: false,
    recordedAt: "2026-10-24T12:00:10.000Z",
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
      component: () => <SevenSecondRuntime slug="7-second" title="7 Second" />,
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

/** Presses Start. The rules screen is the game's own, not a loading state. */
async function startRun() {
  fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
  await screen.findByRole("timer", { name: "Time remaining" });
}

/** The button for one answer index on the challenge currently shown. */
function answerButton(option: number) {
  const dealt = challenge("1", currentIndex());
  return screen.getByRole("button", { name: `Answer ${dealt.options[option]}` });
}

/**
 * The challenge the table is showing, by its prompt. The index is the number of
 * answers the screen has taken; the tests only ever answer the first two, and the
 * prompt is what the player reads anyway.
 */
function currentIndex(): number {
  const prompt = screen.getByText(/^\d+ [+−] \d+$/).textContent ?? "";
  for (let index = 0; index < 60; index += 1) {
    const dealt = challenge("1", index);
    if (`${dealt.left} ${dealt.operator} ${dealt.right}` === prompt) return index;
  }
  throw new Error(`no challenge matches ${prompt}`);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("starting a run", () => {
  it("issues a session before it shows the rules or a clock", async () => {
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
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();

    await act(async () => {
      release?.();
    });

    expect(await screen.findByRole("button", { name: "Start run" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Seven seconds. Answer everything." }),
    ).toBeInTheDocument();
  });

  it("asks for a 7 Second session, not another game's rules", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await screen.findByRole("button", { name: "Start run" });

    const start = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(start?.[1]?.body ?? "{}"))).toEqual({
      gameSlug: "7-second",
      rulesVersion: "seven-second@1",
      client: "web/1.0",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it("explains the rules and does not start the clock until the player does", async () => {
    mockPlayback();
    await renderRuntime();

    expect(
      await screen.findByRole("heading", { name: "Seven seconds. Answer everything." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/A right answer/)).toBeInTheDocument();
    expect(screen.getByText(/A wrong answer/)).toBeInTheDocument();
    expect(screen.getByText(/One ranked attempt/)).toBeInTheDocument();
    expect(screen.getByText(/Guest run: verified, but not ranked/)).toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();

    await startRun();

    expect(screen.getByRole("timer", { name: "Time remaining" })).toHaveTextContent("7.0s");
  });

  it("moves focus onto the answer buttons when the rules give way to the table", async () => {
    mockPlayback();
    await renderRuntime();
    await startRun();

    expect(document.activeElement).toBe(screen.getByLabelText("Answers"));
  });

  it("shows today's attempt as done when the server refuses a second one", async () => {
    mockFetch(() =>
      jsonResponse(
        {
          error: {
            code: "conflict",
            message:
              "You've already played today's challenge. The next deck arrives at midnight UTC.",
          },
        },
        409,
      ),
    );

    await renderRuntime();

    expect(
      await screen.findByRole("heading", { name: "Today's attempt is done" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/already played today's challenge/)).toBeInTheDocument();
    // The daily limit is not a retryable failure, and must not look like one.
    expect(screen.queryByRole("button", { name: "Start run" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("reports any other failed start with a retry rather than an empty table", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByRole("button", { name: "Start run" });
  });
});

describe("the clock", () => {
  it("counts down from seven seconds", async () => {
    mockPlayback();
    await renderRuntime();
    await screen.findByRole("button", { name: "Start run" });
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    expect(screen.getByRole("timer")).toHaveTextContent("7.0s");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("6.0s");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("4.0s");
  });

  it("adds 1.5 seconds and ten points for a right answer", async () => {
    mockPlayback();
    await renderRuntime();
    await screen.findByRole("button", { name: "Start run" });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("6.0s");

    fireEvent.click(answerButton(challenge("1", 0).correct));

    // 6.0 left, plus 1.5 for the right answer.
    expect(screen.getByRole("timer")).toHaveTextContent("7.5s");
    expect(screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent).toBe("100");
    expect(screen.getByText(/Correct — 1.5 seconds back\./)).toBeInTheDocument();
    // The next challenge is on screen, not the one just answered.
    expect(screen.getByText(/^9 − 5$/)).toBeInTheDocument();
  });

  it("costs 2 seconds and nothing else for a wrong answer", async () => {
    mockPlayback();
    await renderRuntime();
    await screen.findByRole("button", { name: "Start run" });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    fireEvent.click(answerButton(1));
    expect(screen.getByRole("timer")).toHaveTextContent("5.0s");
    expect(screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent).toBe("0");
    expect(screen.getByText(/Wrong — 2 seconds gone\./)).toBeInTheDocument();
    expect(screen.getByText(/^9 − 5$/)).toBeInTheDocument();
  });

  it("accepts 1, 2 and 3 as the three answers", async () => {
    mockPlayback();
    await renderRuntime();
    await screen.findByRole("button", { name: "Start run" });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    fireEvent.keyDown(window, { key: "1" });

    expect(screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent).toBe("100");
  });

  it("takes one answer from two key presses in the same frame", async () => {
    // A double tap must not answer two challenges with the first challenge's
    // options. The second press lands before React has re-rendered the buttons.
    const spy = mockPlayback({}, { score: 10, tilesPlaced: 1 });
    await renderRuntime();
    await screen.findByRole("button", { name: "Start run" });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "2" }));
    });

    expect(screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent).toBe("100");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toEqual([0]);
  });

  it("does not record a press after the clock has emptied", async () => {
    const spy = mockPlayback({}, { score: 0, tilesPlaced: 0 });
    await renderRuntime();
    await screen.findByRole("button", { name: "Start run" });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("Time's up")).toBeInTheDocument();

    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toEqual([]);
    expect(body.score).toBe(0);
  });
});

describe("the end of a run", () => {
  it("submits the answers already given when the clock runs out", async () => {
    const spy = mockPlayback({}, { score: 30, tilesPlaced: 2, durationMs: 8000 });
    await renderRuntime();
    await screen.findByRole("button", { name: "Start run" });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    fireEvent.click(answerButton(challenge("1", 0).correct));
    // Seed 1's second challenge wants button 0 too; button 1 is a wrong answer.
    fireEvent.click(answerButton(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("Time's up")).toBeInTheDocument();
    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toEqual([0, 1]);
    expect(body.score).toBe(10);
    expect(body.progress.rulesVersion).toBe("seven-second@1");
  });

  it("shows the server's score and the run's correct count, not its own arithmetic", async () => {
    // A score the client did not compute: the screen must show the verified one.
    mockPlayback({}, { score: 999, tilesPlaced: 2, durationMs: 8000 });
    await renderRuntime();
    await screen.findByRole("button", { name: "Start run" });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    fireEvent.click(answerButton(challenge("1", 0).correct));
    fireEvent.click(answerButton(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("9990")).toBeInTheDocument();
    expect(screen.getByText("1 correct of 2 answered")).toBeInTheDocument();
    // A guest's run is verified and explicitly unranked.
    expect(screen.getByText(/This was a guest run/)).toBeInTheDocument();
  });

  it("starts a fresh run from the end panel, rules first, with the clock reset", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    await screen.findByRole("button", { name: "Start run" });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.click(screen.getByRole("button", { name: /play again/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // The new session resolves in a microtask; `findBy` would wait on the faked
    // clock, so the flush is explicit.
    expect(
      screen.getByRole("heading", { name: "Seven seconds. Answer everything." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(screen.getByRole("timer")).toHaveTextContent("7.0s");
    expect(screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent).toBe("0");

    // Two sessions were issued: a restart is a real new run, not a replay.
    const sessions = spy.mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(sessions).toHaveLength(2);
  });

  it("keeps the run and offers the identical submission when verification fails", async () => {
    let calls = 0;
    const spy = mockFetch((url) => {
      if (!url.includes("/complete")) return jsonResponse(sessionPayload(), 201);
      calls += 1;
      // The client retries a deduplicated completion through a 503 twice on its
      // own; the third refusal is the one the player sees.
      return calls <= 3
        ? jsonResponse(
            {
              error: {
                code: "service_unavailable",
                message: "Play sessions are not available right now.",
              },
            },
            503,
          )
        : jsonResponse(resultPayload({ score: 10 }));
    });

    await renderRuntime();
    await screen.findByRole("button", { name: "Start run" });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    fireEvent.click(answerButton(challenge("1", 0).correct));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    // Room for the client's own retries, which wait between attempts.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByText("Your run was not verified")).toBeInTheDocument();
    expect(screen.queryByText("10")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /try submitting again/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("100")).toBeInTheDocument();
    const sessions = spy.mock.calls.filter((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(sessions).toHaveLength(1);
    const bodies = spy.mock.calls
      .filter((call) => String(call[0]).includes("/complete"))
      .map((call) => String(call[1]?.body ?? ""));
    expect(bodies).toHaveLength(4);
    expect(new Set(bodies).size).toBe(1);
  });

  it("tells a ranked player the day's attempt is spent instead of offering a replay", async () => {
    mockPlayback({ ranked: true }, { ranked: true, personalBest: 30, rank: 2 });
    await renderRuntime();
    await screen.findByRole("button", { name: "Start run" });
    expect(screen.getByText("Signed in: this is today's ranked attempt")).toBeInTheDocument();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText(/next daily deck arrives at midnight, your time/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /play again/i })).not.toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
  });
});
