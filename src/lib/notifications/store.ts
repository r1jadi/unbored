/**
 * Real in-app notifications backed by `public.notifications` through the
 * Supabase Data API. RLS scopes every read and write to `auth.uid()`, so a
 * caller can only ever see their own inbox and guests see nothing.
 *
 * No mock rows: an empty inbox is an empty state, a failure is a retryable
 * error, and the unread badge is the count of rows with `read_at IS NULL`.
 */

import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { getAccessToken, getAuthState, subscribe as subscribeToAuth } from "@/lib/auth/session";
import { restGet, restMutate, SupabaseRestError } from "@/lib/supabase/rest";

export type NotificationKind = "follow" | "comment" | "like" | "score" | "moderation" | "system";

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

function toNotification(row: Row): AppNotification {
  return {
    id: row.id,
    kind: row.kind,
    payload: row.payload ?? {},
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof SupabaseRestError && error.status === 401) {
    return new ApiError("Sign in to view notifications.", { code: "unauthorized", status: 401 });
  }
  return new ApiError("Couldn't load notifications. Try again.", { code: "notifications_failed" });
}

export async function fetchNotifications(limit = 50): Promise<AppNotification[]> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") {
    throw new ApiError("Sign in to view notifications.", { code: "unauthorized", status: 401 });
  }
  try {
    const rows = await restGet<Row[]>(
      `notifications?select=id,kind,payload,read_at,created_at&order=created_at.desc&limit=${limit}`,
      token,
    );
    return rows.map(toNotification);
  } catch (error) {
    throw toApiError(error);
  }
}

export async function fetchUnreadCount(): Promise<number> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") {
    throw new ApiError("Sign in to view notifications.", { code: "unauthorized", status: 401 });
  }
  try {
    const rows = await restGet<Array<{ id: string }>>(
      "notifications?select=id&read_at=is.null&limit=100",
      token,
    );
    return rows.length;
  } catch (error) {
    // A failure is never a zero: callers distinguish it via UnreadBadgeState
    // and render no badge with a retry path.
    throw toApiError(error);
  }
}

export async function markAllRead(): Promise<void> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") {
    throw new ApiError("Sign in to view notifications.", { code: "unauthorized", status: 401 });
  }
  try {
    await restMutate("notifications?read_at=is.null", "PATCH", token, {
      read_at: new Date().toISOString(),
    });
  } catch (error) {
    throw toApiError(error);
  }
}

export async function markRead(id: string): Promise<void> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") {
    throw new ApiError("Sign in to view notifications.", { code: "unauthorized", status: 401 });
  }
  try {
    await restMutate(`notifications?id=eq.${encodeURIComponent(id)}`, "PATCH", token, {
      read_at: new Date().toISOString(),
    });
  } catch (error) {
    throw toApiError(error);
  }
}

// Every mounted unread badge listens here, so the inbox can clear them all the
// moment it is opened rather than leaving a stale number until the next reload.
const unreadListeners = new Set<(count: number | null) => void>();

/** Sets every badge to `count` now; `null` asks every badge to read the count again. */
function announceUnread(count: number | null): void {
  unreadListeners.forEach((listener) => listener(count));
}

/**
 * Opening the inbox reads every notification in it: the badge clears at once,
 * and the rows are marked read on the server. If marking fails, the badges read
 * the real count again rather than showing a zero that is not true.
 */
export async function openInbox(): Promise<void> {
  announceUnread(0);
  try {
    await markAllRead();
  } catch (error) {
    announceUnread(null);
    throw error;
  }
}

export type NotificationsState =
  | { status: "anonymous" }
  | { status: "loading" }
  | { status: "ready"; items: AppNotification[] }
  | { status: "error"; error: ApiError };

export function useNotifications(): NotificationsState & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<NotificationsState>(() =>
    getAuthState().status === "authenticated" ? { status: "loading" } : { status: "anonymous" },
  );

  useEffect(() => {
    const auth = getAuthState();
    if (auth.status !== "authenticated") {
      setState({ status: "anonymous" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    fetchNotifications()
      .then((items) => {
        if (!cancelled) setState({ status: "ready", items });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            error: error instanceof ApiError ? error : new ApiError("Couldn't load notifications."),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(
    () =>
      subscribeToAuth(() => {
        const auth = getAuthState();
        if (auth.status !== "authenticated") setState({ status: "anonymous" });
        else setAttempt((n) => n + 1);
      }),
    [],
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry } as NotificationsState & { retry: () => void };
}

/**
 * Reactive unread badge state.
 *
 * - `anonymous`: no account, so no account-specific badge — render nothing.
 * - `loading`: the count is not known yet — render nothing, not zero.
 * - `ready`: the request succeeded; `count` may be a genuine zero (render the
 *   unread-free state) or a positive number (render the badge).
 * - `error`: the request failed — render no badge and offer `retry`; the
 *   failure must never look like a successful zero.
 */
export type UnreadBadgeState =
  | { status: "anonymous"; count: 0 }
  | { status: "loading"; count: 0 }
  | { status: "ready"; count: number }
  | { status: "error"; count: 0; error: ApiError };

export function useUnreadCount(): UnreadBadgeState & { retry: () => void } {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<UnreadBadgeState>(() =>
    getAuthState().status === "authenticated"
      ? { status: "loading", count: 0 }
      : { status: "anonymous", count: 0 },
  );

  useEffect(() => {
    if (getAuthState().status !== "authenticated") {
      setState({ status: "anonymous", count: 0 });
      return;
    }
    let cancelled = false;
    setState({ status: "loading", count: 0 });
    fetchUnreadCount()
      .then((count) => {
        if (!cancelled) setState({ status: "ready", count });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            count: 0,
            error: error instanceof ApiError ? error : new ApiError("Couldn't load notifications."),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(
    () =>
      subscribeToAuth(() => {
        if (getAuthState().status !== "authenticated") {
          setState({ status: "anonymous", count: 0 });
        } else {
          setTick((n) => n + 1);
        }
      }),
    [],
  );

  // The inbox clears the badge when it is opened (see `openInbox`).
  useEffect(() => {
    const listener = (count: number | null) => {
      if (getAuthState().status !== "authenticated") return;
      if (count === null) setTick((n) => n + 1);
      else setState({ status: "ready", count });
    };
    unreadListeners.add(listener);
    return () => {
      unreadListeners.delete(listener);
    };
  }, []);

  // Coming back to the tab reads the count again, so a notification that arrived
  // in the meantime shows without a reload.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && getAuthState().status === "authenticated") {
        setTick((n) => n + 1);
      }
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const retry = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, retry } as UnreadBadgeState & { retry: () => void };
}

/** Human-readable line for a notification row. Never invents actor names. */
export function describeNotification(item: AppNotification): string {
  const payload = item.payload;
  const text = typeof payload["text"] === "string" ? payload["text"] : "";
  switch (item.kind) {
    case "follow":
      return text !== "" ? text : "started following you";
    case "comment":
      return text !== "" ? text : "commented on your score";
    case "like":
      return text !== "" ? text : "liked your score";
    case "score":
      return text !== "" ? text : "beat your score";
    case "moderation":
      return text !== "" ? text : "An update about your content";
    case "system":
    default:
      return text !== "" ? text : "An update from Unbored";
  }
}
