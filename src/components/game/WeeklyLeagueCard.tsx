import { Link } from "@tanstack/react-router";
import { ChevronRight, Trophy, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth/session";
import { leagueStanding, untilReset } from "@/lib/games/league";
import { useOverallBoard } from "@/lib/games/overall-board";
import { t } from "@/lib/settings/language";
import { FOLLOWING_SCAN, useFollowedUsernames } from "@/lib/social/followed";

function useResetCountdown(): string | null {
  // Null on the server and the first client render, so the two agree.
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setLabel(untilReset(new Date()));
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);
  return label;
}

/**
 * This week's league at a glance: your place among the people you follow, who is
 * just ahead and by how much, and when it resets. A tap opens the full table on
 * Ranks. Signed-in players only; someone who follows nobody is shown how to start.
 */
export function WeeklyLeagueCard() {
  const auth = useAuth();
  const userId = auth.status === "authenticated" ? auth.session.userId : undefined;
  const followed = useFollowedUsernames(userId);
  const board = useOverallBoard({
    period: "this-week",
    limit: FOLLOWING_SCAN,
    enabled: userId !== undefined,
  });
  const countdown = useResetCountdown();

  if (!userId || followed.status !== "ready" || board.status !== "ready" || !followed.me) {
    return null;
  }

  const shell =
    "mt-4 flex items-center gap-3 rounded-2xl border border-glass-border bg-surface p-4";

  if (followed.following === 0) {
    return (
      <Link to="/search" className={`press ${shell}`}>
        <Users className="size-5 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{t("Start a weekly league")}</span>
          <span className="block text-xs text-muted-foreground">
            {t("Follow a few players and race them every week. It resets on Monday.")}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    );
  }

  const standing = leagueStanding(
    board.board.entries,
    followed.usernames,
    board.board.me,
    followed.me,
  );

  return (
    <Link
      to="/leaderboards"
      search={{ scope: "friends", period: "this-week" }}
      className={`press ${shell}`}
      aria-label={t("This week's league")}
    >
      <span className="flex size-11 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Trophy className="size-4" aria-hidden />
        {standing && <span className="text-xs font-bold tabular">#{standing.position}</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">
          {standing
            ? t("#{position} of {size} in your league", {
                position: standing.position,
                size: standing.size,
              })
            : t("This week's league")}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {!standing
            ? t("Play any game to join this week's table.")
            : standing.ahead
              ? t("@{username} is {gap} ahead.", {
                  username: standing.ahead.username,
                  gap: standing.ahead.gap.toLocaleString(),
                })
              : t("You're top. Stay there.")}
          {countdown && ` · ${t("Resets in {time}", { time: countdown })}`}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
