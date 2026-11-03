import { createFileRoute } from "@tanstack/react-router";
import { LeaderboardPage } from "@/components/game/LeaderboardPage";
import { titleFromSlug } from "@/lib/games/catalog";
import { prefetchLeaderboard } from "@/lib/prefetch";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/leaderboards/$id")({
  loader: ({ context, params }) => prefetchLeaderboard(context.queryClient, params.id),
  head: ({ params }) => {
    const title = titleFromSlug(params.id);
    return {
      meta: [
        { title: t("{title} leaderboard — Unbored", { title }) },
        { name: "description", content: t("Top scores on {title}.", { title }) },
        { property: "og:title", content: `${title} leaderboard — Unbored` },
        { property: "og:description", content: t("Top scores on {title}.", { title }) },
      ],
    };
  },
  component: Board,
});

/**
 * The per-game board.
 *
 * The slug is passed straight through. The prototype resolved an unknown id to
 * the first game in its list, so a mistyped URL silently showed somebody else's
 * leaderboard; now an unknown slug simply has no matching game to title the page.
 */
function Board() {
  const { id } = Route.useParams();
  return <LeaderboardPage gameId={id} />;
}
