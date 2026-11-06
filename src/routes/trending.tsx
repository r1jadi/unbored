import { createFileRoute, Link } from "@tanstack/react-router";
import { EmptyState, ErrorState, GridSkeleton } from "@/components/common";
import { GameCard } from "@/components/game/GameCard";
import { GameListPage } from "@/components/game/GameListPage";
import { Button } from "@/components/ui/button";
import { MAX_PAGE_SIZE, useGames } from "@/lib/games/catalog";
import { pickBySlug, useTrending } from "@/lib/games/rankings";
import { seo } from "@/lib/seo";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/trending")({
  head: () => seo(t("Trending games"), t("What everyone is playing right now.")),
  component: Trending,
});

/**
 * What's taking off: finished runs this week, with growth on last week counted again
 * (`public.trending_games`). A game nobody played this week isn't on the list, so a
 * quiet week says so rather than padding it with the catalogue.
 */
function Trending() {
  const trending = useTrending(20);
  const catalogue = useGames({ limit: MAX_PAGE_SIZE });
  const games = pickBySlug(
    catalogue.items,
    (trending.data ?? []).map((entry) => entry.slug),
  );

  return (
    <GameListPage title={t("Trending games")} subtitle={t("What everyone is playing right now.")}>
      {trending.isError || catalogue.status === "error" ? (
        <ErrorState
          title={t("Couldn't load trending games")}
          body={t("Check your connection and try again.")}
          onRetry={() => {
            void trending.refetch();
            catalogue.retry();
          }}
        />
      ) : trending.isPending || catalogue.status === "loading" ? (
        <GridSkeleton count={8} />
      ) : games.length === 0 ? (
        <EmptyState
          title={t("Nothing's trending this week")}
          body={t("See which games people have played the most.")}
          action={
            <Button asChild variant="secondary">
              <Link to="/popular">{t("See popular games")}</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 md:grid-cols-4 md:px-0 lg:grid-cols-5">
          {games.map((game, i) => (
            <GameCard key={game.slug} game={game} rank={i + 1} />
          ))}
        </div>
      )}
    </GameListPage>
  );
}
