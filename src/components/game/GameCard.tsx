import { Link } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { GameArt } from "./GameArt";
import { categoryName, isDaily, type Game } from "@/lib/games/catalog";
import { cn } from "@/lib/utils";

import { t } from "@/lib/settings/language";
/**
 * A catalogue card.
 *
 * What it no longer shows is as deliberate as what it does. The old card carried
 * a play count and a creator handle, both of which came from fixture data; the
 * API returns neither, because nothing counts plays yet and there is no public
 * profile endpoint to resolve a creator into a name. The scrim now carries the
 * one fact the catalogue can actually state — whether the game can be played —
 * and the badge marks the daily challenge, derived from the game's category.
 */
export function GameCard({
  game,
  className,
  rank,
}: {
  game: Game;
  className?: string;
  rank?: number;
}) {
  const category = categoryName(game);
  const daily = isDaily(game);

  return (
    <Link
      to="/games/$id"
      params={{ id: game.slug }}
      className={cn("press group block enter", className)}
    >
      <div className="relative overflow-hidden rounded-xl border border-glass-border">
        <GameArt id={game.slug} className="aspect-[4/5] w-full" />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-2.5 scrim-bottom">
          {!game.playable && (
            <span className="inline-flex items-center gap-1 text-xs font-medium">
              <Clock className="size-3" />
              {t("Not playable yet")}
            </span>
          )}
          {rank && <span className="ml-auto font-mono text-xs text-muted-foreground">#{rank}</span>}
        </div>
        {daily && (
          <span className="absolute top-2 left-2 rounded-md glass px-1.5 py-0.5 text-[11px] font-medium">
            {t("Daily")}
          </span>
        )}
      </div>
      <p className="mt-2 truncate text-sm font-medium">{game.title}</p>
      <p className="truncate text-xs text-muted-foreground">{category ?? game.tagline ?? " "}</p>
    </Link>
  );
}

export function GameRow({
  game,
  meta,
  action,
}: {
  game: Game;
  meta?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="enter flex items-center gap-3 px-4 py-3 md:px-0">
      <Link
        to="/games/$id"
        params={{ id: game.slug }}
        className="press flex min-w-0 flex-1 items-center gap-3"
      >
        <GameThumb game={game} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{game.title}</p>
          <p className="truncate text-xs text-muted-foreground">{meta ?? defaultMeta(game)}</p>
        </div>
      </Link>
      {action}
    </div>
  );
}

/**
 * The one-line description a row falls back to. It states the playability rather
 * than a count: the API has no play count to show, and "0 plays" would read as a
 * measurement rather than as an absence.
 */
function defaultMeta(game: Game): string {
  const category = categoryName(game);
  const status = game.playable ? t("Playable") : t("Not playable yet");
  return category ? `${category} · ${status}` : status;
}

export function GameThumb({ game, className }: { game: Game; className?: string }) {
  return (
    <span
      className={cn(
        "relative block size-14 shrink-0 overflow-hidden rounded-lg border border-glass-border",
        className,
      )}
    >
      <GameArt
        id={game.slug}
        className="absolute top-0 left-0 size-40 origin-top-left scale-[0.35]"
      />
    </span>
  );
}
