import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearSession, signIn } from "@/lib/auth/session";
import { Route as RootRoute } from "@/routes/__root";
import { routeTree } from "@/routeTree.gen";

// The real root renders the whole document shell (`<html>`/`<head>`/`<body>`),
// which jsdom cannot mount inside a test container. Only that wrapper is
// removed here — the component under test (the registration gate and the
// sign-up screen) is the real one, and vitest isolates this mutation to this
// file's module graph. `shellComponent` is a Start-level option the core route
// options type does not carry, hence the narrow cast.
delete (RootRoute.options as { shellComponent?: unknown }).shellComponent;

const testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";
const supabaseBase = "https://project.supabase.co";
const marker = "2026-10-17T12:00:00.000Z";

/** The shape `POST /auth/sign-in` answers with, per the contract. */
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

/** The shape `PATCH /users/me` answers with, per the contract. */
function profilePayload() {
  return {
    id: testUserID,
    username: "player_one",
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * The backend this flow talks to: the auth service (sign-in and `GET
 * /auth/session`), the users API (the display-name write) and the Supabase
 * Data API row the registration marker lives in — which flips to "registered"
 * the moment the conditional write lands, so the reads after it see the same
 * answer the database would give.
 */
function stubBackend(initialOnboarded = false) {
  let onboarded = initialOnboarded;
  const spy = mockFetch((url, init) => {
    const method = init?.method ?? "GET";
    if (url.includes("/api/v1/auth/sign-in")) {
      return jsonResponse(sessionPayload(onboarded));
    }
    if (url.includes("/api/v1/auth/session")) {
      return jsonResponse({
        userId: testUserID,
        role: "user",
        email: "player@example.com",
        onboarded,
      });
    }
    if (url.includes("/api/v1/users/me")) return jsonResponse(profilePayload());
    if (url.startsWith(supabaseBase)) {
      if (method === "PATCH") onboarded = true;
      return jsonResponse([{ onboarded_at: onboarded ? marker : null }]);
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  return { spy, wasMarked: () => onboarded };
}

/** Renders the real app route tree at `at`, with its real root gate. */
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

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("unfinished sign-up", () => {
  it("routes a signed-in account through completion and records it exactly once", async () => {
    const backend = stubBackend();
    // The state a Google sign-in (or a just-opened confirmation link) lands in:
    // an authenticated session whose account has not finished signing up.
    await signIn("player@example.com", "correct-horse");

    const router = await renderApp("/");

    // The gate: the app is not shown until the registration is finished.
    await waitFor(() => expect(router.state.location.pathname).toBe("/signup"));

    // The completion mode: the credential step is done, so the name and the
    // terms are what remain.
    expect(await screen.findByText("Choose your name")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "New Player" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const boxes = await screen.findAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "1990-05-17" } });
    fireEvent.click(screen.getByRole("button", { name: "Agree and create account" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/account-created"));
    expect(backend.wasMarked()).toBe(true);

    // One conditional write, on the caller's own row, with the caller's own
    // token — the marker cannot be set twice and cannot be set for anyone else.
    const writes = backend.spy.mock.calls.filter(
      ([input, init]) => String(input).includes("/rest/v1/profiles") && init?.method === "PATCH",
    );
    expect(writes).toHaveLength(1);
    const parsed = new URL(String(writes[0][0]));
    expect(parsed.searchParams.get("id")).toBe(`eq.${testUserID}`);
    expect(parsed.searchParams.get("onboarded_at")).toBe("is.null");
    expect(new Headers(writes[0][1]?.headers).get("Authorization")).toBe("Bearer access-token-1");
  });

  it("recognises an account that finished registration instead of registering it again", async () => {
    const backend = stubBackend(true);
    await signIn("player@example.com", "correct-horse");

    const router = await renderApp("/signup");

    // A completed account is not offered a second registration: the screen says
    // so and points at the profile. It never shows the credential step, so a
    // duplicate sign-up cannot be attempted from here.
    expect(await screen.findByText("You're already signed in")).toBeInTheDocument();
    expect(screen.getByText(/Signed in as player@example.com/)).toBeInTheDocument();
    expect(screen.queryByText("Create your account")).toBeNull();
    expect(screen.queryByText("Choose your name")).toBeNull();
    expect(screen.getByRole("link", { name: "Go to your profile" })).toBeInTheDocument();

    // Nothing was registered and nothing was marked: one sign-in, no writes.
    expect(
      backend.spy.mock.calls.filter(([input]) => String(input).includes("/auth/sign-up")),
    ).toHaveLength(0);
    await waitFor(() => expect(router.state.location.pathname).toBe("/signup"));
  });
});
