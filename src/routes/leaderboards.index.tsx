import { createFileRoute } from "@tanstack/react-router";
import { LeaderboardPage } from "@/components/game/LeaderboardPage";
import type { BoardPeriod, BoardScope } from "@/lib/games/sessions";
import { seo } from "@/lib/seo";

import { t } from "@/lib/settings/language";

const PERIODS: readonly BoardPeriod[] = ["all", "day", "week", "this-week"];

export const Route = createFileRoute("/leaderboards/")({
  // `?scope=friends&period=this-week` opens the weekly league from its card.
  validateSearch: (
    search: Record<string, unknown>,
  ): { scope?: BoardScope; period?: BoardPeriod } => ({
    ...(search["scope"] === "friends" || search["scope"] === "global"
      ? { scope: search["scope"] }
      : {}),
    ...(PERIODS.includes(search["period"] as BoardPeriod)
      ? { period: search["period"] as BoardPeriod }
      : {}),
  }),
  head: () => seo(t("Leaderboards"), t("Global and friends leaderboards across every game.")),
  component: LeaderboardsIndex,
});

function LeaderboardsIndex() {
  const { scope, period } = Route.useSearch();
  return <LeaderboardPage initialScope={scope} initialPeriod={period} />;
}
