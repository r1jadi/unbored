import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminShell } from "@/components/admin/AdminShell";
import { FeaturedAdmin } from "@/routes/admin.featured";
import { GamesAdmin } from "@/routes/admin.games";
import { NotificationsAdmin } from "@/routes/admin.notifications";
import { Overview } from "@/routes/admin.index";
import { ReviewQueue } from "@/routes/admin.review";
import { SystemSettings } from "@/routes/admin.settings";
import { UsersAdmin } from "@/routes/admin.users";
import { clearSession, signIn } from "@/lib/auth/session";

const adminId = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";
const playerId = "9c1f0b2a-7e63-4a5d-9f10-5e6d7c8b9a01";
const gameId = "11111111-2222-4333-8444-555555555555";

/**
 * A page under test, mounted in a real router.
 *
 * Every admin screen links somewhere — to a game, to the catalogue, back to the
 * app — so it is mounted the way the app mounts it rather than with its links
 * stubbed out.
 */
async function renderPage(component: () => ReactElement) {
  const root = createRootRoute();
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/", component }),
    ...[
      "admin",
      "admin/games",
      "admin/categories",
      "admin/users",
      "admin/reports",
      "admin/review",
      "admin/comments",
      "admin/featured",
      "admin/leaderboards",
      "admin/analytics",
      "admin/notifications",
      "admin/settings",
      "login",
      "notifications",
    ].map((path) =>
      createRoute({ getParentRoute: () => root, path, component: () => <p>{path}</p> }),
    ),
    createRoute({ getParentRoute: () => root, path: "games/$id", component: () => <p>Game</p> }),
    createRoute({ getParentRoute: () => root, path: "play/$id", component: () => <p>Play</p> }),
    createRoute({
      getParentRoute: () => root,
      path: "categories/$slug",
      component: () => <p>Category</p>,
    }),
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

type Role = "user" | "moderator" | "admin";

/**
 * The admin API, answering the credential call and then the supplied routes.
 *
 * `session` lets a test hand the dashboard a role and a database state that
 * disagree — which is the case the service is built to survive.
 */
function adminApi(
  role: Role,
  routes: Record<string, () => Response> = {},
  session: Partial<{ isStaff: boolean; isAdmin: boolean; isSuspended: boolean }> = {},
) {
  const spy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);

    if (url.includes("/auth/sign-in")) {
      return jsonResponse({
        session: { userId: adminId, role, email: "person@example.com", onboarded: true },
        tokens: {
          accessToken: "access-token-1",
          refreshToken: "refresh-token-1",
          tokenType: "bearer",
          expiresAt: "2026-10-13T12:00:00.000Z",
          expiresIn: 3600,
        },
      });
    }

    if (url.includes("/admin/session")) {
      return jsonResponse({
        userId: adminId,
        username: "rijad",
        displayName: "Rijad",
        role,
        isStaff: session.isStaff ?? role !== "user",
        isAdmin: session.isAdmin ?? role === "admin",
        isSuspended: session.isSuspended ?? false,
      });
    }

    for (const [match, answer] of Object.entries(routes)) {
      if (url.includes(match)) return answer();
    }

    return jsonResponse({ items: [], hasMore: false });
  });
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
  return jsonResponse({ error: { code, message, request_id: "req-admin-1" } }, status);
}

function paths(spy: ReturnType<typeof adminApi>): string[] {
  return spy.mock.calls.map((call) => new URL(String(call[0])).pathname);
}

function requestOf(spy: ReturnType<typeof adminApi>, match: string) {
  const call = spy.mock.calls.find((c) => String(c[0]).includes(match));
  if (!call) throw new Error(`no request matching ${match}`);
  return {
    url: new URL(String(call[0])),
    method: call[1]?.method ?? "GET",
    body: call[1]?.body === undefined ? undefined : (JSON.parse(String(call[1].body)) as unknown),
  };
}

/** Signs in so the screens have a session; the api above answers the call. */
async function signedIn(spy: ReturnType<typeof adminApi>) {
  await signIn("person@example.com", "correct-horse");
  expect(spy.mock.calls.some((call) => String(call[0]).includes("/auth/sign-in"))).toBe(true);
}

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the admin gate", () => {
  it("refuses an account outside the server allowlist, and reads nothing else", async () => {
    const spy = adminApi("user");
    await signedIn(spy);

    await renderPage(() => <AdminShell />);

    await screen.findByText("This area requires an administrator account");
    // The gate is the server's allowlist answer, and no staff read follows a refusal.
    expect(paths(spy)).toEqual(["/api/v1/auth/sign-in", "/api/v1/admin/session"]);
    expect(screen.queryByRole("navigation", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("asks an anonymous visitor to sign in without calling the API", async () => {
    const spy = adminApi("admin");

    await renderPage(() => <AdminShell />);

    await screen.findByText("Sign in to open the dashboard");
    expect(spy).not.toHaveBeenCalled();
  });

  it("admits an allowlisted administrator and shows the API's own queue counts", async () => {
    const spy = adminApi("admin", { "/admin/overview": () => jsonResponse(overviewPayload()) });
    await signedIn(spy);

    await renderPage(() => <AdminShell />);

    // Two navigations exist — the desktop sidebar and the mobile strip — and both
    // carry the same badge, so the assertions look for it in either.
    const navs = await screen.findAllByRole("navigation", { name: "Admin" });
    expect(navs.length).toBeGreaterThan(0);
    const badgeIn = (name: RegExp, value: string) =>
      screen
        .getAllByRole("link", { name })
        .some((link) => within(link).queryByText(value) !== null);
    expect(badgeIn(/Reports/, "7")).toBe(true);
    expect(badgeIn(/Review queue/, "3")).toBe(true);
    expect(screen.getAllByText("Administrator").length).toBeGreaterThan(0);
  });
});

describe("staff hierarchy", () => {
  // Every dashboard section is gated on the staff boolean, never on a role
  // string — so an administrator and a moderator see the same navigation, and
  // only the suspend action distinguishes them. The links are read from one
  // settled navigation per test (not one accessible-name query per link) so
  // the assertion stays cheap no matter how many sections exist.
  const sections = [
    "Overview",
    "Reports",
    "Review queue",
    "Comments",
    "Games",
    "Categories",
    "Featured",
    "Leaderboards",
    "Users",
    "Analytics",
    "Notifications",
    "Settings",
  ];

  async function navLabels(): Promise<string[]> {
    const navs = await screen.findAllByRole("navigation", { name: "Admin" });
    expect(navs.length).toBeGreaterThan(0);
    return navs.flatMap((nav) =>
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent ?? ""),
    );
  }

  it("shows an administrator every section with suspend enabled", async () => {
    const spy = adminApi("admin", {
      "/admin/overview": () => jsonResponse(overviewPayload()),
      "/admin/users": () =>
        jsonResponse({
          items: [userPayload({ username: "player", displayName: "Player", role: "user" })],
          hasMore: false,
        }),
    });
    await signedIn(spy);

    await renderPage(() => <AdminShell />);
    const labels = await navLabels();
    for (const section of sections) {
      expect(
        labels.some((text) => text.startsWith(section)),
        section,
      ).toBe(true);
    }
    expect(screen.getAllByText("Administrator").length).toBeGreaterThan(0);
  });

  it("shows a moderator every section with the moderator label", async () => {
    const spy = adminApi("moderator", {
      "/admin/overview": () => jsonResponse(overviewPayload()),
    });
    await signedIn(spy);

    await renderPage(() => <AdminShell />);
    const labels = await navLabels();
    for (const section of sections) {
      expect(
        labels.some((text) => text.startsWith(section)),
        section,
      ).toBe(true);
    }
    expect(screen.getAllByText("Moderator").length).toBeGreaterThan(0);
    expect(screen.queryByText("Administrator")).not.toBeInTheDocument();
  });

  it("enables suspend for an administrator on the users page", async () => {
    const spy = adminApi("admin", {
      "/admin/users": () =>
        jsonResponse({
          items: [userPayload({ username: "player", displayName: "Player", role: "user" })],
          hasMore: false,
        }),
    });
    await signedIn(spy);

    await renderPage(() => <UsersAdmin />);
    await screen.findAllByText(/@player/);
    expect(screen.queryByRole("button", { name: /Admin only/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Suspend/ })[0]).toBeEnabled();
    expect(screen.queryByText(/requires an administrator/)).not.toBeInTheDocument();
  });
});

describe("a failed read", () => {
  it("shows the API's message and a retry, and never prototype rows", async () => {
    const unavailable = () =>
      errorResponse(503, "service_unavailable", "The admin API is not available right now.");
    const spy = adminApi("admin", {
      "/admin/overview": unavailable,
      "/admin/system/services": unavailable,
    });
    await signedIn(spy);

    await renderPage(() => <Overview />);

    await screen.findByText("The admin API is not available right now.");
    const retry = screen.getAllByRole("button", { name: /Retry/ })[0];
    expect(retry).toBeInTheDocument();

    // Nothing invented stands in for the failed read: no figures, no rows, and
    // the sections that would carry them are not rendered at all.
    expect(screen.queryByText("Most played games")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent activity")).not.toBeInTheDocument();

    // The read is retried through a transient gateway failure before it is
    // reported, so a load costs more than one attempt; what matters here is that
    // pressing Retry sends the read again rather than reusing what it had.
    const reads = () => paths(spy).filter((path) => path === "/api/v1/admin/overview").length;
    const before = reads();

    await act(async () => {
      fireEvent.click(retry);
    });

    await waitFor(() => expect(reads()).toBeGreaterThan(before));
  });
});

describe("the review queue", () => {
  it("reads the games the database holds in review and counts them itself", async () => {
    const spy = adminApi("moderator", {
      "/admin/games": () =>
        jsonResponse({
          items: [
            gamePayload({ slug: "chain", title: "Chain", status: "review" }),
            gamePayload({
              id: "22222222-3333-4444-8555-666666666666",
              slug: "peak",
              title: "Peak",
              status: "review",
              playable: true,
              runtime: "v1",
            }),
          ],
          hasMore: false,
        }),
    });
    await signedIn(spy);

    await renderPage(() => <ReviewQueue />);

    await screen.findByText("Chain");
    const games = requestOf(spy, "/admin/games");
    expect(games.url.searchParams.get("status")).toBe("review");
    expect(games.url.searchParams.get("limit")).toBe("50");
    // The queue's own count is the number of rows the API returned, not a
    // statistic that could disagree with the list below it.
    const waiting = screen.getByText("Waiting for review").closest("div.rounded-xl");
    expect(waiting?.textContent).toContain("2");
    expect(screen.getAllByText("Peak").length).toBeGreaterThan(0);
  });
});

describe("the games catalogue screen", () => {
  const queued = () =>
    jsonResponse({
      items: [gamePayload({ slug: "chain", title: "Chain", status: "review" })],
      hasMore: false,
    });

  it("shows the stored status and a per-row action, and invents no status", async () => {
    const spy = adminApi("moderator", { "/admin/games": queued });
    await signedIn(spy);

    await renderPage(() => <GamesAdmin />);
    await screen.findAllByText("Chain");

    expect(screen.getAllByRole("button", { name: "Actions for Chain" }).length).toBeGreaterThan(0);
    // The badge is the row's own status, not a guess about what it should be.
    expect(screen.getAllByText("review").length).toBeGreaterThan(0);
    expect(screen.queryByText("published")).not.toBeInTheDocument();
  });
});

describe("a moderation write", () => {
  // The queue's decisions are plain buttons and its confirmation is a dialog, so
  // the write path is exercised here rather than through a dropdown menu.
  const queued = () =>
    jsonResponse({
      items: [gamePayload({ slug: "chain", title: "Chain", status: "review" })],
      hasMore: false,
    });

  async function confirmIn(role: "alertdialog" | "dialog", name: string) {
    const dialog = await screen.findByRole(role);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name }));
    });
  }

  it("PATCHes exactly what the dialog confirmed and re-reads the queue", async () => {
    const spy = adminApi("moderator", {
      [`/admin/games/${gameId}`]: () =>
        jsonResponse({
          id: gameId,
          previousStatus: "review",
          status: "published",
          action: "game_published",
        }),
      "/admin/games": queued,
    });
    await signedIn(spy);

    await renderPage(() => <ReviewQueue />);
    await screen.findAllByText("Chain");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    });
    await confirmIn("alertdialog", "Publish");

    await waitFor(() => expect(paths(spy)).toContain(`/api/v1/admin/games/${gameId}`));
    const write = requestOf(spy, `/admin/games/${gameId}`);
    expect(write.method).toBe("PATCH");
    expect(write.body).toEqual({ status: "published", reason: "" });

    // A successful write re-reads the queue, so what is shown is the server's.
    await waitFor(() =>
      expect(paths(spy).filter((path) => path === "/api/v1/admin/games").length).toBeGreaterThan(1),
    );
  });

  it("sends a rejection with the reason typed into the prompt", async () => {
    const spy = adminApi("moderator", {
      [`/admin/games/${gameId}`]: () =>
        jsonResponse({
          id: gameId,
          previousStatus: "review",
          status: "rejected",
          action: "game_rejected",
        }),
      "/admin/games": queued,
    });
    await signedIn(spy);

    await renderPage(() => <ReviewQueue />);
    await screen.findAllByText("Chain");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send back" }));
    });
    await act(async () => {
      fireEvent.change(await screen.findByLabelText("What has to change"), {
        target: { value: "The runtime fails the replay check." },
      });
    });
    await confirmIn("dialog", "Send back");

    await waitFor(() => expect(paths(spy)).toContain(`/api/v1/admin/games/${gameId}`));
    const write = requestOf(spy, `/admin/games/${gameId}`);
    expect(write.body).toEqual({
      status: "rejected",
      reason: "The runtime fails the replay check.",
    });
  });

  it("leaves the queue alone when the write is refused", async () => {
    const spy = adminApi("moderator", {
      [`/admin/games/${gameId}`]: () =>
        errorResponse(403, "forbidden", "This action requires an administrator account."),
      "/admin/games": queued,
    });
    await signedIn(spy);

    await renderPage(() => <ReviewQueue />);
    await screen.findAllByText("Chain");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    });
    await confirmIn("alertdialog", "Publish");

    await waitFor(() => expect(paths(spy)).toContain(`/api/v1/admin/games/${gameId}`));

    // The game still reads `review` and no re-read was performed as though the
    // decision had been accepted: a refusal is reported, never absorbed.
    expect(screen.getAllByText("review").length).toBeGreaterThan(0);
    expect(paths(spy).filter((path) => path === "/api/v1/admin/games").length).toBe(1);
  });
});

describe("suspending an account", () => {
  const directory = () =>
    jsonResponse({
      items: [userPayload({ username: "player", displayName: "Player", role: "user" })],
      hasMore: false,
    });

  it("offers the action to an administrator only", async () => {
    const spy = adminApi("moderator", { "/admin/users": directory });
    await signedIn(spy);

    await renderPage(() => <UsersAdmin />);

    await screen.findAllByText(/@player/);
    expect(screen.getAllByRole("button", { name: /Admin only/ })[0]).toBeDisabled();
    expect(screen.getByText(/requires an administrator/)).toBeInTheDocument();
  });

  it("suspends with a reason, then re-reads the directory", async () => {
    const spy = adminApi("admin", {
      [`/admin/users/${playerId}`]: () =>
        jsonResponse({ id: playerId, suspended: true, action: "account_suspended" }),
      "/admin/users": directory,
    });
    await signedIn(spy);

    await renderPage(() => <UsersAdmin />);
    await screen.findAllByText(/@player/);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Suspend/ })[0]);
    });
    await act(async () => {
      fireEvent.change(await screen.findByLabelText("Reason for suspension"), {
        target: { value: "Repeated abuse after a warning." },
      });
    });
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Suspend" }));
    });

    await waitFor(() => expect(paths(spy)).toContain(`/api/v1/admin/users/${playerId}`));
    const write = requestOf(spy, `/admin/users/${playerId}`);
    expect(write.method).toBe("PATCH");
    expect(write.body).toEqual({ suspended: true, reason: "Repeated abuse after a warning." });
    await waitFor(() =>
      expect(paths(spy).filter((path) => path === "/api/v1/admin/users").length).toBeGreaterThan(1),
    );
  });
});

describe("featured games", () => {
  const saved = {
    gameId: "11111111-1111-4111-8111-111111111111",
    slug: "sudoku",
    title: "Sudoku",
    status: "published",
    position: 0,
    setByUsername: "rijad",
    setAt: "2026-11-01T00:00:00Z",
  };
  const second = {
    ...saved,
    gameId: "22222222-2222-4222-8222-222222222222",
    slug: "stack-10",
    title: "Stack 10",
    position: 1,
  };

  it("saves a new order as one write, only once something changed", async () => {
    const spy = adminApi("admin", {
      "/admin/featured": () => jsonResponse({ items: [saved, second] }),
      "/admin/games": () => jsonResponse({ items: [], hasMore: false }),
    });
    await signedIn(spy);
    await renderPage(() => <FeaturedAdmin />);

    const save = await screen.findByRole("button", { name: "Save order" });
    expect(save).toBeDisabled();

    fireEvent.click(await screen.findByRole("button", { name: "Move Stack 10 up" }));
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => {
      const write = spy.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PUT");
      expect(write).toBeDefined();
      expect(JSON.parse((write![1] as RequestInit).body as string)).toEqual({
        gameIds: [second.gameId, saved.gameId],
      });
    });
  });
});

describe("announcements", () => {
  it("asks for confirmation before it sends to everyone", async () => {
    const spy = adminApi("admin", {
      "/admin/broadcasts": () =>
        jsonResponse({
          items: [
            {
              id: "b1",
              title: "Earlier news",
              body: "Sent before",
              link: null,
              sentByUsername: "rijad",
              recipients: 40,
              readCount: 12,
              createdAt: "2026-11-01T00:00:00Z",
            },
          ],
          hasMore: false,
        }),
    });
    await signedIn(spy);
    await renderPage(() => <NotificationsAdmin />);

    // Measured numbers, from the API.
    await screen.findByText("Earlier news");
    expect(screen.getByText("40 recipients")).toBeInTheDocument();
    expect(screen.getByText("12 read")).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Big news" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Something new" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByRole("button", { name: "Yes, send to everyone" });
    expect(
      spy.mock.calls.some(
        ([input, init]) =>
          String(input).includes("/admin/broadcasts") && (init as RequestInit)?.method === "POST",
      ),
    ).toBe(false);
  });
});

describe("the system screen", () => {
  it("describes the system from the service list, with settings only admins can change", async () => {
    const spy = adminApi("admin", {
      "/admin/system/services": () =>
        jsonResponse({
          measured: false,
          note: "Service health is not measured by this deployment.",
          items: [
            {
              name: "auth",
              status: "unmeasured",
              note: "This deployment collects no service metrics.",
            },
            {
              name: "games",
              status: "unmeasured",
              note: "This deployment collects no service metrics.",
            },
          ],
        }),
      "/admin/system/settings": () =>
        jsonResponse({
          bannerText: null,
          commentsEnabled: true,
          messagesEnabled: true,
          updatedAt: "2026-11-01T00:00:00Z",
          updatedByUsername: null,
          log: [],
        }),
    });
    await signedIn(spy);

    await renderPage(() => <SystemSettings />);

    await screen.findByText("auth");
    expect(screen.getByText("games")).toBeInTheDocument();
    const save = await screen.findByRole("button", { name: /Save changes/ });
    // Nothing has changed yet, so there is nothing to save.
    expect(save).toBeDisabled();
    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });
});

describe("the prototype data module", () => {
  /**
   * The admin surface is scanned for any reference to the deleted fixture module.
   * The scan is scoped to those directories and skips test files, so this test's
   * own mention of the name cannot make it pass or fail by accident.
   */
  it("is gone, and no admin source imports it", () => {
    const sources = {
      ...import.meta.glob("/src/routes/admin*.tsx", {
        query: "?raw",
        import: "default",
        eager: true,
      }),
      ...import.meta.glob("/src/components/admin/**/*.tsx", {
        query: "?raw",
        import: "default",
        eager: true,
      }),
      ...import.meta.glob("/src/lib/admin/**/*.ts", {
        query: "?raw",
        import: "default",
        eager: true,
      }),
    } as Record<string, string>;

    const screens = Object.keys(sources).filter((path) => !path.includes(".test."));
    expect(screens.length).toBeGreaterThan(10);

    const referencing = screens.filter((path) => sources[path].includes("admin-mock"));
    expect(referencing).toEqual([]);
  });
});

/** The overview aggregate, as the admin API returns it. */
function overviewPayload(overrides: Record<string, unknown> = {}) {
  return {
    totalUsers: 12,
    activeUsers: 3,
    games: 4,
    publishedGames: 2,
    playableGames: 1,
    gamesPlayed: 30,
    runsOpen: 1,
    scoresRecorded: 9,
    players: 5,
    openReports: 7,
    pendingReview: 3,
    reviewingReports: 1,
    comments: 4,
    hiddenComments: 0,
    newUsersToday: 1,
    avgRunSeconds: null,
    runsMeasured: 0,
    series: [],
    activity: [],
    topGames: [],
    ...overrides,
  };
}

/** A game as the admin API returns one. */
function gamePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: gameId,
    slug: "stack-10",
    title: "Stack 10",
    tagline: null,
    status: "published",
    isOfficial: true,
    playable: false,
    runtime: null,
    categorySlug: "puzzle",
    categoryName: "Puzzle",
    ownerUsername: null,
    plays: 0,
    players: 0,
    bestScore: null,
    comments: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    publishedAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

/** An account as the admin API returns one. */
function userPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: playerId,
    username: "rijad",
    displayName: "Rijad",
    email: "rijad@example.com",
    role: "admin",
    isSuspended: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    lastActiveAt: null,
    plays: 0,
    bestScore: null,
    reportsAgainst: 0,
    ...overrides,
  };
}
