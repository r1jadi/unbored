import { createFileRoute } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { MAX_PAGE_SIZE, mostPlayed } from "@/lib/games/catalog";
import { seo } from "@/lib/seo";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/popular")({
  head: () => seo(t("Popular games"), t("The most played games on Unbored.")),
  component: Popular,
});

/**
 * The most played games.
 *
 * `plays` is the number of completed runs, counted by the database, so ordering
 * the catalogue by it is a real ranking. Games nobody has finished are left out
 * rather than listed with a zero.
 */
function Popular() {
  return (
    <GameListPage
      title={t("Popular games")}
      subtitle={t("The most played games on Unbored.")}
      query={{ limit: MAX_PAGE_SIZE }}
      arrange={mostPlayed}
      ranked
      empty={{
        title: t("Nothing played yet"),
        body: t("Once people finish a few runs, the most played games show up here."),
      }}
    />
  );
}
