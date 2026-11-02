import { createFileRoute } from "@tanstack/react-router";
import { Feed } from "@/components/game/Feed";
import { WelcomeMoment } from "@/components/layout/WelcomeMoment";
import { useMemo } from "react";
import { byPlays, FEED_QUERY, useGames } from "@/lib/games/catalog";
import { prefetchFeed } from "@/lib/prefetch";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/")({
  loader: ({ context }) => prefetchFeed(context.queryClient),
  head: () =>
    seo("For You", "Swipe through playable games. Play, score, and swipe to the next one."),
  component: ForYou,
});

/**
 * The "For You" feed.
 *
 * It lists the catalogue by popularity: the most played game first and the least
 * played last, from the completed runs the database counts. There is no
 * personalisation: a recommendation service does not exist, so every viewer sees
 * the same order. Naming the feed "For You" is the product's label; the order is
 * the one the catalogue can honestly produce. Games with the same number of runs
 * keep the catalogue's newest-first order.
 */
function ForYou() {
  const { status, items, error, retry } = useGames(FEED_QUERY);
  const ranked = useMemo(() => byPlays(items), [items]);
  return (
    <>
      <Feed
        tab="for-you"
        items={ranked}
        loading={status === "loading"}
        error={status === "error" ? error : undefined}
        onRetry={retry}
        onRefresh={retry}
      />
      <WelcomeMoment />
    </>
  );
}
