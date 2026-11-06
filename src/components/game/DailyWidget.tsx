import { Link } from "@tanstack/react-router";
import { Check, CalendarDays, Flame } from "lucide-react";
import { useEffect, useState } from "react";

import { GameArt } from "@/components/game/GameArt";
import { useAuth } from "@/lib/auth/session";
import { type Game } from "@/lib/games/catalog";
import { streakStatus, useMyGameStreak } from "@/lib/games/streaks";
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
 * Today at a glance: the daily games, whether each is done, the streak riding on it,
 * and how long is left. The streak comes from the database, in the player's own time
 * zone, so what this says matches what the game page says.
 */
export function DailyWidget({ games }: { games: readonly Game[] }) {
  const signedIn = useAuth().status === "authenticated";
  const countdown = useCountdown();
  if (games.length === 0) return null;
  return (
    <section
      aria-label={t("Today's challenge")}
      className="mt-4 rounded-2xl border border-glass-border bg-surface p-3"
    >
      <div className="mb-1 flex items-center justify-between gap-2 px-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
          <CalendarDays className="size-3.5" aria-hidden />
          {t("Today's challenge")}
        </p>
        {countdown && (
          <p className="text-xs text-muted-foreground tabular">
            {t("New in {time}", { time: countdown })}
          </p>
        )}
      </div>
      <ul>
        {games.map((game) => (
          <DailyRow key={game.slug} game={game} signedIn={signedIn} />
        ))}
      </ul>
    </section>
  );
}
