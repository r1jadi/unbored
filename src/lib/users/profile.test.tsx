import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import {
  SESSION_STORAGE_KEY,
  clearSession,
  getAccessToken,
  getAuthState,
  signIn,
  signOut,
} from "@/lib/auth/session";
import {
  avatarUrl,
  changeAvatar,
  clearProfile,
  getProfileState,
  loadProfile,
  updateProfile,
  useProfile,
  type Profile,
} from "@/lib/users/profile";

const testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";

/** The shape `POST /auth/sign-in` answers with, per the contract. */
function sessionPayload(userId = testUserID) {
  return {
    session: {
      userId,
      role: "user",
      email: "player@example.com",
      expiresAt: "2026-10-08T12:00:00.000Z",
    },
    tokens: {
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
      tokenType: "bearer",
      expiresIn: 3600,
    },
    user: {
      id: userId,
      email: "player@example.com",
      emailConfirmed: true,
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  };
}

/** The shape `POST /auth/refresh` answers with: the same view, a new pair. */
function refreshedSessionPayload() {
  return {
    ...sessionPayload(),
    tokens: {
      accessToken: "access-token-2",
      refreshToken: "refresh-token-2",
      tokenType: "bearer",
      expiresIn: 3600,
    },
  };
}

/** The shape `GET /users/me` answers with, per the contract. */
function profilePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: testUserID,
    username: "player_one",
    displayName: "Player One",
    bio: "Puzzles in the morning.",
    role: "user",
    onboardedAt: "2026-10-02T08:00:00.000Z",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-08T09:30:00.000Z",
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
  const raw = init?.body;
  return {
    url: String(input),
    path: new URL(String(input)).pathname,
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers),
    // JSON bodies are parsed; an uploaded file is kept as it was sent.
    body: typeof raw === "string" ? JSON.parse(raw) : raw,
  };
}

/** Signs in through the real endpoint, so the profile reads carry a real token. */
async function signInAs(userId = testUserID) {
  await signIn("player@example.com", "correct-horse");
  return userId;
}

/** A signed-in caller whose profile reads answer with `payload`. */
function signedInWith(payload: unknown = profilePayload(), status = 200) {
  return mockFetch((url) =>
    url.endsWith("/auth/sign-in") ? jsonResponse(sessionPayload()) : jsonResponse(payload, status),
  );
}

beforeEach(() => {
  clearSession();
  clearProfile();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadProfile", () => {
  it("reads the caller's own profile with the session token and no user id", async () => {
    const spy = signedInWith();
    await signInAs();

    const state = await loadProfile();

    const request = requestOf(spy, 1);
    expect(request.method).toBe("GET");
    expect(request.path).toBe("/api/v1/users/me");
    expect(request.headers.get("Authorization")).toBe("Bearer access-token-1");
    // The row is resolved from the token: nothing identifies the user in the
    // request, so it cannot be aimed at somebody else's profile.
    expect(request.body).toBeUndefined();
    expect(request.url).not.toContain(testUserID);

    expect(state.status).toBe("ready");
    expect(state).toEqual({
      status: "ready",
      profile: expect.objectContaining({ username: "player_one", displayName: "Player One" }),
    });
    expect(getProfileState().status).toBe("ready");
  });

  it("makes no request while signed out", async () => {
    const spy = mockFetch(() => jsonResponse({}));

    await expect(loadProfile()).resolves.toEqual({ status: "anonymous" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("treats a refused token with a refused refresh as signed out and forgets the dead session", async () => {
    mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : errorResponse(401, "unauthorized", "Your session is no longer valid. Sign in again."),
    );
    await signInAs();

    const state = await loadProfile();

    expect(state).toEqual({ status: "anonymous" });
    // The read was refused and the rotation that followed was refused too: the
    // credential is dead, and keeping it would only fail every later call the
    // same way.
    expect(getAuthState()).toEqual({ status: "anonymous" });
    expect(getAccessToken()).toBeUndefined();
  });

  it("rotates a lapsed access token instead of signing the visitor out", async () => {
    // The profile read is refused because the access token lapsed; the refresh
    // token is still valid, so the read is retried with the rotated credential
    // and the session survives — the logout this path used to perform on any
    // 401.
    let reads = 0;
    const spy = mockFetch((url) => {
      if (url.endsWith("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (url.endsWith("/auth/refresh")) return jsonResponse(refreshedSessionPayload());
      reads += 1;
      return reads === 1
        ? errorResponse(401, "unauthorized", "Your session is no longer valid. Sign in again.")
        : jsonResponse(profilePayload());
    });
    await signInAs();

    const state = await loadProfile();

    expect(state.status).toBe("ready");
    expect(getAuthState().status).toBe("authenticated");
    expect(getAccessToken()).toBe("access-token-2");
    // The retry carried the rotated token, not the one that was refused.
    expect(requestOf(spy, 3).headers.get("Authorization")).toBe("Bearer access-token-2");
  });

  it("keeps the session and reports a retryable error when the refresh cannot be answered", async () => {
    mockFetch((url) => {
      if (url.endsWith("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (url.endsWith("/auth/refresh")) {
        return errorResponse(
          503,
          "service_unavailable",
          "Authentication is not available right now.",
        );
      }
      return errorResponse(401, "unauthorized", "Your session is no longer valid. Sign in again.");
    });
    await signInAs();

    const state = await loadProfile();

    // A server that could not answer decided nothing: the session stays and
    // the screen offers a retry instead of claiming the visitor is signed out.
    expect(state.status).toBe("error");
    expect(getAuthState().status).toBe("authenticated");
    expect(getAccessToken()).toBe("access-token-1");
  });

  it("reports an account with no profile row separately from a failure", async () => {
    mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : errorResponse(404, "not_found", "This account has no profile yet."),
    );
    await signInAs();

    await expect(loadProfile()).resolves.toEqual({ status: "missing" });
  });

  it("keeps a server failure as an error, with the API's own message", async () => {
    mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : errorResponse(503, "service_unavailable", "Profiles are not available right now."),
    );
    await signInAs();

    const state = await loadProfile();

    expect(state.status).toBe("error");
    expect(state.status === "error" && state.error.message).toBe(
      "Profiles are not available right now.",
    );
  });

  it("shares one request between concurrent readers", async () => {
    const spy = signedInWith();
    await signInAs();

    await Promise.all([loadProfile(), loadProfile(), loadProfile()]);

    // One sign-in plus one profile read, however many screens asked.
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("never writes the profile to web storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    signedInWith();
    await signInAs();

    await loadProfile();

    // Signing in persists the session under auth's own key; the profile itself
    // is never written anywhere, and no other key appears.
    expect(setItem.mock.calls.every(([key]) => key === SESSION_STORAGE_KEY)).toBe(true);
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).not.toContain("player_one");
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe("updateProfile", () => {
  it("writes only the named fields, against the version it read", async () => {
    const spy = mockFetch((url, init) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : jsonResponse(profilePayload({ displayName: "Player Two", bio: null }), 200),
    );
    await signInAs();
    const loaded = await loadProfile();
    if (loaded.status !== "ready") throw new Error("expected a loaded profile");

    const updated = await updateProfile({
      displayName: "Player Two",
      bio: null,
      expectedUpdatedAt: loaded.profile.updatedAt,
    });

    const request = requestOf(spy, 2);
    expect(request.method).toBe("PATCH");
    expect(request.path).toBe("/api/v1/users/me");
    expect(request.headers.get("Authorization")).toBe("Bearer access-token-1");
    // Exactly the documented fields: the endpoint rejects unknown ones, and
    // `role` is not the caller's to write.
    expect(request.body).toEqual({
      displayName: "Player Two",
      bio: null,
      expectedUpdatedAt: "2026-10-08T09:30:00.000Z",
    });
    expect(updated.displayName).toBe("Player Two");
    // The row the database returned is what is on screen, including its new
    // version, which the next edit has to use.
    expect(getProfileState()).toEqual({ status: "ready", profile: updated });
  });

  it("writes a rename and adopts it without signing out", async () => {
    const spy = mockFetch((url, init) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : url.endsWith("/users/me") && init?.method === "PATCH"
          ? jsonResponse(profilePayload({ username: "player_two" }), 200)
          : jsonResponse(profilePayload()),
    );
    await signInAs();
    const loaded = await loadProfile();
    if (loaded.status !== "ready") throw new Error("expected a loaded profile");

    const updated = await updateProfile({
      username: "player_two",
      expectedUpdatedAt: loaded.profile.updatedAt,
    });

    const request = requestOf(spy, 2);
    expect(request.method).toBe("PATCH");
    expect(request.path).toBe("/api/v1/users/me");
    // The rename names no account: the row comes from the token, so there is
    // no user id in the body to manipulate.
    expect(request.body).toEqual({
      username: "player_two",
      expectedUpdatedAt: "2026-10-08T09:30:00.000Z",
    });
    expect(updated.username).toBe("player_two");
    // The store holds the renamed row: every surface reading the profile shows
    // the new name with no further request and no new session.
    expect(getProfileState()).toEqual({ status: "ready", profile: updated });
  });

  it("surfaces a conflict without changing what is on screen", async () => {
    mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : url.endsWith("/users/me")
          ? errorResponse(
              409,
              "conflict",
              "This profile changed since you loaded it. Reload and try again.",
            )
          : jsonResponse(profilePayload()),
    );
    await signInAs();
    await loadProfile();

    const failure = await updateProfile({ displayName: "Player Two" }).catch((error) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.status).toBe(409);
    expect(failure.message).toBe("This profile changed since you loaded it. Reload and try again.");
  });

  it("refuses to write while signed out", async () => {
    const spy = mockFetch(() => jsonResponse({}));

    await expect(updateProfile({ displayName: "Player Two" })).rejects.toBeInstanceOf(ApiError);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("changeAvatar", () => {
  function pngFile(bytes = 2048) {
    return new File([new Uint8Array(bytes)], "photo.png", { type: "image/png" });
  }

  function avatarSpy(profileResponse: () => Response) {
    return mockFetch((url, init) => {
      if (url.endsWith("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (init?.method === "POST") return jsonResponse({ Key: "avatars/object" });
      return profileResponse();
    });
  }

  it("refuses a file type the bucket does not accept, before sending anything", async () => {
    const spy = avatarSpy(() => jsonResponse(profilePayload()));
    await signInAs();
    await loadProfile();
    const before = spy.mock.calls.length;

    const failure = await changeAvatar(new File(["x"], "cat.gif", { type: "image/gif" })).catch(
      (e) => e,
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.message).toMatch(/png, jpeg or webp/i);
    expect(spy.mock.calls.length).toBe(before);
  });

  it("refuses an image larger than the bucket allows, before sending anything", async () => {
    const spy = avatarSpy(() => jsonResponse(profilePayload()));
    await signInAs();
    await loadProfile();
    const before = spy.mock.calls.length;

    const failure = await changeAvatar(pngFile(2 * 1024 * 1024 + 1)).catch((e) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.message).toMatch(/2 MB/);
    expect(spy.mock.calls.length).toBe(before);
  });

  it("holds the picture privately, then asks the service to screen and publish it", async () => {
    const spy = mockFetch((url, init) => {
      if (url.endsWith("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (url.includes("/storage/v1/object/"))
        return jsonResponse({ Key: "avatar-uploads/object" });
      if (url.endsWith("/users/me/avatar")) {
        // Answer the way the service does: with the profile now pointing at it.
        const sent = JSON.parse(String(init?.body)) as { uploadPath: string };
        return jsonResponse(profilePayload({ avatarPath: sent.uploadPath }));
      }
      return jsonResponse(profilePayload());
    });
    await signInAs();
    await loadProfile();

    await changeAvatar(pngFile());

    const upload = requestOf(spy, 2);
    expect(upload.method).toBe("POST");
    // Into the private holding bucket, under the caller's own folder: nobody else
    // can see it before it is screened.
    expect(upload.url).toContain(`/storage/v1/object/avatar-uploads/${testUserID}/`);
    expect(upload.headers.get("Authorization")).toBe("Bearer access-token-1");
    expect(upload.headers.get("Content-Type")).toBe("image/png");

    const objectPath = decodeURIComponent(upload.url.split("/avatar-uploads/")[1]!);
    expect(objectPath).toMatch(/^[0-9a-f-]{36}\/[a-z0-9._-]{1,120}$/);

    const screen = requestOf(spy, 3);
    expect(screen.method).toBe("POST");
    expect(screen.url).toMatch(/\/users\/me\/avatar$/);
    expect(screen.body).toEqual({ uploadPath: objectPath });
    expect((getProfileState() as { profile: Profile }).profile.avatarPath).toBe(objectPath);
    // The profile is never patched to a path directly any more.
    expect(spy.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
  });

  it("shows the service's answer when a picture is refused", async () => {
    mockFetch((url) => {
      if (url.endsWith("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (url.includes("/storage/v1/object/"))
        return jsonResponse({ Key: "avatar-uploads/object" });
      if (url.endsWith("/users/me/avatar")) {
        return jsonResponse(
          {
            error: {
              code: "unprocessable",
              message: "That picture isn't allowed. Choose a different one.",
              details: [{ field: "uploadPath", rule: "objectionable" }],
            },
          },
          422,
        );
      }
      return jsonResponse(profilePayload());
    });
    await signInAs();
    await loadProfile();

    const failure = await changeAvatar(pngFile()).catch((e) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).message).toBe(
      "That picture isn't allowed. Choose a different one.",
    );
    expect((getProfileState() as { profile: Profile }).profile.avatarPath).toBeFalsy();
  });

  it("surfaces a failed upload and leaves the profile alone", async () => {
    const spy = avatarSpy(() => jsonResponse(profilePayload()));
    await signInAs();
    await loadProfile();
    // The upload is refused, so the profile must never be pointed at an object
    // that does not exist.
    spy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (init?.method === "POST") return new Response("denied", { status: 403 });
      return jsonResponse(profilePayload());
    });

    const failure = await changeAvatar(pngFile()).catch((e) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(403);
    expect(spy.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
    expect(spy.mock.calls.filter(([url]) => String(url).endsWith("/users/me/avatar"))).toHaveLength(
      0,
    );
  });
});

describe("avatarUrl", () => {
  it("builds the public object URL for a stored path", () => {
    const profile = { avatarPath: `${testUserID}/photo.png` } as Profile;
    expect(avatarUrl(profile)).toBe(
      "https://project.supabase.co/storage/v1/object/public/avatars/" + `${testUserID}/photo.png`,
    );
  });

  it("is absent when the profile has no picture", () => {
    expect(avatarUrl({ id: testUserID } as Profile)).toBeUndefined();
    expect(avatarUrl(undefined)).toBeUndefined();
  });
});

describe("account changes", () => {
  it("drops the cached profile when the session ends", async () => {
    const spy = mockFetch((url) =>
      url.endsWith("/auth/sign-out")
        ? new Response(null, { status: 204 })
        : jsonResponse(sessionPayload()),
    );
    await signInAs();
    mockFetch((url) =>
      url.endsWith("/auth/sign-out")
        ? new Response(null, { status: 204 })
        : jsonResponse(profilePayload()),
    );
    await loadProfile();
    expect(getProfileState().status).toBe("ready");

    await signOut();

    // A signed-out screen must not keep showing the profile it just read.
    expect(getProfileState()).toEqual({ status: "anonymous" });
    expect(spy).toHaveBeenCalled();
  });

  it("reads the new account's profile after a switch", async () => {
    const otherUserID = "b7d1c0aa-1111-4222-8333-444455556666";
    mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload(otherUserID))
        : jsonResponse(sessionPayload(otherUserID)),
    );
    await signInAs(otherUserID);
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      return jsonResponse(
        profilePayload({ id: otherUserID, username: "player_two", displayName: "Player Two" }),
      );
    });

    const state = await loadProfile();

    expect(calls).toBe(1);
    expect(state).toEqual({
      status: "ready",
      profile: expect.objectContaining({ username: "player_two" }),
    });
  });
});

describe("useProfile", () => {
  function Probe() {
    const state = useProfile();
    if (state.status === "ready") return <span>{state.profile.displayName}</span>;
    return <span>{state.status}</span>;
  }

  it("loads the profile when a screen mounts and renders the real identity", async () => {
    signedInWith();
    await signInAs();

    render(<Probe />);
    expect(screen.getByText("loading")).toBeInTheDocument();

    await act(async () => {
      await loadProfile();
    });
    expect(screen.getByText("Player One")).toBeInTheDocument();
    // The prototype identity is gone: nothing here can render `rijad`.
    expect(screen.queryByText("rijad")).toBeNull();
  });

  it("stays anonymous and silent while signed out", () => {
    const spy = mockFetch(() => jsonResponse({}));

    render(<Probe />);

    expect(screen.getByText("anonymous")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("starts signed out on a page load that has no session", async () => {
    // A reload is a new page: the store must not begin in a state that waits for
    // a read it will never ask for. Re-importing is how a fresh load is modelled.
    vi.resetModules();
    const fresh = await import("@/lib/users/profile");

    expect(fresh.getProfileState()).toEqual({ status: "anonymous" });
  });
});
