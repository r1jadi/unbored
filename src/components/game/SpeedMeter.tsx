import { Timer } from "lucide-react";
import { useEffect, useState } from "react";

import { points } from "@/lib/format";
import { speedBonus } from "@/lib/games/speed";
import { t } from "@/lib/settings/language";

/** Milliseconds as `m:ss`. */
export function formatRunTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * How the run is doing against par: time counting up, never down, and the bonus the
 * solved boards are earning so far. Nothing happens when it passes par except that
 * the bonus reaches nothing. It is an estimate; the server decides the real bonus.
 */
export function SpeedMeter({
  startedAt,
  score,
  solvedParMs,
  boardParMs,
  running,
}: {
  /** When the run started, as a `Date.now()` timestamp. */
  startedAt: number;
  /** The points scored so far. */
  score: number;
  /** The par of the boards already solved. */
  solvedParMs: number;
  /** The par of those boards and the one being played. */
  boardParMs: number;
  running: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);

  const elapsed = Math.max(0, now - startedAt);
  const bonus = speedBonus(score, solvedParMs, elapsed);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular">
      <Timer aria-hidden className="size-3.5" />
      <span>{formatRunTime(elapsed)}</span>
      <span>{t("par {time}", { time: formatRunTime(boardParMs) })}</span>
      {bonus > 0 && (
        <span className="font-medium text-primary">
          {t("+{bonus} speed", { bonus: points(bonus) })}
        </span>
      )}
    </span>
  );
}

/** The bonus a finished run earned, on its result screen: what the server added. */
export function SpeedBonusStat({ verified, played }: { verified: number; played: number }) {
  const bonus = verified - played;
  if (bonus <= 0) return null;
  return (
    <div className="rounded-xl bg-surface p-3">
      <dt className="text-xs text-muted-foreground">{t("Speed bonus")}</dt>
      <dd className="font-semibold tabular text-primary">+{points(bonus)}</dd>
    </div>
  );
}
