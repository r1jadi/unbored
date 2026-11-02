import { createFileRoute } from "@tanstack/react-router";
import { Feed } from "@/components/game/Feed";
import { WelcomeMoment } from "@/components/layout/WelcomeMoment";
import { useMemo } from "react";
import { FEED_QUERY, forYouOrder, useGames } from "@/lib/games/catalog";
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
 * It lists the catalogue by popularity, from the completed runs the database
 * counts, with room kept for launches: a game published in the last two weeks
 * is guaranteed the third card and every third card after it, so a new game is
 * seen before it has had time to collect plays (`forYouOrder`). There is no
 * personalisation: a recommendation service does not exist, so every viewer sees
 * the same order. Naming the feed "For You" is the product's label; the order is
 * the one the catalogue can honestly produce.
 */
function ForYou() {
  const { status, items, error, retry } = useGames(FEED_QUERY);
  const ranked = useMemo(() => forYouOrder(items), [items]);
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
