import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * What every feed preview shares.
 *
 * A preview is a short scripted game played through that game's real rules, so
 * what it shows is something the game would really do: the points it floats are
 * the ones the rules scored and the moves are ones they allow. The scripts use
 * boards of their own, not a day's or a bank's, so watching one never gives away a
 * puzzle somebody is about to play. `previews.test.ts` fails if a change to the
 * rules makes a script impossible.
 */

/** How long a preview fades out for before it starts over. */
export const FADE_MS = 250;

/** One moment of a preview. */
export type Beat = { readonly ms: number; readonly fading?: boolean };

/** The square a preview plays in, fading out as its loop ends. */
export function PreviewStage({
  name,
  fading,
  className,
  children,
}: {
  name: string;
  fading?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={`${name}-preview`}
      className={cn(
        "relative size-full transition-opacity duration-200 [contain:layout_paint]",
        fading && "opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Points earned, rising over the board. Remounted by its key for each award. */
export function FloatingPoints({
  children,
  note,
  top = "top-[30%]",
}: {
  children: ReactNode;
  note?: ReactNode;
  top?: string;
}) {
  return (
    <div className={cn("gridburst-float absolute inset-x-0 z-20 text-center", top)}>
      <p className="text-[min(11cqw,11cqh,2.75rem)] font-bold leading-none text-foreground drop-shadow-[0_2px_6px_oklch(0_0_0/0.6)] tabular">
        {children}
      </p>
      {note && (
        <p className="mt-1 text-[min(4.5cqw,4.5cqh,1.1rem)] font-semibold text-primary">{note}</p>
      )}
    </div>
  );
}
