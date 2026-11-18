import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearSession } from "@/lib/auth/session";
import { Route as RootRoute } from "@/routes/__root";
import { routeTree } from "@/routeTree.gen";

// The root's document shell cannot be mounted in a test container; every other
// component under test is the real one (the same narrow removal
// `signup-completion.test.tsx` uses).
delete (RootRoute.options as { shellComponent?: unknown }).shellComponent;

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

/** Fills the three sign-up steps with the credentials a duplicate would use. */
async function fillSignup(email: string, password: string) {
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  fireEvent.change(await screen.findByLabelText("Display name"), {
    target: { value: "Returning Player" },
  });
  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "returning_player" },
  });
  // The username step now waits for a real availability answer.
  await waitFor(() => expect(screen.getByText("Username is available")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  const boxes = await screen.findAllByRole("checkbox");
  fireEvent.click(boxes[0]);
  fireEvent.click(boxes[1]);
  fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "1990-05-17" } });
  fireEvent.click(screen.getByRole("button", { name: "Agree and create account" }));
}

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("registering an email that already has an account", () => {
  it("shows the sign-in message and offers the sign-in route", async () => {
    const spy = mockFetch((url) => {
      if (url.includes("/api/v1/auth/username-available")) {
        return jsonResponse({ username: "returning_player", available: true });
      }
      return jsonResponse(
        {
          error: {
            code: "conflict",
            message: "An account with this email already exists. Please sign in instead.",
          },
        },
        409,
      );
    });

    await renderApp("/signup");
    await fillSignup("taken@example.com", "correct-horse");

    expect(
      await screen.findByText("An account with this email already exists. Please sign in instead."),
    ).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "Sign in instead" });
    expect(link.getAttribute("href")).toContain("/login");
    expect(link.getAttribute("href")).toContain("taken%40example.com");

    // One attempt, and no profile write: nothing was registered twice.
    const signUps = spy.mock.calls.filter(([input]) =>
      String(input).includes("/api/v1/auth/sign-up"),
    );
    expect(signUps).toHaveLength(1);
    expect(
      spy.mock.calls.filter(([input]) => String(input).includes("/rest/v1/profiles")),
    ).toHaveLength(0);
  });
});
