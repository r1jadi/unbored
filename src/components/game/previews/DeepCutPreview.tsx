import { TIERS, tierInfo, type Tier } from "@/lib/games/deep-cut";
import { cn } from "@/lib/utils";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

/**
 * A question of its own, not in the bank, so the feed never gives away an answer
 * somebody is about to need.
 */
export const DEEP_CUT_PREVIEW_PROMPT = "Name a pizza topping";
export const DEEP_CUT_PREVIEW_ANSWER = "Anchovies";
/** How deep the scripted answer dives: Twilight, worth what the real tiers say. */
export const DEEP_CUT_PREVIEW_TIER: Tier = 4;

export type DeepCutBeat = Beat & {
  /** How much of the answer is typed. */
  readonly typed: number;
  /** The diver's tier: null while still at the surface. */
  readonly depth: Tier | null;
  readonly points: number | null;
};

const TYPE_MS = 110;

function build(): DeepCutBeat[] {
  const word = DEEP_CUT_PREVIEW_ANSWER;
  const beats: DeepCutBeat[] = [{ ms: 500, typed: 0, depth: null, points: null }];
  for (let typed = 1; typed <= word.length; typed += 1) {
    beats.push({ ms: TYPE_MS, typed, depth: null, points: null });
  }
  beats.push({ ms: 250, typed: word.length, depth: null, points: null });
  // The dive: the diver sinks through the bands (a CSS transition carries it).
  beats.push({ ms: 1000, typed: word.length, depth: DEEP_CUT_PREVIEW_TIER, points: null });
  beats.push({
    ms: 1000,
    typed: word.length,
    depth: DEEP_CUT_PREVIEW_TIER,
    points: tierInfo(DEEP_CUT_PREVIEW_TIER)!.points,
  });
  beats.push({
    ms: FADE_MS,
    typed: word.length,
    depth: DEEP_CUT_PREVIEW_TIER,
    points: null,
    fading: true,
  });
  return beats;
}

export const DEEP_CUT_PREVIEW_BEATS: readonly DeepCutBeat[] = build();

const BANDS = [
  "oklch(0.86 0.1 210)",
  "oklch(0.72 0.12 222)",
  "oklch(0.58 0.13 238)",
  "oklch(0.42 0.13 262)",
  "oklch(0.28 0.09 272)",
  "oklch(0.16 0.05 282)",
];

/** Deep Cut: a prompt, an answer typed in, and a dive to the depth it reaches. */
export function DeepCutPreview({ playing }: { playing: boolean }) {
  const index = useBeats(DEEP_CUT_PREVIEW_BEATS, playing);
  const beat = DEEP_CUT_PREVIEW_BEATS[index];
  const typing =
    beat.depth === null && beat.typed > 0 && beat.typed < DEEP_CUT_PREVIEW_ANSWER.length;
  const share = beat.depth === null ? 0.05 : (beat.depth - 0.5) / TIERS.length;
  const info = beat.depth ? tierInfo(beat.depth) : null;

  return (
    <PreviewStage name="deep-cut" fading={beat.fading} className="flex items-center justify-center">
      <div className="flex h-full w-full items-stretch gap-[4cqw] p-[4cqw]">
        <div className="flex flex-1 flex-col justify-center gap-[4cqw]">
          <p className="text-[min(7cqw,7cqh,1.75rem)] font-semibold leading-tight text-foreground">
            {DEEP_CUT_PREVIEW_PROMPT}
          </p>
          <div
            className={cn(
              "flex h-[min(13cqw,13cqh,3.2rem)] items-center rounded-[min(3cqw,3cqh,0.75rem)] border-[min(0.5cqw,0.5cqh,0.125rem)] bg-surface px-[3cqw] text-[min(6cqw,6cqh,1.5rem)] font-medium transition-colors duration-200",
              beat.depth !== null ? "border-primary" : "border-foreground/20",
            )}
          >
            <span className="text-foreground">{DEEP_CUT_PREVIEW_ANSWER.slice(0, beat.typed)}</span>
            {beat.depth === null && (
              <span
                className={cn(
                  "ml-px inline-block h-[60%] w-[min(0.6cqw,0.6cqh,0.15rem)] bg-foreground/70",
                  !typing && "animate-pulse",
                )}
              />
            )}
          </div>
          <p
            className={cn(
              "text-[min(4.5cqw,4.5cqh,1.1rem)] font-semibold transition-opacity duration-300",
              info ? "opacity-100" : "opacity-0",
            )}
          >
            {info ? `${info.depth} · ${info.name}` : " "}
          </p>
        </div>

        <div className="relative w-[28%] overflow-hidden rounded-[min(3cqw,3cqh,0.75rem)]">
          {BANDS.map((background, band) => (
            <div key={band} className="h-1/6" style={{ background }} />
          ))}
          <div
            className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-[min(9cqw,9cqh,2.25rem)] leading-none transition-[top] duration-[900ms] ease-out"
            style={{ top: `${share * 100}%` }}
            aria-hidden
          >
            🤿
          </div>
        </div>
      </div>
      {beat.points !== null && (
        <FloatingPoints key={index} note={info?.name}>
          +{beat.points}
        </FloatingPoints>
      )}
    </PreviewStage>
  );
}
