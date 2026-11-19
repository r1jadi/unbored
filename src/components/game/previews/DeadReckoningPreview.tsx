import { Plane } from "lucide-react";

import { rate, type Rating } from "@/lib/games/dead-reckoning";
import { points } from "@/lib/format";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

/**
 * A round of its own, on a list no day uses (planets), so nothing is given away:
 * "closest to 12,000 km", answered with Venus at 12,104 km.
 */
export const DEAD_RECKONING_PREVIEW_ROUND = {
  prompt: "Name a planet whose diameter is closest to",
  target: 12000,
  answer: "Venus",
  value: 12104,
} as const;

export type DeadReckoningBeat = Beat & {
  readonly typed: string;
  readonly seconds: number;
  readonly rating: Rating | null;
  readonly gain: number | null;
};

function build(): DeadReckoningBeat[] {
  const { target, value, answer } = DEAD_RECKONING_PREVIEW_ROUND;
  const rating = rate(value, target, "ratio");
  // Answered with 27 seconds left: ⌊100 × 47 ÷ 50⌋.
  const gain = Math.floor((100 * (20 + 27)) / 50);
  return [
    { ms: 600, typed: "", seconds: 30, rating: null, gain: null },
    { ms: 500, typed: answer.slice(0, 2), seconds: 29, rating: null, gain: null },
    { ms: 700, typed: answer, seconds: 28, rating: null, gain: null },
    { ms: 1600, typed: answer, seconds: 27, rating, gain },
    { ms: 600, typed: answer, seconds: 27, rating, gain: null },
    { ms: FADE_MS, typed: answer, seconds: 27, rating, gain: null, fading: true },
  ];
}

export const DEAD_RECKONING_PREVIEW_BEATS: readonly DeadReckoningBeat[] = build();

/** Dead Reckoning: a number, an answer typed against the clock, and the plane climbing. */
export function DeadReckoningPreview({ playing }: { playing: boolean }) {
  const index = useBeats(DEAD_RECKONING_PREVIEW_BEATS, playing);
  const beat = DEAD_RECKONING_PREVIEW_BEATS[index];
  const round = DEAD_RECKONING_PREVIEW_ROUND;
  const climbed = beat.rating !== null;
  return (
    <PreviewStage
      name="dead-reckoning"
      fading={beat.fading}
      className="flex items-center justify-center"
    >
      <div className="flex w-full flex-col items-center gap-[2.5cqw] p-[5cqw]">
        <div className="relative h-[24cqh] w-full overflow-hidden rounded-[min(3cqw,3cqh,0.75rem)] bg-gradient-to-b from-sky-400/30 to-emerald-400/20">
          <div
            className="absolute left-1/2 -translate-x-1/2 transition-[bottom] duration-700"
            style={{ bottom: climbed ? "62%" : `${12 + beat.seconds}%` }}
          >
            <Plane className="size-[min(9cqw,9cqh,2.25rem)] rotate-45 fill-current" />
          </div>
        </div>
        <p className="text-center text-[min(4.5cqw,4.5cqh,1.1rem)] text-muted-foreground">
          {t(round.prompt)}
        </p>
        <p className="text-[min(11cqw,11cqh,2.75rem)] font-bold leading-none tabular">
          {round.target.toLocaleString("en-US")} km
        </p>
        <div
          className={cn(
            "flex h-[min(11cqw,11cqh,2.75rem)] w-full items-center justify-between rounded-[min(2.5cqw,2.5cqh,0.6rem)] bg-surface px-[4cqw] text-[min(5.5cqw,5.5cqh,1.4rem)] font-semibold transition-colors duration-300",
            beat.rating === "dialed" && "bg-primary text-primary-foreground",
          )}
        >
          <span>{beat.typed || "…"}</span>
          <span className="tabular">{beat.rating ? t("Dialed") : `${beat.seconds}s`}</span>
        </div>
      </div>
      {beat.gain !== null && (
        <FloatingPoints key={index} note={`${round.value.toLocaleString("en-US")} km`}>
          +{points(beat.gain).toLocaleString("en-US")}
        </FloatingPoints>
      )}
    </PreviewStage>
  );
}
