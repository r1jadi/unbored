import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Feed } from "@/components/game/Feed";
import { WelcomeMoment } from "@/components/layout/WelcomeMoment";
import { useEffect, useMemo, useState } from "react";
import { FEED_QUERY, useGames } from "@/lib/games/catalog";
import { personalOrder } from "@/lib/games/for-you-personal";
import { useFeaturedSlugs, withFeaturedFirst } from "@/lib/games/rankings";
import { prefetchFeed } from "@/lib/prefetch";
import { seo } from "@/lib/seo";
import { useForYouSignals } from "@/lib/social/engagement";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/")({
  // `game` is the card to open on: the game the player just left.
  validateSearch: (search: Record<string, unknown>): { game?: string } => {
    const { game } = search;
    return typeof game === "string" && /^[a-z0-9-]+$/.test(game) ? { game } : {};
  },
  loader: ({ context }) => prefetchFeed(context.queryClient),
  head: () =>
    seo(t("For You"), t("Swipe through playable games. Play, score, and swipe to the next one.")),
  component: ForYou,
});

/**
 * The "For You" feed.
 *
 * Every game is scored for the viewer (`personalOrder`): its popularity, the
 * categories the viewer plays, likes and saves, a boost for games they liked or
 * saved, a step back for one they played in the last day, a boost for launches,
 * and a small daily shuffle. New games keep the third card and every third after
 * it, and no two games of a category come back to back. A guest gets the same
 * order without the personal part.
 *
 * A signed-in viewer's feed waits for their signals, so the cards do not reorder
 * under them a moment after they appear; if the signals cannot be read, the feed
 * is a guest's.
 */
function ForYou() {
  const { game } = Route.useSearch();
  const navigate = useNavigate();
  // Read once: the card is where this visit opens, not where the feed stays. The
  // address goes back to plain `/`, so a reload or a shared link starts at the top.
  const [landOn] = useState(game);
  useEffect(() => {
    if (game) void navigate({ to: "/", search: {}, replace: true });
  }, [game, navigate]);

  const { status, items, error, retry, nextCursor, loadingMore, loadMore } = useGames(FEED_QUERY);
  const viewer = useForYouSignals();
  // The order ranks the whole catalogue, so every page is read before it is
  // laid out: a game on page two must be able to win the first card.
  const complete = status === "ready" && nextCursor === null;
  useEffect(() => {
    if (status === "ready" && nextCursor !== null && !loadingMore) loadMore();
  }, [status, nextCursor, loadingMore, loadMore]);
  // Waits for the featured answer, like the viewer's signals, so the first card doesn't
  // change a moment after it appears. A failed read just means no featured games.
  const featured = useFeaturedSlugs();
  const ranked = useMemo(
    () =>
      complete && !featured.isPending
        ? withFeaturedFirst(personalOrder(items, viewer.signals), featured.data ?? [])
        : [],
    [complete, featured.isPending, featured.data, items, viewer.signals],
  );
  return (
    <>
      <Feed
        tab="for-you"
        items={ranked}
        loading={
          status === "loading" || (status === "ready" && !complete) || viewer.status === "loading"
        }
        error={status === "error" ? error : undefined}
        onRetry={retry}
        onRefresh={retry}
        landOn={landOn}
      />
      <WelcomeMoment />
    </>
  );
}
