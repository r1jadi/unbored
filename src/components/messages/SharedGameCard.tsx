import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import type { ReactNode } from "react";

import { GameArt } from "@/components/game/GameArt";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGame } from "@/lib/games/catalog";
import { t } from "@/lib/settings/language";

/**
 * A game someone shared in a chat. A game that can't be read, or no longer exists, falls
 * back to `fallback`, the message as text: the link is still what was sent.
 */
export function SharedGameCard({ slug, fallback }: { slug: string; fallback: ReactNode }) {
  const state = useGame(slug);

  if (state.status === "loading") {
    return <Skeleton className="h-52 w-56 rounded-2xl" />;
  }
  if (state.status !== "ready") return <>{fallback}</>;

  const { game } = state;
  return (
    <div className="w-56 overflow-hidden rounded-2xl border border-border bg-surface">
      <Link to="/games/$id" params={{ id: game.slug }} className="block">
        <GameArt id={game.slug} className="aspect-video w-full" />
        <span className="block px-3 pt-2.5 text-sm font-semibold">{game.title}</span>
        {game.tagline && (
          <span className="line-clamp-2 block px-3 pt-0.5 text-xs text-muted-foreground">
            {game.tagline}
          </span>
        )}
      </Link>
      {game.playable && (
        <div className="p-3">
          <Button asChild size="sm" className="w-full">
            <Link to="/play/$id" params={{ id: game.slug }} search={{ start: true }}>
              <Play /> {t("Play")}
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
