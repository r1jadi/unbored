import { useQuery } from "@tanstack/react-query";

import { getAccessToken, getAuthState, useAuth } from "@/lib/auth/session";
import { getQueryClient } from "@/lib/query";
import { restMutate } from "@/lib/supabase/rest";
import { deviceTimeZone } from "@/lib/time-zone";

import { t } from "@/lib/settings/language";
/**
 * Daily streaks, per game.
 *
 * Every day a signed-in player has a verified score in a game adds one to their
 * streak in it. One missed day is forgiven — a rest day — and playing the next
 * day carries the streak on; two missed days in a row end it. The database
 * computes the streak (`public.my_game_streak`) in the player's own time zone,
 * so "a day" is their day, not the server's.
 */

export type GameStreak = {
  /** Days played in a row, rest days not counted. Zero when there is none. */
  readonly streak: number;
  /** The last day played, as `YYYY-MM-DD` in the player's time zone. */
  readonly lastPlayedOn: string | null;
  /** Today, as `YYYY-MM-DD` in the same zone. */
  readonly today: string;
};

/**
 * Where a streak stands today:
 *
 *   - `none` — no streak to keep.
 *   - `done` — played today; the streak includes today.
 *   - `keep` — played yesterday; play today to add a day.
 *   - `rest` — missed yesterday, the rest day; play today to save the streak.
 */
export type StreakStatus = "none" | "done" | "keep" | "rest";

export function streakStatus(streak: GameStreak): StreakStatus {
  if (streak.streak === 0 || streak.lastPlayedOn === null) return "none";
  const gap = daysBetween(streak.lastPlayedOn, streak.today);
  if (gap <= 0) return "done";
  if (gap === 1) return "keep";
  if (gap === 2) return "rest";
  return "none";
}

/** Whole days from one `YYYY-MM-DD` date to another. */
function daysBetween(from: string, to: string): number {
  const day = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / day);
}

type StreakRow = { streak: number; last_played_on: string | null; today: string };

export async function fetchMyGameStreak(gameSlug: string): Promise<GameStreak | null> {
  const token = getAccessToken();
  if (!token || getAuthState().status !== "authenticated") return null;
  const response = await restMutate("rpc/my_game_streak", "POST", token, {
    p_game_slug: gameSlug,
    p_time_zone: deviceTimeZone(),
  });
  const row = ((await response.json()) as StreakRow[])[0];
  if (!row) return null;
  return { streak: Number(row.streak), lastPlayedOn: row.last_played_on, today: row.today };
}

/** The signed-in player's streak in a game; null data for a guest. */
export function useMyGameStreak(gameSlug: string, enabled = true) {
  const signedIn = useAuth().status === "authenticated";
  return useQuery(
    {
      queryKey: ["my-game-streak", gameSlug, signedIn],
      queryFn: () => fetchMyGameStreak(gameSlug),
      enabled: enabled && signedIn && gameSlug !== "",
      staleTime: 30_000,
    },
    // The play screen mounts outside any query provider, like the other game reads.
    getQueryClient(),
  );
}

/** The line that says where a streak stands, or null when there is nothing to say. */
export function streakLine(streak: GameStreak): string | null {
  const days =
    streak.streak === 1 ? t("1-day streak") : t("{streak}-day streak", { streak: streak.streak });
  switch (streakStatus(streak)) {
    case "done":
      return `${days}. Come back tomorrow to keep it going.`;
    case "keep":
      return `${days}. Play today to add a day.`;
    case "rest":
      return t("{days}, on a rest day. You missed yesterday, so play today to save it.", { days });
    default:
      return null;
  }
}

/**
 * The streak across every game (`public.my_daily_streak`). Any verified score
 * counts for the day. One missed day is a free rest day, as in a single game, and
 * each further missed day spends a freeze: one is earned for every seven days of
 * streak, and two at most are saved.
 */
export type DailyStreak = GameStreak & {
  /** Freezes saved for the days a rest day doesn't cover. */
  readonly freezes: number;
};

type DailyStreakRow = StreakRow & { freezes: number };

export async function fetchMyDailyStreak(): Promise<DailyStreak | null> {
  const token = getAccessToken();
  if (!token || getAuthState().status !== "authenticated") return null;
  const response = await restMutate("rpc/my_daily_streak", "POST", token, {
    p_time_zone: deviceTimeZone(),
  });
  const row = ((await response.json()) as DailyStreakRow[])[0];
  if (!row) return null;
  return {
    streak: Number(row.streak),
    lastPlayedOn: row.last_played_on,
    today: row.today,
    freezes: Number(row.freezes),
  };
}

/** The signed-in player's streak across every game; null data for a guest. */
export function useMyDailyStreak() {
  const signedIn = useAuth().status === "authenticated";
  return useQuery(
    {
      queryKey: ["my-daily-streak", signedIn],
      queryFn: fetchMyDailyStreak,
      enabled: signedIn,
      staleTime: 60_000,
    },
    getQueryClient(),
  );
}

/**
 * Whether today is already in: `none` with no streak, `done` once a game has been
 * played today, and otherwise `owed`, one game away from keeping it. The server has
 * already decided whether the streak is still alive, rest day and freezes included.
 */
export function dailyStreakStatus(streak: DailyStreak): "none" | "done" | "owed" {
  if (streak.streak === 0) return "none";
  return streak.lastPlayedOn === streak.today ? "done" : "owed";
}
