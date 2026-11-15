import { TON_UP_CATEGORIES } from "@/lib/games/ton-up-bank";
import { MAX_DARTS, replay, scoreOf, TARGET } from "@/lib/games/ton-up";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

/**
 * Elements are every day's answers when their day comes round, and the whole list
 * counts, so three of them give nothing away: oxygen, zinc and samarium make 100.
 */
export const TON_UP_PREVIEW_CATEGORY = 0;
export const TON_UP_PREVIEW_DARTS = ["Oxygen", "Zinc", "Samarium"] as const;

const category = TON_UP_CATEGORIES[TON_UP_PREVIEW_CATEGORY]!;
const indices = TON_UP_PREVIEW_DARTS.map((name) =>
  category.answers.findIndex((answer) => answer.name === name),
);
/** Day 0 plays the elements: the real rules replay the darts and score them. */
const finalRun = replay(0, indices);

export type TonUpBeat = Beat & {
  readonly thrown: number;
  readonly total: number;
  readonly gain: number | null;
};

function build(): TonUpBeat[] {
  const beats: TonUpBeat[] = [{ ms: 600, thrown: 0, total: 0, gain: null }];
  let total = 0;
  indices.forEach((index, i) => {
    total += category.answers[index]!.value;
    beats.push({ ms: i === indices.length - 1 ? 500 : 750, thrown: i + 1, total, gain: null });
  });
  beats.push({ ms: 1300, thrown: indices.length, total, gain: scoreOf(finalRun) });
  beats.push({ ms: FADE_MS, thrown: indices.length, total, gain: null, fading: true });
  return beats;
}

export const TON_UP_PREVIEW_BEATS: readonly TonUpBeat[] = build();

/** Ton Up: three answers land as darts and the total climbs to exactly 100. */
export function TonUpPreview({ playing }: { playing: boolean }) {
  const index = useBeats(TON_UP_PREVIEW_BEATS, playing);
  const beat = TON_UP_PREVIEW_BEATS[index];
  const ton = beat.total === TARGET;
  return (
    <PreviewStage name="ton-up" fading={beat.fading} className="flex items-center justify-center">
      <div className="flex w-full flex-col items-center gap-[4cqw] p-[5cqw]">
        <p className="text-[min(5cqw,5cqh,1.25rem)] font-semibold text-muted-foreground">
          {t(category.title)}
        </p>
        <p
          className={cn(
            "text-[min(22cqw,22cqh,5.5rem)] font-bold leading-none tabular transition-colors duration-300",
            ton ? "text-primary" : "text-foreground",
          )}
        >
          {beat.total}
        </p>
        <div className="h-[min(2.5cqw,2.5cqh,0.6rem)] w-[80%] overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${(beat.total / TARGET) * 100}%` }}
          />
        </div>
        <div className="grid w-full grid-cols-3 gap-[2.5cqw]">
          {Array.from({ length: MAX_DARTS }, (_, i) => {
            const answer = i < beat.thrown ? category.answers[indices[i]!]! : null;
            return (
              <div
                key={i}
                className={cn(
                  "flex aspect-[4/3] flex-col items-center justify-center rounded-[min(3cqw,3cqh,0.75rem)] border-[min(0.5cqw,0.5cqh,0.125rem)] border-dashed border-foreground/15 transition-[transform,background-color] duration-300",
                  answer && "scale-100 border-solid border-primary/50 bg-surface",
                  i === beat.thrown - 1 && !ton && "scale-105",
                )}
              >
                {answer ? (
                  <>
                    <span className="text-[min(4.2cqw,4.2cqh,1rem)] leading-tight">
                      {answer.name}
                    </span>
                    <span className="text-[min(7cqw,7cqh,1.75rem)] font-bold leading-none tabular">
                      +{answer.value}
                    </span>
                  </>
                ) : (
                  <span className="text-[min(8cqw,8cqh,2rem)] text-muted-foreground/30">◎</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {beat.gain !== null && (
        <FloatingPoints key={index} note={t("A ton!")} top="top-[3%]">
          +{beat.gain}
        </FloatingPoints>
      )}
    </PreviewStage>
  );
}
