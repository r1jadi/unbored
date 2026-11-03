import { createFileRoute, Link } from "@tanstack/react-router";
import { Brain, Calendar, Gamepad2, Puzzle, Swords, Type, Zap, Lightbulb } from "lucide-react";
import { ErrorState, GridSkeleton, Page, PageHeader } from "@/components/common";
import { catalogErrorMessage, useCategories } from "@/lib/games/catalog";
import { seo } from "@/lib/seo";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/categories/")({
  head: () => seo(t("Categories"), t("Browse every game category on Unbored.")),
  component: Categories,
});

const icons: Record<string, typeof Puzzle> = {
  puzzle: Puzzle,
  arcade: Gamepad2,
  logic: Lightbulb,
  reaction: Zap,
  memory: Brain,
  daily: Calendar,
  word: Type,
  strategy: Swords,
};

/**
 * Every category, with its real published-game count.
 *
 * The count comes from the database (a view over `games` filtered to published),
 * not from a client-side tally, so a category whose only game is a draft reads
 * zero rather than one.
 */
function Categories() {
  const state = useCategories();

  return (
    <Page>
      <PageHeader back title={t("Categories")} subtitle={t("Every kind of quick game.")} />
      {state.status === "loading" && (
        <div className="px-4 md:px-0">
          <GridSkeleton count={8} />
        </div>
      )}
      {state.status === "error" && (
        <ErrorState
          title={t("Couldn't load categories")}
          body={catalogErrorMessage(state.error)}
          onRetry={state.retry}
        />
      )}
      {state.status === "ready" && (
        <div className="grid grid-cols-2 gap-3 px-4 md:grid-cols-3 md:px-0">
          {/* A category with no published game is a dead end, so it waits until it has one. */}
          {state.items
            .filter((c) => c.gameCount > 0)
            .map((c) => {
              const Icon = icons[c.slug] ?? Puzzle;
              return (
                <Link
                  key={c.slug}
                  to="/categories/$slug"
                  params={{ slug: c.slug }}
                  className="press enter flex flex-col gap-6 rounded-xl border border-border bg-surface p-4 hover:bg-surface-2"
                >
                  <Icon className="size-5 text-muted-foreground" strokeWidth={1.75} />
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground tabular">
                      {c.gameCount} {c.gameCount === 1 ? t("game") : t("games")}
                    </p>
                  </div>
                </Link>
              );
            })}
        </div>
      )}
    </Page>
  );
}
