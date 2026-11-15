import {
  createRun,
  encode,
  scoreOf,
  submit,
  yearLabel,
  type ThenAndNowRun,
} from "@/lib/games/then-and-now";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

/**
 * Six events of the preview's own, oldest first as every puzzle lists them, in no
 * day's puzzle. Event id `i` belongs in place `i`, so the real rules replay the
 * tries without a bank.
 */
export const THEN_AND_NOW_PREVIEW_EVENTS = [
  { text: "The first photograph", year: 1826 },
  { text: "Benz builds his first car", year: 1886 },
  { text: "The first Nobel Prizes", year: 1901 },
  { text: "The first talking picture", year: 1927 },
  { text: "The first Paralympic Games", year: 1960 },
  { text: "The first Harry Potter film", year: 2001 },
] as const;

/** The shuffled start, then the swaps made before each of the two tries. */
const START = [2, 0, 1, 3, 5, 4];
export const THEN_AND_NOW_PREVIEW_SWAPS: readonly (readonly [number, number])[][] = [
  [[0, 1]],
  [
    [1, 2],
    [4, 5],
  ],
];

export type ThenAndNowBeat = Beat & {
  readonly run: ThenAndNowRun;
  readonly order: readonly number[];
  /** The place picked for a swap. */
  readonly picked: number | null;
  readonly gain: number | null;
};

function build(): ThenAndNowBeat[] {
  let run = createRun(0);
  let order = [...START];
  const beats: ThenAndNowBeat[] = [{ ms: 400, run, order, picked: null, gain: null }];
  THEN_AND_NOW_PREVIEW_SWAPS.forEach((swaps, i) => {
    for (const [a, b] of swaps) {
      beats.push({ ms: i === 0 ? 250 : 200, run, order, picked: a, gain: null });
      const next = [...order];
      [next[a], next[b]] = [next[b]!, next[a]!];
      order = next;
      beats.push({ ms: i === 0 ? 300 : 250, run, order, picked: null, gain: null });
    }
    run = submit(run, encode(order));
    const last = i === THEN_AND_NOW_PREVIEW_SWAPS.length - 1;
    beats.push({
      ms: last ? 1100 : 600,
      run,
      order,
      picked: null,
      gain: run.ending === "solved" ? scoreOf(run) : null,
    });
  });
  const end = beats[beats.length - 1]!;
  beats.push({ ...end, ms: FADE_MS, gain: null, fading: true });
  return beats;
}

export const THEN_AND_NOW_PREVIEW_BEATS: readonly ThenAndNowBeat[] = build();

/** Then & Now: a swap, a try that locks two events, two more swaps and all six in order. */
export function ThenAndNowPreview({ playing }: { playing: boolean }) {
  const index = useBeats(THEN_AND_NOW_PREVIEW_BEATS, playing);
  const beat = THEN_AND_NOW_PREVIEW_BEATS[index];
  return (
    <PreviewStage
      name="then-and-now"
      fading={beat.fading}
      className="flex items-center justify-center"
    >
      <ol className="flex w-full flex-col gap-[1.6cqw] p-[6cqw]">
        {beat.order.map((id, place) => {
          const event = THEN_AND_NOW_PREVIEW_EVENTS[id]!;
          const locked = beat.run.locked[place];
          return (
            <li
              key={id}
              className={cn(
                "flex h-[min(11cqw,11cqh,2.75rem)] items-center justify-between gap-[2cqw] rounded-[min(2.5cqw,2.5cqh,0.6rem)] px-[3cqw] text-[min(3.6cqw,3.6cqh,0.9rem)] font-medium transition-colors duration-200",
                locked
                  ? "bg-emerald-500/25"
                  : beat.picked === place
                    ? "bg-foreground text-background"
                    : "bg-surface-2",
              )}
            >
              <span className="truncate">{t(event.text)}</span>
              {locked && (
                <span className="shrink-0 font-semibold tabular">{yearLabel(event.year)}</span>
              )}
            </li>
          );
        })}
      </ol>
      {beat.gain !== null && (
        <FloatingPoints key={index} note={t("In order!")}>
          +{beat.gain}
        </FloatingPoints>
      )}
    </PreviewStage>
  );
}
