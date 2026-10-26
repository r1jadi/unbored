import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";

import { RulesList } from "@/components/game/RulesList";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Game } from "@/lib/games/catalog";
import { rulesFor } from "@/lib/games/rules";

/**
 * A game's full rules, from the feed, without leaving it.
 *
 * The rules are the ones the game's own rules screen shows (`GAME_RULES`), so
 * the two cannot disagree. A game whose runtime has no rules written falls back
 * to the catalogue's instructions. Tap to play at the bottom starts the run
 * straight away, as the feed's own button does.
 */
export function HowToPlaySheet({
  open,
  onOpenChange,
  game,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  game: Pick<Game, "slug" | "title" | "runtime" | "instructions" | "playable">;
}) {
  const rules = rulesFor(game.runtime);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[85dvh] max-w-xl overflow-y-auto rounded-t-2xl border-glass-border pb-[max(2rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader>
          <SheetTitle>How to play {game.title}</SheetTitle>
          <SheetDescription>{rules?.summary ?? "The rules, before you start."}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pt-2">
          {rules ? (
            <RulesList rules={rules.rules} />
          ) : (
            <p className="rounded-2xl bg-surface p-4 text-sm">
              {game.instructions ?? "The rules for this game are not written yet."}
            </p>
          )}
          {game.playable && (
            <Button asChild variant="play" size="lg">
              <Link to="/play/$id" params={{ id: game.slug }} search={{ start: true }}>
                <Play className="fill-current" /> Tap to play
              </Link>
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
