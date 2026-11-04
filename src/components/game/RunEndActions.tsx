import { Link } from "@tanstack/react-router";
import { Home, RotateCcw, Trophy } from "lucide-react";
import type { ReactNode } from "react";

import { StreakNote } from "@/components/game/StreakNote";
import { Button } from "@/components/ui/button";

import { t } from "@/lib/settings/language";
/**
 * What a player can do once a run is over, shared by every game's result screen.
 *
 * Play again is the one big button. The two ways out — back to the For You feed
 * and the leaderboard — sit side by side under it at equal weight, so leaving is
 * as easy to find as the leaderboard without stacking a third full-width button.
 * A guest's sign-in prompt is a plain text link: an offer, not another choice.
 *
 * `children` replaces Play again when a run cannot be replayed (7 Second's daily
 * ranked attempt shows when the next deck arrives instead).
 */
export function RunEndActions({
  slug,
  ranked,
  onRestart,
  autoFocus,
  children,
}: {
  slug: string;
  ranked: boolean;
  onRestart?: () => void;
  autoFocus?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
      {/* A ranked run is a day played: the streak it just kept goes first. */}
      {ranked && <StreakNote slug={slug} className="pb-1" />}
      {children ||
        (onRestart && (
          <Button variant="play" size="lg" onClick={onRestart} autoFocus={autoFocus}>
            <RotateCcw />
            {t("Play again")}
          </Button>
        ))}
      <div className="grid grid-cols-2 gap-2">
        <Button asChild variant="secondary" size="lg" className="px-3">
          <Link to="/">
            <Home />
            {t("For You")}
          </Link>
        </Button>
        <Button asChild variant="secondary" size="lg" className="px-3">
          <Link to="/leaderboards/$id" params={{ id: slug }}>
            <Trophy />
            {t("Leaderboard")}
          </Link>
        </Button>
      </div>
      {/* A guest's run is over and was not ranked: the moment an account means
          most. This run cannot be claimed afterwards (a guest session has no
          owner), so the offer is about the next one, said plainly. */}
      {!ranked && (
        <div className="mt-2 rounded-xl bg-surface p-3 text-left">
          <p className="text-sm font-medium">{t("Guest runs aren't ranked")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(
              "Make a free account and your next score goes on the leaderboard, with a streak to keep.",
            )}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Button asChild variant="secondary" size="sm">
              <Link to="/signup">{t("Create a free account")}</Link>
            </Button>
            <Button asChild variant="link" size="sm" className="px-1 text-muted-foreground">
              <Link to="/login" search={{ redirect: `/games/${slug}` }}>
                {t("Sign in to rank your scores")}
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
