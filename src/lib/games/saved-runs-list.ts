import { useQuery } from "@tanstack/react-query";

import { getAccessToken, getAuthState, useAuth } from "@/lib/auth/session";
import { getQueryClient } from "@/lib/query";
import { currentLanguage } from "@/lib/settings/language";
import { restMutate } from "@/lib/supabase/rest";

export type SavedRunSummary = { gameSlug: string; gameTitle: string; savedAt: string };

/** The games the player has a run waiting in, newest first (`public.my_saved_runs`). */
export async function fetchMySavedRuns(): Promise<SavedRunSummary[]> {
  const token = getAccessToken();
  if (!token || getAuthState().status !== "authenticated") return [];
  const response = await restMutate("rpc/my_saved_runs", "POST", token, { p_limit: 3 });
  const rows = (await response.json()) as {
    game_slug: string;
    game_title: string;
    saved_at: string;
  }[];
  return rows.map((row) => ({
    gameSlug: row.game_slug,
    gameTitle: row.game_title,
    savedAt: row.saved_at,
  }));
}

export function useMySavedRuns() {
  const signedIn = useAuth().status === "authenticated";
  return useQuery(
    {
      queryKey: ["my-saved-runs", signedIn],
      queryFn: fetchMySavedRuns,
      enabled: signedIn,
      staleTime: 60_000,
      retry: false,
    },
    getQueryClient(),
  );
}

/** "2 hours ago", in the player's language. */
export function savedAgo(savedAt: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(savedAt) - now) / 1000);
  const format = new Intl.RelativeTimeFormat(currentLanguage(), { numeric: "auto" });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "minute");
}
