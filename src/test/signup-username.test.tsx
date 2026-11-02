import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearSession, signIn } from "@/lib/auth/session";
import { clearProfile } from "@/lib/users/profile";
import { Route as RootRoute } from "@/routes/__root";
import { routeTree } from "@/routeTree.gen";

// The root's document shell cannot be mounted in a test container; every other
// component (the sign-up screen included) is the real one.
delete (RootRoute.options as { shellComponent?: unknown }).shellComponent;

const testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";
const supabaseBase = "https://project.supabase.co";
const marker = "2026-10-17T12:00:00.000Z";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sessionPayload(onboarded: boolean) {
  return {
    session: {
      userId: testUserID,
      role: "user",
      email: "player@example.com",
      onboarded,
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

function profilePayload(username: string) {
  return {
    id: testUserID,
    username,
    displayName: "New Player",
    bio: null,
    role: "user",
    onboardedAt: marker,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: marker,
  };
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

async function renderApp(at: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [at] }),
  });
  render(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
  });
  return router;
}

async function enterCredentials(email = "player@example.com", password = "correct-horse") {
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

async function enterName(displayName: string, username: string) {
  fireEvent.change(await screen.findByLabelText("Display name"), {
    target: { value: displayName },
  });
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: username } });
}

async function acceptTerms() {
  const boxes = await screen.findAllByRole("checkbox");
  fireEvent.click(boxes[0]);
  fireEvent.click(boxes[1]);
}

beforeEach(() => {
  clearSession();
  clearProfile();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("choosing a username during sign-up", () => {
  it("validates as the user types and sends the chosen username on sign-up", async () => {
    const spy = mockFetch((url, init) => {
      const method = init?.method ?? "GET";
      if (url.includes("/api/v1/auth/username-available")) {
        const username = new URL(url).searchParams.get("username");
        return jsonResponse({ username, available: true });
      }
      if (url.includes("/api/v1/auth/sign-up")) return jsonResponse(sessionPayload(false), 201);
      if (url.includes("/api/v1/users/me")) return jsonResponse(profilePayload("rijad"));
      if (url.endsWith("/api/v1/auth/session")) return jsonResponse(sessionPayload(true).session);
      if (url.startsWith(supabaseBase)) {
        return jsonResponse(method === "PATCH" ? [{ onboarded_at: marker }] : []);
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    });

    const router = await renderApp("/signup");
    await enterCredentials();
    await enterName("Rijad", "Rijad");

    const input = screen.getByLabelText("Username") as HTMLInputElement;
    // Normalization is visible: the field shows exactly what will be stored.
    expect(input.value).toBe("rijad");

    expect(await screen.findByText("Username is available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await acceptTerms();
    fireEvent.click(screen.getByRole("button", { name: "Agree and create account" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/account-created"));

    const signUp = spy.mock.calls.find(([url]) => String(url).includes("/api/v1/auth/sign-up"));
    expect(signUp).toBeDefined();
    expect(JSON.parse(String(signUp?.[1]?.body))).toMatchObject({
      email: "player@example.com",
      username: "rijad",
    });

    // The username was not written a second time after registration: the
    // trigger created the profile with it, and completion only names the row.
    const profileWrites = spy.mock.calls.filter(
      ([url, init]) =>
        String(url).includes("/api/v1/users/me") && (init?.method ?? "GET") === "PATCH",
    );
    expect(profileWrites).toHaveLength(1);
    expect(JSON.parse(String(profileWrites[0][1]?.body))).toEqual({ displayName: "Rijad" });
  });

  it("blocks continuing while the username is taken", async () => {
    mockFetch((url) => {
      if (url.includes("/api/v1/auth/username-available")) {
        return jsonResponse({ username: "taken_name", available: false });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await renderApp("/signup");
    await enterCredentials();
    await enterName("Rijad", "taken_name");

    expect(await screen.findByText("Username is already taken")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.queryByText("Before you start")).toBeNull();
  });

  it("shows the exact format rule and never asks about an invalid name", async () => {
    const spy = mockFetch(() => {
      throw new Error("no request should be made for an invalid username");
    });

    await renderApp("/signup");
    await enterCredentials();
    await enterName("Rijad", "bad name");

    expect(
      await screen.findByText("Use only letters, numbers and underscores."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(
      spy.mock.calls.filter(([url]) => String(url).includes("/username-available")),
    ).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ab" } });
    expect(await screen.findByText("Use 3–24 characters for your username.")).toBeInTheDocument();
  });

  it("does not treat a failed availability check as available", async () => {
    mockFetch((url) => {
      if (url.includes("/api/v1/auth/username-available")) {
        return jsonResponse({ error: { code: "internal_error", message: "boom" } }, 500);
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await renderApp("/signup");
    await enterCredentials();
    await enterName("Rijad", "rijad");

    expect(
      await screen.findByText("Couldn't check username availability. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("returns to the name step when the name is claimed before submission", async () => {
    let availabilityChecks = 0;
    const spy = mockFetch((url) => {
      if (url.includes("/api/v1/auth/username-available")) {
        availabilityChecks += 1;
        // Available for the on-screen check, taken by the time the registration
        // request arrives and the server re-reads it.
        return jsonResponse({
          username: "last_second",
          available: availabilityChecks === 1,
        });
      }
      if (url.includes("/api/v1/auth/sign-up")) {
        return jsonResponse(
          {
            error: {
              code: "conflict",
              message: "That username is taken. Choose another.",
              details: [{ field: "username", rule: "taken" }],
            },
          },
          409,
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await renderApp("/signup");
    await enterCredentials();
    await enterName("Rijad", "last_second");
    expect(await screen.findByText("Username is available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await acceptTerms();
    fireEvent.click(screen.getByRole("button", { name: "Agree and create account" }));

    // No account was created; the visitor is back on the name step with the
    // server's explanation, and a fresh check shows the name is gone.
    expect(await screen.findByText("Choose your name")).toBeInTheDocument();
    expect(screen.getByText("That username is taken. Choose another.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(await screen.findByText("Username is already taken")).toBeInTheDocument();

    const signUps = spy.mock.calls.filter(([url]) => String(url).includes("/api/v1/auth/sign-up"));
    expect(signUps).toHaveLength(1);
    expect(JSON.parse(String(signUps[0][1]?.body))).toMatchObject({ username: "last_second" });
  });

  it("offers the saved username as an editable starting value when finishing a confirmed or OAuth sign-up", async () => {
    mockFetch((url, init) => {
      if (url.includes("/api/v1/auth/sign-in")) return jsonResponse(sessionPayload(false));
      if (url.endsWith("/api/v1/users/me")) return jsonResponse(profilePayload("player_one"));
      if (url.endsWith("/api/v1/auth/session")) return jsonResponse(sessionPayload(false).session);
      if (url.startsWith(supabaseBase)) return jsonResponse([]);
      throw new Error(`unexpected fetch ${init?.method ?? "GET"} ${url}`);
    });

    await signIn("player@example.com", "correct-horse");
    await renderApp("/signup");

    expect(await screen.findByText("Choose your name")).toBeInTheDocument();
    const input = (await screen.findByLabelText("Username")) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("player_one"));
    expect(input).toBeEnabled();
    expect(input).not.toHaveAttribute("readonly");
    expect(screen.getByText("This is your current username.")).toBeInTheDocument();
  });

  it("writes a username changed while finishing sign-up together with the display name", async () => {
    const patches: Array<Record<string, unknown>> = [];
    let marked = false;
    mockFetch((url, init) => {
      if (url.includes("/api/v1/auth/username-available")) {
        return jsonResponse({ username: "my_new_name", available: true });
      }
      if (url.includes("/api/v1/auth/sign-in")) return jsonResponse(sessionPayload(false));
      if (url.endsWith("/api/v1/users/me")) {
        if (init?.method === "PATCH") {
          patches.push(JSON.parse(String(init.body)));
          return jsonResponse(profilePayload("my_new_name"));
        }
        return jsonResponse(profilePayload("player_one"));
      }
      if (url.endsWith("/api/v1/auth/session")) {
        return jsonResponse(sessionPayload(marked).session);
      }
      if (url.startsWith(supabaseBase)) {
        // The availability check finds no row; the registration marker is written.
        if (init?.method === "PATCH") {
          marked = true;
          return jsonResponse([{ onboarded_at: marker }]);
        }
        return jsonResponse([]);
      }
      throw new Error(`unexpected fetch ${init?.method ?? "GET"} ${url}`);
    });

    await signIn("player@example.com", "correct-horse");
    await renderApp("/signup");

    await screen.findByText("Choose your name");
    await waitFor(() =>
      expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("player_one"),
    );
    await enterName("New Player", "my_new_name");
    expect(await screen.findByText("Username is available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await acceptTerms();
    fireEvent.click(screen.getByRole("button", { name: "Agree and create account" }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ displayName: "New Player", username: "my_new_name" });
  });
});
