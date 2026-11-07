import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SwipeRow } from "@/components/social/SwipeRow";
import { clearSession, signIn } from "@/lib/auth/session";
import {
  dismissNotification,
  fetchNotifications,
  fetchUnreadCount,
  restoreNotification,
  type AppNotification,
} from "@/lib/notifications/store";
import { Route as InboxRoute } from "@/routes/messages.index";
import { Route as NotificationsRoute } from "@/routes/notifications";

const supabaseBase = "https://project.supabase.co";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Options = { failDelete?: boolean };

/** The two tables behind the REST double, and every write that reached them. */
function stubBackend(options: Options = {}) {
  const writes: Array<{ url: string; body: Record<string, unknown> }> = [];
  let notifications = [
    {
      id: "n1",
      kind: "follow",
      payload: { username: "ana" },
      read_at: "2026-11-01T00:00:00Z",
      created_at: "2026-11-02T00:00:00Z",
    },
  ];
  let chats = [
    {
      conversation_id: "c1",
      other_id: "u1",
      username: "ana",
      display_name: "Ana",
      avatar_path: null,
      last_body: "gg",
      last_sender_id: "u1",
      last_at: "2026-11-02T00:00:00Z",
      unread_count: 1,
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/auth/sign-in")) {
        return json({
          session: { userId: "me", role: "user", email: "player@example.com" },
          tokens: {
            accessToken: "token",
            refreshToken: "refresh",
            tokenType: "bearer",
            expiresIn: 3600,
          },
          user: { id: "me", email: "player@example.com", emailConfirmed: true },
        });
      }
      if (url.startsWith(`${supabaseBase}/rest/v1/rpc/clear_conversation`)) {
        writes.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        if (options.failDelete) return json({ message: "down" }, 503);
        chats = [];
        return new Response(null, { status: 204 });
      }
      if (url.startsWith(`${supabaseBase}/rest/v1/rpc/direct_inbox`)) return json(chats);
      if (url.startsWith(`${supabaseBase}/rest/v1/notifications`)) {
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          writes.push({ url, body });
          if (options.failDelete) return json({ message: "down" }, 503);
          if (body["dismissed_at"]) notifications = [];
          return new Response(null, { status: 204 });
        }
        return json(notifications);
      }
      return json([]);
    }),
  );
  return { writes };
}

async function renderPage(component: unknown, path: string) {
  const root = createRootRoute();
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path,
      component: component as () => React.JSX.Element,
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/messages/$username",
      component: () => <p>The chat</p>,
    }),
    ...["/login", "/activity", "/settings/$section", "/u/$username", "/notifications"]
      .filter((other) => other !== path)
      .map((other) =>
        createRoute({ getParentRoute: () => root, path: other, component: () => null }),
      ),
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

const note: AppNotification = {
  id: "n1",
  kind: "follow",
  payload: {},
  readAt: null,
  createdAt: "2026-11-02T00:00:00Z",
};

beforeEach(async () => {
  clearSession();
  stubBackend();
  await signIn("player@example.com", "secret");
});

afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** jsdom has no PointerEvent, and without one a fired event loses its coordinates. */
function pointer(
  target: Element,
  type: "down" | "move" | "up",
  init: { clientX?: number; clientY?: number; pointerType?: string } = {},
) {
  const event = new MouseEvent(`pointer${type}`, { bubbles: true, button: 0, ...init });
  Object.defineProperty(event, "pointerType", { value: init.pointerType ?? "touch" });
  act(() => void target.dispatchEvent(event));
}

describe("a row that swipes", () => {
  const row = (onDelete = vi.fn(), confirmSwipe = false) => {
    render(
      <ul>
        <SwipeRow
          deleteLabel="Delete it"
          confirm={{ title: "Delete this?", body: "Gone." }}
          confirmSwipe={confirmSwipe}
          onDelete={onDelete}
        >
          <a href="#inner">The row</a>
        </SwipeRow>
      </ul>,
    );
    return screen.getByText("The row").parentElement!;
  };

  /** A finger going down, across and up: jsdom has no layout, so widths read as zero. */
  function swipe(target: Element, dx: number, startX = 100) {
    pointer(target, "down", { clientX: startX, clientY: 50 });
    pointer(target, "move", { clientX: startX + dx / 2, clientY: 50 });
    pointer(target, "move", { clientX: startX + dx, clientY: 50 });
    pointer(target, "up");
  }

  function withWidth(target: HTMLElement, width: number) {
    Object.defineProperty(target, "offsetWidth", { configurable: true, value: width });
  }

  it("shows Delete after a swipe either way", () => {
    for (const dx of [120, -120]) {
      const target = row();
      withWidth(target, 400);
      swipe(target, dx);
      expect(target.style.transform).toBe(`translateX(${dx > 0 ? 92 : -92}px)`);
      document.body.innerHTML = "";
    }
  });

  it("deletes straight away after a long swipe", () => {
    vi.useFakeTimers();
    const onDelete = vi.fn();
    const target = row(onDelete);
    withWidth(target, 400);
    swipe(target, 300);
    act(() => void vi.advanceTimersByTime(300));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("asks first when told to, even after a long swipe", () => {
    const onDelete = vi.fn();
    const target = row(onDelete, true);
    withWidth(target, 400);
    swipe(target, 300);
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Delete this?" })).toBeInTheDocument();
  });

  it("asks when pressed and held", () => {
    vi.useFakeTimers();
    const target = row();
    pointer(target, "down", { clientX: 100, clientY: 50 });
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.getByRole("alertdialog", { name: "Delete this?" })).toBeInTheDocument();
  });

  it("leaves a plain tap, a short nudge and a scroll alone", () => {
    vi.useFakeTimers();
    const target = row();
    withWidth(target, 400);

    pointer(target, "down", { clientX: 100, clientY: 50 });
    pointer(target, "up");
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    swipe(target, 20);
    expect(target.style.transform).toBe("");

    pointer(target, "down", { clientX: 100, clientY: 50 });
    pointer(target, "move", { clientX: 102, clientY: 120 });
    act(() => void vi.advanceTimersByTime(500));
    expect(target.style.transform).toBe("");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("leaves a right swipe from the screen's edge to the browser's back gesture", () => {
    const target = row();
    withWidth(target, 400);
    pointer(target, "down", { clientX: 8, clientY: 50 });
    pointer(target, "move", { clientX: 200, clientY: 50 });
    expect(target.style.transform).toBe("");
  });

  it("doesn't let the end of a swipe open the row", () => {
    const opened = vi.fn();
    const target = row();
    target.addEventListener("click", opened);
    withWidth(target, 400);
    swipe(target, 120);
    fireEvent.click(screen.getByText("The row"));
    expect(opened).not.toHaveBeenCalled();
  });
});

describe("deleting a notification", () => {
  it("hides it from the list and the badge's count without deleting the row", async () => {
    const { writes } = stubBackend();
    await dismissNotification(note);

    expect(writes).toHaveLength(1);
    expect(writes[0]!.url).toContain("notifications?id=eq.n1");
    expect(writes[0]!.body["dismissed_at"]).toEqual(expect.any(String));
    // It was unread, so it counts as read: a digest can't bring it back up.
    expect(writes[0]!.body["read_at"]).toEqual(expect.any(String));

    const spy = vi.mocked(fetch);
    await fetchNotifications();
    await fetchUnreadCount();
    const reads = spy.mock.calls
      .map((call) => String(call[0]))
      .filter((u) => u.includes("select="));
    expect(reads.length).toBeGreaterThanOrEqual(2);
    for (const read of reads) expect(read).toContain("dismissed_at=is.null");
  });

  it("can be undone", async () => {
    const { writes } = stubBackend();
    await restoreNotification(note);
    expect(writes[0]!.body).toEqual({ dismissed_at: null });
  });

  it("goes from the page, and comes back if the server refused", async () => {
    stubBackend();
    await renderPage(NotificationsRoute.options.component, "/notifications");
    fireEvent.click(await screen.findByRole("button", { name: "Delete notification" }));
    await waitFor(() => expect(screen.queryByText("@ana")).not.toBeInTheDocument());
    document.body.innerHTML = "";

    stubBackend({ failDelete: true });
    await renderPage(NotificationsRoute.options.component, "/notifications");
    fireEvent.click(await screen.findByRole("button", { name: "Delete notification" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
    expect(await screen.findByText(/@ana/)).toBeInTheDocument();
  });
});

describe("deleting a chat", () => {
  const openDialog = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Delete chat with @ana" }));
    return screen.findByRole("alertdialog", { name: "Delete this chat?" });
  };

  it("asks, then clears it for this player", async () => {
    const { writes } = stubBackend();
    await renderPage(InboxRoute.options.component, "/messages");
    await openDialog();
    expect(writes).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.body).toEqual({ p_conversation: "c1" });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Delete chat with @ana" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("does nothing if the player changes their mind", async () => {
    const { writes } = stubBackend();
    await renderPage(InboxRoute.options.component, "/messages");
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(writes).toHaveLength(0);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Delete chat with @ana" })).toBeInTheDocument(),
    );
  });

  it("comes back if the server refused", async () => {
    const { writes } = stubBackend({ failDelete: true });
    await renderPage(InboxRoute.options.component, "/messages");
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Delete chat with @ana" })).toBeInTheDocument(),
    );
  });
});
