import {
  CELLS,
  code,
  createRun,
  cluesOf,
  FILL,
  FILLED,
  inked,
  lineDone,
  move,
  scoreOf,
  SIZE,
  type PixelockRun,
} from "@/lib/games/pixelock";
import type { PixelockPicture } from "@/lib/games/pixelock-bank";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

/** A picture of the preview's own, in no day's bank, and solvable line by line. */
export const PIXELOCK_PREVIEW_PICTURE: PixelockPicture = {
  name: "Ice cream",
  rows: [
    "...####...",
    "..######..",
    ".########.",
    ".########.",
    "..######..",
    "..######..",
    "...####...",
    "...####...",
    "....##....",
    "....##....",
  ],
};

const picture = PIXELOCK_PREVIEW_PICTURE;
const clues = cluesOf(picture);

export type PixelockBeat = Beat & {
  readonly run: PixelockRun;
  /** The row just dragged across, lit for a moment. */
  readonly row: number | null;
  readonly gain: number | null;
};

/** Every row dragged across in turn, each fill a real move on the preview's picture. */
function build(): PixelockBeat[] {
  let run = createRun(0);
  const beats: PixelockBeat[] = [{ ms: 400, run, row: null, gain: null }];
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      const cell = r * SIZE + c;
      if (inked(picture, cell)) run = move(run, code(cell, FILL), picture);
    }
    beats.push({ ms: 210, run, row: r, gain: null });
  }
  beats.push({ ms: 1300, run, row: null, gain: run.ending === "solved" ? scoreOf(run) : null });
  beats.push({ ms: FADE_MS, run, row: null, gain: null, fading: true });
  return beats;
}

export const PIXELOCK_PREVIEW_BEATS: readonly PixelockBeat[] = build();

const CLUE = "text-[min(2.6cqw,2.6cqh,0.65rem)] font-semibold leading-none tabular";

/** Pixelock: the clues around an empty grid, then a picture dragged in row by row. */
export function PixelockPreview({ playing }: { playing: boolean }) {
  const index = useBeats(PIXELOCK_PREVIEW_BEATS, playing);
  const beat = PIXELOCK_PREVIEW_BEATS[index];
  const { run } = beat;
  return (
    <PreviewStage name="pixelock" fading={beat.fading} className="flex items-center justify-center">
      <div
        className={cn(
          "grid w-[86%] transition-opacity duration-300",
          beat.gain !== null && "opacity-40",
        )}
        style={{ gridTemplateColumns: `auto repeat(${SIZE}, minmax(0, 1fr))` }}
      >
        <div />
        {clues.columns.map((clue, c) => (
          <div
            key={`c${c}`}
            className={cn(
              CLUE,
              "flex flex-col items-center justify-end gap-[0.5cqw] pb-[1cqw] transition-colors duration-300",
              lineDone(run, "column", c, picture) && "text-muted-foreground/40",
            )}
          >
            {clue.map((n, i) => (
              <span key={i}>{n}</span>
            ))}
          </div>
        ))}
        {Array.from({ length: SIZE }, (_, r) => [
          <div
            key={`r${r}`}
            className={cn(
              CLUE,
              "flex items-center justify-end gap-[1cqw] pr-[1.2cqw] transition-colors duration-300",
              lineDone(run, "row", r, picture) && "text-muted-foreground/40",
            )}
          >
            {clues.rows[r]!.map((n, i) => (
              <span key={i}>{n}</span>
            ))}
          </div>,
          ...Array.from({ length: SIZE }, (_, c) => {
            const cell = r * SIZE + c;
            return (
              <div
                key={cell}
                className={cn(
                  "aspect-square border-r border-b border-foreground/15 bg-surface-2 transition-colors duration-200",
                  c === 0 && "border-l-2 border-l-foreground/40",
                  r === 0 && "border-t-2 border-t-foreground/40",
                  (c === 4 || c === 9) && "border-r-2 border-r-foreground/40",
                  (r === 4 || r === 9) && "border-b-2 border-b-foreground/40",
                  run.cells[cell] === FILLED && "bg-foreground",
                  run.cells[cell] === FILLED &&
                    (beat.row === r || beat.gain !== null) &&
                    "bg-primary",
                )}
              />
            );
          }),
        ])}
      </div>
      {beat.gain !== null && (
        <FloatingPoints key={index} note={t(picture.name)} top="top-[34%]">
          +{beat.gain}
        </FloatingPoints>
      )}
    </PreviewStage>
  );
}

/** How many cells the preview's picture fills: what the drawing scores. */
export const PIXELOCK_PREVIEW_INK = Array.from({ length: CELLS }, (_, i) =>
  inked(picture, i),
).filter(Boolean).length;
