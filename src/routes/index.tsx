import { createFileRoute } from "@tanstack/react-router";
import { Feed } from "@/components/game/Feed";
import { WelcomeMoment } from "@/components/layout/WelcomeMoment";
import { useMemo } from "react";
import { FEED_QUERY, useGames } from "@/lib/games/catalog";
import { personalOrder } from "@/lib/games/for-you-personal";
import { prefetchFeed } from "@/lib/prefetch";
import { seo } from "@/lib/seo";
import { useForYouSignals } from "@/lib/social/engagement";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/")({
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
  const { status, items, error, retry } = useGames(FEED_QUERY);
  const viewer = useForYouSignals();
  const ranked = useMemo(() => personalOrder(items, viewer.signals), [items, viewer.signals]);
  return (
    <>
      <Feed
        tab="for-you"
        items={ranked}
        loading={status === "loading" || viewer.status === "loading"}
        error={status === "error" ? error : undefined}
        onRetry={retry}
        onRefresh={retry}
      />
      <WelcomeMoment />
    </>
  );
}
