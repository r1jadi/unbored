import { createFileRoute } from "@tanstack/react-router";
import { LeaderboardPage } from "@/components/game/LeaderboardPage";
import { seo } from "@/lib/seo";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/leaderboards/")({
  head: () => seo(t("Leaderboards"), t("Global and friends leaderboards across every game.")),
  component: () => <LeaderboardPage />,
});
