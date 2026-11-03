import { createFileRoute } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { seo } from "@/lib/seo";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/trending")({
  head: () => seo(t("Trending games"), t("What everyone is playing right now.")),
  component: Trending,
});

/**
 * Trending, honestly reported as unavailable.
 *
 * A trend is a change in play activity over a window. Plays are recorded — every
 * finished run adds one — but nothing ranks them, and there is no windowed trend
 * query behind this page. The prototype listed its fixture games in insertion
 * order and called them trending. There is no honest way to show that yet, so the
 * page says what is missing: the ranking, not the plays.
 */
function Trending() {
  return (
    <GameListPage title={t("Trending games")} subtitle={t("What everyone is playing right now.")}>
      <EmptyState
        title={t("Trending is coming soon")}
        body={t("Until then, see which games people have played the most.")}
        action={
          <Button asChild variant="secondary">
            <Link to="/popular">{t("See popular games")}</Link>
          </Button>
        }
      />
    </GameListPage>
  );
}
