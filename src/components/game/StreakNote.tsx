import { Flame } from "lucide-react";

import { cn } from "@/lib/utils";
import { streakLine, streakStatus, useMyGameStreak } from "@/lib/games/streaks";

/**
 * The player's streak in a game, in one line: how many days, and what keeps it.
 * Nothing for a guest, a player with no streak, or a read that failed — a
 * streak that was not measured is not shown as zero.
 */
export function StreakNote({ slug, className }: { slug: string; className?: string }) {
  const streak = useMyGameStreak(slug);
  if (!streak.data) return null;
  const line = streakLine(streak.data);
  if (!line) return null;
  const atRisk = streakStatus(streak.data) === "rest";
  return (
    <p
      className={cn(
        "inline-flex items-center justify-center gap-1.5 text-sm",
        atRisk ? "text-primary" : "text-muted-foreground",
        className,
      )}
    >
      <Flame className="size-4 shrink-0 text-primary" />
      {line}
    </p>
  );
}
