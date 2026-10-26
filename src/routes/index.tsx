import { createFileRoute } from "@tanstack/react-router";
import { Feed } from "@/components/game/Feed";
import { useGames } from "@/lib/games/catalog";
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
 * It lists the catalogue, newest first. There is no personalisation: a
 * recommendation service does not exist, and ranking by anything other than
 * publication order would require play data nothing records yet. Naming the feed
 * "For You" is the product's label; the order is the one the catalogue can
 * honestly produce.
 */
function ForYou() {
  const { status, items, error, retry } = useGames();
  return (
    <Feed
      tab="for-you"
      items={items}
      loading={status === "loading"}
      error={status === "error" ? error : undefined}
      onRetry={retry}
      onRefresh={retry}
    />
  );
}
