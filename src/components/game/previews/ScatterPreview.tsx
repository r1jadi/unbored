import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCw } from "lucide-react";
import type { CSSProperties } from "react";

import {
  canExit,
  createRun,
  tap,
  type Direction,
  type ScatterCell,
  type ScatterRun,
} from "@/lib/games/scatter";
import { cn } from "@/lib/utils";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

export type ScatterBeat = Beat & {
  readonly cells: readonly ScatterCell[];
  /** The tile leaving, drawn on its way off the board. */
  readonly leaving: { readonly cell: number; readonly tile: NonNullable<ScatterCell> } | null;
  readonly jammed: number | null;
  readonly gain: number | null;
};

const SIDE = 4;

const arrow = (dir: Direction): ScatterCell => ({ dir, turnstile: false });
const turnstile = (dir: Direction): ScatterCell => ({ dir, turnstile: true });

/** A board of its own: arrows every way, one turnstile, and one lane blocked at first. */
export const SCATTER_PREVIEW_START: readonly ScatterCell[] = [
  null,
  arrow(1),
  null,
  arrow(2),
  arrow(0),
  null,
  turnstile(3),
  null,
  null,
  arrow(2),
  arrow(1),
  null,
  arrow(3),
  null,
  arrow(0),
  arrow(1),
];

/** The start of the run: this board, not the seed's. */
export function scatterPreviewStart(): ScatterRun {
  return { ...createRun(3), side: SIDE, cells: SCATTER_PREVIEW_START };
}

function build(): ScatterBeat[] {
  let run = scatterPreviewStart();
  const still = { leaving: null, jammed: null, gain: null };
  const beats: ScatterBeat[] = [{ ...still, ms: 380, cells: run.cells }];

  // One blocked tap first: what the rules do with a tile whose lane is not clear.
  const blocked = run.cells.findIndex((tile, cell) => tile && !canExit(run.cells, SIDE, cell));
  if (blocked >= 0) {
    run = tap(run, blocked);
    beats.push({ ...still, ms: 380, cells: run.cells, jammed: blocked });
    beats.push({ ...still, ms: 120, cells: run.cells });
  }

  for (;;) {
    const cell = run.cells.findIndex((tile, at) => tile && canExit(run.cells, SIDE, at));
    if (cell < 0) break;
    const tile = run.cells[cell] as NonNullable<ScatterCell>;
    const next = tap(run, cell);
    const cleared = next.last?.event === "clear";
    const after = run.cells.map((other, at) => {
      if (at === cell || !other) return null;
      return other.turnstile ? { dir: ((other.dir + 1) % 4) as Direction, turnstile: true } : other;
    });
    beats.push({
      ...still,
      ms: cleared ? 700 : 300,
      cells: after,
      leaving: { cell, tile },
      gain: cleared ? next.score - run.score : null,
    });
    if (cleared) {
      beats.push({ ...still, ms: 160, cells: after });
      beats.push({ ...still, ms: FADE_MS, cells: after, fading: true });
      return beats;
    }
    run = next;
  }
  beats.push({ ...still, ms: FADE_MS, cells: run.cells, fading: true });
  return beats;
}

export const SCATTER_PREVIEW_BEATS: readonly ScatterBeat[] = build();

const ARROWS = [ArrowUp, ArrowRight, ArrowDown, ArrowLeft] as const;
const OFF_BOARD = [
  ["0", "-340%"],
  ["340%", "0"],
  ["0", "340%"],
  ["-340%", "0"],
] as const;

function Tile({ tile }: { tile: NonNullable<ScatterCell> }) {
  const Arrow = ARROWS[tile.dir];
  return (
    <>
      <Arrow className="size-[55%]" strokeWidth={2.75} />
      {tile.turnstile && (
        <RotateCw className="absolute right-0.5 top-0.5 size-[28%] text-primary" strokeWidth={3} />
      )}
    </>
  );
}

const TILE = "relative flex items-center justify-center rounded-lg border-2";
const paint = (tile: NonNullable<ScatterCell>) =>
  tile.turnstile
    ? "border-primary/50 bg-primary/15 text-primary"
    : "border-foreground/10 bg-foreground text-background";

/** Scatter: tiles leave along clear lanes, and a blocked one jams. */
export function ScatterPreview({ playing }: { playing: boolean }) {
  const index = useBeats(SCATTER_PREVIEW_BEATS, playing);
  const beat = SCATTER_PREVIEW_BEATS[index];
  return (
    <PreviewStage name="scatter" fading={beat.fading}>
      <div
        className="absolute inset-0 grid gap-[1.5%] rounded-2xl bg-surface p-[2.5%]"
        style={{
          gridTemplateColumns: `repeat(${SIDE}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${SIDE}, minmax(0, 1fr))`,
        }}
      >
        {beat.cells.map((tile, cell) => {
          const leaving = beat.leaving?.cell === cell ? beat.leaving.tile : null;
          return (
            <div key={cell} className="relative rounded-lg bg-surface-2/40">
              {tile && (
                <div
                  className={cn(
                    TILE,
                    "absolute inset-0 transition-colors",
                    paint(tile),
                    beat.jammed === cell && "scatter-jam border-destructive",
                  )}
                >
                  <Tile tile={tile} />
                </div>
              )}
              {leaving && (
                <div
                  key={index}
                  className={cn(TILE, "preview-leave absolute inset-0 z-10", paint(leaving))}
                  style={
                    {
                      "--to-x": OFF_BOARD[leaving.dir][0],
                      "--to-y": OFF_BOARD[leaving.dir][1],
                    } as CSSProperties
                  }
                >
                  <Tile tile={leaving} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {beat.gain !== null && <FloatingPoints key={index}>+{beat.gain}</FloatingPoints>}
    </PreviewStage>
  );
}
