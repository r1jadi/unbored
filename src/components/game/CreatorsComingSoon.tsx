import { Link } from "@tanstack/react-router";
import { Hammer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/settings/language";

/** A play button, tile by tile: the game this screen is still putting together. */
const PLAY_TILES = ["#......", "###....", "#####..", "#######", "#####..", "###....", "#......"];

/**
 * What the Following feed shows while games only come from the Unbored team.
 *
 * Tiles assemble into a play button from the left and clear again, on a loop. It
 * is decoration, so it is hidden from assistive technology, and with reduced
 * motion the tiles simply stay lit (see `.workshop-tile`).
 */
export function CreatorsComingSoon() {
  return (
    <section className="enter mx-4 overflow-hidden rounded-2xl bg-surface md:mx-0">
      <div className="flex flex-col items-center px-6 py-10 text-center">
        <div
          aria-hidden
          data-testid="workshop-board"
          className="grid grid-cols-7 gap-1 rounded-2xl bg-background p-4 ring-1 ring-border"
        >
          {PLAY_TILES.flatMap((row, y) =>
            [...row].map((cell, x) => (
              // Every cell has a slot, so the board stays a whole grid between loops.
              <span key={`${x}-${y}`} className="relative size-4 rounded-[3px] bg-surface-2">
                {cell === "#" && (
                  <span
                    className="workshop-tile absolute inset-0 rounded-[3px] bg-primary"
                    style={{ animationDelay: `${x * 140 + Math.abs(y - 3) * 60}ms` }}
                  />
                )}
              </span>
            )),
          )}
        </div>

        <p className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">
          <Hammer className="size-3" aria-hidden />
          {t("Coming soon")}
        </p>
        <h2 className="mt-3 text-xl font-semibold text-balance">
          {t("Player-made games are on the way")}
        </h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {t(
            "One day you'll build your own games here, and this feed will fill up with games from the people you follow. We're still putting the workshop together, so for now every game comes from the Unbored team.",
          )}
        </p>
        <Button asChild className="mt-6">
          <Link to="/">{t("Play a game")}</Link>
        </Button>
      </div>
    </section>
  );
}
