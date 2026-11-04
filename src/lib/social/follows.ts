/**
 * Persistent follow/unfollow backed by `public.follows` through the Supabase
 * Data API. RLS is the boundary: inserts require `follower_id = auth.uid()`
 * and deletes require ownership, so the acting user always comes from the
 * verified token and never from a browser-supplied id.
 *
 * Two rules keep the button and the database from ever disagreeing:
 *
 *   - the database is the source of truth for the displayed state. A screen
 *     that did not just read the follow graph loads it here (`useFollowState`)
 *     rather than assuming "not following" because nobody said otherwise;
 *   - the insert is idempotent (`on conflict do nothing`). A follow that
 *     already exists is the same end state the caller asked for, not the
 *     unique-violation error it used to be reported as;
 *   - the acting account comes from the access token's own subject. The cached
 *     session view can be older than the token (a restore publishes it before
 *     the server confirms it), and aiming a write with a stale id is the one
 *     way a legitimate follow could be refused by RLS and silently lost;
 *   - a write refused because the access token lapsed is rotated once and
 *     retried, so a follow tapped at the end of a token's life is persisted
 *     rather than reported as a failure the user never notices.
 */

import { useEffect, useState, useSyncExternalStore } from "react";

import { ApiError } from "@/lib/api/client";
import {
  accessTokenSubject,
  getAccessToken,
  getAuthState,
  getSessionUserId,
  rotateRefusedSession,
  subscribe as subscribeToAuth,
} from "@/lib/auth/session";
import { restCount, restGet, restMutate, SupabaseRestError } from "@/lib/supabase/rest";

import { t } from "@/lib/settings/language";
export type PublicProfile = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_path: string | null;
};

type FollowRow = { follower_id: string; followee_id: string; created_at: string };

/** The two counts every profile shows. Both are measured, never estimated. */
export type FollowCounts = { followers: number; following: number };

/**
 * Bumped after a follow graph write the database accepted. Counts and follow
 * buttons subscribe to it, so the profile behind a button does not keep showing
 * the number from before the tap.
 */
let followGraphVersion = 0;
const graphListeners = new Set<() => void>();

export function subscribeFollowGraph(listener: () => void): () => void {
  graphListeners.add(listener);
  return () => graphListeners.delete(listener);
}

export function getFollowGraphVersion(): number {
  return followGraphVersion;
}

function announceFollowGraphChange(): void {
  followGraphVersion += 1;
  for (const listener of graphListeners) listener();
}

function unauthorised(): ApiError {
  return new ApiError(t("Sign in to follow players."), { code: "unauthorized", status: 401 });
}

/**
 * Runs a Data API call with the caller's own token, rotating a lapsed one once.
 *
 * A 401 here almost always means the access token expired between the session
 * being restored and the write being sent. Rotating and retrying persists the
 * action; only a credential the server definitively refuses ends the session
 * (see `rotateRefusedSession`).
 */
async function withSessionRetry<T>(operation: (token: string) => Promise<T>): Promise<T> {
  const token = getAccessToken();
  if (!token || getAuthState().status !== "authenticated") throw unauthorised();
  try {
    return await operation(token);
  } catch (error) {
    if (!(error instanceof SupabaseRestError) || error.status !== 401) throw error;
    const outcome = await rotateRefusedSession();
    const refreshed = getAccessToken();
    if (outcome !== "rotated" || !refreshed) throw unauthorised();
    return operation(refreshed);
  }
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof SupabaseRestError) {
    if (error.status === 401) {
      return new ApiError(t("Sign in to follow players."), { code: "unauthorized", status: 401 });
    }
    if (error.status === 409 || error.code === "23505") {
      // The insert is idempotent, so a duplicate should never produce this; a
      // caller that does see it reconciles against the follow graph (see
      // `useFollowState`) rather than repeating a message the button it was
      // clicked from may already contradict.
      return new ApiError(t("You're already following this account."), {
        code: "conflict",
        status: 409,
      });
    }
    return new ApiError(t("Couldn't update the follow. Try again."), {
      code: "follow_failed",
      status: error.status,
    });
  }
  return new ApiError(t("Couldn't update the follow. Try again."), { code: "follow_failed" });
}

/** Resolves a username to its profile id via the public projection. */
export async function resolveUserId(username: string): Promise<string | null> {
  const rows = await restGet<PublicProfile[]>(
    `profiles?username=eq.${encodeURIComponent(username.toLowerCase())}&select=id,username,display_name,bio,avatar_path`,
  );
  return rows[0]?.id ?? null;
}

export async function fetchProfileByUsername(username: string): Promise<PublicProfile | null> {
  const rows = await restGet<PublicProfile[]>(
    `profiles?username=eq.${encodeURIComponent(username.toLowerCase())}&select=id,username,display_name,bio,avatar_path`,
  );
  return rows[0] ?? null;
}

export async function searchProfiles(query: string, limit = 8): Promise<PublicProfile[]> {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  // PostgREST `or` with ilike on both columns; the public projection only.
  const filter = `or=(username.ilike.*${encodeURIComponent(q)}*,display_name.ilike.*${encodeURIComponent(q)}*)`;
  return restGet<PublicProfile[]>(
    `profiles?${filter}&select=id,username,display_name,bio,avatar_path&limit=${limit}`,
  );
}

/**
 * The exact number of followers and followed accounts for one profile.
 *
 * `restCount` asks PostgREST for `Prefer: count=exact`, so the answer is the
 * database's total in one `Content-Range` header per direction. It deliberately
 * does not download the rows: PostgREST caps a response at the project's
 * `max_rows` (1000 here), so counting a fetched list silently reported 1000 for
 * every account past that — a wrong number presented as a real one.
 *
 * Both directions are public (the follow graph is), so this works signed out;
 * the caller's token is still forwarded when present so RLS sees the same
 * identity as the rest of the page.
 */
export async function getFollowCounts(
  userId: string,
  token: string | undefined = getAccessToken(),
): Promise<FollowCounts> {
  if (userId === "") {
    throw new ApiError(t("Couldn't read this account's follows."), {
      code: "bad_request",
      status: 400,
    });
  }
  const id = encodeURIComponent(userId);
  const read = async (withToken: string | undefined): Promise<FollowCounts> => {
    const [followers, following] = await Promise.all([
      restCount(`follows?followee_id=eq.${id}&select=follower_id`, withToken),
      restCount(`follows?follower_id=eq.${id}&select=followee_id`, withToken),
    ]);
    return { followers, following };
  };
  try {
    return await read(token);
  } catch (error) {
    // The graph is public, so a lapsed access token must not make a profile's
    // numbers unreadable. The anonymous view of the same rows is the answer.
    if (token && error instanceof SupabaseRestError && error.status === 401) {
      return read(undefined);
    }
    throw error;
  }
}

/** What a profile's counts currently are, including the states before/after. */
export type FollowCountsState = {
  status: "idle" | "loading" | "ready" | "error";
  /** Absent until the first successful read; kept on a later failure. */
  counts?: FollowCounts;
  error?: string;
  reload: () => void;
};

/**
 * Reactive follower/following counts for one account.
 *
 * Re-read on: mount, a change of account, and every accepted follow or unfollow
 * (`subscribeFollowGraph`). A failed read keeps the last known numbers and
 * reports the failure instead of showing zero, so "couldn't load" never looks
 * like an account nobody follows.
 */
export function useFollowCounts(userId: string | undefined): FollowCountsState {
  const version = useSyncExternalStore(subscribeFollowGraph, getFollowGraphVersion, () => 0);
  const auth = useSyncExternalStore(subscribeToAuth, getAuthState, getAuthState);
  const authUserId = auth.status === "authenticated" ? auth.session.userId : undefined;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    status: FollowCountsState["status"];
    counts?: FollowCounts;
    error?: string;
  }>({
    status: "idle",
  });

  useEffect(() => {
    if (!userId) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState((current) => (current.counts ? { ...current } : { status: "loading" }));
    getFollowCounts(userId)
      .then((counts) => {
        if (!cancelled) setState({ status: "ready", counts });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState((current) => ({
          status: "error",
          counts: current.counts,
          error: error instanceof Error ? error.message : t("Couldn't load follow counts."),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [userId, version, attempt, auth.status, authUserId]);

  return { ...state, reload: () => setAttempt((n) => n + 1) };
}

export async function isFollowing(followeeId: string): Promise<boolean> {
  const actor = getSessionUserId();
  if (!actor) return false;
  const rows = await withSessionRetry((token) =>
    restGet<FollowRow[]>(
      `follows?follower_id=eq.${encodeURIComponent(actor)}&followee_id=eq.${encodeURIComponent(followeeId)}&select=follower_id`,
      token,
    ),
  );
  return rows.length > 0;
}

export async function followUser(followeeId: string): Promise<void> {
  const actor = getSessionUserId();
  if (!actor) throw unauthorised();
  if (actor === followeeId) {
    throw new ApiError(t("You can't follow yourself."), { code: "bad_request", status: 400 });
  }
  try {
    // `on conflict do nothing` on the follow's own primary key: repeating a
    // follow — a double tap, a retry after a lost response, a second tab —
    // converges on the same single row instead of failing with 23505.
    await withSessionRetry((token) => {
      // The token is the authority on who is acting; RLS checks this value
      // against `auth.uid()`, so a mismatch is refused rather than stored.
      const follower = accessTokenSubject(token) ?? actor;
      return restMutate(
        "follows?on_conflict=follower_id,followee_id",
        "POST",
        token,
        { follower_id: follower, followee_id: followeeId },
        "resolution=ignore-duplicates",
      );
    });
  } catch (error) {
    throw toApiError(error);
  }
  announceFollowGraphChange();
}

export async function unfollowUser(followeeId: string): Promise<void> {
  const actor = getSessionUserId();
  if (!actor) throw unauthorised();
  try {
    await withSessionRetry((token) => {
      const follower = accessTokenSubject(token) ?? actor;
      return restMutate(
        `follows?follower_id=eq.${encodeURIComponent(follower)}&followee_id=eq.${encodeURIComponent(followeeId)}`,
        "DELETE",
        token,
      );
    });
  } catch (error) {
    throw toApiError(error);
  }
  announceFollowGraphChange();
}

export async function listFollowees(userId: string): Promise<string[]> {
  const rows = await restGet<FollowRow[]>(
    `follows?follower_id=eq.${encodeURIComponent(userId)}&select=followee_id`,
    getAccessToken(),
  );
  return rows.map((row) => row.followee_id);
}

export async function listFollowers(userId: string): Promise<string[]> {
  const rows = await restGet<FollowRow[]>(
    `follows?followee_id=eq.${encodeURIComponent(userId)}&select=follower_id`,
    getAccessToken(),
  );
  return rows.map((row) => row.follower_id);
}

export async function fetchProfilesByIds(ids: string[]): Promise<PublicProfile[]> {
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)];
  const filter = `id=in.(${unique.map(encodeURIComponent).join(",")})`;
  return restGet<PublicProfile[]>(
    `profiles?${filter}&select=id,username,display_name,bio,avatar_path`,
  );
}

/**
 * Reactive follow state for one target account.
 *
 * `initial` is a state the caller just read (the search list loads the
 * viewer's followees in one query). When it is omitted the state is loaded
 * from the database, so a screen that never fetched it — a profile page, a
 * connections list — still shows the truth instead of assuming "not
 * following". A sign-in or sign-out re-reads the answer for either kind of
 * caller.
 */
export function useFollowState(targetUserId: string | undefined, initial?: boolean) {
  const seeded = initial !== undefined;
  const [following, setFollowing] = useState(initial ?? false);
  const [loading, setLoading] = useState(!seeded && targetUserId !== undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!targetUserId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    if (!seeded) {
      setLoading(true);
      isFollowing(targetUserId)
        .then((value) => {
          if (!cancelled) {
            setFollowing(value);
            setError(undefined);
          }
        })
        .catch(() => {
          // The relationship could not be read: unknown, not "not following".
          // Keeping the button's default with no word about it would present a
          // guess as an answer; the failure is surfaced instead. The reconcile
          // path in `toggle` still means a retry re-reads the truth.
          if (!cancelled) setError(t("Couldn't check your follow state. Try again."));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    const unsubscribe = subscribeToAuth(() => {
      void isFollowing(targetUserId)
        .then((value) => {
          if (!cancelled) {
            setFollowing(value);
            setError(undefined);
          }
        })
        .catch(() => {
          if (!cancelled) setError(t("Couldn't check your follow state. Try again."));
        });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [targetUserId, seeded]);

  async function toggle(): Promise<void> {
    if (!targetUserId || busy) return;
    setBusy(true);
    setError(undefined);
    const desired = !following;
    try {
      if (desired) {
        await followUser(targetUserId);
      } else {
        await unfollowUser(targetUserId);
      }
      setFollowing(desired);
      // `followUser`/`unfollowUser` announced the accepted write, so profiles
      // showing this account's counts are already re-reading them.
    } catch (err) {
      // The write failed, but it may still have landed (a lost response); the
      // follow graph is the authority on that. Re-read it, adopt its answer and
      // only report the failure when the database still disagrees with what
      // was asked for — never a state the row itself contradicts.
      let reconciled = false;
      try {
        const truth = await isFollowing(targetUserId);
        setFollowing(truth);
        reconciled = truth === desired;
        if (reconciled) announceFollowGraphChange();
      } catch {
        // The re-read failed too; fall through to the message below.
      }
      if (!reconciled) {
        setError(
          err instanceof ApiError ? err.message : t("Couldn't update the follow. Try again."),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return { following, loading, busy, error, toggle };
}
