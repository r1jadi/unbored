import { Shield, Sun } from "lucide-react";
import type { CSSProperties } from "react";

import { FUSEBOX_SIDE, SHIELDED, SURGE, type FuseBolt, type FuseCell } from "@/lib/games/fusebox";
import { cn } from "@/lib/utils";

/** A cell's look, shared by the board, the end screen and the feed preview. */
export function fuseCellClass(cell: FuseCell): string {
  return cn(
    cell.charge === 0 && "bg-surface-2/40",
    cell.charge === 1 && "bg-game-7/25",
    cell.charge === 2 && "bg-game-7/55",
    cell.charge >= 3 && "fusebox-hot bg-game-7",
    cell.kind === SURGE && "ring-2 ring-inset ring-primary",
    cell.kind === SHIELDED && "ring-2 ring-inset ring-foreground/50",
  );
}

/**
 * What a cell holds: a dot per charge, so charge never rests on colour alone, and a
 * mark for a surge or shielded cell. A burst plays over a cell popping this wave.
 */
export function FuseCellFace({ cell, popping = false }: { cell: FuseCell; popping?: boolean }) {
  return (
    <>
      <span className="flex items-center justify-center gap-[8%]" aria-hidden>
        {Array.from({ length: Math.min(cell.charge, 3) }, (_, dot) => (
          <span key={dot} className="aspect-square w-[14%] min-w-1 rounded-full bg-foreground" />
        ))}
      </span>
      {cell.kind === SURGE && (
        <Sun aria-hidden className="absolute right-[6%] top-[6%] size-[30%] text-primary" />
      )}
      {cell.kind === SHIELDED && (
        <Shield aria-hidden className="absolute right-[6%] top-[6%] size-[30%] text-foreground" />
      )}
      {popping && <span aria-hidden className="fusebox-pop absolute inset-0 rounded-[inherit]" />}
    </>
  );
}

const centre = (cell: number) => ({
  x: (cell % FUSEBOX_SIDE) + 0.5,
  y: Math.floor(cell / FUSEBOX_SIDE) + 0.5,
});

/** A wave's bolts, drawn over the board. Remounted by its key for each wave. */
export function FuseBolts({
  bolts,
  durationMs,
}: {
  bolts: readonly FuseBolt[];
  durationMs: number;
}) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${FUSEBOX_SIDE} ${FUSEBOX_SIDE}`}
      className="pointer-events-none absolute inset-[var(--fusebox-inset,0.5rem)] z-10 size-[calc(100%-2*var(--fusebox-inset,0.5rem))]"
      style={{ "--fusebox-bolt-ms": `${durationMs}ms` } as CSSProperties}
    >
      {bolts.map((bolt, index) => {
        const from = centre(bolt.from);
        const to = centre(bolt.to);
        return (
          <line
            key={index}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            pathLength={1}
            className={cn("fusebox-bolt", bolt.hit ? "stroke-foreground" : "stroke-foreground/30")}
            strokeWidth={0.09}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}
