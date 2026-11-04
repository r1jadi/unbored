/**
 * What a visitor may see on another player's profile.
 *
 * The answer comes from `profile_showcase`, which reads the player's own privacy
 * choices on the server. `user_preferences` is owner-only, so a visitor's browser
 * cannot read those choices itself, and it should not be the one applying them.
 * See `supabase/migrations/20261207120000_profile_privacy.sql`.
 */

import { useQuery } from "@tanstack/react-query";

import { getAccessToken, useAuth } from "@/lib/auth/session";
import type { Game } from "@/lib/games/catalog";
import { fetchGameRecords, type ScoreEntry } from "@/lib/social/engagement";
import { restGet } from "@/lib/supabase/rest";

type ShowcaseRow = {
  private: boolean;
  scores_visible: boolean;
  recent_visible: boolean;
  scores: Array<{ game_id: string; score: number }>;
  recent: string[];
};

export type ProfileShowcase = {
  readonly isPrivate: boolean;
  readonly scoresVisible: boolean;
  readonly recentVisible: boolean;
  readonly scores: readonly ScoreEntry[];
  readonly recent: readonly Game[];
};

export async function fetchProfileShowcase(userId: string): Promise<ProfileShowcase> {
  const row = await restGet<ShowcaseRow>("rpc/profile_showcase", getAccessToken() ?? undefined, {
    method: "POST",
    body: JSON.stringify({ p_user_id: userId }),
  });
  const games = new Map(
    (await fetchGameRecords([...row.scores.map((score) => score.game_id), ...row.recent])).map(
      (record) => [record.id, record.game],
    ),
  );
  return {
    isPrivate: row.private,
    scoresVisible: row.scores_visible,
    recentVisible: row.recent_visible,
    scores: row.scores.map((score) => ({
      game: games.get(score.game_id) ?? null,
      score: Number(score.score),
    })),
    recent: row.recent.map((id) => games.get(id)).filter((game): game is Game => Boolean(game)),
  };
}

/** A player's showcase as this viewer may see it. The viewer is part of the key. */
export function useProfileShowcase(userId: string | undefined) {
  const auth = useAuth();
  const viewer = auth.status === "authenticated" ? auth.session.userId : null;
  return useQuery({
    queryKey: ["profile-showcase", userId, viewer],
    queryFn: () => fetchProfileShowcase(userId as string),
    enabled: userId !== undefined && auth.status !== "restoring",
    staleTime: 30_000,
  });
}
