import { act, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearSession, signIn } from "@/lib/auth/session";
import {
  completeRun,
  fetchLeaderboard,
  startSession,
  useChainRun,
  useLeaderboard,
  useMemoryFlashRun,
  useOneMoveRun,
  useStack10Run,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import { submission } from "@/lib/games/stack10";
import { winningCell } from "@/lib/games/one-move";

/**
 * The session client and the run lifecycle.
 *
 * The interesting assertions are about *refusals and retries* rather than the happy
 * path: that nothing is called twice, that a retry re-sends the identical run, that
 * the number shown is the server's, and that a guest run is real but unranked. Those
 * are the properties the whole phase rests on, and every one of them is a claim a
 * client could otherwise quietly break.
 */

const DEFAULT_HEADERS = { "Content-Type": "application/json" };

/** The shape `POST /sessions` answers with, per the contract. */
function sessionPayload(overrides: Partial<PlaySession> = {}): PlaySession {
  return {
    id: "cccccccc-1111-4111-8111-cccccccccccc",
    gameSlug: "stack-10",
    rulesVersion: "stack-10@2",
    // A decimal string, and deliberately one bigger than a JS safe integer: the
    // client must not round it.
    seed: "9223372036854775807",
    // The submission bound, not a run's length: an endless Stack 10 run has none.
    tileCount: 4096,
    startedAt: "2026-10-13T12:00:00.000Z",
    expiresAt: "2026-10-13T14:00:00.000Z",
    ranked: true,
    ...overrides,
  };
}

/** The shape `POST /sessions/{id}/complete` answers with. */
function resultPayload(overrides: Partial<RunResult> = {}): RunResult {
  return {
    sessionId: "cccccccc-1111-4111-8111-cccccccccccc",
    gameSlug: "stack-10",
    score: 55,
    clearedColumns: 3,
    tilesPlaced: 14,
    durationMs: 4200,
    ranked: true,
    recordedAt: "2026-10-13T12:01:00.000Z",
    personalBest: 55,
    rank: 4,
    duplicate: false,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: DEFAULT_HEADERS });
}

function errorResponse(status: number, code: string, message: string) {
  return jsonResponse({ error: { code, message, request_id: "req-abc123" } }, status);
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function requestUrl(spy: ReturnType<typeof mockFetch>, index = 0): URL {
  const call = spy.mock.calls[index];
  if (!call) throw new Error(`no request at index ${index}`);
  return new URL(String(call[0]));
}

function requestHeaders(spy: ReturnType<typeof mockFetch>, index = 0): Headers {
  const call = spy.mock.calls[index];
  if (!call) throw new Error(`no request at index ${index}`);
  return new Headers(call[1]?.headers);
}

/** The JSON body a request was sent with. Untyped on purpose: each test asserts
 * the exact shape it cares about, which is the point of reading it here. */
function requestBody(spy: ReturnType<typeof mockFetch>, index = 0) {
  const call = spy.mock.calls[index];
  if (!call) throw new Error(`no request at index ${index}`);
  return JSON.parse(String(call[1]?.body ?? "{}"));
}

/** Renders a hook and hands back its latest result, as catalog.test.tsx does. */
function renderHook<T>(hook: () => T) {
  const ref: { current: T } = { current: undefined as unknown as T };
  function Probe() {
    const value = hook();
    const latest = useRef(value);
    latest.current = value;
    ref.current = latest.current;
    return null;
  }
  const utils = render(<Probe />);
  return {
    get result() {
      return ref.current;
    },
    ...utils,
  };
}

/** Signs in so the API calls that follow carry a real token. */
async function signInWith(accessToken = "access-token-1") {
  const spy = mockFetch(() =>
    jsonResponse({
      session: { userId: "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f", role: "user" },
      tokens: { accessToken, refreshToken: "refresh-token-1", tokenType: "bearer" },
    }),
  );
  await signIn("player@example.com", "correct-horse");
  vi.unstubAllGlobals();
  return spy;
}

/** The greedy line seed 1 scores 55 with; it ends the run on the fourteenth move. */
const GREEDY_LINE = [0, 0, 1, 0, 0, 0, 2, 2, 2, 3, 0, 0, 0, 0];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

// ── Requests ────────────────────────────────────────────────────────────────

describe("startSession", () => {
  it("asks the server to issue a run and sends no identity of its own", async () => {
    const spy = mockFetch(() => jsonResponse(sessionPayload(), 201));

    const session = await startSession("stack-10");

    const url = requestUrl(spy);
    expect(url.pathname).toBe("/api/v1/sessions");
    const body = requestBody(spy);
    expect(body).toEqual({
      gameSlug: "stack-10",
      rulesVersion: "stack-10@2",
      client: "web/1.0",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    // No user id, and no seed: both are the server's to choose.
    expect(Object.keys(body)).not.toContain("userId");
    expect(Object.keys(body)).not.toContain("seed");
    expect(requestHeaders(spy).get("Authorization")).toBeNull();
    // The seed survives as a string, unrounded.
    expect(session.seed).toBe("9223372036854775807");
  });

  it("carries the caller's token when there is a session, which is what makes a run ranked", async () => {
    await signInWith();
    const spy = mockFetch(() => jsonResponse(sessionPayload(), 201));

    await startSession("stack-10");

    expect(requestHeaders(spy).get("Authorization")).toBe("Bearer access-token-1");
  });

  it("starts a Chain run under Chain rules when asked to", async () => {
    const spy = mockFetch(() =>
      jsonResponse(
        sessionPayload({ gameSlug: "dont-break-the-chain", rulesVersion: "chain@2" }),
        201,
      ),
    );

    const session = await startSession("dont-break-the-chain", { rulesVersion: "chain@2" });

    const body = requestBody(spy);
    expect(body).toEqual({
      gameSlug: "dont-break-the-chain",
      rulesVersion: "chain@2",
      client: "web/1.0",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(session.rulesVersion).toBe("chain@2");
  });

  it("keeps Stack 10's rules when no version is passed", async () => {
    const spy = mockFetch(() => jsonResponse(sessionPayload(), 201));

    await startSession("stack-10");

    expect(requestBody(spy).rulesVersion).toBe("stack-10@2");
  });
});

describe("completeRun", () => {
  it("submits the run and returns the server's result", async () => {
    const spy = mockFetch(() => jsonResponse(resultPayload({ score: 55 })));

    const result = await completeRun(
      "cccccccc-1111-4111-8111-cccccccccccc",
      { rulesVersion: "stack-10@1", actions: GREEDY_LINE, score: 55 },
      4200,
    );

    expect(requestUrl(spy).pathname).toBe(
      "/api/v1/sessions/cccccccc-1111-4111-8111-cccccccccccc/complete",
    );
    expect(requestBody(spy)).toEqual({
      score: 55,
      durationMs: 4200,
      progress: { rulesVersion: "stack-10@1", actions: GREEDY_LINE },
    });
    expect(result.score).toBe(55);
  });

  it("escapes a session id so it cannot address another endpoint", async () => {
    const spy = mockFetch(() => jsonResponse(resultPayload()));
    await completeRun("../me", { rulesVersion: "stack-10@1", actions: [], score: 0 }, 1);
    expect(requestUrl(spy).pathname).toBe("/api/v1/sessions/..%2Fme/complete");
  });

  it("passes the server's refusal through as an ApiError", async () => {
    mockFetch(() =>
      errorResponse(422, "unprocessable_entity", "That score is not the one this run produces."),
    );

    const failure = await completeRun(
      "cccccccc-1111-4111-8111-cccccccccccc",
      { rulesVersion: "stack-10@1", actions: GREEDY_LINE, score: 999 },
      4200,
    ).catch((error) => error);

    expect(failure.code).toBe("unprocessable_entity");
    expect(failure.status).toBe(422);
  });
});

describe("fetchLeaderboard", () => {
  it("reads the game's board with the window the caller asked for", async () => {
    const spy = mockFetch(() =>
      jsonResponse({
        gameSlug: "stack-10",
        scope: "global",
        period: "week",
        entries: [{ rank: 1, username: "rija", score: 120, achievedAt: null, plays: 3 }],
        hasMore: false,
        me: null,
      }),
    );

    const board = await fetchLeaderboard("stack-10", { period: "week", limit: 5 });

    const url = requestUrl(spy);
    expect(url.pathname).toBe("/api/v1/games/stack-10/leaderboard");
    expect(url.searchParams.get("period")).toBe("week");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(board.entries[0].username).toBe("rija");
    expect(board.me).toBeNull();
  });

  it("carries the token so the board can include the caller's own standing", async () => {
    await signInWith();
    const spy = mockFetch(() =>
      jsonResponse({
        gameSlug: "stack-10",
        scope: "global",
        period: "all",
        entries: [],
        hasMore: false,
        me: { rank: 4, score: 88, achievedAt: null, plays: 2 },
      }),
    );

    const board = await fetchLeaderboard("stack-10");

    expect(requestHeaders(spy).get("Authorization")).toBe("Bearer access-token-1");
    expect(board.me?.rank).toBe(4);
  });
});

// ── The run lifecycle ───────────────────────────────────────────────────────

describe("useStack10Run", () => {
  it("starts a real run from the server's session", async () => {
    const spy = mockFetch(() => jsonResponse(sessionPayload(), 201));

    const hook = renderHook(() => useStack10Run("stack-10"));
    expect(hook.result.status).toBe("starting");

    await waitFor(() => expect(hook.result.status).toBe("playing"));
    if (hook.result.status !== "playing") throw new Error("run did not start");

    // The board is the seed's deck, and the session is the server's.
    expect(hook.result.session.seed).toBe("9223372036854775807");
    expect(hook.result.run.nextTile).toBe(6);
    expect(hook.result.run.score).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("plays without asking the server anything until the run ends", async () => {
    const spy = mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(resultPayload())
        : jsonResponse(sessionPayload(), 201),
    );

    const hook = renderHook(() => useStack10Run("stack-10"));
    await waitFor(() => expect(hook.result.status).toBe("playing"));

    act(() => {
      [0, 0, 1].forEach((column) => hook.result.place(column));
    });

    if (hook.result.status !== "playing") throw new Error("run ended early");
    expect(hook.result.run.actions).toEqual([0, 0, 1]);
    expect(hook.result.run.score).toBe(0);
    // One request so far: the session. Scoring is not a per-move conversation.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("submits the finished run once and shows the score the server derived", async () => {
    const spy = mockFetch((url) =>
      url.includes("/complete")
        ? // The server's number, deliberately different from the client's 55, to
          // prove the screen shows the verified score rather than its own arithmetic.
          jsonResponse(resultPayload({ score: 60, clearedColumns: 3 }))
        : jsonResponse(sessionPayload({ seed: "1" }), 201),
    );

    const hook = renderHook(() => useStack10Run("stack-10"));
    await waitFor(() => expect(hook.result.status).toBe("playing"));

    act(() => {
      GREEDY_LINE.forEach((column) => hook.result.place(column));
    });

    await waitFor(() => expect(hook.result.status).toBe("finished"));
    if (hook.result.status !== "finished") throw new Error("run was not verified");

    expect(hook.result.result.score).toBe(60);
    expect(hook.result.run.score).toBe(55);
    expect(hook.result.result.rank).toBe(4);
    expect(hook.result.result.personalBest).toBe(55);

    const completeCalls = spy.mock.calls.filter((call) => String(call[0]).includes("/complete"));
    expect(completeCalls).toHaveLength(1);
    // And the body is the run: the action list, the claimed score, the duration.
    const body = requestBody(
      spy,
      spy.mock.calls.findIndex((c) => String(c[0]).includes("/complete")),
    );
    expect(body.progress.actions).toEqual(GREEDY_LINE);
    expect(body.score).toBe(55);
    expect(body.durationMs).toBeGreaterThan(0);
  });

  it("refuses to keep playing once the run has ended", async () => {
    mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(resultPayload())
        : jsonResponse(sessionPayload({ seed: "1" }), 201),
    );

    const hook = renderHook(() => useStack10Run("stack-10"));
    await waitFor(() => expect(hook.result.status).toBe("playing"));

    act(() => {
      GREEDY_LINE.forEach((column) => hook.result.place(column));
    });
    await waitFor(() => expect(hook.result.status).toBe("finished"));

    act(() => hook.result.place(0));

    if (hook.result.status !== "finished") throw new Error("the finished run changed");
    expect(hook.result.run.actions).toHaveLength(14);
  });

  it("reports a failed verification as a failure, keeps the run, and retries the identical body", async () => {
    let completions = 0;
    const spy = mockFetch((url) => {
      if (!url.includes("/complete")) return jsonResponse(sessionPayload({ seed: "1" }), 201);
      completions += 1;
      // Three refusals: the client's own retries of a deduplicated write, then
      // the failure the player sees and retries by hand.
      return completions <= 3
        ? errorResponse(503, "service_unavailable", "Play sessions are not available right now.")
        : jsonResponse(resultPayload());
    });

    const hook = renderHook(() => useStack10Run("stack-10"));
    await waitFor(() => expect(hook.result.status).toBe("playing"));

    act(() => {
      GREEDY_LINE.forEach((column) => hook.result.place(column));
    });

    await waitFor(() => expect(hook.result.status).toBe("error"));
    if (hook.result.status !== "error") throw new Error("expected a failure");
    expect(hook.result.stage).toBe("submit");
    // The run is not thrown away: it is unverified, not lost.
    expect(hook.result.run?.actions).toEqual(GREEDY_LINE);

    act(() => hook.result.retry());
    await waitFor(() => expect(hook.result.status).toBe("finished"));

    const sends = spy.mock.calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => String(call[0]).includes("/complete"));
    expect(sends).toHaveLength(4);
    // Same run, same body: a retry cannot become a second, different score.
    for (const send of sends.slice(1)) {
      expect(requestBody(spy, send.index)).toEqual(requestBody(spy, sends[0].index));
    }
    // And no new session was started to do it.
    const sessionCalls = spy.mock.calls.filter((call) =>
      String(call[0]).endsWith("/api/v1/sessions"),
    );
    expect(sessionCalls).toHaveLength(1);
  });

  it("reports a failed start, and retries with a new session", async () => {
    let attempts = 0;
    const spy = mockFetch(() => {
      attempts += 1;
      return attempts === 1
        ? errorResponse(503, "service_unavailable", "Play sessions are not available right now.")
        : jsonResponse(sessionPayload(), 201);
    });

    const hook = renderHook(() => useStack10Run("stack-10"));
    await waitFor(() => expect(hook.result.status).toBe("error"));
    if (hook.result.status !== "error") throw new Error("expected a failure");
    expect(hook.result.stage).toBe("start");

    act(() => hook.result.retry());
    await waitFor(() => expect(hook.result.status).toBe("playing"));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("starts a fresh run on restart, replacing the board", async () => {
    const spy = mockFetch(() => jsonResponse(sessionPayload({ seed: "1" }), 201));

    const hook = renderHook(() => useStack10Run("stack-10"));
    await waitFor(() => expect(hook.result.status).toBe("playing"));
    act(() => hook.result.place(0));

    act(() => hook.result.restart());

    await waitFor(() => expect(hook.result.status).toBe("playing"));
    if (hook.result.status !== "playing") throw new Error("run did not restart");
    expect(hook.result.run.actions).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("keeps a guest's run unranked without calling it saved to a board", async () => {
    // No token anywhere: the run is verified and the result says `ranked: false`
    // with no rank, because `scores.user_id` is NOT NULL by design.
    mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(resultPayload({ ranked: false, rank: null, personalBest: null }))
        : jsonResponse(sessionPayload({ seed: "1", ranked: false }), 201),
    );

    const hook = renderHook(() => useStack10Run("stack-10"));
    await waitFor(() => expect(hook.result.status).toBe("playing"));

    act(() => {
      GREEDY_LINE.forEach((column) => hook.result.place(column));
    });
    await waitFor(() => expect(hook.result.status).toBe("finished"));
    if (hook.result.status !== "finished") throw new Error("run was not verified");

    expect(hook.result.result.ranked).toBe(false);
    expect(hook.result.result.rank).toBeNull();
    expect(hook.result.result.personalBest).toBeNull();
  });

  it("does not end a run at the retired sixty-tile deck", async () => {
    const perfect = [
      0, 0, 1, 0, 0, 0, 2, 2, 2, 3, 0, 0, 2, 0, 2, 2, 0, 0, 2, 0, 2, 2, 3, 2, 2, 2, 2, 3, 0, 1, 0,
      0, 0, 0, 0, 2, 1, 2, 1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 3, 1, 1, 2, 1, 1, 0,
    ];
    const spy = mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(resultPayload({ score: 435, tilesPlaced: 67 }))
        : jsonResponse(sessionPayload({ seed: "1" }), 201),
    );

    const hook = renderHook(() => useStack10Run("stack-10"));
    await waitFor(() => expect(hook.result.status).toBe("playing"));

    act(() => {
      perfect.forEach((column) => hook.result.place(column));
    });

    // Sixty tiles used to be a complete run and a `cleared` outcome. It is not one
    // any more: the board can still take a tile, so nothing is submitted and the
    // run keeps playing.
    const live = hook.result;
    expect(live.status).toBe("playing");
    if (live.status !== "playing") throw new Error("the old deck ended the run");
    expect(live.run.actions).toHaveLength(60);
    expect(live.run.outcome).toBe("playing");
    expect(live.run.nextTile).toBe(9);
    expect(spy.mock.calls.filter((call) => String(call[0]).includes("/complete"))).toHaveLength(0);

    // Seven more tiles, the last of which passes ten.
    act(() => {
      [0, 2, 3, 0, 1, 0, 1].forEach((column) => hook.result.place(column));
    });

    await waitFor(() => expect(hook.result.status).toBe("finished"));
    const done = hook.result;
    if (done.status !== "finished") throw new Error("run was not verified");

    expect(done.run.endReason).toBe("overflow");
    expect(done.result.tilesPlaced).toBe(67);

    const index = spy.mock.calls.findIndex((call) => String(call[0]).includes("/complete"));
    expect(requestBody(spy, index).progress.actions).toEqual([...perfect, 0, 2, 3, 0, 1, 0, 1]);
  });

  it("submits the run derived by the engine, not a number a caller supplied", async () => {
    // The only thing the hook exposes is `place`, and the body always comes from
    // `submission(run)` inside the module: the score submitted is the engine's 55,
    // even though the server answers with 60 and the screen shows 60.
    const spy = mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(resultPayload({ score: 60 }))
        : jsonResponse(sessionPayload({ seed: "1" }), 201),
    );

    const hook = renderHook(() => useStack10Run("stack-10"));
    await waitFor(() => expect(hook.result.status).toBe("playing"));

    act(() => {
      GREEDY_LINE.forEach((column) => hook.result.place(column));
    });
    await waitFor(() => expect(hook.result.status).toBe("finished"));
    if (hook.result.status !== "finished") throw new Error("run was not verified");

    expect(submission(hook.result.run)).toEqual({
      rulesVersion: "stack-10@2",
      actions: GREEDY_LINE,
      score: 55,
      tilesPlaced: 14,
      clearedColumns: 3,
    });
    const index = spy.mock.calls.findIndex((call) => String(call[0]).includes("/complete"));
    expect(requestBody(spy, index).score).toBe(55);
  });
});

// ── The Chain run lifecycle ─────────────────────────────────────────────────
// Seed 1 deals 0,0,2,3,…: round one is [0], round two [0,0].

/** A Chain session payload, per the contract. */
function chainSessionPayload(overrides: Partial<PlaySession> = {}): PlaySession {
  return {
    id: "dddddddd-1111-4111-8111-dddddddddddd",
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

/** A Chain result payload, per the contract. */
function chainResultPayload(overrides: Partial<RunResult> = {}): RunResult {
  return {
    sessionId: "dddddddd-1111-4111-8111-dddddddddddd",
    gameSlug: "dont-break-the-chain",
    score: 3,
    clearedColumns: 2,
    tilesPlaced: 4,
    durationMs: 3800,
    ranked: true,
    recordedAt: "2026-10-13T12:01:00.000Z",
    personalBest: 3,
    rank: 1,
    duplicate: false,
    ...overrides,
  };
}

describe("useChainRun", () => {
  it("starts a real run from the server's session, under Chain rules", async () => {
    const spy = mockFetch(() => jsonResponse(chainSessionPayload(), 201));

    const hook = renderHook(() => useChainRun("dont-break-the-chain"));
    expect(hook.result.status).toBe("starting");

    await waitFor(() => expect(hook.result.status).toBe("playing"));
    if (hook.result.status !== "playing") throw new Error("run did not start");

    // The session asked for Chain rules, and the board is the seed's sequence.
    const body = requestBody(spy);
    expect(body.rulesVersion).toBe("chain@2");
    expect(hook.result.session.seed).toBe("1");
    expect(hook.result.run.round).toBe(1);
    expect(hook.result.run.score).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("plays without asking the server anything until the run ends", async () => {
    const spy = mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(chainResultPayload())
        : jsonResponse(chainSessionPayload(), 201),
    );

    const hook = renderHook(() => useChainRun("dont-break-the-chain"));
    await waitFor(() => expect(hook.result.status).toBe("playing"));

    act(() => {
      [0, 0, 0].forEach((pad) => hook.result.tap(pad));
    });

    if (hook.result.status !== "playing") throw new Error("run ended early");
    expect(hook.result.run.taps).toEqual([0, 0, 0]);
    expect(hook.result.run.score).toBe(3);
    expect(hook.result.run.round).toBe(3);
    // One request so far: the session. Scoring is not a per-move conversation.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("submits the finished run once and shows the score the server derived", async () => {
    const spy = mockFetch((url) =>
      url.includes("/complete")
        ? // The server's number, deliberately different from the client's 3, to
          // prove the screen shows the verified score rather than its own arithmetic.
          jsonResponse(chainResultPayload({ score: 7 }))
        : jsonResponse(chainSessionPayload(), 201),
    );

    const hook = renderHook(() => useChainRun("dont-break-the-chain"));
    await waitFor(() => expect(hook.result.status).toBe("playing"));

    act(() => {
      // Rounds one and two reproduced, then the tap that breaks the chain.
      [0, 0, 0, 1].forEach((pad) => hook.result.tap(pad));
    });

    await waitFor(() => expect(hook.result.status).toBe("finished"));
    if (hook.result.status !== "finished") throw new Error("run was not verified");

    expect(hook.result.result.score).toBe(7);
    expect(hook.result.run.score).toBe(3);
    expect(hook.result.run.outcome).toBe("over");

    const completeCalls = spy.mock.calls.filter((call) => String(call[0]).includes("/complete"));
    expect(completeCalls).toHaveLength(1);
    // And the body is the run: the tap list including the losing tap, the
    // claimed score, the duration — and the session's pinned rules version.
    const body = requestBody(
      spy,
      spy.mock.calls.findIndex((c) => String(c[0]).includes("/complete")),
    );
    expect(body.progress.actions).toEqual([0, 0, 0, 1]);
    expect(body.progress.rulesVersion).toBe("chain@2");
    expect(body.score).toBe(3);
    expect(body.durationMs).toBeGreaterThan(0);
  });

  it("reports a failed verification as a failure, keeps the run, and retries the identical body", async () => {
    let completions = 0;
    const spy = mockFetch((url) => {
      if (!url.includes("/complete")) return jsonResponse(chainSessionPayload(), 201);
      completions += 1;
      // Three refusals: the client's own retries of a deduplicated write, then
      // the failure the player sees and retries by hand.
      return completions <= 3
        ? errorResponse(503, "service_unavailable", "Play sessions are not available right now.")
        : jsonResponse(chainResultPayload());
    });

    const hook = renderHook(() => useChainRun("dont-break-the-chain"));
    await waitFor(() => expect(hook.result.status).toBe("playing"));

    act(() => {
      [0, 0, 0, 1].forEach((pad) => hook.result.tap(pad));
    });

    await waitFor(() => expect(hook.result.status).toBe("error"));
    if (hook.result.status !== "error") throw new Error("expected a failure");
    expect(hook.result.stage).toBe("submit");
    // The run is not thrown away: it is unverified, not lost.
    expect(hook.result.run?.taps).toEqual([0, 0, 0, 1]);

    act(() => hook.result.retry());
    await waitFor(() => expect(hook.result.status).toBe("finished"));

    const sends = spy.mock.calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => String(call[0]).includes("/complete"));
    expect(sends).toHaveLength(4);
    // Same run, same body: a retry cannot become a second, different score.
    for (const send of sends.slice(1)) {
      expect(requestBody(spy, send.index)).toEqual(requestBody(spy, sends[0].index));
    }
    // And no new session was started to do it.
    const sessionCalls = spy.mock.calls.filter((call) =>
      String(call[0]).endsWith("/api/v1/sessions"),
    );
    expect(sessionCalls).toHaveLength(1);
  });
});

// ── The Memory Flash run lifecycle ──────────────────────────────────────────
// Seed 1 flashes [8], then [8,6]: round one is one cell, round two two cells.

/** A Memory Flash session payload, per the contract. */
function memoryFlashSessionPayload(overrides: Partial<PlaySession> = {}): PlaySession {
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

/** A Memory Flash result payload, per the contract. */
function memoryFlashResultPayload(overrides: Partial<RunResult> = {}): RunResult {
  return {
    sessionId: "eeeeeeee-1111-4111-8111-eeeeeeeeeeee",
    gameSlug: "memory-flash",
    score: 10,
    clearedColumns: 1,
    tilesPlaced: 3,
    durationMs: 3800,
    ranked: true,
    recordedAt: "2026-10-20T12:01:00.000Z",
    personalBest: 10,
    rank: 1,
    duplicate: false,
    ...overrides,
  };
}

describe("useMemoryFlashRun", () => {
  it("starts a real run from the server's session, under Memory Flash rules", async () => {
    const spy = mockFetch(() => jsonResponse(memoryFlashSessionPayload(), 201));

    const hook = renderHook(() => useMemoryFlashRun("memory-flash"));
    expect(hook.result.status).toBe("starting");

    await waitFor(() => expect(hook.result.status).toBe("playing"));
    if (hook.result.status !== "playing") throw new Error("run did not start");

    // The session asked for Memory Flash rules, and the board is the seed's
    // first pattern.
    const body = requestBody(spy);
    expect(body.rulesVersion).toBe("memory-flash@2");
    expect(hook.result.session.seed).toBe("1");
    expect(hook.result.run.round).toBe(1);
    expect(hook.result.run.score).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("plays without asking the server anything until the run ends", async () => {
    const spy = mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(memoryFlashResultPayload())
        : jsonResponse(memoryFlashSessionPayload(), 201),
    );

    const hook = renderHook(() => useMemoryFlashRun("memory-flash"));
    await waitFor(() => expect(hook.result.status).toBe("playing"));

    act(() => {
      // Round one is [8]: one tap clears it and scores ten.
      hook.result.tap(8);
    });

    if (hook.result.status !== "playing") throw new Error("run ended early");
    expect(hook.result.run.taps).toEqual([8]);
    expect(hook.result.run.score).toBe(10);
    expect(hook.result.run.round).toBe(2);
    // One request so far: the session. Scoring is not a per-move conversation.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("submits the finished run once and shows the score the server derived", async () => {
    const spy = mockFetch((url) =>
      url.includes("/complete")
        ? // The server's number, deliberately different from the client's 10, to
          // prove the screen shows the verified score rather than its own arithmetic.
          jsonResponse(memoryFlashResultPayload({ score: 40 }))
        : jsonResponse(memoryFlashSessionPayload(), 201),
    );

    const hook = renderHook(() => useMemoryFlashRun("memory-flash"));
    await waitFor(() => expect(hook.result.status).toBe("playing"));

    act(() => {
      // Round one rebuilt, then a cell round two does not light.
      [8, 8, 0].forEach((cell) => hook.result.tap(cell));
    });

    await waitFor(() => expect(hook.result.status).toBe("finished"));
    if (hook.result.status !== "finished") throw new Error("run was not verified");

    expect(hook.result.result.score).toBe(40);
    expect(hook.result.run.score).toBe(10);
    expect(hook.result.run.outcome).toBe("over");

    const completeCalls = spy.mock.calls.filter((call) => String(call[0]).includes("/complete"));
    expect(completeCalls).toHaveLength(1);
    // And the body is the run: the cell list including the losing tap, the
    // claimed score, the duration — and the session's pinned rules version.
    const body = requestBody(
      spy,
      spy.mock.calls.findIndex((c) => String(c[0]).includes("/complete")),
    );
    expect(body.progress.actions).toEqual([8, 8, 0]);
    expect(body.progress.rulesVersion).toBe("memory-flash@2");
    expect(body.score).toBe(10);
    expect(body.durationMs).toBeGreaterThan(0);
  });

  it("reports a failed verification as a failure, keeps the run, and retries the identical body", async () => {
    let completions = 0;
    const spy = mockFetch((url) => {
      if (!url.includes("/complete")) return jsonResponse(memoryFlashSessionPayload(), 201);
      completions += 1;
      // Three refusals: the client's own retries of a deduplicated write, then
      // the failure the player sees and retries by hand.
      return completions <= 3
        ? errorResponse(503, "service_unavailable", "Play sessions are not available right now.")
        : jsonResponse(memoryFlashResultPayload());
    });

    const hook = renderHook(() => useMemoryFlashRun("memory-flash"));
    await waitFor(() => expect(hook.result.status).toBe("playing"));

    act(() => {
      [8, 8, 0].forEach((cell) => hook.result.tap(cell));
    });

    await waitFor(() => expect(hook.result.status).toBe("error"));
    if (hook.result.status !== "error") throw new Error("expected a failure");
    expect(hook.result.stage).toBe("submit");
    // The run is not thrown away: it is unverified, not lost.
    expect(hook.result.run?.taps).toEqual([8, 8, 0]);

    act(() => hook.result.retry());
    await waitFor(() => expect(hook.result.status).toBe("finished"));

    const sends = spy.mock.calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => String(call[0]).includes("/complete"));
    expect(sends).toHaveLength(4);
    // Same run, same body: a retry cannot become a second, different score.
    for (const send of sends.slice(1)) {
      expect(requestBody(spy, send.index)).toEqual(requestBody(spy, sends[0].index));
    }
    // And no new session was started to do it.
    const sessionCalls = spy.mock.calls.filter((call) =>
      String(call[0]).endsWith("/api/v1/sessions"),
    );
    expect(sessionCalls).toHaveLength(1);
  });
});

// ── Boards ──────────────────────────────────────────────────────────────────

describe("useOneMoveRun", () => {
  it("times the run from Start, not from the session arriving", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const spy = mockFetch((url) =>
      url.includes("/complete")
        ? jsonResponse(resultPayload())
        : jsonResponse(sessionPayload({ seed: "1", rulesVersion: "one-move@2" }), 201),
    );

    const hook = renderHook(() => useOneMoveRun("one-move"));
    await waitFor(() => expect(hook.result.status).toBe("playing"));

    // A minute on the rules screen, then Start.
    now.mockReturnValue(61_000);
    act(() => hook.result.begin());

    // Five seconds of play, ending on a wrong tap.
    now.mockReturnValue(66_000);
    const wrong = winningCell("1", 1) === 0 ? 1 : 0;
    act(() => hook.result.tap(wrong));

    await waitFor(() => expect(hook.result.status).toBe("finished"));
    const send = spy.mock.calls.findIndex((call) => String(call[0]).includes("/complete"));
    expect(requestBody(spy, send).durationMs).toBe(5_000);
  });
});

describe("useLeaderboard", () => {
  it("reports an empty board as ready, because no scores is an answer", async () => {
    mockFetch(() =>
      jsonResponse({
        gameSlug: "stack-10",
        scope: "global",
        period: "all",
        entries: [],
        hasMore: false,
        me: null,
      }),
    );

    const hook = renderHook(() => useLeaderboard("stack-10"));
    await waitFor(() => expect(hook.result.status).toBe("ready"));
    if (hook.result.status !== "ready") throw new Error("board did not load");

    expect(hook.result.board.entries).toEqual([]);
    expect(hook.result.board.me).toBeNull();
  });

  it("reports a failed read as an error rather than an empty board", async () => {
    const spy = mockFetch(() =>
      errorResponse(503, "service_unavailable", "The game catalogue is not available right now."),
    );

    const hook = renderHook(() => useLeaderboard("stack-10"));
    await waitFor(() => expect(hook.result.status).toBe("error"));

    act(() => hook.result.retry());
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(1));
  });

  it("asks for nothing when there is no game to rank", async () => {
    const spy = mockFetch(() => jsonResponse({}));

    const hook = renderHook(() => useLeaderboard(""));

    expect(hook.result.status).toBe("loading");
    expect(spy).not.toHaveBeenCalled();
  });
});
