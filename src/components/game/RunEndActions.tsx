import { Link } from "@tanstack/react-router";
import { History, Home, RotateCcw, Share2, Trophy, Users } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { InstallAsk } from "@/components/game/InstallAsk";
import { StreakNote } from "@/components/game/StreakNote";
import { Button } from "@/components/ui/button";
import { titleFromSlug, useGame } from "@/lib/games/catalog";
import { useMyDailyRank } from "@/lib/games/daily-rank";
import { hasContinuableRun } from "@/lib/games/saved-runs";
import { shareResult, shareText, type DailyShare } from "@/lib/games/share";
import { useProfile } from "@/lib/users/profile";

import { t } from "@/lib/settings/language";
/**
 * What a player can do once a run is over, shared by every game's result screen.
 *
 * Play again is the one big button. The two ways out — back to the For You feed
 * and the leaderboard — sit side by side under it at equal weight, so leaving is
 * as easy to find as the leaderboard without stacking a third full-width button.
 * For You lands on this game's card, so the player carries on from where they
 * were in the feed rather than from the top. A guest's sign-in prompt is a plain text link: an offer, not another choice.
 *
 * `children` replaces Play again when a run cannot be replayed (7 Second's daily
 * ranked attempt shows when the next deck arrives instead).
 *
 * Share sits beside Play again: a ready message with the score and a "beat me"
 * link to this game, plus a spoiler-free grid for a daily game (`daily`). Where
 * there is no Play again, Share is the main button.
 */
export function RunEndActions({
  slug,
  ranked,
  onRestart,
  autoFocus,
  children,
  score,
  daily,
  sessionId,
}: {
  slug: string;
  ranked: boolean;
  onRestart?: () => void;
  autoFocus?: boolean;
  children?: ReactNode;
  /** The verified score, which the share message reports. */
  score?: number;
  /** A daily game's day, short result and spoiler-free grid. */
  daily?: DailyShare;
  /** A daily run's session, to say where it stands among today's players. */
  sessionId?: string;
}) {
  // Everyone plays the same daily board, so a ranked daily run can be compared.
  const rank = useMyDailyRank(sessionId, ranked && daily !== undefined).data ?? null;
  const shared = daily && rank ? { ...daily, beatPercent: rank.percent } : daily;
  // The player ended this run themselves: it's saved, and the next start offers it.
  const continuable = hasContinuableRun(slug);
  const play = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Focused without scrolling: on a short screen the result scrolls, and opening
    // it scrolled down to the button would hide the score the player came to see.
    if (autoFocus) play.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  return (
    <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
      {/* A ranked run is a day played: the streak it just kept goes first. */}
      {ranked && <StreakNote slug={slug} className="pb-1" />}
      {rank && (
        <p className="inline-flex items-center justify-center gap-1.5 pb-1 text-sm">
          <Users className="size-4 shrink-0 text-primary" aria-hidden />
          {t("You beat {percent}% of today's {players} players.", {
            percent: rank.percent,
            players: rank.players.toLocaleString(),
          })}
        </p>
      )}
      {children}
      {!children && onRestart ? (
        <div className="flex gap-2">
          <Button ref={play} variant="play" size="lg" className="flex-1" onClick={onRestart}>
            {continuable ? <History /> : <RotateCcw />}
            {continuable ? t("Continue or start over") : t("Play again")}
          </Button>
          {score !== undefined && (
            <ShareResultButton slug={slug} score={score} daily={shared} variant="secondary" />
          )}
        </div>
      ) : (
        score !== undefined && (
          <ShareResultButton slug={slug} score={score} daily={shared} variant="play" />
        )
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button asChild variant="secondary" size="lg" className="px-3">
          <Link to="/" search={{ game: slug }}>
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
      {/* After a third finished game: add to the Home Screen, turn on push. */}
      <InstallAsk />
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

/** Shares the result: the device's share sheet, or the clipboard where there is none. */
function ShareResultButton({
  slug,
  score,
  daily,
  variant,
}: {
  slug: string;
  score: number;
  daily?: DailyShare;
  variant: "play" | "secondary";
}) {
  // The play screen has already loaded this game, so the title is in the cache.
  const game = useGame(slug);
  // Signed in, the link names the sharer, so a friend can follow them from it.
  const profile = useProfile();
  const from = profile.status === "ready" ? profile.profile.username : undefined;
  const title = game.status === "ready" ? game.game.title : titleFromSlug(slug);
  return (
    <Button
      variant={variant}
      size="lg"
      onClick={() => void shareResult(title, shareText({ slug, title, score, daily, from }))}
    >
      <Share2 />
      {variant === "play" ? t("Share result") : t("Share")}
    </Button>
  );
}
