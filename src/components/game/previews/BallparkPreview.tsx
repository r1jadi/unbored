import {
  closeness,
  direction,
  dollars,
  MAX_GUESSES,
  POINTS_PER_SPARE,
  type Closeness,
  type Direction,
} from "@/lib/games/ballpark";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

/** A product of its own, not on the shelf the days walk, so nothing is given away. */
export const BALLPARK_PREVIEW_PRODUCT = {
  name: "AA batteries",
  detail: "Pack of 8",
  emoji: "🔋",
  cents: 999,
};
/** Too high, close but still high, then within 5%. */
export const BALLPARK_PREVIEW_GUESSES = [2000, 1200, 1000] as const;

type Row = { readonly cents: number; readonly near: Closeness; readonly way: Direction };

export type BallparkBeat = Beat & {
  readonly rows: readonly Row[];
  readonly gain: number | null;
};

function build(): BallparkBeat[] {
  const price = BALLPARK_PREVIEW_PRODUCT.cents;
  const rows: Row[] = [];
  const beats: BallparkBeat[] = [{ ms: 600, rows: [], gain: null }];
  BALLPARK_PREVIEW_GUESSES.forEach((cents, i) => {
    rows.push({ cents, near: closeness(cents, price), way: direction(cents, price) });
    beats.push({
      ms: i === BALLPARK_PREVIEW_GUESSES.length - 1 ? 450 : 800,
      rows: [...rows],
      gain: null,
    });
  });
  const solvedOn = rows.findIndex((row) => row.near === "hit") + 1;
  beats.push({
    ms: 1300,
    rows: [...rows],
    gain: solvedOn > 0 ? (MAX_GUESSES + 1 - solvedOn) * POINTS_PER_SPARE : null,
  });
  beats.push({ ms: FADE_MS, rows: [...rows], gain: null, fading: true });
  return beats;
}

export const BALLPARK_PREVIEW_BEATS: readonly BallparkBeat[] = build();

/** Ballpark: a product, and guesses at its price that close in on it. */
export function BallparkPreview({ playing }: { playing: boolean }) {
  const index = useBeats(BALLPARK_PREVIEW_BEATS, playing);
  const beat = BALLPARK_PREVIEW_BEATS[index];
  const product = BALLPARK_PREVIEW_PRODUCT;
  return (
    <PreviewStage name="ballpark" fading={beat.fading} className="flex items-center justify-center">
      <div className="flex w-full flex-col items-center gap-[2.5cqw] p-[5cqw]">
        <div className="flex w-full items-center gap-[3cqw] rounded-[min(3cqw,3cqh,0.75rem)] bg-surface p-[3cqw]">
          <span className="text-[min(14cqw,14cqh,3.5rem)] leading-none">{product.emoji}</span>
          <div>
            <p className="text-[min(6cqw,6cqh,1.5rem)] font-semibold leading-tight">
              {t(product.name)}
            </p>
            <p className="text-[min(4.2cqw,4.2cqh,1rem)] text-muted-foreground">
              {t(product.detail)}
            </p>
          </div>
        </div>
        {Array.from({ length: BALLPARK_PREVIEW_GUESSES.length }, (_, i) => {
          const row = beat.rows[i];
          return (
            <div
              key={i}
              className={cn(
                "flex h-[min(11cqw,11cqh,2.75rem)] w-full items-center justify-between rounded-[min(2.5cqw,2.5cqh,0.6rem)] px-[4cqw] text-[min(5.5cqw,5.5cqh,1.4rem)] font-semibold tabular transition-[background-color,transform,opacity] duration-300",
                !row && "border-[min(0.5cqw,0.5cqh,0.125rem)] border-dashed border-foreground/10",
                row?.near === "far" && "bg-surface-2",
                row?.near === "close" &&
                  "bg-amber-400/25 ring-[min(0.6cqw,0.6cqh,0.15rem)] ring-amber-500/60",
                row?.near === "hit" && "scale-[1.03] bg-primary text-primary-foreground",
              )}
            >
              {row && (
                <>
                  <span>{dollars(row.cents)}</span>
                  <span>{row.way === "higher" ? "↑" : row.way === "lower" ? "↓" : "✓"}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
      {beat.gain !== null && (
        <FloatingPoints key={index} note={dollars(product.cents)}>
          +{beat.gain}
        </FloatingPoints>
      )}
    </PreviewStage>
  );
}
