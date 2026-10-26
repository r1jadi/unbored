import { Check } from "lucide-react";

import type { LevelUp } from "@/lib/games/level-up";

/**
 * The beat between two levels, laid over the board: what was solved, what it
 * earned and what comes next. Place it inside a `relative` box that also holds
 * the board, and lock the board while it shows. See `src/lib/games/level-up.ts`
 * for when it shows and for how long.
 */
export function LevelUpOverlay({
  levelUp,
  unit,
  next,
  note,
}: {
  levelUp: LevelUp;
  /** What a level is called in this game: "Board", "Round". */
  unit: string;
  /** What comes next, in a few words: "Board 4 · 6×6". */
  next: string;
  /** Said only when the next level is harder in a way worth saying. */
  note?: string;
}) {
  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl bg-background/85 px-4 text-center backdrop-blur-sm animate-in fade-in duration-150 motion-reduce:animate-none"
      role="status"
      aria-live="polite"
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground animate-in zoom-in-50 duration-300 motion-reduce:animate-none">
        <Check className="size-6" strokeWidth={3} />
      </span>
      <p className="text-lg font-semibold">
        {unit} {levelUp.solved} solved
      </p>
      {levelUp.gained > 0 && (
        <p className="text-3xl font-semibold tabular text-primary">+{levelUp.gained}</p>
      )}
      <p className="text-sm text-muted-foreground">Next: {next}</p>
      {note && (
        <p className="max-w-xs rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-foreground">
          {note}
        </p>
      )}
    </div>
  );
}
