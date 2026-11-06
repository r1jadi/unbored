/**
 * Trending and featured: orderings of the catalogue the database decides.
 *
 * Both answer with slugs, and the catalogue the screen already read supplies the
 * games, so a game that isn't in the catalogue can't appear under either heading.
 */

import { useQuery } from "@tanstack/react-query";

import type { Game } from "@/lib/games/catalog";
import { getQueryClient } from "@/lib/query";
import { restGet } from "@/lib/supabase/rest";

/** How many featured games the For You feed opens with. Explore shows them all. */
export const FEATURED_IN_FEED = 3;

export type TrendingEntry = { slug: string; recentRuns: number; previousRuns: number };

type TrendingRow = { slug: string; recent_runs: number; previous_runs: number };

export function useTrending(limit = 20) {
  return useQuery(
    {
      queryKey: ["trending-games", limit],
      queryFn: async (): Promise<TrendingEntry[]> => {
        const rows = await restGet<TrendingRow[]>(`rpc/trending_games?p_limit=${limit}`);
        return rows.map((row) => ({
          slug: row.slug,
          recentRuns: Number(row.recent_runs),
          previousRuns: Number(row.previous_runs),
        }));
      },
      staleTime: 5 * 60_000,
      retry: false,
    },
    getQueryClient(),
  );
}

export function useFeaturedSlugs() {
  return useQuery(
    {
      queryKey: ["featured-games"],
      queryFn: async (): Promise<string[]> => {
        const rows = await restGet<Array<{ slug: string }>>("rpc/featured_game_slugs");
        return rows.map((row) => row.slug);
      },
      staleTime: 5 * 60_000,
      retry: false,
      // The feed waits for this answer. Offline it has to fail, not wait for a network.
      networkMode: "always",
    },
    getQueryClient(),
  );
}

/** The games named by `slugs`, in that order. A slug not in `games` is left out. */
export function pickBySlug(games: readonly Game[], slugs: readonly string[]): Game[] {
  const bySlug = new Map(games.map((game) => [game.slug, game]));
  return slugs.flatMap((slug) => {
    const game = bySlug.get(slug);
    return game ? [game] : [];
  });
}

/** Moves the first few featured games to the front, and leaves the rest in order. */
export function withFeaturedFirst(
  games: readonly Game[],
  slugs: readonly string[],
  count = FEATURED_IN_FEED,
): Game[] {
  const lead = pickBySlug(games, slugs).slice(0, count);
  const led = new Set(lead.map((game) => game.slug));
  return [...lead, ...games.filter((game) => !led.has(game.slug))];
}
