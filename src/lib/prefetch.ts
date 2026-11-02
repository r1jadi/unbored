import type { QueryClient } from "@tanstack/react-query";

import {
  categoriesQuery,
  gameQuery,
  FEED_QUERY,
  gamesQuery,
  MAX_PAGE_SIZE,
} from "@/lib/games/catalog";
import { leaderboardQuery } from "@/lib/games/sessions";
import { isBrowser } from "@/lib/query";

/**
 * Route-level prefetching.
 *
 * Each function warms the query cache with exactly what one screen will ask for,
 * using the same query definitions its hooks use, so the screen finds the data
 * already there. The router calls them from `loader`s, which run when a link is
 * hovered or touched (`defaultPreload: "intent"`) as well as on navigation.
 *
 * They never block: a loader that awaited the API would hold the navigation on a
 * blank screen, which is worse than the screen's own skeleton. They are also
 * browser-only — on the server, API paths are relative to the visitor's origin,
 * which the server does not have.
 */

function warm(run: () => Promise<unknown>): void {
  if (!isBrowser) return;
  // A failed prefetch is not an error to show: the screen asks again itself.
  run().catch(() => undefined);
}

export function prefetchFeed(client: QueryClient): void {
  warm(() => client.prefetchInfiniteQuery(gamesQuery(FEED_QUERY)));
}

export function prefetchExplore(client: QueryClient): void {
  warm(() =>
    Promise.all([
      client.prefetchInfiniteQuery(gamesQuery({ category: "daily", limit: 1 })),
      client.prefetchInfiniteQuery(gamesQuery({ limit: MAX_PAGE_SIZE })),
      client.prefetchQuery(categoriesQuery()),
    ]),
  );
}

/** A game's page: the game, its top five, and — once its category is known — the related row. */
export function prefetchGamePage(client: QueryClient, slug: string): void {
  warm(() =>
    Promise.all([
      client
        .fetchQuery(gameQuery(slug))
        .then((game) =>
          game.category
            ? client.prefetchInfiniteQuery(gamesQuery({ category: game.category.slug, limit: 5 }))
            : undefined,
        ),
      client.prefetchQuery(leaderboardQuery(slug, { limit: 5 })),
    ]),
  );
}

export function prefetchPlay(client: QueryClient, slug: string): void {
  warm(() => client.prefetchQuery(gameQuery(slug)));
}

export function prefetchLeaderboard(client: QueryClient, slug: string): void {
  warm(() =>
    Promise.all([
      client.prefetchQuery(leaderboardQuery(slug)),
      client.prefetchInfiniteQuery(gamesQuery()),
    ]),
  );
}
