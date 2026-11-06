import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Search } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState, GridSkeleton, Page, PageHeader, Section } from "@/components/common";
import { DailyWidget } from "@/components/game/DailyWidget";
import { GameCard } from "@/components/game/GameCard";
import { Button } from "@/components/ui/button";
import { MAX_PAGE_SIZE, mostPlayed, useCategories, useGames } from "@/lib/games/catalog";
import { pickBySlug, useFeaturedSlugs, useTrending } from "@/lib/games/rankings";
import { DAILY_LIMIT, prefetchExplore } from "@/lib/prefetch";
import { seo } from "@/lib/seo";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/explore")({
  loader: ({ context }) => prefetchExplore(context.queryClient),
  head: () => seo(t("Explore"), t("Discover new games and browse every category.")),
  component: Explore,
});

function More({ to }: { to: string }) {
  return (
    <Link to={to} className="flex items-center text-sm text-muted-foreground hover:text-foreground">
      {t("See all")}
      <ChevronRight className="size-4" />
    </Link>
  );
}

/**
 * One section whose read failed.
 *
 * The sections that did load stay, the failed one says so, and it offers the
 * only action that can help. It never fills the gap with a different set of
 * games — there is nothing to fall back to, and a plausible-looking grid under
 * a heading that failed would be indistinguishable from a real one.
 */
function SectionError({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <p className="text-muted-foreground">{children}</p>
      <button
        type="button"
        onClick={onRetry}
        className="font-medium underline underline-offset-4 transition-colors hover:text-primary"
      >
        {t("Retry")}
      </button>
    </div>
  );
}

/**
 * Explore.
 *
 * Every section is real. "Popular" orders the catalogue by completed runs, which
 * the database counts, and leaves out games nobody has finished. "Trending" is
 * this week's runs against last week's, and "Featured" is what staff chose; each is
 * hidden while it has nothing to show, as are categories with no published game.
 */
export function Explore() {
  const daily = useGames({ category: "daily", limit: DAILY_LIMIT });
  // One catalogue read feeds both "New" (its first five, newest first) and
  // "Popular" (all of it, by plays).
  const catalogue = useGames({ limit: MAX_PAGE_SIZE });
  const newest = catalogue;
  const newestItems = catalogue.items.slice(0, 5);
  const popular = mostPlayed(catalogue.items).slice(0, 5);
  const categories = useCategories();
  const withGames =
    categories.status === "ready" ? categories.items.filter((c) => c.gameCount > 0) : [];
  const featuredSlugs = useFeaturedSlugs();
  const featured = pickBySlug(catalogue.items, featuredSlugs.data ?? []);
  const trendingRead = useTrending(5);
  const trending = pickBySlug(
    catalogue.items,
    (trendingRead.data ?? []).map((entry) => entry.slug),
  );

  return (
    <Page className="max-w-5xl">
      <PageHeader
        title={t("Explore")}
        subtitle={t("Find your next game.")}
        actions={
          <Button asChild variant="ghost" size="icon" aria-label={t("Search")}>
            <Link to="/search">
              <Search />
            </Link>
          </Button>
        }
      />
      <div className="px-4 md:px-0">
        <Link
          to="/search"
          className="press flex h-11 items-center gap-2 rounded-xl bg-surface px-4 text-sm text-muted-foreground md:hidden"
        >
          <Search className="size-4" />
          {t("Search games")}
        </Link>
        {daily.status === "error" ? (
          <div className="mt-4">
            <SectionError onRetry={daily.retry}>
              {t("Today's challenge is unavailable right now.")}
            </SectionError>
          </div>
        ) : (
          <DailyWidget games={daily.items} />
        )}
      </div>

      {/* Hidden when nothing is featured: staff choose whether this section exists. */}
      {featured.length > 0 && (
        <Section title={t("Featured")}>
          <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 md:grid md:grid-cols-4 md:px-0 lg:grid-cols-5">
            {featured.map((game) => (
              <GameCard key={game.slug} game={game} className="w-36 shrink-0 md:w-auto" />
            ))}
          </div>
        </Section>
      )}

      {/* Hidden until something has been played this week. */}
      {trending.length > 0 && (
        <Section title={t("Trending")} action={<More to="/trending" />}>
          <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 md:grid md:grid-cols-4 md:px-0 lg:grid-cols-5">
            {trending.map((game, i) => (
              <GameCard
                key={game.slug}
                game={game}
                rank={i + 1}
                className="w-36 shrink-0 md:w-auto"
              />
            ))}
          </div>
        </Section>
      )}

      <Section title={t("Categories")} action={<More to="/categories" />}>
        {categories.status === "loading" ? (
          <GridSkeleton count={3} />
        ) : categories.status === "error" ? (
          <div className="px-4 md:px-0">
            <SectionError onRetry={categories.retry}>
              {t("Categories are unavailable right now.")}
            </SectionError>
          </div>
        ) : (
          <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 md:flex-wrap md:px-0">
            {withGames.map((c) => (
              <Link
                key={c.slug}
                to="/categories/$slug"
                params={{ slug: c.slug }}
                className="press shrink-0 rounded-full border border-border px-4 py-2 text-sm hover:bg-surface"
              >
                {c.name}
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section title={t("New")} action={<More to="/new" />}>
        {newest.status === "loading" ? (
          <GridSkeleton count={3} />
        ) : newest.status === "error" ? (
          <div className="px-4 md:px-0">
            <SectionError onRetry={newest.retry}>
              {t("The catalogue is unavailable right now.")}
            </SectionError>
          </div>
        ) : newestItems.length === 0 ? (
          <EmptyState title={t("No games published yet")} />
        ) : (
          <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 md:grid md:grid-cols-4 md:px-0 lg:grid-cols-5">
            {newestItems.map((game) => (
              <GameCard key={game.slug} game={game} className="w-36 shrink-0 md:w-auto" />
            ))}
          </div>
        )}
      </Section>

      {/* Hidden until something has been played: an empty "Popular" row says
          nothing a player can use. */}
      {catalogue.status === "ready" && popular.length > 0 && (
        <Section title={t("Popular")} action={<More to="/popular" />}>
          <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 md:grid md:grid-cols-4 md:px-0 lg:grid-cols-5">
            {popular.map((game, i) => (
              <GameCard
                key={game.slug}
                game={game}
                rank={i + 1}
                className="w-36 shrink-0 md:w-auto"
              />
            ))}
          </div>
        </Section>
      )}
    </Page>
  );
}
