import { Crown, X } from "lucide-react";
import type { CSSProperties } from "react";

import { blockedCells, type QueensCell } from "@/lib/games/queens";
import { cn } from "@/lib/utils";

import { FADE_MS, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

export const QUEENS_PREVIEW_SIZE = 5;
/** Where the crowns go: a column per row. */
export const QUEENS_PREVIEW_SOLUTION = [1, 3, 0, 2, 4];
/** Regions of its own, drawn so the crowns above are the board's only answer. */
export const QUEENS_PREVIEW_REGIONS = ("00111" + "22314" + "22334" + "23344" + "22244")
  .split("")
  .map(Number);

export type QueensBeat = Beat & { readonly cells: readonly QueensCell[] };

function build(): QueensBeat[] {
  const size = QUEENS_PREVIEW_SIZE;
  const cells = new Array<QueensCell>(size * size).fill("empty");
  const beats: QueensBeat[] = [{ ms: 450, cells: [...cells] }];
  // An order a solver might take, not top to bottom.
  [2, 0, 3, 1, 4].forEach((row, step) => {
    cells[row * size + QUEENS_PREVIEW_SOLUTION[row]] = "queen";
    beats.push({ ms: step === 4 ? 1100 : 620, cells: [...cells] });
  });
  beats.push({ ms: FADE_MS, cells: [...cells], fading: true });
  return beats;
}

export const QUEENS_PREVIEW_BEATS: readonly QueensBeat[] = build();

const REGION_COLOURS = [
  "bg-queens-1",
  "bg-queens-5",
  "bg-queens-9",
  "bg-queens-4",
  "bg-queens-8",
  "bg-queens-3",
  "bg-queens-7",
  "bg-queens-2",
  "bg-queens-6",
] as const;
const REGION_EDGE = "color-mix(in oklch, var(--foreground) 70%, transparent)";
const CELL_EDGE = "color-mix(in oklch, var(--foreground) 14%, transparent)";

/** Queens: one crown per row, column and region, and each rules out its neighbours. */
export function QueensPreview({ playing }: { playing: boolean }) {
  const index = useBeats(QUEENS_PREVIEW_BEATS, playing);
  const beat = QUEENS_PREVIEW_BEATS[index];
  const size = QUEENS_PREVIEW_SIZE;
  const regions = QUEENS_PREVIEW_REGIONS;
  const blocked = blockedCells(size, regions, beat.cells);
  return (
    <PreviewStage name="crowns" fading={beat.fading}>
      <div
        className="absolute inset-0 grid overflow-hidden rounded-lg border-2"
        style={{
          borderColor: REGION_EDGE,
          gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${size}, minmax(0, 1fr))`,
        }}
      >
        {beat.cells.map((cell, at) => {
          const row = Math.floor(at / size);
          const column = at % size;
          const region = regions[at];
          const right = column < size - 1 ? regions[at + 1] : region;
          const below = row < size - 1 ? regions[at + size] : region;
          const edges: CSSProperties = {
            borderStyle: "solid",
            borderRightWidth: column < size - 1 ? (right !== region ? 2 : 1) : 0,
            borderBottomWidth: row < size - 1 ? (below !== region ? 2 : 1) : 0,
            borderRightColor: right !== region ? REGION_EDGE : CELL_EDGE,
            borderBottomColor: below !== region ? REGION_EDGE : CELL_EDGE,
          };
          return (
            <div
              key={at}
              style={edges}
              className={cn("flex items-center justify-center", REGION_COLOURS[region])}
            >
              {cell === "queen" ? (
                <Crown
                  className="cascade-made size-[55%] fill-current text-foreground"
                  strokeWidth={1.75}
                />
              ) : blocked.has(at) ? (
                <X className="size-[30%] text-foreground/30" strokeWidth={2} />
              ) : null}
            </div>
          );
        })}
      </div>
    </PreviewStage>
  );
}
