import { Link } from "@tanstack/react-router";
import { Home } from "lucide-react";

import { ExitGameLink } from "@/components/game/ExitGameLink";
import { Button } from "@/components/ui/button";

/**
 * The two ways out of a game screen that has nothing left to play — a daily
 * attempt already used, a run that could not be verified, a game that cannot
 * start: back to the For You feed, or back to the game's page. They share one
 * row at equal weight, under whatever the screen's own main action is, so
 * leaving is always visible without stacking another full-width button.
 *
 * `title` omitted (a screen with no game to go back to) leaves For You alone.
 */
export function GameExits({ slug, title }: { slug?: string; title?: string }) {
  const feed = (
    <Button asChild variant="secondary" size="lg" className="px-3">
      <Link to="/">
        <Home />
        For You
      </Link>
    </Button>
  );

  if (!slug || !title) {
    return <div className="mx-auto grid w-full max-w-xs">{feed}</div>;
  }

  return (
    <div className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2">
      {feed}
      <Button asChild variant="secondary" size="lg" className="min-w-0 px-3">
        <ExitGameLink slug={slug} aria-label={`Back to ${title}`}>
          <span className="truncate">{title}</span>
        </ExitGameLink>
      </Button>
    </div>
  );
}
