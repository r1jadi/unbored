import { Bomb, Flag } from "lucide-react";

import { CLOSED, FLAGGED, HIT, MINE, OPEN, type MineCell } from "@/lib/games/minefield";
import { cn } from "@/lib/utils";

/** Each number's hue. The digit itself carries the meaning, so colour is only a help. */
const NUMBER_HUE: Readonly<Record<number, string>> = {
  1: "text-game-1",
  2: "text-game-2",
  3: "text-game-5",
  4: "text-game-4",
  5: "text-game-7",
  6: "text-game-6",
};

/** A cell's look, shared by the board, the end screen and the feed preview. */
export function mineCellClass(state: MineCell): string {
  return cn(
    (state === CLOSED || state === FLAGGED) && "bg-foreground/20",
    state === OPEN && "bg-foreground/5",
    state === HIT && "minefield-hit bg-destructive",
  );
}

/**
 * What a cell shows. `number` is the cell's number or `MINE`, known once it is open.
 * `reveal` shows what a finished board was hiding: every mine, and any flag that was
 * wrong, struck through.
 */
export function MineCellFace({
  state,
  number,
  reveal = false,
}: {
  state: MineCell;
  number: number | undefined;
  reveal?: boolean;
}) {
  if (state === FLAGGED) {
    const wrong = reveal && number !== MINE;
    return (
      <span aria-hidden className="relative flex size-[62%] items-center justify-center">
        <Flag
          className={cn("size-full", wrong ? "text-muted-foreground" : "fill-primary text-primary")}
        />
        {wrong && (
          <span className="absolute inset-x-0 top-1/2 h-0.5 -rotate-45 rounded-full bg-destructive" />
        )}
      </span>
    );
  }
  if (state === HIT) {
    return <Bomb aria-hidden className="size-[62%] text-destructive-foreground" />;
  }
  if (state === CLOSED) {
    return reveal && number === MINE ? (
      <Bomb aria-hidden className="size-[55%] text-foreground/70" />
    ) : null;
  }
  if (!number) return null;
  return (
    <span aria-hidden className={cn("font-bold leading-none tabular", NUMBER_HUE[number])}>
      {number}
    </span>
  );
}
