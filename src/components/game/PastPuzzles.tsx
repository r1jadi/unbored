import { Link } from "@tanstack/react-router";
import { History } from "lucide-react";
import { useEffect, useState } from "react";

import { archiveDays } from "@/lib/games/archive";
import type { Game } from "@/lib/games/catalog";
import { dayDate } from "@/lib/games/share";
import { t } from "@/lib/settings/language";

/** The runtimes whose board is the day: the crossword, Guesswork and 7 Second. */
const ARCHIVE_RUNTIMES = new Set(["crossword", "guesswork", "seven-second"]);

/** How many past days the game page lists; the archive itself goes back further. */
const SHOWN_DAYS = 14;

function hasArchive(game: Pick<Game, "runtime" | "playable">): boolean {
  return game.playable && !!game.runtime && ARCHIVE_RUNTIMES.has(game.runtime);
}

/**
 * The last two weeks of a daily game, each a tap from being played as practice:
 * for the days a player missed, or a puzzle they want another go at. Today's stays
 * the ranked one, so it isn't listed.
 */
export function PastPuzzles({ game }: { game: Game }) {
  // The days depend on this device's date, which the server render doesn't know.
  const [days, setDays] = useState<number[] | null>(null);
  useEffect(() => setDays(archiveDays().slice(0, SHOWN_DAYS)), []);
  if (!hasArchive(game) || !days) return null;

  return (
    <section className="mt-4 rounded-xl border border-border p-4" aria-label={t("Past puzzles")}>
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <History className="size-4 text-primary" aria-hidden />
        {t("Past puzzles")}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("Missed a day? Play it as practice. Only today's puzzle counts for the leaderboard.")}
      </p>
      <ul className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
        {days.map((day) => (
          <li key={day} className="shrink-0">
            <Link
              to="/play/$id"
              params={{ id: game.slug }}
              search={{ day, start: true }}
              className="press flex h-9 items-center rounded-full bg-surface-2 px-3 text-xs font-medium tabular"
            >
              {dayDate(day)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
