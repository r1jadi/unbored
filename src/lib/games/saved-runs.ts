/**
 * Saved progress for signed-in players: an unfinished run, and stats per game.
 *
 * While a signed-in player plays an untimed game, the run's moves are saved to
 * its session through the Supabase Data API (`save_run_progress`), with the
 * player's own token as the credential. Opening the game again finds the saved
 * run (`saved_run`) and offers to continue it; continuing replays the saved
 * moves from the session's seed, so the board is exactly where it was. Nothing
 * saved here is a score: a run is scored only when it is submitted and the
 * server has replayed it. See `supabase/migrations/20261108120000_saved_progress.sql`.
 *
 * Saving is best effort. A save that fails is retried with the next move, and a
 * check for a saved run that fails simply starts a new run — neither ever stands
 * between the player and the game.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, type RefObject } from "react";

import { getAccessToken, getAuthState, useAuth } from "@/lib/auth/session";
import { restMutate, supabaseBase, supabaseHeaders } from "@/lib/supabase/rest";

import type { PlaySession } from "@/lib/games/sessions";

/** The untimed games' current rules: the runs that can be saved and continued. */
export const RESUMABLE_RULES: ReadonlySet<string> = new Set([
  "stack-10@2",
  "chain@2",
  "memory-flash@2",
  "one-move@2",
  "color-merge@2",
  "queens@1",
]);

/** How long after the last move a run is saved. */
export const SAVE_DELAY_MS = 1500;

/** An unfinished run, found on the player's account. */
export type SavedRun = {
  /** The run's session, still open, ready to be continued and then submitted. */
  readonly session: PlaySession;
  /** The moves made so far, in order. */
  readonly actions: readonly number[];
  /** How long the run had been played, so its duration carries on. */
  readonly playedMs: number;
};

type SavedRunRow = {
  session_id: string;
  game_slug: string;
  rules_version: string;
  seed: string;
  started_at: string;
  expires_at: string;
  actions: number[];
  played_ms: number;
  saved_at: string;
};

function signedInToken(): string | null {
  const token = getAccessToken();
  return token && getAuthState().status === "authenticated" ? token : null;
}

/**
 * The player's unfinished run of a game under these rules, or null — for a
 * guest, a game that cannot resume, no saved run, or a failed check.
 */
export async function fetchSavedRun(
  gameSlug: string,
  rulesVersion: string,
): Promise<SavedRun | null> {
  const token = signedInToken();
  if (!token || !RESUMABLE_RULES.has(rulesVersion)) return null;
  try {
    const response = await restMutate("rpc/saved_run", "POST", token, {
      p_game_slug: gameSlug,
      p_rules_version: rulesVersion,
    });
    const rows = (await response.json()) as SavedRunRow[];
    const row = rows[0];
    if (!row || row.actions.length === 0) return null;
    return {
      session: {
        id: row.session_id,
        gameSlug: row.game_slug,
        rulesVersion: row.rules_version,
        seed: row.seed,
        tileCount: 0,
        startedAt: row.started_at,
        expiresAt: row.expires_at,
        ranked: true,
      },
      actions: row.actions,
      playedMs: Math.max(0, row.played_ms),
    };
  } catch {
    // A check that fails must not keep the player from playing: start fresh.
    return null;
  }
}

/**
 * Saves an unfinished run's moves to its session. `keepalive` lets the request
 * outlive the page, for the save made as the player leaves.
 */
export async function saveRunProgress(
  sessionId: string,
  actions: readonly number[],
  playedMs: number,
  options: { keepalive?: boolean } = {},
): Promise<boolean> {
  const token = signedInToken();
  const base = supabaseBase();
  if (!token || base === "") return false;
  try {
    const response = await fetch(`${base}/rest/v1/rpc/save_run_progress`, {
      method: "POST",
      headers: supabaseHeaders(token),
      body: JSON.stringify({
        p_session_id: sessionId,
        p_actions: [...actions],
        p_played_ms: Math.max(0, Math.round(playedMs)),
      }),
      keepalive: options.keepalive,
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Keeps a live run saved while it is played.
 *
 * `live` is the run to keep, or null when there is nothing to save (a guest, a
 * game that cannot resume, a run that has ended or not started). Each move
 * schedules a save shortly after the last one, so a burst of taps is one save;
 * leaving the page — or hiding it — saves at once. `startedAt` is the run's own
 * clock (a `Date.now()` mark, already moved back by the time a continued run had
 * been played), so the saved played time carries on across sessions.
 */
export function useSaveProgress(
  live: { session: PlaySession; actions: readonly number[] } | null,
  startedAt: RefObject<number>,
): void {
  const latest = useRef(live);
  const saved = useRef(0);
  latest.current = live;

  const sessionId = live?.session.id ?? null;
  const count = live?.actions.length ?? 0;
  const eligible =
    live !== null && live.session.ranked && RESUMABLE_RULES.has(live.session.rulesVersion);

  useEffect(() => {
    if (!eligible || !sessionId || count === 0 || count === saved.current) return;
    const timer = setTimeout(() => {
      const current = latest.current;
      if (!current) return;
      const played = startedAt.current ? Date.now() - startedAt.current : 0;
      saved.current = current.actions.length;
      void saveRunProgress(current.session.id, current.actions, played).then((ok) => {
        // A failed save is tried again with the next move.
        if (!ok) saved.current = 0;
      });
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [eligible, sessionId, count, startedAt]);

  // Leaving or hiding the page saves straight away: that is when the delay above
  // would otherwise lose the last moves.
  useEffect(() => {
    if (!eligible) return;
    const flush = () => {
      const current = latest.current;
      if (!current || current.actions.length === 0) return;
      if (current.actions.length === saved.current) return;
      const played = startedAt.current ? Date.now() - startedAt.current : 0;
      saved.current = current.actions.length;
      void saveRunProgress(current.session.id, current.actions, played, { keepalive: true });
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      // Unmounting a live run — the player went back to the feed — saves it too.
      flush();
    };
  }, [eligible, startedAt]);
}

// ── Stats per game ──────────────────────────────────────────────────────────

/** A signed-in player's stats for one game, from their verified scores. */
export type GameStats = {
  readonly runs: number;
  readonly bestScore: number | null;
  readonly totalScore: number;
  readonly rank: number | null;
  readonly lastPlayedAt: string | null;
};

type StatsRow = {
  runs: number;
  best_score: number | null;
  total_score: number;
  rank: number | null;
  last_played_at: string | null;
};

export async function fetchMyGameStats(gameSlug: string): Promise<GameStats | null> {
  const token = signedInToken();
  if (!token) return null;
  const response = await restMutate("rpc/my_game_stats", "POST", token, {
    p_game_slug: gameSlug,
  });
  const rows = (await response.json()) as StatsRow[];
  const row = rows[0];
  if (!row) return null;
  return {
    runs: Number(row.runs),
    bestScore: row.best_score === null ? null : Number(row.best_score),
    totalScore: Number(row.total_score),
    rank: row.rank === null ? null : Number(row.rank),
    lastPlayedAt: row.last_played_at,
  };
}

/** The signed-in player's stats for a game; null data for a guest. */
export function useMyGameStats(gameSlug: string) {
  const signedIn = useAuth().status === "authenticated";
  return useQuery({
    queryKey: ["my-game-stats", gameSlug, signedIn],
    queryFn: () => fetchMyGameStats(gameSlug),
    enabled: signedIn && gameSlug !== "",
    staleTime: 30_000,
  });
}
