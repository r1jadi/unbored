import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  rootRouteId,
} from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/layout/AppShell";
import { SESSION_STORAGE_KEY, clearSession, initializeSession, signIn } from "@/lib/auth/session";
import { LanguageProvider, resetLanguageForTests } from "@/lib/settings/language";
import { routeTree } from "@/routeTree.gen";

const testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";
// Matches src/test/setup.ts: publicConfig is computed at import time from the
// stubbed env, so tests must use the setup value rather than re-stubbing.
const supabaseBase = "https://project.supabase.co";

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

/**
 * The sidebar links somewhere for every entry, so AppShell is mounted in a
 * real router with a stub page for each destination rather than with links
 * stubbed out.
 */
async function renderShell() {
  function Host(): ReactElement {
    return (
      <LanguageProvider>
        <AppShell>
          <p>page content</p>
        </AppShell>
      </LanguageProvider>
    );
  }

  const root = createRootRoute();
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/", component: Host }),
    ...[
      "following",
      "explore",
      "search",
      "leaderboards",
      "notifications",
      "saved",
      "recent",
      "profile",
      "settings",
      "admin",
      "welcome",
      "login",
      "signup",
      "onboarding",
    ].map((path) =>
      createRoute({ getParentRoute: () => root, path, component: () => <p>{path}</p> }),
    ),
  ];

  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  render(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
  });
}

/**
 * Answers the credential call, the session restore/validation call and the
 * admin allowlist check. Anything else is a test bug, not a network to hit.
 */
function stubBackend(adminSession: { isStaff: boolean }) {
  const spy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/v1/")) {
      if (url.includes("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (url.includes("/auth/session")) return jsonResponse({ userId: testUserID, role: "user" });
      if (url.includes("/auth/refresh")) return jsonResponse(sessionPayload());
      if (url.includes("/admin/session"))
        return jsonResponse({ userId: testUserID, role: "user", ...adminSession });
      throw new Error(`unexpected gateway call ${url}`);
    }
    if (url.startsWith(supabaseBase)) return jsonResponse([]);
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function desktopSidebar(): HTMLElement {
  const aside = document.querySelector("aside");
  if (!aside) throw new Error("expected the desktop sidebar to render");
  return aside as HTMLElement;
}

function mobileNav(): HTMLElement {
  const navs = screen.getAllByRole("navigation", { name: "Main" });
  const mobile = navs.find((nav) => within(nav).queryByText("Home") !== null);
  if (!mobile) throw new Error("expected the mobile navigation to render");
  return mobile;
}

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  window.localStorage.removeItem("unbored-language");
  window.localStorage.removeItem("onemore-language");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // No clearSession() here: the shell is still mounted until the library's
  // auto-cleanup runs, and publishing anonymous into it would warn. The next
  // test's beforeEach resets the session while nothing is mounted.
});

describe("sidebar auth entry points", () => {
  it("never shows the internal sign-in screens label", () => {
    const source = readFileSync("src/components/layout/AppShell.tsx", "utf8");
    expect(source).not.toContain("Sign-in screens");
  });

  it("shows Get started and Log in to visitors without a session", async () => {
    await renderShell();

    expect(screen.queryByText("Sign-in screens")).toBeNull();

    const sidebar = desktopSidebar();
    const started = within(sidebar).getByRole("link", { name: "Get started" });
    expect(started).toHaveAttribute("href", "/welcome");
    const login = within(sidebar).getByRole("link", { name: "Log in" });
    // The sidebar keeps the visitor on the page they were reading after sign-in.
    expect(login).toHaveAttribute("href", "/login?redirect=%2F");

    // Settings stays; the Admin link fails closed for anonymous visitors.
    expect(within(sidebar).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(within(sidebar).queryByRole("link", { name: "Admin" })).toBeNull();
  });

  it("shows no sign-in CTA once signed in", async () => {
    stubBackend({ isStaff: false });
    await signIn("player@example.com", "correct-horse");
    await renderShell();

    expect(screen.queryByText("Sign-in screens")).toBeNull();
    expect(screen.queryByRole("link", { name: "Get started" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Log in" })).toBeNull();

    // The existing navigation is preserved for signed-in visitors.
    const sidebar = desktopSidebar();
    expect(within(sidebar).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(within(sidebar).queryByRole("link", { name: "Admin" })).toBeNull();
    expect(within(sidebar).getByRole("link", { name: "For You" })).toHaveAttribute("href", "/");
  });

  it("keeps the Admin link for staff and hides it for anyone else", async () => {
    stubBackend({ isStaff: true });
    await signIn("player@example.com", "correct-horse");
    await renderShell();

    await waitFor(() => {
      expect(within(desktopSidebar()).getByRole("link", { name: "Admin" })).toHaveAttribute(
        "href",
        "/admin",
      );
    });
    // Staff see the product navigation, not a sign-in CTA.
    expect(screen.queryByRole("link", { name: "Get started" })).toBeNull();
  });
});

describe("session restoration on boot", () => {
  it("restores a stored session instead of showing the sign-in CTA", async () => {
    const spy = stubBackend({ isStaff: false });
    // A previous page load persisted this session; booting from storage is the
    // reload the old memory-only session could not survive.
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tokens: {
          accessToken: "access-token-1",
          refreshToken: "refresh-token-1",
          tokenType: "bearer",
          expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        },
        session: { userId: testUserID, role: "user", email: "player@example.com" },
      }),
    );

    await act(async () => {
      await initializeSession();
    });
    await renderShell();

    expect(screen.queryByRole("link", { name: "Get started" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Log in" })).toBeNull();
    // The stored token was checked with the server rather than trusted blindly.
    expect(spy.mock.calls.some(([input]) => String(input).includes("/api/v1/auth/session"))).toBe(
      true,
    );
  });
});

describe("language selection", () => {
  afterEach(() => {
    document.cookie = "unbored-language=; path=/; max-age=0";
    resetLanguageForTests();
  });

  // Polish is no longer offered, so a visitor who chose it earlier sees English.
  it("falls back to English for a stored language that is no longer offered", async () => {
    window.localStorage.setItem("unbored-language", "pl");
    resetLanguageForTests();
    await renderShell();

    const sidebar = desktopSidebar();
    expect(within(sidebar).getByRole("link", { name: "For You" })).toHaveAttribute("href", "/");
    expect(within(sidebar).queryByRole("link", { name: "Dla Ciebie" })).toBeNull();
  });

  it("shows the app in Albanian when that is the chosen language", async () => {
    document.cookie = "unbored-language=sq; path=/";
    resetLanguageForTests();
    await renderShell();

    const sidebar = desktopSidebar();
    expect(within(sidebar).getByRole("link", { name: "Për ty" })).toHaveAttribute("href", "/");
    expect(within(sidebar).queryByRole("link", { name: "For You" })).toBeNull();
  });
});

describe("mobile navigation stays consistent", () => {
  it("keeps the five tabs and carries no demo entry", async () => {
    await renderShell();

    const nav = mobileNav();
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Home",
      "Explore",
      "Ranks",
      "Inbox",
      "Profile",
    ]);
    expect(within(nav).queryByText("Sign-in screens")).toBeNull();
    expect(within(nav).queryByText("Get started")).toBeNull();
  });

  it("keeps the same five tabs once signed in", async () => {
    stubBackend({ isStaff: false });
    await signIn("player@example.com", "correct-horse");
    await renderShell();

    const nav = mobileNav();
    expect(within(nav).getAllByRole("link")).toHaveLength(5);
    expect(within(nav).queryByText("Sign-in screens")).toBeNull();
  });
});

describe("auth routes stay reachable", () => {
  it("still matches the welcome, login, signup and onboarding pages", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    for (const path of ["/welcome", "/login", "/signup", "/onboarding"]) {
      expect(router.matchRoutes(path).at(-1)?.routeId).not.toBe(rootRouteId);
    }
  });
});
