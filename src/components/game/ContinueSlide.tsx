import { Link } from "@tanstack/react-router";
import { ArrowDown, History, Play } from "lucide-react";

import { GameArt } from "@/components/game/GameArt";
import { Button } from "@/components/ui/button";
import { savedAgo, useMySavedRuns } from "@/lib/games/saved-runs-list";
import { t } from "@/lib/settings/language";

/**
 * The first slide of For You when a run is waiting: the newest saved run, big, with
 * one tap to pick it up, and any others underneath. Swiping past it is "not now".
 * Nothing at all for a guest or a player with nothing saved.
 */
export function ContinueSlide() {
  const runs = useMySavedRuns().data ?? [];
  const [first, ...rest] = runs;
  if (!first) return null;

  return (
    <article
      className="relative flex h-dvh snap-start snap-always items-stretch justify-center md:py-6"
      aria-label={t("Continue where you left off")}
      data-continue
    >
      <div className="relative flex w-full max-w-[460px] flex-col items-center justify-center gap-5 overflow-hidden bg-surface px-6 pt-[calc(var(--safe-top)+4rem)] pb-[calc(6rem+env(safe-area-inset-bottom))] text-center md:rounded-2xl md:border md:border-glass-border md:pb-6">
        <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
          <History className="size-4" aria-hidden />
          {t("Continue where you left off")}
        </p>
        <GameArt id={first.gameSlug} className="aspect-square w-56 rounded-2xl" />
        <div>
          <h2 className="text-2xl font-semibold">{first.gameTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Saved {when}", { when: savedAgo(first.savedAt) })}
          </p>
        </div>
        <Button asChild variant="play" size="lg" className="w-full max-w-xs">
          <Link to="/play/$id" params={{ id: first.gameSlug }}>
            <Play className="fill-current" />
            {t("Continue {title}", { title: first.gameTitle })}
          </Link>
        </Button>
        {rest.length > 0 && (
          <ul className="flex w-full max-w-xs flex-col gap-1">
            {rest.map((run) => (
              <li key={run.gameSlug}>
                <Link
                  to="/play/$id"
                  params={{ id: run.gameSlug }}
                  className="press flex items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-surface-2"
                >
                  <GameArt id={run.gameSlug} className="size-9 shrink-0 rounded-lg" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{run.gameTitle}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("Saved {when}", { when: savedAgo(run.savedAt) })}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="absolute bottom-[calc(5.5rem+env(safe-area-inset-bottom))] flex items-center gap-1 text-xs text-muted-foreground md:bottom-4">
          <ArrowDown className="size-3.5" aria-hidden />
          {t("Swipe for new games")}
        </p>
      </div>
    </article>
  );
}
