import {
  answer,
  challenge,
  createRun,
  promptOf,
  SEVEN_SECOND_BASE_MS,
  SEVEN_SECOND_BONUS_MS,
  type SevenSecondChallenge,
} from "@/lib/games/seven-second";
import { cn } from "@/lib/utils";

import { FADE_MS, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

export type SevenSecondBeat = Beat & {
  readonly remaining: number;
  readonly dealt: SevenSecondChallenge;
  readonly pressed: number | null;
  readonly score: number;
};

/** A deck of its own: a real run's deck comes from the seed the server issues. */
export const SEVEN_SECOND_PREVIEW_SEED = 19;
const ANSWERS = 5;
const TICK_MS = 100;
const THINK_TICKS = 6;
const PRESS_TICKS = 2;

function build(): SevenSecondBeat[] {
  let run = createRun(SEVEN_SECOND_PREVIEW_SEED);
  let remaining = SEVEN_SECOND_BASE_MS;
  const beats: SevenSecondBeat[] = [];
  for (let at = 0; at < ANSWERS; at += 1) {
    const dealt = challenge(SEVEN_SECOND_PREVIEW_SEED, at);
    for (let tick = 0; tick < THINK_TICKS; tick += 1) {
      remaining -= TICK_MS;
      beats.push({ ms: TICK_MS, remaining, dealt, pressed: null, score: run.score });
    }
    run = answer(run, dealt.correct);
    remaining += SEVEN_SECOND_BONUS_MS;
    for (let tick = 0; tick < PRESS_TICKS; tick += 1) {
      remaining -= TICK_MS;
      beats.push({ ms: TICK_MS, remaining, dealt, pressed: dealt.correct, score: run.score });
    }
  }
  const last = beats[beats.length - 1];
  beats.push({ ...last, ms: FADE_MS, fading: true });
  return beats;
}

export const SEVEN_SECOND_PREVIEW_BEATS: readonly SevenSecondBeat[] = build();

/** 7 Second: right answers feed a clock that never stops falling. */
export function SevenSecondPreview({ playing }: { playing: boolean }) {
  const index = useBeats(SEVEN_SECOND_PREVIEW_BEATS, playing);
  const beat = SEVEN_SECOND_PREVIEW_BEATS[index];
  const fill = Math.min(100, Math.max(0, (beat.remaining / SEVEN_SECOND_BASE_MS) * 100));
  return (
    <PreviewStage
      name="7-second"
      fading={beat.fading}
      className="flex flex-col justify-center gap-[5%]"
    >
      <div className="flex items-baseline justify-between">
        <p className="text-[min(10cqw,10cqh,2.25rem)] font-semibold leading-none tabular">
          {(beat.remaining / 1000).toFixed(1)}s
        </p>
        <p className="text-[min(7cqw,7cqh,1.5rem)] font-semibold leading-none tabular">
          {beat.score}
        </p>
      </div>
      <div className="h-[min(2cqw,2cqh,0.5rem)] overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-100 ease-linear"
          style={{ width: `${fill}%` }}
        />
      </div>
      <p className="py-[6%] text-center text-[min(15cqw,15cqh,3.75rem)] font-semibold leading-none tracking-tight tabular">
        {promptOf(beat.dealt)}
      </p>
      <div className="grid grid-cols-3 gap-[3%]">
        {beat.dealt.options.map((option, i) => (
          <span
            key={`${beat.dealt.index}-${i}`}
            className={cn(
              "flex h-[min(18cqw,18cqh,5rem)] items-center justify-center rounded-lg bg-secondary text-[min(7cqw,7cqh,1.5rem)] font-medium text-secondary-foreground transition-transform duration-100 tabular",
              beat.pressed === i && "scale-95 bg-success text-background",
            )}
          >
            {option}
          </span>
        ))}
      </div>
    </PreviewStage>
  );
}
