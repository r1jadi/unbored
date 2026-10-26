import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Feed } from "@/components/game/Feed";
import { AppShell } from "@/components/layout/AppShell";
import { clearSession } from "@/lib/auth/session";
import { LanguageProvider } from "@/lib/settings/language";

/**
 * Home and For You, tapped while already on the feed, take the player back to
 * the first game and read the feed again — the home-tab gesture of every feed
 * app. Anywhere else they are ordinary links to the feed.
 */

async function renderAt(path: string, onRefresh: () => void) {
  const root = createRootRoute();
  const shell = (page: React.ReactNode) => () => (
    <LanguageProvider>
      <AppShell>{page}</AppShell>
    </LanguageProvider>
  );
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: "/",
      component: shell(<Feed tab="for-you" items={[]} onRefresh={onRefresh} />),
    }),
    createRoute({ getParentRoute: () => root, path: "/explore", component: shell(<p>Explore</p>) }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
  });
  return router;
}

const scrollTo = vi.fn();

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { headers: { "Content-Type": "application/json" } })),
  );
  Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo;
});

afterEach(() => {
  vi.unstubAllGlobals();
  scrollTo.mockReset();
  clearSession();
});

describe("tapping Home on the feed", () => {
  it("scrolls back to the top and refreshes, without navigating", async () => {
    const onRefresh = vi.fn();
    const router = await renderAt("/", onRefresh);

    fireEvent.click(screen.getByRole("link", { name: "Home" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(router.state.location.pathname).toBe("/");
  });

  it("does the same for For You, in the sidebar and on the feed's own tabs", async () => {
    const onRefresh = vi.fn();
    await renderAt("/", onRefresh);

    for (const link of screen.getAllByRole("link", { name: "For You" })) fireEvent.click(link);

    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("is an ordinary link from anywhere else", async () => {
    const onRefresh = vi.fn();
    const router = await renderAt("/explore", onRefresh);

    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Home" }));
    });

    expect(router.state.location.pathname).toBe("/");
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
