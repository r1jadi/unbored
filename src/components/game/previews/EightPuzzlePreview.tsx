import {
  canTap,
  createRun,
  EIGHT_PUZZLE_SIDE,
  tap,
  type EightPuzzleRun,
} from "@/lib/games/eight-puzzle";
import { cn } from "@/lib/utils";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

export type EightPuzzleBeat = Beat & {
  readonly tiles: readonly number[];
  readonly gain: number | null;
};

/** Four slides from home: the gap walks back to the corner. */
export const EIGHT_PUZZLE_PREVIEW_START = [0, 1, 2, 4, 5, 3, 7, 8, 6];
/** The cells tapped, each next to the gap when its turn comes. */
export const EIGHT_PUZZLE_PREVIEW_TAPS = [1, 2, 5, 8];

/** The start of the run: this board, not the seed's. */
export function eightPuzzlePreviewStart(): EightPuzzleRun {
  return { ...createRun(8), tiles: EIGHT_PUZZLE_PREVIEW_START };
}

const SLIDE_MS = 560;

function build(): EightPuzzleBeat[] {
  let run = eightPuzzlePreviewStart();
  const beats: EightPuzzleBeat[] = [{ ms: 500, tiles: run.tiles, gain: null }];
  EIGHT_PUZZLE_PREVIEW_TAPS.forEach((cell, step) => {
    const last = step === EIGHT_PUZZLE_PREVIEW_TAPS.length - 1;
    const before = run;
    if (!canTap(before, cell)) return;
    const next = tap(before, cell);
    // The rules deal the next board on solving it; the preview stays on the solved one.
    const tiles = [...before.tiles];
    const gap = tiles.indexOf(0);
    tiles[gap] = tiles[cell];
    tiles[cell] = 0;
    beats.push({
      ms: last ? 1500 : SLIDE_MS,
      tiles,
      gain: next.score > before.score ? next.score - before.score : null,
    });
    run = { ...next, tiles, level: before.level };
  });
  beats.push({ ms: FADE_MS, tiles: run.tiles, gain: null, fading: true });
  return beats;
}

export const EIGHT_PUZZLE_PREVIEW_BEATS: readonly EightPuzzleBeat[] = build();

/** 8 Puzzle: tiles slide into the gap until every one is home. */
export function EightPuzzlePreview({ playing }: { playing: boolean }) {
  const index = useBeats(EIGHT_PUZZLE_PREVIEW_BEATS, playing);
  const beat = EIGHT_PUZZLE_PREVIEW_BEATS[index];
  return (
    <PreviewStage name="8-puzzle" fading={beat.fading}>
      <div className="absolute inset-0 rounded-2xl bg-surface p-[2%]">
        <div className="relative size-full">
          {beat.tiles.map((tile, cell) => {
            if (tile === 0) return null;
            const row = Math.floor(cell / EIGHT_PUZZLE_SIDE);
            const column = cell % EIGHT_PUZZLE_SIDE;
            return (
              <TileAt key={tile} tile={tile} home={tile - 1 === cell} row={row} column={column} />
            );
          })}
        </div>
        {beat.gain !== null && <FloatingPoints key={index}>+{beat.gain}</FloatingPoints>}
      </div>
    </PreviewStage>
  );
}

function TileAt({
  tile,
  home,
  row,
  column,
}: {
  tile: number;
  home: boolean;
  row: number;
  column: number;
}) {
  return (
    <div
      className="absolute left-0 top-0 flex size-1/3 items-center justify-center p-1 transition-transform duration-200 ease-out"
      style={{ transform: `translate(${column * 100}%, ${row * 100}%)` }}
    >
      <span
        className={cn(
          "flex size-full items-center justify-center rounded-xl text-[min(13cqw,13cqh,3rem)] font-semibold shadow-sm transition-colors duration-200 tabular",
          home ? "bg-primary/20 text-foreground" : "bg-surface-2 text-foreground",
        )}
      >
        {tile}
      </span>
    </div>
  );
}
