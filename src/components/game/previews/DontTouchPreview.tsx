import {
  cellAt,
  createRun,
  DONT_TOUCH_LANES,
  rowAt,
  tap,
  type DontTouchRun,
} from "@/lib/games/dont-touch";
import { cn } from "@/lib/utils";

import { FADE_MS, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

export type DontTouchBeat = Beat & {
  /** The row at the line. */
  readonly row: number;
  readonly cleared: readonly number[];
  readonly score: number;
};

export const DONT_TOUCH_PREVIEW_SEED = 12;
/** Further down the conveyor, where the black tiles are thicker. */
const FIRST_ROW = 60;
const ROWS = 7;
const VISIBLE_ROWS = 3;

function build(): DontTouchBeat[] {
  let run: DontTouchRun = createRun(DONT_TOUCH_PREVIEW_SEED);
  const beats: DontTouchBeat[] = [{ ms: 320, row: FIRST_ROW, cleared: [], score: 0 }];
  for (let row = FIRST_ROW; row < FIRST_ROW + ROWS; row += 1) {
    rowAt(DONT_TOUCH_PREVIEW_SEED, row).forEach((black, lane) => {
      if (black) return;
      run = tap(run, cellAt(row, lane));
      beats.push({ ms: 150, row, cleared: run.taps, score: run.score });
    });
    beats.push({ ms: 150, row: row + 1, cleared: run.taps, score: run.score });
  }
  const last = beats[beats.length - 1];
  beats.push({ ...last, ms: FADE_MS, fading: true });
  return beats;
}

export const DONT_TOUCH_PREVIEW_BEATS: readonly DontTouchBeat[] = build();

/** Don't Touch the Black: clear every white at the line before the row moves on. */
export function DontTouchPreview({ playing }: { playing: boolean }) {
  const index = useBeats(DONT_TOUCH_PREVIEW_BEATS, playing);
  const beat = DONT_TOUCH_PREVIEW_BEATS[index];
  // One row beyond the top, so a row arrives instead of appearing.
  const rows = Array.from({ length: VISIBLE_ROWS + 2 }, (_, offset) => beat.row - 1 + offset);
  return (
    <PreviewStage name="dont-touch-the-black" fading={beat.fading}>
      <div className="absolute inset-0 overflow-hidden rounded-2xl border border-border bg-surface">
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 border-t-2 border-dashed border-primary/60 bg-primary/5"
          style={{ height: `${100 / VISIBLE_ROWS}%` }}
        />
        {rows.map((row) => {
          const offset = row - beat.row;
          const atLine = offset === 0;
          const colours = rowAt(DONT_TOUCH_PREVIEW_SEED, row);
          return (
            <div
              key={row}
              className="absolute inset-x-0 grid grid-cols-3 gap-1 px-1 py-0.5 transition-[top] duration-150 ease-linear"
              style={{
                top: `${((VISIBLE_ROWS - 1 - offset) * 100) / VISIBLE_ROWS}%`,
                height: `${100 / VISIBLE_ROWS}%`,
              }}
            >
              {Array.from({ length: DONT_TOUCH_LANES }, (_, lane) => {
                const cleared = beat.cleared.includes(cellAt(row, lane));
                return (
                  <div
                    key={lane}
                    className={cn(
                      "h-full rounded-md transition-opacity duration-100",
                      colours[lane]
                        ? "border border-zinc-700 bg-zinc-950"
                        : "bg-zinc-100 shadow-sm",
                      cleared && "opacity-20",
                      !cleared && !atLine && "opacity-50",
                      !cleared && atLine && "ring-1 ring-white/30",
                    )}
                  />
                );
              })}
            </div>
          );
        })}
        <p className="absolute inset-x-0 top-[6%] z-20 text-center text-[min(9cqw,9cqh,2.25rem)] font-semibold text-primary drop-shadow-[0_2px_4px_oklch(0_0_0/0.5)] tabular">
          {beat.score}
        </p>
      </div>
    </PreviewStage>
  );
}
