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

import { ageOn, isAgeBlocked } from "@/lib/age-gate";

async function reachLastStep() {
  fireEvent.change(await screen.findByLabelText("Email"), {
    target: { value: "kid@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(await screen.findByLabelText("Display name"), { target: { value: "Kid" } });
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "kid_player" } });
  await waitFor(() => expect(screen.getByText("Username is available")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  const boxes = await screen.findAllByRole("checkbox");
  fireEvent.click(boxes[0]);
  fireEvent.click(boxes[1]);
}

beforeEach(() => {
  clearSession();
  localStorage.clear();
  document.cookie = "unbored_age_blocked=; Max-Age=0; Path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the sign-up age screen", () => {
  it("counts whole years", () => {
    const today = new Date(2026, 4, 16);
    expect(ageOn("2013-05-17", today)).toBe(12);
    expect(ageOn("2013-05-16", today)).toBe(13);
    expect(ageOn("2013-02-30", today)).toBeUndefined();
    expect(ageOn("2999-01-01", today)).toBeUndefined();
  });

  it("refuses an under-13 answer without sending anything, and remembers it", async () => {
    const spy = mockFetch((url) => {
      if (url.includes("/api/v1/auth/username-available")) {
        return jsonResponse({ username: "kid_player", available: true });
      }
      return jsonResponse({}, 500);
    });

    await renderApp("/signup");
    await reachLastStep();
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    fireEvent.change(screen.getByLabelText("Date of birth"), {
      target: { value: tenYearsAgo.toISOString().slice(0, 10) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agree and create account" }));

    expect(await screen.findByText("We can't create your account")).toBeInTheDocument();
    expect(
      spy.mock.calls.filter(([input]) => String(input).includes("/api/v1/auth/sign-up")),
    ).toHaveLength(0);
    expect(isAgeBlocked()).toBe(true);
  });

  it("keeps a blocked browser out on the next visit", async () => {
    mockFetch(() => jsonResponse({}));
    document.cookie = "unbored_age_blocked=1; Path=/";
    await renderApp("/signup");
    expect(await screen.findByText("We can't create your account")).toBeInTheDocument();
  });
});
