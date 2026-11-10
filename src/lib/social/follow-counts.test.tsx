import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearSession, signIn } from "@/lib/auth/session";
import { followUser, getFollowCounts, unfollowUser, useFollowCounts } from "@/lib/social/follows";

const testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";
const otherUserID = "9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d";

function sessionPayload() {
  return {
    session: {
      userId: testUserID,
      role: "user",
      email: "player@example.com",
      onboarded: true,
      expiresAt: "2026-10-08T12:00:00.000Z",
    },
    tokens: {
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
      tokenType: "bearer",
      expiresIn: 3600,
    },
    user: {
      id: testUserID,
      email: "player@example.com",
      emailConfirmed: true,
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  };
}

/** A count answer: an empty body and the exact total PostgREST puts in the header. */
function countResponse(total: number) {
  return new Response("[]", {
    status: 200,
    headers: { "Content-Type": "application/json", "Content-Range": `*/${total}` },
  });
}

/** The `follow_counts` function's answer. */
function countsResponse(followers: number, following = followers) {
  return jsonResponse({ followers, following });
}

const isCountsCall = (url: string) => url.includes("/rest/v1/rpc/follow_counts");

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

async function signInAs() {
  await signIn("player@example.com", "correct-horse");
}

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getFollowCounts", () => {
  it("reads both numbers from follow_counts, which counts without showing rows", async () => {
    const spy = mockFetch((url) =>
      url.includes("/auth/sign-in") ? jsonResponse(sessionPayload()) : countsResponse(42, 7),
    );
    await signInAs();

    await expect(getFollowCounts(otherUserID)).resolves.toEqual({
      followers: 42,
      following: 7,
    });

    const calls = spy.mock.calls.slice(1).map(([input]) => new URL(String(input)));
    expect(calls).toHaveLength(1);
    expect(calls[0].pathname).toBe("/rest/v1/rpc/follow_counts");
    expect(calls[0].searchParams.get("p_user_id")).toBe(otherUserID);
  });

  it("falls back to exact row counts until follow_counts is deployed", async () => {
    const spy = mockFetch((url) => {
      if (url.includes("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (isCountsCall(url)) return jsonResponse({ message: "not found" }, 404);
      return countResponse(42);
    });
    await signInAs();

    await expect(getFollowCounts(otherUserID)).resolves.toEqual({
      followers: 42,
      following: 42,
    });

    const [followers, following] = spy.mock.calls.slice(2).map(([input, init]) => ({
      url: new URL(String(input)),
      headers: new Headers(init?.headers),
    }));
    expect(followers.url.pathname).toBe("/rest/v1/follows");
    expect(followers.url.searchParams.get("followee_id")).toBe(`eq.${otherUserID}`);
    expect(following.url.searchParams.get("follower_id")).toBe(`eq.${otherUserID}`);
    // The number comes from the count header; no row list is fetched, so the
    // project's `max_rows` cap cannot truncate it to 1000.
    expect(followers.headers.get("Prefer")).toBe("count=exact");
    expect(following.headers.get("Prefer")).toBe("count=exact");
  });

  it("still reads the public counts when the access token has lapsed", async () => {
    const spy = mockFetch((url, init) => {
      if (url.includes("/auth/sign-in")) return jsonResponse(sessionPayload());
      const token = new Headers(init?.headers).get("Authorization");
      return token ? jsonResponse({ message: "JWT expired" }, 401) : countsResponse(6);
    });
    await signInAs();

    // The counts are public, so a token the server refuses must not turn a
    // measurable count into an error.
    await expect(getFollowCounts(otherUserID)).resolves.toEqual({ followers: 6, following: 6 });

    const anonymous = spy.mock.calls
      .slice(1)
      .filter(([, init]) => new Headers(init?.headers).get("Authorization") === null);
    expect(anonymous).toHaveLength(1);
  });

  it("reports a failed count instead of a zero", async () => {
    mockFetch((url) =>
      url.includes("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : new Response(JSON.stringify({ message: "nope" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }),
    );
    await signInAs();

    await expect(getFollowCounts(otherUserID)).rejects.toMatchObject({ status: 503 });
  });
});

describe("useFollowCounts", () => {
  it("reads both numbers for the profile and refreshes after a follow", async () => {
    let follows = 0;
    const spy = mockFetch((url, init) => {
      if (url.includes("/auth/sign-in")) return jsonResponse(sessionPayload());
      const method = init?.method ?? "GET";
      if (method === "POST") {
        follows += 1;
        return jsonResponse([], 201);
      }
      if (method === "DELETE") {
        follows -= 1;
        return new Response(null, { status: 204 });
      }
      return countsResponse(2 + follows, 5);
    });
    await signInAs();

    const { result } = renderHook(() => useFollowCounts(otherUserID));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.counts).toEqual({ followers: 2, following: 5 });

    // Following from anywhere on the page bumps the follow graph; the counts
    // re-read instead of staying at the value from before the tap.
    await act(async () => {
      await followUser(otherUserID);
    });

    await waitFor(() => expect(result.current.counts?.followers).toBe(3));
    expect(result.current.counts?.following).toBe(5);

    // Unfollowing is the same contract in reverse: the number must come back
    // down, not stay where the follow left it.
    await act(async () => {
      await unfollowUser(otherUserID);
    });

    await waitFor(() => expect(result.current.counts?.followers).toBe(2));
    expect(result.current.counts?.following).toBe(5);
    expect(spy.mock.calls.length).toBeGreaterThan(3);
  });

  it("keeps the last known numbers and reports a failed refresh", async () => {
    let fail = false;
    mockFetch((url) => {
      if (url.includes("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (fail) {
        return new Response(JSON.stringify({ message: "down" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return countsResponse(4);
    });
    await signInAs();

    const { result } = renderHook(() => useFollowCounts(otherUserID));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.counts).toEqual({ followers: 4, following: 4 });

    fail = true;
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.status).toBe("error"));
    // A failed read is not a zero: the measured numbers stay on screen.
    expect(result.current.counts).toEqual({ followers: 4, following: 4 });
    expect(result.current.error).toBeTruthy();
  });

  it("does nothing without a profile to read", () => {
    const spy = mockFetch(() => jsonResponse({}));

    const { result } = renderHook(() => useFollowCounts(undefined));

    expect(result.current.status).toBe("idle");
    expect(result.current.counts).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
