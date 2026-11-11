import { Link } from "@tanstack/react-router";
import { Check, CalendarDays, Flame } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { GameArt } from "@/components/game/GameArt";
import { useAuth } from "@/lib/auth/session";
import { type Game } from "@/lib/games/catalog";
import { fetchMyGameStreak, streakStatus, useMyGameStreak } from "@/lib/games/streaks";
import { getQueryClient } from "@/lib/query";
import { t } from "@/lib/settings/language";
import { cn } from "@/lib/utils";

/** Time to the player's next midnight, which is when the daily games turn over. */
function untilMidnight(now: Date): string {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const minutes = Math.max(0, Math.ceil((midnight.getTime() - now.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0
    ? t("{hours}h {minutes}m", { hours, minutes: minutes % 60 })
    : t("{minutes}m", { minutes });
}

function useCountdown(): string | null {
  // Null on the server and the first client render, so the two agree.
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setLabel(untilMidnight(new Date()));
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
  return label;
}

function DailyRow({ game, signedIn }: { game: Game; signedIn: boolean }) {
  const streak = useMyGameStreak(game.slug, game.playable);
  const status = streak.data ? streakStatus(streak.data) : "none";
  const days = status === "none" ? 0 : (streak.data?.streak ?? 0);
  const done = status === "done";
  return (
    <li>
      <Link
        to={game.playable ? "/play/$id" : "/games/$id"}
        params={{ id: game.slug }}
        className="press flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2"
      >
        <GameArt id={game.slug} className="size-11 shrink-0 rounded-lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{game.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {!game.playable
              ? t("Not playable yet.")
              : done
                ? t("Done for today")
                : signedIn
                  ? t("One ranked attempt a day.")
                  : t("Practise as often as you like.")}
          </span>
        </span>
        {days > 0 && (
          <span
            className="flex items-center gap-1 text-xs font-semibold text-primary tabular"
            aria-label={t("{streak}-day streak", { streak: days })}
          >
            <Flame className="size-3.5" aria-hidden />
            {days}
          </span>
        )}
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full border",
            done ? "border-primary bg-primary text-primary-foreground" : "border-border",
          )}
          aria-label={done ? t("Done for today") : t("Not played today")}
          role="img"
        >
          {done && <Check className="size-3.5" aria-hidden />}
        </span>
      </Link>
    </li>
  );
}

/**
 * How many of today's games are done, from the same streak reads the rows make (one
 * cache entry each), so the ring and the ticks never disagree.
 */
function useDoneToday(games: readonly Game[], signedIn: boolean): number {
  const results = useQueries(
    {
      queries: games.map((game) => ({
        queryKey: ["my-game-streak", game.slug, signedIn],
        queryFn: () => fetchMyGameStreak(game.slug),
        enabled: signedIn && game.playable,
        staleTime: 30_000,
      })),
    },
    getQueryClient(),
  );
  return results.filter((result) => result.data && streakStatus(result.data) === "done").length;
}

/** A ring that fills as the day's games are played, with the count inside. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const filled = total === 0 ? 0 : (done / total) * circumference;
  return (
    <span
      className="relative flex size-10 shrink-0 items-center justify-center"
      role="img"
      aria-label={t("{done} of {total} done today", { done, total })}
    >
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={radius} fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="3"
          // A round end on an empty ring would draw a dot.
          strokeLinecap={done > 0 ? "round" : "butt"}
          strokeDasharray={`${filled} ${circumference}`}
          className="transition-[stroke-dasharray] duration-500 motion-reduce:transition-none"
        />
      </svg>
      <span className="text-[11px] font-semibold tabular">
        {done}/{total}
      </span>
    </span>
  );
}

/**
 * Today at a glance: the daily games, whether each is done, the streak riding on it,
 * and how long is left. The streak comes from the database, in the player's own time
 * zone, so what this says matches what the game page says.
 */
export function DailyWidget({ games }: { games: readonly Game[] }) {
  const signedIn = useAuth().status === "authenticated";
  const countdown = useCountdown();
  const playable = games.filter((game) => game.playable);
  const done = useDoneToday(playable, signedIn);
  if (games.length === 0) return null;
  const allDone = signedIn && playable.length > 0 && done === playable.length;
  return (
    <section
      aria-label={t("Today's challenge")}
      className="mt-4 rounded-2xl border border-glass-border bg-surface p-3"
    >
      <div className="mb-1 flex items-center justify-between gap-2 px-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <CalendarDays className="size-3.5" aria-hidden />
            {t("Today's challenge")}
          </p>
          {countdown && (
            <p className="mt-0.5 text-xs text-muted-foreground tabular">
              {allDone
                ? t("All done. New ones in {time}", { time: countdown })
                : t("New in {time}", { time: countdown })}
            </p>
          )}
        </div>
        {signedIn && playable.length > 0 && <ProgressRing done={done} total={playable.length} />}
      </div>
      <ul>
        {games.map((game) => (
          <DailyRow key={game.slug} game={game} signedIn={signedIn} />
        ))}
      </ul>
    </section>
  );
}
