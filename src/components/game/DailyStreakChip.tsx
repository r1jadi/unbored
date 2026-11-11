import { Flame, Snowflake } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dailyStreakStatus, useMyDailyStreak } from "@/lib/games/streaks";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

/**
 * The streak across every game, always in view on the feed: a flame and the days.
 * It is lit in the accent colour while today still needs a game, and a tap says
 * what keeps it and how many freezes are saved. Nothing for a guest or a player
 * with no streak.
 */
export function DailyStreakChip({ className }: { className?: string }) {
  const streak = useMyDailyStreak();
  if (!streak.data) return null;
  const status = dailyStreakStatus(streak.data);
  if (status === "none") return null;
  const { streak: days, freezes } = streak.data;
  const owed = status === "owed";
  const label = days === 1 ? t("1-day streak") : t("{streak}-day streak", { streak: days });

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "press inline-flex h-9 items-center gap-1 rounded-full glass px-3 text-sm font-semibold tabular",
          owed ? "text-primary" : "text-foreground",
          className,
        )}
        aria-label={owed ? t("{days}. Play one game today to keep it.", { days: label }) : label}
      >
        <Flame className={cn("size-4 text-primary", owed && "animate-pulse")} aria-hidden />
        {days}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 text-sm">
        <p className="flex items-center gap-1.5 font-semibold">
          <Flame className="size-4 text-primary" aria-hidden />
          {label}
        </p>
        <p className="mt-1 text-muted-foreground">
          {owed
            ? t("Play any game today to keep it going.")
            : t("Today's game is in. Come back tomorrow to add a day.")}
        </p>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Snowflake className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {freezes === 0
            ? t(
                "Miss one day and it waits for you. Every 7 days earns a freeze for a longer break.",
              )
            : freezes === 1
              ? t("1 freeze saved: it covers one more missed day.")
              : t("{n} freezes saved: they cover {n} more missed days.", { n: freezes })}
        </p>
      </PopoverContent>
    </Popover>
  );
}
