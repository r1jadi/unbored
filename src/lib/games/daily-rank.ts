import { useQuery } from "@tanstack/react-query";

import { getAccessToken, getAuthState } from "@/lib/auth/session";
import { getQueryClient } from "@/lib/query";
import { restMutate } from "@/lib/supabase/rest";

/**
 * Where a finished daily run stands among everyone who played the same board
 * (`public.my_daily_rank`). Null until at least two other players have played it,
 * and for a guest, whose run has no score on the board.
 */
export type DailyRank = {
  /** Other players on today's board. */
  players: number;
  /** How many of them this run scored above, as a whole percentage. */
  percent: number;
};

export async function fetchMyDailyRank(sessionId: string): Promise<DailyRank | null> {
  const token = getAccessToken();
  if (!token || getAuthState().status !== "authenticated") return null;
  const response = await restMutate("rpc/my_daily_rank", "POST", token, {
    p_session_id: sessionId,
  });
  const row = ((await response.json()) as { players: number; beaten: number }[])[0];
  if (!row || row.players < 1) return null;
  return {
    players: Number(row.players),
    percent: Math.round((Number(row.beaten) / Number(row.players)) * 100),
  };
}

export function useMyDailyRank(sessionId: string | undefined, enabled: boolean) {
  return useQuery(
    {
      queryKey: ["my-daily-rank", sessionId],
      queryFn: () => fetchMyDailyRank(sessionId!),
      enabled: enabled && !!sessionId,
      staleTime: 60_000,
      // A read that fails just leaves the line out.
      retry: false,
    },
    getQueryClient(),
  );
}
