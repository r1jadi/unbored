import type { MeanderPuzzle } from "@/lib/games/meander-bank";
import {
  CELLS,
  createRun,
  encodeTrace,
  lettersOf,
  move,
  owners,
  scoreOf,
  SIZE,
  type MeanderRun,
} from "@/lib/games/meander";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

/** A grid of the preview's own, in no day's bank, laid out by the bank's generator. */
export const MEANDER_PREVIEW_PUZZLE: MeanderPuzzle = {
  theme: "Bakery",
  words: ["BAGUETTE", "PRETZEL", "BAGEL", "SCONE"],
  rows: ["SCBAL", "BONGE", "AGELE", "EUPRZ", "TTEET"],
  paths: [
    [5, 10, 11, 16, 15, 20, 21, 22],
    [17, 18, 23, 24, 19, 14, 13],
    [2, 3, 8, 9, 4],
    [0, 1, 6, 7, 12],
  ],
};

/** The order the preview traces the words in. */
const ORDER = [3, 2, 1, 0] as const;

const FILLS = ["bg-sky-500/30", "bg-amber-500/30", "bg-emerald-500/30", "bg-rose-500/30"];

export type MeanderBeat = Beat & {
  readonly run: MeanderRun;
  readonly trace: readonly number[];
  readonly gain: number | null;
};

function build(): MeanderBeat[] {
  let run = createRun(0);
  const beats: MeanderBeat[] = [{ ms: 300, run, trace: [], gain: null }];
  ORDER.forEach((word, i) => {
    const path = MEANDER_PREVIEW_PUZZLE.paths[word]!;
    const half = Math.ceil(path.length / 2);
    beats.push({ ms: 200, run, trace: path.slice(0, half), gain: null });
    beats.push({ ms: 200, run, trace: path, gain: null });
    run = move(run, encodeTrace(path)!, MEANDER_PREVIEW_PUZZLE);
    const last = i === ORDER.length - 1;
    beats.push({ ms: last ? 1000 : 300, run, trace: [], gain: last ? scoreOf(run) : null });
  });
  const end = beats[beats.length - 1]!;
  beats.push({ ...end, ms: FADE_MS, gain: null, fading: true });
  return beats;
}

export const MEANDER_PREVIEW_BEATS: readonly MeanderBeat[] = build();

/** Meander: four bakery words traced through the grid, one after another, until it is full. */
export function MeanderPreview({ playing }: { playing: boolean }) {
  const index = useBeats(MEANDER_PREVIEW_BEATS, playing);
  const beat = MEANDER_PREVIEW_BEATS[index];
  const letters = lettersOf(MEANDER_PREVIEW_PUZZLE);
  const owner = owners(beat.run);
  return (
    <PreviewStage name="meander" fading={beat.fading} className="flex items-center justify-center">
      <div
        className="grid aspect-square w-[min(78cqw,78cqh)] gap-[1.4cqw]"
        style={{ gridTemplateColumns: `repeat(${SIZE}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: CELLS }, (_, cell) => (
          <div
            key={cell}
            className={cn(
              "flex items-center justify-center rounded-[min(2cqw,2cqh,0.5rem)] text-[min(6cqw,6cqh,1.5rem)] font-bold transition-colors duration-150",
              beat.trace.includes(cell)
                ? "bg-foreground text-background"
                : owner[cell]! >= 0
                  ? FILLS[owner[cell]!]
                  : "bg-surface-2",
            )}
          >
            {letters[cell]}
          </div>
        ))}
      </div>
      {beat.gain !== null && (
        <FloatingPoints key={index} note={t("Grid filled!")}>
          +{beat.gain}
        </FloatingPoints>
      )}
    </PreviewStage>
  );
}
