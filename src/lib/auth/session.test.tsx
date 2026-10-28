import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import {
  SESSION_STORAGE_KEY,
  clearSession,
  getAccessToken,
  getAuthState,
  initializeSession,
  loadSession,
  refreshSession,
  rotateRefusedSession,
  signIn,
  signOut,
  signUp,
  useAuth,
} from "@/lib/auth/session";

const testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";

/** The shape `POST /auth/sign-in` answers with, per the contract. */
function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      userId: testUserID,
      role: "user",
      email: "player@example.com",
      onboarded: false,
      expiresAt: "2026-10-08T12:00:00.000Z",
    },
    tokens: {
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
      tokenType: "bearer",
      expiresAt: "2026-10-08T12:00:00.000Z",
      expiresIn: 3600,
    },
    user: {
      id: testUserID,
      email: "player@example.com",
      emailConfirmed: true,
      createdAt: "2026-10-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code: string, message: string) {
  return jsonResponse({ error: { code, message, request_id: "req-abc123" } }, status);
}

function requestOf(spy: ReturnType<typeof mockFetch>, index = 0) {
  const call = spy.mock.calls[index];
  if (!call) throw new Error(`no request at index ${index}`);
  const [input, init] = call;
  return {
    path: new URL(String(input)).pathname,
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers),
    body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
  };
}

/** A stored entry in the shape `initializeSession` reads back. */
function storedPayload(
  tokens: Record<string, unknown> = {},
  session: Record<string, unknown> = {},
) {
  return {
    version: 1,
    tokens: {
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
      tokenType: "bearer",
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      ...tokens,
    },
    session: {
      userId: testUserID,
      role: "user",
      email: "player@example.com",
      onboarded: false,
      ...session,
    },
  };
}

function storeSession(payload: Record<string, unknown>): void {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
}

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("signIn", () => {
  it("posts the credential to the auth service and adopts the session", async () => {
    const spy = mockFetch(() => jsonResponse(sessionPayload()));

    await expect(signIn("player@example.com", "correct-horse")).resolves.toMatchObject({
      session: { userId: testUserID, role: "user" },
    });

    const request = requestOf(spy);
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/api/v1/auth/sign-in");
    // Exactly the two documented fields: the endpoint rejects unknown ones.
    expect(request.body).toEqual({ email: "player@example.com", password: "correct-horse" });
    // The credential is the request, so it is not repeated in a header.
    expect(request.headers.get("Authorization")).toBeNull();

    expect(getAuthState()).toEqual({
      status: "authenticated",
      session: expect.objectContaining({ userId: testUserID }),
    });
    expect(getAccessToken()).toBe("access-token-1");
  });

  it("stays anonymous and surfaces the envelope when the credential is wrong", async () => {
    mockFetch(() => errorResponse(401, "unauthorized", "That email and password do not match."));

    const failure = await signIn("player@example.com", "wrong").catch((error) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.code).toBe("unauthorized");
    expect(failure.status).toBe(401);
    // The server's message is the one the user sees; nothing is invented here.
    expect(failure.message).toBe("That email and password do not match.");
    expect(failure.requestId).toBe("req-abc123");
    expect(getAuthState()).toEqual({ status: "anonymous" });
    expect(getAccessToken()).toBeUndefined();
  });
});

describe("signUp", () => {
  it("reports a confirmation-pending signup as success without a session", async () => {
    mockFetch(() =>
      jsonResponse(
        {
          session: { userId: testUserID, role: "user", email: "player@example.com" },
          user: {
            id: testUserID,
            email: "player@example.com",
            emailConfirmed: false,
            createdAt: "2026-10-01T00:00:00.000Z",
          },
        },
        201,
      ),
    );

    const payload = await signUp("player@example.com", "correct-horse-battery");

    expect(payload.tokens).toBeUndefined();
    expect(payload.user?.emailConfirmed).toBe(false);
    // No tokens means not signed in: the caller must not be treated as one.
    expect(getAuthState()).toEqual({ status: "anonymous" });
  });

  it("sends the chosen username with the sign-up request", async () => {
    const spy = mockFetch(() => jsonResponse(sessionPayload(), 201));

    await signUp("player@example.com", "correct-horse-battery", "  Rijad  ");

    expect(requestOf(spy).body).toEqual({
      email: "player@example.com",
      password: "correct-horse-battery",
      // The server normalizes and validates it; the client only drops the
      // accidental whitespace so the field and the request agree.
      username: "Rijad",
    });
  });

  it("omits the field when there is no username to send", async () => {
    const spy = mockFetch(() => jsonResponse(sessionPayload(), 201));

    await signUp("player@example.com", "correct-horse-battery");

    expect(requestOf(spy).body).toEqual({
      email: "player@example.com",
      password: "correct-horse-battery",
    });
  });

  it("sends the product-updates choice only when it was ticked", async () => {
    const consented = mockFetch(() => jsonResponse(sessionPayload(), 201));
    await signUp("player@example.com", "correct-horse-battery", "rijad", "Rijad", true);
    expect(requestOf(consented).body).toMatchObject({ marketing: true });

    const declined = mockFetch(() => jsonResponse(sessionPayload(), 201));
    await signUp("player@example.com", "correct-horse-battery", "rijad", "Rijad", false);
    expect(requestOf(declined).body).not.toHaveProperty("marketing");
  });

  it("signs the caller in when Supabase returns a session", async () => {
    const spy = mockFetch(() => jsonResponse(sessionPayload(), 201));

    await signUp("player@example.com", "correct-horse-battery");

    expect(requestOf(spy).path).toBe("/api/v1/auth/sign-up");
    expect(getAuthState().status).toBe("authenticated");
    // A fresh signup is stored like any other session, so it survives a reload.
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
  });

  it("surfaces an existing account as a conflict", async () => {
    mockFetch(() => errorResponse(409, "conflict", "An account with that email already exists."));

    const failure = await signUp("player@example.com", "correct-horse-battery").catch((e) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.status).toBe(409);
    expect(failure.message).toBe("An account with that email already exists.");
  });
});

describe("refreshSession", () => {
  it("rotates both tokens", async () => {
    const spy = mockFetch((url) =>
      url.endsWith("/auth/refresh")
        ? jsonResponse(
            sessionPayload({
              tokens: {
                accessToken: "access-token-2",
                refreshToken: "refresh-token-2",
                tokenType: "bearer",
                expiresIn: 3600,
              },
            }),
          )
        : jsonResponse(sessionPayload()),
    );

    await signIn("player@example.com", "correct-horse");
    await refreshSession();

    const request = requestOf(spy, 1);
    expect(request.path).toBe("/api/v1/auth/refresh");
    expect(request.body).toEqual({ refreshToken: "refresh-token-1" });
    expect(getAccessToken()).toBe("access-token-2");
  });

  it("refuses to call the API without a session to rotate", async () => {
    const spy = mockFetch(() => jsonResponse(sessionPayload()));

    await expect(refreshSession()).rejects.toThrow(/no session to refresh/i);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("loadSession", () => {
  it("reads the session with the stored token as a bearer header", async () => {
    const spy = mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : jsonResponse({ userId: testUserID, role: "admin", onboarded: true }),
    );

    await signIn("player@example.com", "correct-horse");
    const session = await loadSession();

    const request = requestOf(spy, 1);
    expect(request.method).toBe("GET");
    expect(request.path).toBe("/api/v1/auth/session");
    expect(request.headers.get("Authorization")).toBe("Bearer access-token-1");
    expect(request.body).toBeUndefined();
    expect(session).toEqual({ userId: testUserID, role: "admin", onboarded: true });
  });

  it("refuses to call the API while anonymous", async () => {
    const spy = mockFetch(() => jsonResponse({}));

    await expect(loadSession()).rejects.toThrow(/no session to read/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("adopts the server's view, so a completed registration is reflected", async () => {
    const spy = mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : jsonResponse({ userId: testUserID, role: "user", onboarded: true }),
    );

    await signIn("player@example.com", "correct-horse");
    expect(getAuthState()).toEqual({
      status: "authenticated",
      session: expect.objectContaining({ onboarded: false }),
    });

    await loadSession();

    expect(getAuthState()).toEqual({
      status: "authenticated",
      session: { userId: testUserID, role: "user", onboarded: true },
    });
    // The stored copy carries the fresh view too, so a reload agrees with the
    // server instead of the stale view.
    const stored = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) ?? "{}");
    expect(stored.session.onboarded).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("rotateRefusedSession", () => {
  it("rotates the pair and keeps the session", async () => {
    const spy = mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : jsonResponse(
            sessionPayload({
              tokens: {
                accessToken: "access-token-2",
                refreshToken: "refresh-token-2",
                tokenType: "bearer",
                expiresIn: 3600,
              },
            }),
          ),
    );
    await signIn("player@example.com", "correct-horse");

    await expect(rotateRefusedSession()).resolves.toBe("rotated");

    const request = requestOf(spy, 1);
    expect(request.path).toBe("/api/v1/auth/refresh");
    expect(request.body).toEqual({ refreshToken: "refresh-token-1" });
    expect(getAccessToken()).toBe("access-token-2");
    expect(getAuthState().status).toBe("authenticated");
    const stored = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) ?? "{}");
    expect(stored.tokens.accessToken).toBe("access-token-2");
  });

  it("forgets the session only when the credential is definitively refused", async () => {
    mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : errorResponse(401, "unauthorized", "That refresh token is not valid."),
    );
    await signIn("player@example.com", "correct-horse");

    await expect(rotateRefusedSession()).resolves.toBe("signed-out");
    expect(getAuthState()).toEqual({ status: "anonymous" });
    expect(getAccessToken()).toBeUndefined();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("keeps the session when the server cannot answer", async () => {
    mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : errorResponse(503, "service_unavailable", "Authentication is not available right now."),
    );
    await signIn("player@example.com", "correct-horse");

    await expect(rotateRefusedSession()).resolves.toBe("transient");

    // A server that could not answer decided nothing; the stored session stays
    // for a later attempt and the caller falls back to a retryable error.
    expect(getAccessToken()).toBe("access-token-1");
    expect(getAuthState().status).toBe("authenticated");
  });

  it("reports signed out with nothing to rotate", async () => {
    const spy = mockFetch(() => jsonResponse({}));

    await expect(rotateRefusedSession()).resolves.toBe("signed-out");
    expect(spy).not.toHaveBeenCalled();
  });

  it("shares one rotation between concurrent callers", async () => {
    // Two requests refused at the same moment used to spend the same refresh
    // token twice. Supabase treats a second use as reuse and can revoke the
    // whole token family, which signed the visitor out. The rotation is now
    // single-flight: one request, one new pair, both callers succeed.
    let releaseRefresh: ((response: Response) => void) | undefined;
    const spy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/auth/sign-in")) return jsonResponse(sessionPayload());
      return new Promise<Response>((resolve) => {
        releaseRefresh = resolve;
      });
    });
    vi.stubGlobal("fetch", spy);
    await signIn("player@example.com", "correct-horse");

    const first = rotateRefusedSession();
    const second = rotateRefusedSession();
    // Let both callers reach the shared request before it answers.
    await Promise.resolve();
    releaseRefresh?.(
      jsonResponse(
        sessionPayload({
          tokens: {
            accessToken: "access-token-2",
            refreshToken: "refresh-token-2",
            tokenType: "bearer",
            expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
          },
        }),
      ),
    );

    await expect(Promise.all([first, second])).resolves.toEqual(["rotated", "rotated"]);
    const refreshCalls = spy.mock.calls.filter(([input]) =>
      String(input).endsWith("/auth/refresh"),
    );
    expect(refreshCalls).toHaveLength(1);
    expect(getAccessToken()).toBe("access-token-2");
    expect(getAuthState().status).toBe("authenticated");
  });

  it("adopts a pair another tab rotated instead of ending the session", async () => {
    // This tab's refresh token was already spent by another tab, so the server
    // refuses it as reuse. The other tab stored the surviving pair; adopting it
    // keeps the visitor signed in rather than clearing a valid session.
    mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : errorResponse(400, "invalid_grant", "Invalid Refresh Token: Already Used"),
    );
    await signIn("player@example.com", "correct-horse");

    storeSession(
      storedPayload({
        accessToken: "access-token-2",
        refreshToken: "refresh-token-2",
      }),
    );

    await expect(rotateRefusedSession()).resolves.toBe("rotated");
    expect(getAccessToken()).toBe("access-token-2");
    expect(getAuthState().status).toBe("authenticated");
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
  });
});

describe("signOut", () => {
  it("revokes the session and forgets it locally", async () => {
    const spy = mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : new Response(null, { status: 204 }),
    );

    await signIn("player@example.com", "correct-horse");
    await signOut();

    const request = requestOf(spy, 1);
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/api/v1/auth/sign-out");
    expect(request.headers.get("Authorization")).toBe("Bearer access-token-1");
    expect(getAuthState()).toEqual({ status: "anonymous" });
    expect(getAccessToken()).toBeUndefined();
    // Signing out must not leave a restorable session behind.
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("forgets the session even when the revoke fails", async () => {
    mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : errorResponse(503, "service_unavailable", "Authentication is not available right now."),
    );

    await signIn("player@example.com", "correct-horse");

    await expect(signOut()).rejects.toBeInstanceOf(ApiError);
    // A signed-out screen is the point of signing out; a network failure must not
    // leave the app holding a token it can no longer revoke.
    expect(getAuthState()).toEqual({ status: "anonymous" });
    expect(getAccessToken()).toBeUndefined();
  });

  it("does nothing while anonymous", async () => {
    const spy = mockFetch(() => jsonResponse({}));

    await expect(signOut()).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("credential handling", () => {
  it("persists the session under one namespaced key and nowhere else", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mockFetch(() => jsonResponse(sessionPayload()));

    await signIn("player@example.com", "correct-horse");

    // Exactly one write, to the one key this module owns.
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem.mock.calls[0]?.[0]).toBe(SESSION_STORAGE_KEY);
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw ?? "null") as {
      version: number;
      tokens: { accessToken: string };
      session: { userId: string };
    };
    expect(stored.version).toBe(1);
    expect(stored.tokens.accessToken).toBe("access-token-1");
    expect(stored.session.userId).toBe(testUserID);
    // Nothing else is written: no other localStorage entry, no sessionStorage
    // and no cookie carries a credential.
    expect(window.localStorage.length).toBe(1);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain("access-token-1");
  });

  it("keeps the password out of the error path", async () => {
    mockFetch(() => errorResponse(500, "internal_error", "Something went wrong."));

    const failure = await signIn("player@example.com", "correct-horse").catch((e) => e);

    expect(String(failure)).not.toContain("correct-horse");
  });
});

describe("session restoration", () => {
  it("publishes the stored session immediately and re-validates it with the server", async () => {
    storeSession(storedPayload());
    const spy = mockFetch(() =>
      jsonResponse({ userId: testUserID, role: "admin", onboarded: true }),
    );

    const restoring = initializeSession();

    // Synchronous: a valid stored session is usable before the server answers.
    expect(getAuthState()).toEqual({
      status: "authenticated",
      session: expect.objectContaining({ userId: testUserID }),
    });
    expect(getAccessToken()).toBe("access-token-1");

    await restoring;

    const request = requestOf(spy);
    expect(request.method).toBe("GET");
    expect(request.path).toBe("/api/v1/auth/session");
    expect(request.headers.get("Authorization")).toBe("Bearer access-token-1");
    // The verified view replaces the cached one.
    expect(getAuthState()).toEqual({
      status: "authenticated",
      session: { userId: testUserID, role: "admin", onboarded: true },
    });
  });

  it("restores a session stored under the pre-rename key and moves it forward", async () => {
    window.localStorage.setItem("onemore.auth.session.v1", JSON.stringify(storedPayload()));
    mockFetch(() => jsonResponse({ userId: testUserID, role: "user", onboarded: true }));

    const restoring = initializeSession();
    // Read synchronously from the legacy key: the rebrand signs nobody out.
    expect(getAccessToken()).toBe("access-token-1");

    await restoring;

    expect(getAuthState().status).toBe("authenticated");
    // Moved to the current key, so the fallback runs once per visitor.
    expect(window.localStorage.getItem("onemore.auth.session.v1")).toBeNull();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
  });

  it("rotates an expired stored pair before restoring the session", async () => {
    storeSession(storedPayload({ expiresAt: new Date(Date.now() - 60_000).toISOString() }));
    const spy = mockFetch(() =>
      jsonResponse(
        sessionPayload({
          tokens: {
            accessToken: "access-token-2",
            refreshToken: "refresh-token-2",
            tokenType: "bearer",
            expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
          },
        }),
      ),
    );

    const restoring = initializeSession();
    // Nothing is claimed while the refresh token's answer is outstanding.
    expect(getAuthState()).toEqual({ status: "restoring" });

    await restoring;

    const request = requestOf(spy);
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/api/v1/auth/refresh");
    expect(request.body).toEqual({ refreshToken: "refresh-token-1" });
    expect(getAccessToken()).toBe("access-token-2");
    expect(getAuthState().status).toBe("authenticated");
    // The rotated pair is what the next reload will read.
    const stored = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) ?? "null") as {
      tokens: { accessToken: string };
    };
    expect(stored.tokens.accessToken).toBe("access-token-2");
  });

  it("clears a stored session the server definitively refuses", async () => {
    storeSession(storedPayload());
    const spy = mockFetch(() =>
      errorResponse(401, "unauthorized", "Your session is no longer valid."),
    );

    await initializeSession();

    expect(requestOf(spy).path).toBe("/api/v1/auth/session");
    // The refused access token is retried through the refresh token; a refused
    // refresh token is a definitive end of the session.
    expect(requestOf(spy, 1).path).toBe("/api/v1/auth/refresh");
    expect(getAuthState()).toEqual({ status: "anonymous" });
    expect(getAccessToken()).toBeUndefined();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("keeps the stored pair but stays anonymous when the server cannot answer", async () => {
    storeSession(storedPayload());
    mockFetch(() =>
      errorResponse(503, "service_unavailable", "Authentication is not available right now."),
    );

    await initializeSession();

    // The server could not confirm; claiming a session would be a lie, but the
    // pair may still be valid, so a later boot can try again.
    expect(getAuthState()).toEqual({ status: "anonymous" });
    expect(getAccessToken()).toBeUndefined();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
  });

  it("drops a malformed entry without asking the server", async () => {
    const spy = mockFetch(() => jsonResponse({}));

    window.localStorage.setItem(SESSION_STORAGE_KEY, "{not json");
    await initializeSession();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();

    // The right shape with the wrong version is still not this app's session.
    storeSession({ ...storedPayload(), version: 99 });
    await initializeSession();

    expect(spy).not.toHaveBeenCalled();
    expect(getAuthState()).toEqual({ status: "anonymous" });
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("stays anonymous without a request when nothing is stored", async () => {
    const spy = mockFetch(() => jsonResponse({}));

    await initializeSession();

    expect(spy).not.toHaveBeenCalled();
    expect(getAuthState()).toEqual({ status: "anonymous" });
  });

  it("does not let a refused restore overwrite a sign-in that landed while it was in flight", async () => {
    storeSession(storedPayload({ expiresAt: new Date(Date.now() - 60_000).toISOString() }));
    let refuseRefresh: ((response: Response) => void) | undefined;
    const spy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/auth/refresh")) {
        return new Promise<Response>((resolve) => {
          refuseRefresh = resolve;
        });
      }
      return jsonResponse(sessionPayload());
    });
    vi.stubGlobal("fetch", spy);

    const restoring = initializeSession();
    await signIn("player@example.com", "correct-horse");
    expect(getAuthState().status).toBe("authenticated");

    // The stale restore's refresh comes back refused *after* the fresh sign-in.
    refuseRefresh?.(errorResponse(401, "unauthorized", "Session expired."));
    await restoring;

    expect(getAccessToken()).toBe("access-token-1");
    expect(getAuthState()).toEqual({
      status: "authenticated",
      session: expect.objectContaining({ userId: testUserID }),
    });
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
  });
});

describe("proactive refresh", () => {
  it("rotates the pair before the access token expires", async () => {
    vi.useFakeTimers();
    try {
      const spy = mockFetch((url) =>
        url.endsWith("/auth/refresh")
          ? jsonResponse(
              sessionPayload({
                tokens: {
                  accessToken: "access-token-2",
                  refreshToken: "refresh-token-2",
                  tokenType: "bearer",
                  expiresIn: 3600,
                },
              }),
            )
          : jsonResponse(
              sessionPayload({
                tokens: {
                  accessToken: "access-token-1",
                  refreshToken: "refresh-token-1",
                  tokenType: "bearer",
                  expiresIn: 120,
                },
              }),
            ),
      );

      await signIn("player@example.com", "correct-horse");
      expect(getAccessToken()).toBe("access-token-1");

      // Nothing happens before the refresh point: 120s lifetime minus the 60s
      // skew leaves a 60s delay.
      await vi.advanceTimersByTimeAsync(59_000);
      expect(spy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(requestOf(spy, 1).path).toBe("/api/v1/auth/refresh");
      expect(requestOf(spy, 1).body).toEqual({ refreshToken: "refresh-token-1" });
      expect(getAccessToken()).toBe("access-token-2");
    } finally {
      clearSession();
      vi.useRealTimers();
    }
  });
});

describe("useAuth", () => {
  function Probe() {
    const auth = useAuth();
    return <span>{auth.status === "authenticated" ? auth.session.userId : "signed out"}</span>;
  }

  it("re-renders the tree when a session arrives and when it ends", async () => {
    mockFetch((url) =>
      url.endsWith("/auth/sign-out")
        ? new Response(null, { status: 204 })
        : jsonResponse(sessionPayload()),
    );

    render(<Probe />);
    expect(screen.getByText("signed out")).toBeInTheDocument();

    await act(async () => {
      await signIn("player@example.com", "correct-horse");
    });
    expect(screen.getByText(testUserID)).toBeInTheDocument();

    await act(async () => {
      await signOut();
    });
    expect(screen.getByText("signed out")).toBeInTheDocument();
  });
});
