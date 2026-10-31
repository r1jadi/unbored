import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileForm } from "@/components/settings/ProfileForm";
import { clearSession, signIn } from "@/lib/auth/session";
import { clearProfile } from "@/lib/users/profile";

const testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";

/**
 * The editor is mounted inside a router because its signed-out and error states
 * link to other screens. A minimal two-route tree gives `Link` a real context
 * without dragging the application shell into the test.
 */
async function renderForm() {
  const root = createRootRoute();
  const index = createRoute({ getParentRoute: () => root, path: "/", component: ProfileForm });
  const login = createRoute({
    getParentRoute: () => root,
    path: "/login",
    component: () => <p>Log in</p>,
  });
  const section = createRoute({
    getParentRoute: () => root,
    path: "/settings/$section",
    component: () => <p>Settings section</p>,
  });

  const profile = createRoute({
    getParentRoute: () => root,
    path: "/profile",
    component: () => <p>Your profile</p>,
  });

  const router = createRouter({
    routeTree: root.addChildren([index, login, section, profile]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  render(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
  });
}

function profilePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: testUserID,
    username: "player_one",
    displayName: "Player One",
    bio: "Puzzles in the morning.",
    role: "user",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-08T09:30:00.000Z",
    ...overrides,
  };
}

function sessionPayload() {
  return {
    session: { userId: testUserID, role: "user", email: "player@example.com" },
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code: string, message: string, details?: unknown[]) {
  return jsonResponse({ error: { code, message, request_id: "req-abc123", details } }, status);
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function patchRequests(spy: ReturnType<typeof mockFetch>) {
  return spy.mock.calls.filter(([, init]) => init?.method === "PATCH");
}

async function signInAs() {
  await act(async () => {
    await signIn("player@example.com", "correct-horse");
  });
}

beforeEach(() => {
  clearSession();
  clearProfile();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProfileForm", () => {
  it("shows the stored profile and saves an edit through the API", async () => {
    const spy = mockFetch((url, init) => {
      if (url.endsWith("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (init?.method === "PATCH") {
        const sent = JSON.parse(String(init.body)) as { displayName: string; bio: string };
        return jsonResponse(profilePayload({ displayName: sent.displayName, bio: sent.bio }));
      }
      return jsonResponse(profilePayload());
    });
    await signInAs();
    await renderForm();

    const name = (await screen.findByLabelText("Display name")) as HTMLInputElement;
    // The identity shown is the account's own row, not the prototype user.
    expect(name.value).toBe("Player One");
    expect((screen.getByLabelText("Bio") as HTMLTextAreaElement).value).toBe(
      "Puzzles in the morning.",
    );
    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("player_one");
    expect((screen.getByLabelText("Username") as HTMLInputElement).readOnly).toBe(false);
    expect(
      screen.getByText("3–24 characters: lowercase letters, numbers, underscores."),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Rijad Halili")).toBeNull();
    expect(screen.queryByDisplayValue("rijad")).toBeNull();

    fireEvent.change(name, { target: { value: "  Player Two  " } });
    await act(async () => {
      fireEvent.submit(name.closest("form")!);
    });

    const [request] = patchRequests(spy);
    expect(request).toBeDefined();
    const [url, init] = request!;
    expect(new URL(String(url)).pathname).toBe("/api/v1/users/me");
    expect(JSON.parse(String(init!.body))).toEqual({
      displayName: "Player Two",
      bio: "Puzzles in the morning.",
      // The version the form was loaded against, so a concurrent edit is caught
      // instead of overwritten.
      expectedUpdatedAt: "2026-10-08T09:30:00.000Z",
    });
    // An unchanged username is not sent: the row's updatedAt is the concurrency
    // control, and a no-op write would still move it. No user id travels either.
    expect(JSON.parse(String(init!.body))).not.toHaveProperty("username");
    expect(JSON.parse(String(init!.body))).not.toHaveProperty("userId");
    expect(JSON.parse(String(init!.body))).not.toHaveProperty("id");

    // The form shows what was stored, trimmed the way the API stores it.
    await waitFor(() =>
      expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe("Player Two"),
    );
  });

  it("renames the account and shows the stored name without signing out", async () => {
    const spy = mockFetch((url, init) => {
      if (url.endsWith("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (init?.method === "PATCH") {
        const sent = JSON.parse(String(init.body)) as { username: string };
        return jsonResponse(profilePayload({ username: sent.username }));
      }
      return jsonResponse(profilePayload());
    });
    await signInAs();
    await renderForm();

    const username = (await screen.findByLabelText("Username")) as HTMLInputElement;
    fireEvent.change(username, { target: { value: "player_two" } });
    await act(async () => {
      fireEvent.submit(username.closest("form")!);
    });

    const [request] = patchRequests(spy);
    expect(request).toBeDefined();
    const body = JSON.parse(String(request![1]!.body));
    expect(body.username).toBe("player_two");
    // The rename names no account: the row comes from the token.
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("id");

    // The form shows what was stored, with no further request and no new session.
    await waitFor(() =>
      expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("player_two"),
    );
  });

  it("refuses a bad username without calling the API", async () => {
    const spy = mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : jsonResponse(profilePayload()),
    );
    await signInAs();
    await renderForm();

    const username = (await screen.findByLabelText("Username")) as HTMLInputElement;
    for (const [value, message] of [
      ["   ", "Add a username."],
      ["ab", "Use 3–24 characters for your username."],
      ["Rijad", "Use only lowercase letters, numbers and underscores."],
      ["rija d", "Use only lowercase letters, numbers and underscores."],
    ] as const) {
      fireEvent.change(username, { target: { value } });
      await act(async () => {
        fireEvent.submit(username.closest("form")!);
      });
      expect(await screen.findByText(message)).toBeInTheDocument();
    }
    expect(patchRequests(spy)).toHaveLength(0);
  });

  it("shows a taken username under the field and keeps the draft", async () => {
    let reads = 0;
    const spy = mockFetch((url, init) => {
      if (url.endsWith("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (init?.method === "PATCH") {
        return errorResponse(409, "conflict", "That username is taken.", [
          { field: "username", rule: "taken" },
        ]);
      }
      reads += 1;
      return jsonResponse(profilePayload());
    });
    await signInAs();
    await renderForm();
    const readsAfterLoad = reads;

    const username = (await screen.findByLabelText("Username")) as HTMLInputElement;
    fireEvent.change(username, { target: { value: "taken_name" } });
    await act(async () => {
      fireEvent.submit(username.closest("form")!);
    });

    expect(await screen.findByText("That username is taken.")).toBeInTheDocument();
    // A taken name is not a concurrent edit: the draft stays so it can be
    // fixed, and the profile is not re-read from underneath it.
    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("taken_name");
    expect(reads).toBe(readsAfterLoad);
    expect(patchRequests(spy)).toHaveLength(1);
  });

  it("keeps the user's draft and shows the API's message under the field it names", async () => {
    const spy = mockFetch((url, init) => {
      if (url.endsWith("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (init?.method === "PATCH") {
        return errorResponse(
          422,
          "unprocessable_entity",
          "Use at most 60 characters for your display name.",
          [{ field: "displayName", rule: "maxLength" }],
        );
      }
      return jsonResponse(profilePayload());
    });
    await signInAs();
    await renderForm();

    const name = (await screen.findByLabelText("Display name")) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "A name that is far too long" } });
    await act(async () => {
      fireEvent.submit(name.closest("form")!);
    });

    expect(patchRequests(spy)).toHaveLength(1);
    expect(
      await screen.findByText("Use at most 60 characters for your display name."),
    ).toBeInTheDocument();
    // An edit in progress is never thrown away because the server refused it.
    expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe(
      "A name that is far too long",
    );
  });

  it("reports a conflict and re-reads the stored profile", async () => {
    let stored = profilePayload();
    const spy = mockFetch((url, init) => {
      if (url.endsWith("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (init?.method === "PATCH") {
        // Someone else's edit landed first: the row moved on.
        stored = profilePayload({ displayName: "Someone Else" });
        return errorResponse(
          409,
          "conflict",
          "This profile changed since you loaded it. Reload and try again.",
        );
      }
      return jsonResponse(stored);
    });
    await signInAs();
    await renderForm();

    const name = (await screen.findByLabelText("Display name")) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Player Two" } });
    await act(async () => {
      fireEvent.submit(name.closest("form")!);
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This profile changed since you loaded it. Reload and try again.",
    );
    // Nothing was overwritten, and what is on screen is what the database holds.
    await waitFor(() =>
      expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe(
        "Someone Else",
      ),
    );
  });

  it("refuses an empty display name without calling the API", async () => {
    const spy = mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : jsonResponse(profilePayload()),
    );
    await signInAs();
    await renderForm();

    const name = (await screen.findByLabelText("Display name")) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "   " } });
    await act(async () => {
      fireEvent.submit(name.closest("form")!);
    });

    expect(await screen.findByText("Add a display name.")).toBeInTheDocument();
    expect(patchRequests(spy)).toHaveLength(0);
  });

  it("uploads a chosen photo and stores its path on the profile", async () => {
    const spy = mockFetch((url, init) => {
      if (url.endsWith("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (init?.method === "POST") return jsonResponse({ Key: "avatars/object" });
      if (init?.method === "PATCH") {
        const sent = JSON.parse(String(init.body)) as { avatarPath: string };
        return jsonResponse(profilePayload({ avatarPath: sent.avatarPath }));
      }
      return jsonResponse(profilePayload());
    });
    await signInAs();
    await renderForm();

    const input = (await screen.findByLabelText("Choose a profile picture")) as HTMLInputElement;
    const photo = new File([new Uint8Array(1024)], "me.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [photo] } });
    });

    const [patch] = patchRequests(spy);
    expect(patch).toBeDefined();
    const body = JSON.parse(String(patch![1]!.body)) as { avatarPath: string };
    // The path is inside the caller's own folder, which is what the storage
    // policy and the database's check constraint both require.
    expect(body.avatarPath).toMatch(new RegExp(`^${testUserID}/[0-9a-f-]{36}\\.png$`));
    // Once saved, the player is taken to their profile to see it.
    expect(await screen.findByText("Your profile")).toBeInTheDocument();
  });

  it("asks for a sign-in instead of showing a profile, and calls nothing", async () => {
    const spy = mockFetch(() => jsonResponse({}));

    await renderForm();

    expect(await screen.findByText("Sign in to edit your profile")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("offers a retry when the profile cannot be read", async () => {
    let failReads = true;
    const spy = mockFetch((url, init) => {
      if (url.endsWith("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (url.endsWith("/users/me") && init?.method === "GET") {
        return failReads
          ? errorResponse(503, "service_unavailable", "Profiles are not available right now.")
          : jsonResponse(profilePayload());
      }
      return jsonResponse(profilePayload());
    });
    await signInAs();
    await renderForm();

    expect(await screen.findByText("Couldn't load your profile")).toBeInTheDocument();
    expect(screen.getByText("Profiles are not available right now.")).toBeInTheDocument();

    failReads = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    });

    await waitFor(() => expect(screen.getByLabelText("Display name")).toBeInTheDocument());
    expect(spy.mock.calls.length).toBeGreaterThan(2);
  });
});
