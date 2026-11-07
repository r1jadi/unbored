import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSession,
  initializeSession,
  SESSION_BOOT_SCRIPT,
  SESSION_STORAGE_KEY,
} from "@/lib/auth/session";
import { getQueryClient } from "@/lib/query";
import { Route as ForYouRoute } from "@/routes/index";

/**
 * What a reload must not show: the signed-out app to someone who is signed in, or an
 * empty feed on the way to a full one.
 */

const pending = () => document.documentElement.classList.contains("session-pending");
const runBootScript = () => new Function(SESSION_BOOT_SCRIPT)();

function storeSession() {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      tokens: {
        accessToken: "access",
        refreshToken: "refresh",
        tokenType: "bearer",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
      session: { userId: "me", role: "user" },
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("session-pending");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});

afterEach(() => {
  clearSession();
  getQueryClient().clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reloading with a stored session", () => {
  it("holds the signed-out page back before anything runs", () => {
    storeSession();
    runBootScript();
    expect(pending()).toBe(true);
  });

  it("holds nothing back for a visitor with no session", () => {
    runBootScript();
    expect(pending()).toBe(false);
  });

  it("lets go once the session has been restored", async () => {
    storeSession();
    runBootScript();
    await initializeSession();
    await waitFor(() => expect(pending()).toBe(false));
  });

  it("lets go when what was stored turns out to be unusable", async () => {
    localStorage.setItem(SESSION_STORAGE_KEY, "not a session");
    runBootScript();
    expect(pending()).toBe(true);
    await initializeSession();
    expect(pending()).toBe(false);
  });

  it("lets go by itself if the app never starts", () => {
    vi.useFakeTimers();
    storeSession();
    runBootScript();
    vi.advanceTimersByTime(8_000);
    expect(pending()).toBe(false);
  });
});

describe("the For You feed on the way to its first card", () => {
  it("never says it is empty while the featured games are still on their way", async () => {
    let answerFeatured = (_: Response) => {};
    const game = { slug: "stack-10", title: "Stack 10", playable: true };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("featured_game_slugs")) {
          return new Promise<Response>((resolve) => {
            answerFeatured = resolve;
          });
        }
        if (url.includes("/games")) {
          return Promise.resolve(
            new Response(JSON.stringify({ items: [game], nextCursor: null }), { status: 200 }),
          );
        }
        return Promise.resolve(new Response("[]", { status: 200 }));
      }),
    );

    const root = createRootRoute();
    const router = createRouter({
      routeTree: root.addChildren([
        createRoute({
          getParentRoute: () => root,
          path: "/",
          component: ForYouRoute.options.component as () => React.JSX.Element,
        }),
      ]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router} />);
    await act(async () => {
      await router.load();
    });

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByText("Nothing here yet")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Loading feed")).toBeInTheDocument();

    await act(async () => {
      answerFeatured(new Response("[]", { status: 200 }));
    });
    expect(await screen.findByText("Stack 10")).toBeInTheDocument();
    expect(screen.queryByText("Nothing here yet")).not.toBeInTheDocument();
  });
});
