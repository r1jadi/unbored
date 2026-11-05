import type { CSSProperties } from "react";

import {
  COLOR_MERGE_CELLS,
  COLOR_MERGE_DIRECTIONS,
  COLOR_MERGE_SIZE,
  createRun,
  DOWN,
  LEFT,
  slide,
  slideBoard,
  slideGain,
  tileValue,
  UP,
  type ColorMergeDirection,
  type ColorMergeRun,
} from "@/lib/games/color-merge";
import { cn } from "@/lib/utils";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

/** A tile on its way: where it ends, and how many cells away it started. */
export type MovingTile = {
  readonly to: number;
  readonly shade: number;
  readonly dx: number;
  readonly dy: number;
};

export type ColorMergeBeat = Beat & {
  readonly board: readonly number[];
  /** Tiles sliding in to their cells. While they do, the board shows only these. */
  readonly moving: readonly MovingTile[] | null;
  /** The cells that just merged or were dealt, to pop. */
  readonly popping: readonly number[];
  readonly gain: number | null;
};

/** A board with merges waiting, so the first slides pay straight away. */
export const COLOR_MERGE_PREVIEW_BOARD = [1, 1, 2, 0, 0, 2, 3, 0, 1, 0, 3, 4, 0, 0, 1, 4];
const SLIDES = 5;

/** Each tile's journey in a slide, line by line, by the rule `slideBoard` applies. */
export function slidingTiles(
  board: readonly number[],
  direction: ColorMergeDirection,
): MovingTile[] {
  const size = COLOR_MERGE_SIZE;
  const moving: MovingTile[] = [];
  for (let line = 0; line < size; line += 1) {
    const cellAt = (step: number) => {
      if (direction === UP) return step * size + line;
      if (direction === DOWN) return (size - 1 - step) * size + line;
      if (direction === LEFT) return line * size + step;
      return line * size + (size - 1 - step);
    };
    let write = 0;
    let open: { shade: number } | null = null;
    for (let step = 0; step < size; step += 1) {
      const from = cellAt(step);
      const shade = board[from];
      if (shade === 0) continue;
      let to: number;
      if (open && open.shade === shade) {
        to = cellAt(write - 1);
        open = null;
      } else {
        to = cellAt(write);
        write += 1;
        open = { shade };
      }
      moving.push({
        to,
        shade,
        dx: (from % size) - (to % size),
        dy: Math.floor(from / size) - Math.floor(to / size),
      });
    }
  }
  return moving;
}

function bestDirection(run: ColorMergeRun): ColorMergeDirection {
  const moves = (direction: ColorMergeDirection) =>
    slideBoard(run.board, direction).some((shade, cell) => shade !== run.board[cell]);
  const legal = COLOR_MERGE_DIRECTIONS.filter(moves);
  return legal.reduce((best, direction) =>
    slideGain(run.board, direction) > slideGain(run.board, best) ? direction : best,
  );
}

function build(): ColorMergeBeat[] {
  let run: ColorMergeRun = { ...createRun(5), board: COLOR_MERGE_PREVIEW_BOARD };
  const still = { moving: null, popping: [], gain: null };
  const beats: ColorMergeBeat[] = [{ ...still, ms: 360, board: run.board }];
  for (let turn = 0; turn < SLIDES; turn += 1) {
    const direction = bestDirection(run);
    const slid = slideBoard(run.board, direction);
    const gain = slideGain(run.board, direction);
    const next = slide(run, direction);
    beats.push({
      ...still,
      ms: 180,
      board: run.board,
      moving: slidingTiles(run.board, direction),
    });
    const merged = slid.flatMap((shade, cell) => {
      const tiles = slidingTiles(run.board, direction).filter((tile) => tile.to === cell);
      return shade !== 0 && tiles.length > 1 ? [cell] : [];
    });
    const dealt = next.board.flatMap((shade, cell) => (shade !== slid[cell] ? [cell] : []));
    beats.push({
      ...still,
      ms: 400,
      board: next.board,
      popping: [...merged, ...dealt],
      gain: gain > 0 ? gain : null,
    });
    run = next;
  }
  beats.push({ ...still, ms: 240, board: run.board });
  beats.push({ ...still, ms: FADE_MS, board: run.board, fading: true });
  return beats;
}

export const COLOR_MERGE_PREVIEW_BEATS: readonly ColorMergeBeat[] = build();

/** The same paint as the real tile: a shade picks its hue. */
function shadePaint(shade: number): CSSProperties {
  const hue = (shade * 47 + 190) % 360;
  return {
    backgroundColor: `oklch(0.62 0.15 ${hue})`,
    color: "oklch(0.16 0 0)",
    border: `1px solid oklch(0.52 0.15 ${hue})`,
  };
}

const cellBox = (cell: number): CSSProperties => ({
  left: `${(cell % COLOR_MERGE_SIZE) * 25}%`,
  top: `${Math.floor(cell / COLOR_MERGE_SIZE) * 25}%`,
  width: "25%",
  height: "25%",
});

const TILE =
  "flex size-full select-none items-center justify-center rounded-lg text-[min(6.5cqw,6.5cqh,1.5rem)] font-semibold shadow-sm tabular";

/** Color Merge: the board slides, and equal shades merge into the next one. */
export function ColorMergePreview({ playing }: { playing: boolean }) {
  const index = useBeats(COLOR_MERGE_PREVIEW_BEATS, playing);
  const beat = COLOR_MERGE_PREVIEW_BEATS[index];
  return (
    <PreviewStage name="color-merge" fading={beat.fading}>
      <div className="absolute inset-0 rounded-2xl bg-surface p-[1.5%]">
        <div className="relative size-full">
          {Array.from({ length: COLOR_MERGE_CELLS }, (_, cell) => (
            <div key={cell} className="absolute p-[1.5%]" style={cellBox(cell)}>
              <div className="size-full rounded-lg bg-surface-2/40" />
            </div>
          ))}
          {beat.moving
            ? beat.moving.map((tile, i) => (
                <div
                  key={`${index}-${i}`}
                  className="preview-slide absolute p-[1.5%]"
                  style={
                    {
                      ...cellBox(tile.to),
                      "--from-x": `${tile.dx * 100}%`,
                      "--from-y": `${tile.dy * 100}%`,
                    } as CSSProperties
                  }
                >
                  <div className={TILE} style={shadePaint(tile.shade)}>
                    {tileValue(tile.shade)}
                  </div>
                </div>
              ))
            : beat.board.map((shade, cell) =>
                shade === 0 ? null : (
                  <div key={cell} className="absolute p-[1.5%]" style={cellBox(cell)}>
                    <div
                      key={beat.popping.includes(cell) ? index : "still"}
                      className={cn(TILE, beat.popping.includes(cell) && "cascade-made")}
                      style={shadePaint(shade)}
                    >
                      {tileValue(shade)}
                    </div>
                  </div>
                ),
              )}
          {beat.gain !== null && <FloatingPoints key={index}>+{beat.gain}</FloatingPoints>}
        </div>
      </div>
    </PreviewStage>
  );
}
