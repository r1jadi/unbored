import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearSession, signIn } from "@/lib/auth/session";
import { useUnreadCount } from "@/lib/notifications/store";
import { Route as NotificationsRoute } from "@/routes/notifications";

/**
 * The unread badge counts notifications that have not been opened, and opening
 * the inbox opens them: the badge clears straight away, the rows are marked read
 * on the server, and the next visit shows them as read. The rows that were new
 * keep their dot for the visit in which they were opened.
 */

const testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";
// Matches src/test/setup.ts.
const supabaseBase = "https://project.supabase.co";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Row = {
  id: string;
  kind: string;
  payload: object;
  read_at: string | null;
  created_at: string;
};

/** An in-memory `notifications` table behind the Supabase REST double. */
function stubInbox(rows: Row[], options: { failMarking?: boolean } = {}) {
  const patches: string[] = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/v1/auth/sign-in")) {
      return jsonResponse({
        session: { userId: testUserID, role: "user", email: "player@example.com" },
        tokens: {
          accessToken: "access-token-1",
          refreshToken: "refresh-token-1",
          tokenType: "bearer",
          expiresIn: 3600,
        },
        user: { id: testUserID, email: "player@example.com", emailConfirmed: true },
      });
    }
    if (url.startsWith(`${supabaseBase}/rest/v1/notifications`)) {
      if (init?.method === "PATCH") {
        patches.push(url);
        if (options.failMarking) return jsonResponse({ message: "down" }, 503);
        const now = new Date().toISOString();
        for (const row of rows) if (row.read_at === null) row.read_at = now;
        return new Response(null, { status: 204 });
      }
      if (url.includes("read_at=is.null")) {
        return jsonResponse(rows.filter((row) => row.read_at === null).map(({ id }) => ({ id })));
      }
      return jsonResponse(rows);
    }
    return jsonResponse({}, 200);
  });
  vi.stubGlobal("fetch", spy);
  return { patches };
}

function row(id: string, read: boolean): Row {
  return {
    id,
    kind: "system",
    payload: { text: `Notification ${id}` },
    read_at: read ? "2026-11-01T00:00:00.000Z" : null,
    created_at: "2026-11-02T00:00:00.000Z",
  };
}

function Badge() {
  const badge = useUnreadCount();
  return (
    <p data-testid="badge">{badge.status === "ready" && badge.count > 0 ? badge.count : "none"}</p>
  );
}

function renderApp() {
  const root = createRootRoute({
    component: () => (
      <>
        <Badge />
        <Outlet />
      </>
    ),
  });
  const page = NotificationsRoute.options.component as () => React.JSX.Element;
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/", component: () => <p>Feed</p> }),
    createRoute({ getParentRoute: () => root, path: "/notifications", component: page }),
    createRoute({ getParentRoute: () => root, path: "/login", component: () => <p>Log in</p> }),
    createRoute({
      getParentRoute: () => root,
      path: "/activity",
      component: () => <p>Activity</p>,
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/settings/$section",
      component: () => <p>Settings</p>,
    }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

async function go(router: ReturnType<typeof renderApp>, to: "/" | "/notifications") {
  await act(async () => {
    await router.navigate({ to });
  });
}

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("the unread badge and the inbox", () => {
  it("counts only unopened notifications", async () => {
    stubInbox([row("1", false), row("2", false), row("3", true)]);
    await signIn("player@example.com", "correct-horse");
    renderApp();

    await waitFor(() => expect(screen.getByTestId("badge")).toHaveTextContent("2"));
  });

  it("clears the badge as soon as the inbox is opened, and marks the rows read", async () => {
    const { patches } = stubInbox([row("1", false), row("2", false), row("3", true)]);
    await signIn("player@example.com", "correct-horse");
    const router = renderApp();
    await waitFor(() => expect(screen.getByTestId("badge")).toHaveTextContent("2"));

    await go(router, "/notifications");

    await screen.findByText("Notification 1");
    await waitFor(() => expect(screen.getByTestId("badge")).toHaveTextContent("none"));
    expect(patches).toHaveLength(1);
    expect(patches[0]).toContain("read_at=is.null");

    // The two that arrived keep their dot for this visit, so the player can see
    // what was new.
    expect(screen.getByText("2 new")).toBeInTheDocument();
    expect(screen.getAllByLabelText("New")).toHaveLength(2);
  });

  it("shows them as read on the next visit, and does not mark them again", async () => {
    const { patches } = stubInbox([row("1", false), row("2", true)]);
    await signIn("player@example.com", "correct-horse");
    const router = renderApp();

    await go(router, "/notifications");
    await screen.findByText("Notification 1");
    await waitFor(() => expect(patches).toHaveLength(1));

    await go(router, "/");
    await go(router, "/notifications");
    await screen.findByText("Notification 1");

    expect(screen.queryAllByLabelText("New")).toHaveLength(0);
    expect(screen.queryByText(/new$/)).toBeNull();
    expect(screen.getByTestId("badge")).toHaveTextContent("none");
    expect(patches).toHaveLength(1);
  });

  it("puts the real count back if the rows could not be marked read", async () => {
    stubInbox([row("1", false), row("2", false), row("3", false)], { failMarking: true });
    await signIn("player@example.com", "correct-horse");
    const router = renderApp();
    await waitFor(() => expect(screen.getByTestId("badge")).toHaveTextContent("3"));

    await go(router, "/notifications");
    await screen.findByText("Notification 1");

    // The badge never shows a zero that is not true.
    await waitFor(() => expect(screen.getByTestId("badge")).toHaveTextContent("3"));
  });
});
