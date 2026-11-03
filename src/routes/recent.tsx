import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { EmptyState, ErrorState, GridSkeleton, Page, PageHeader } from "@/components/common";
import { GameCard } from "@/components/game/GameCard";
import { Button } from "@/components/ui/button";
import { useRecentlyPlayed } from "@/lib/social/engagement";
import { seo } from "@/lib/seo";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/recent")({
  head: () => seo(t("Recently played"), t("Pick up where you left off.")),
  component: Recent,
});

/**
 * Recently played.
 *
 * The only record of a played game is a saved score: a run writes one when it
 * finishes and is verified. This page derives its list from those rows, newest
 * first, and shows each game once. Guest runs are not saved, so they do not
 * appear — which is what the copy says rather than pretending nothing works.
 */
function Recent() {
  const list = useRecentlyPlayed();

  if (list.status === "anonymous") {
    return (
      <Page className="max-w-5xl">
        <PageHeader back title={t("Recently played")} subtitle={t("Pick up where you left off.")} />
        <div className="px-4 md:px-0">
          <EmptyState
            icon={Clock}
            title={t("Sign in to see your games")}
            body={t("Your recently played games belong to your account.")}
            action={
              <Button asChild>
                <Link to="/login" search={{ redirect: "/recent" }}>
                  {t("Log in")}
                </Link>
              </Button>
            }
          />
        </div>
      </Page>
    );
  }

  if (list.status === "loading") {
    return (
      <Page className="max-w-5xl">
        <PageHeader back title={t("Recently played")} subtitle={t("Pick up where you left off.")} />
        <GridSkeleton />
      </Page>
    );
  }

  if (list.status === "error") {
    return (
      <Page className="max-w-5xl">
        <PageHeader back title={t("Recently played")} subtitle={t("Pick up where you left off.")} />
        <div className="px-4 md:px-0">
          <ErrorState
            title={t("Couldn't load recently played games")}
            body={list.error}
            onRetry={list.retry}
          />
        </div>
      </Page>
    );
  }

  if (list.games.length === 0) {
    return (
      <Page className="max-w-5xl">
        <PageHeader back title={t("Recently played")} subtitle={t("Pick up where you left off.")} />
        <div className="px-4 md:px-0">
          <EmptyState
            icon={Clock}
            title={t("No games played yet")}
            body={t("A game appears here after a scored run is saved. Guest runs are not saved.")}
          />
        </div>
      </Page>
    );
  }

  return (
    <Page className="max-w-5xl">
      <PageHeader back title={t("Recently played")} subtitle={t("Pick up where you left off.")} />
      <div className="grid grid-cols-2 gap-x-3 gap-y-5 px-4 md:grid-cols-3 md:px-0 lg:grid-cols-4">
        {list.games.map((game) => (
          <GameCard key={game.slug} game={game} />
        ))}
      </div>
    </Page>
  );
}
