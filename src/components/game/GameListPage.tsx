import type { ReactNode } from "react";
import { EmptyState, ErrorState, GridSkeleton, Page, PageHeader } from "@/components/common";
import { GameCard } from "./GameCard";
import { Button } from "@/components/ui/button";
import { catalogErrorMessage, useGames, type Game, type GameQuery } from "@/lib/games/catalog";

import { t } from "@/lib/settings/language";
/**
 * A grid of catalogue games.
 *
 * Two deliberate removals from the prototype's version:
 *
 *   - the **filter chips** ("Today", "This week", "All time") never filtered
 *     anything — they were local state with no query behind them. The API has no
 *     date window (nothing records when a game was played), so a control that
 *     looks like it filters is worse than no control.
 *   - the **preview-state switcher**, which let a developer force the loading,
 *     empty and error screens. The states are real now: they follow the request.
 */
export function GameListPage({
  title,
  subtitle,
  query,
  ranked,
  arrange,
  empty = {
    title: t("Nothing here yet"),
    body: t("Check back soon — new games are added every week."),
  },
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  /** The catalogue query this page lists. Omit it when `children` supplies the body. */
  query?: GameQuery;
  ranked?: boolean;
  /**
   * Reorders (or narrows) the loaded games, such as by plays. A page that
   * arranges its games shows one page only: "Load more" would append games
   * that were never part of the ordering.
   */
  arrange?: (games: readonly Game[]) => Game[];
  empty?: { title: string; body?: string };
  /** Rendered instead of a list, for a page whose data does not exist yet. */
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Page className="max-w-5xl">
      <PageHeader back title={title} subtitle={subtitle} actions={action} />
      {query ? (
        <CatalogueList query={query} ranked={ranked} arrange={arrange} empty={empty} />
      ) : (
        <div className="px-4 md:px-0">{children}</div>
      )}
    </Page>
  );
}

/** The list itself. A separate component so `useGames` is never called conditionally. */
function CatalogueList({
  query,
  ranked,
  arrange,
  empty,
}: {
  query: GameQuery;
  ranked?: boolean;
  arrange?: (games: readonly Game[]) => Game[];
  empty: { title: string; body?: string };
}) {
  const { status, items, nextCursor, loadingMore, error, loadMoreError, retry, loadMore } =
    useGames(query);

  if (status === "loading") return <GridSkeleton />;

  if (status === "error") {
    return (
      <ErrorState
        title={t("Couldn't load games")}
        body={catalogErrorMessage(error)}
        onRetry={retry}
      />
    );
  }

  const shown = arrange ? arrange(items) : items;

  if (shown.length === 0) {
    return <EmptyState title={empty.title} body={empty.body} />;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-x-3 gap-y-5 px-4 md:grid-cols-3 md:px-0 lg:grid-cols-4">
        {shown.map((game, i) => (
          <GameCard key={game.slug} game={game} rank={ranked ? i + 1 : undefined} />
        ))}
      </div>
      {loadMoreError && (
        <p className="mt-4 px-4 text-sm text-destructive md:px-0">
          {catalogErrorMessage(loadMoreError)}
        </p>
      )}
      {nextCursor && !arrange && (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? t("Loading…") : t("Load more")}
          </Button>
        </div>
      )}
    </>
  );
}
