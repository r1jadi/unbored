import { Link } from "@tanstack/react-router";
import { Play, Sparkles } from "lucide-react";
import { GameArt } from "@/components/game/GameArt";
import { Button } from "@/components/ui/button";
import { formatAgo } from "@/lib/admin/api";
import { newGameOf, type AppNotification } from "@/lib/notifications/store";
import { msg, t, translateContent } from "@/lib/settings/language";
import { cn } from "@/lib/utils";

const HOOKS = [
  msg("Clear your schedule. {game} just landed."),
  msg("Fresh out of the oven: {game}."),
  msg("Your next high score starts here: {game}."),
  msg("New game, wide-open leaderboard. {game} is up for grabs."),
];

/** The same game always gets the same line, so it doesn't change on a reload. */
function hookFor(slug: string): string {
  let hash = 2166136261;
  for (const char of slug) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  // The high bits: a simple hash's low bits repeat, which gave most games one line.
  return HOOKS[(hash >>> 16) % HOOKS.length]!;
}

/**
 * A new game in the inbox: the one notification that is an invitation, so it looks
 * like one. It shows the game's own art, and a shine crosses it once while it's new.
 */
export function NewGameCard({ item }: { item: AppNotification }) {
  const game = newGameOf(item);
  if (!game) return null;
  const tagline = translateContent(game.tagline);
  return (
    <li
      className={cn(
        "enter relative mx-4 my-2 list-none overflow-hidden rounded-2xl bg-surface p-3 ring-1 md:mx-0",
        item.readAt ? "ring-border" : "new-game-shine ring-primary/50",
      )}
    >
      <div className="relative flex items-center gap-3">
        <Link
          to="/games/$id"
          params={{ id: game.slug }}
          tabIndex={-1}
          aria-hidden
          className="shrink-0"
        >
          <GameArt id={game.slug} className="size-20 rounded-xl" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-xs font-medium text-primary">
            <Sparkles className="size-3" aria-hidden />
            {t("New game")}
            <span className="font-normal text-muted-foreground">
              {" "}
              · {formatAgo(item.createdAt) ?? t("recently")}
            </span>
          </p>
          <p className="mt-0.5 text-sm font-semibold text-balance">
            {t(hookFor(game.slug), { game: game.title })}
          </p>
          {tagline && <p className="mt-0.5 truncate text-xs text-muted-foreground">{tagline}</p>}
        </div>
        <Button asChild size="sm" variant="play" className="shrink-0">
          <Link
            to="/play/$id"
            params={{ id: game.slug }}
            search={{ start: true }}
            aria-label={t("Play {game}", { game: game.title })}
          >
            <Play className="fill-current" aria-hidden />
            {t("Play")}
          </Link>
        </Button>
      </div>
    </li>
  );
}
