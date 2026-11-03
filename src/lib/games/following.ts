/**
 * The authenticated Following feed, as `GET /api/v1/games/following` defines
 * it: published creator-owned games of the accounts the verified caller
 * follows, newest first, with the catalogue's keyset cursor.
 *
 * The follower is never a parameter — the token decides. Official ownerless
 * games are excluded server-side. A page is the full answer for its cursor;
 * only the cursor advances the feed, never a client-side filter over the
 * general catalogue.
 */

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api/client";
import { getAccessToken, getAuthState } from "@/lib/auth/session";
import { localizeGame, type Game } from "@/lib/games/catalog";

import { t } from "@/lib/settings/language";
const Route = "/games/following";

export type FollowingPage = {
  items: Game[];
  nextCursor: string | null;
};

export type FollowingQuery = {
  limit?: number;
  cursor?: string;
  q?: string;
};

/** Reads one Following-feed page for the signed-in caller. */
export function fetchFollowingFeed(
  query: FollowingQuery = {},
  options: { signal?: AbortSignal } = {},
): Promise<FollowingPage> {
  const token = getAccessToken();
  if (!token || getAuthState().status !== "authenticated") {
    return Promise.reject(
      new ApiError(t("Sign in to view your following feed."), {
        code: "unauthorized",
        status: 401,
      }),
    );
  }
  return apiFetch<FollowingPage>(Route, {
    token,
    query: { limit: query.limit, cursor: query.cursor, q: query.q },
    signal: options.signal,
  }).then((page) => ({ ...page, items: page.items.map(localizeGame) }));
}

export type FollowingFeedState =
  | { status: "anonymous" }
  | { status: "loading" }
  | { status: "ready"; items: Game[]; hasMore: boolean }
  | { status: "loading-more"; items: Game[]; hasMore: boolean }
  | { status: "error"; error: ApiError; items: Game[] };

/**
 * Paginated Following feed. Pages accumulate; `loadMore` advances the server
 * cursor. A failed follow-up page keeps the items already shown and reports
 * the error with a retry — never a substituted catalogue.
 */
export function useFollowingFeed(query: Omit<FollowingQuery, "cursor"> = {}) {
  const limit = query.limit ?? 20;
  const search = query.q ?? "";
  const [state, setState] = useState<FollowingFeedState>(() =>
    getAuthState().status === "authenticated" ? { status: "loading" } : { status: "anonymous" },
  );
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (getAuthState().status !== "authenticated") {
      setState({ status: "anonymous" });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchFollowingFeed({ limit, q: search || undefined }, { signal: controller.signal })
      .then((page) => {
        if (cancelled) return;
        setCursor(page.nextCursor ?? undefined);
        setState({
          status: "ready",
          items: page.items,
          hasMore: page.nextCursor != null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        setState({
          status: "error",
          error:
            error instanceof ApiError
              ? error
              : new ApiError(t("Couldn't load the following feed.")),
          items: [],
        });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [limit, search, attempt]);

  const loadMore = useCallback(async () => {
    if (state.status !== "ready" || !state.hasMore || !cursor) return;
    setState({ status: "loading-more", items: state.items, hasMore: state.hasMore });
    try {
      const page = await fetchFollowingFeed({ limit, q: search || undefined, cursor });
      setCursor(page.nextCursor ?? undefined);
      setState({
        status: "ready",
        items: [...state.items, ...page.items],
        hasMore: page.nextCursor != null,
      });
    } catch (error: unknown) {
      // Keep the pages already shown; the error belongs to the next page.
      setState({
        status: "error",
        error: error instanceof ApiError ? error : new ApiError(t("Couldn't load more games.")),
        items: state.items,
      });
    }
  }, [state, cursor, limit, search]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, loadMore, retry } as FollowingFeedState & {
    loadMore: () => Promise<void>;
    retry: () => void;
  };
}
