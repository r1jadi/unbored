import {
  createRun,
  guess,
  maskOf,
  MAX_MISTAKES,
  scoreOf,
  type FoursortRun,
} from "@/lib/games/foursort";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

/**
 * Sixteen words of the preview's own, in no day's puzzle. Every puzzle has the same
 * shape — word id `4 × group + place` — so the real rules replay the guesses
 * without a bank. Navy, Teal, Azure and Piano is the near miss: three blues and a
 * thing with keys.
 */
export const FOURSORT_PREVIEW_GROUPS = [
  { title: "Shades of blue", words: ["Navy", "Teal", "Azure", "Cyan"] },
  { title: "Things with keys", words: ["Piano", "Lock", "Map", "Car"] },
  { title: "Coffee ___", words: ["Bean", "Cup", "Shop", "Break"] },
  { title: "Dog tricks", words: ["Sit", "Roll", "Beg", "Fetch"] },
] as const;

/** The board's order: every id once, the near miss spread across it. */
const ORDER = [4, 9, 0, 14, 7, 2, 12, 5, 10, 1, 15, 8, 3, 11, 6, 13] as const;

/** The guesses, as ids: one away, then the blues, then the dog tricks. */
export const FOURSORT_PREVIEW_GUESSES = [
  [0, 1, 2, 4],
  [0, 1, 2, 3],
  [12, 13, 14, 15],
] as const;

export type FoursortBeat = Beat & {
  readonly run: FoursortRun;
  /** The words picked and not yet submitted. */
  readonly picked: readonly number[];
  readonly notice: string | null;
  readonly shake: boolean;
  /** The group just found and the points it scored, floated over the board. */
  readonly gain: { readonly group: number; readonly points: number } | null;
};

function build(): FoursortBeat[] {
  let run = createRun(0);
  const beats: FoursortBeat[] = [
    { ms: 400, run, picked: [], notice: null, shake: false, gain: null },
  ];
  FOURSORT_PREVIEW_GUESSES.forEach((ids, i) => {
    const picking = i === 0 ? 150 : 110;
    ids.forEach((_, k) =>
      beats.push({
        ms: picking,
        run,
        picked: ids.slice(0, k + 1),
        notice: null,
        shake: false,
        gain: null,
      }),
    );
    const before = run;
    run = guess(run, maskOf(ids));
    beats.push(
      run.found.length > before.found.length
        ? {
            ms: i === FOURSORT_PREVIEW_GUESSES.length - 1 ? 1100 : 550,
            run,
            picked: [],
            notice: null,
            shake: false,
            gain: {
              group: run.found[run.found.length - 1]!,
              points: scoreOf(run) - scoreOf(before),
            },
          }
        : { ms: 550, run, picked: [], notice: t("One away…"), shake: true, gain: null },
    );
  });
  const last = beats[beats.length - 1]!;
  beats.push({ ...last, ms: FADE_MS, gain: null, fading: true });
  return beats;
}

export const FOURSORT_PREVIEW_BEATS: readonly FoursortBeat[] = build();

const TONES = ["bg-amber-300", "bg-emerald-400", "bg-sky-400", "bg-violet-400"] as const;

/** Foursort: a near miss, then two groups locked in as coloured bars. */
export function FoursortPreview({ playing }: { playing: boolean }) {
  const index = useBeats(FOURSORT_PREVIEW_BEATS, playing);
  const beat = FOURSORT_PREVIEW_BEATS[index];
  const { run } = beat;
  const taken = new Set(run.found.flatMap((g) => [0, 1, 2, 3].map((k) => 4 * g + k)));
  const left = ORDER.filter((id) => !taken.has(id));
  return (
    <PreviewStage name="foursort" fading={beat.fading} className="flex items-center justify-center">
      <div className="flex w-full flex-col gap-[1.6cqw] p-[5cqw]">
        {run.found.map((g) => (
          <div
            key={g}
            className={cn(
              "enter flex h-[min(13cqw,13cqh,3.25rem)] flex-col items-center justify-center rounded-[min(2.5cqw,2.5cqh,0.6rem)] text-black",
              TONES[g],
            )}
          >
            <span className="text-[min(3.6cqw,3.6cqh,0.9rem)] font-bold uppercase leading-tight">
              {FOURSORT_PREVIEW_GROUPS[g]!.title}
            </span>
            <span className="text-[min(3.2cqw,3.2cqh,0.8rem)] leading-tight">
              {FOURSORT_PREVIEW_GROUPS[g]!.words.join(", ")}
            </span>
          </div>
        ))}
        <div
          key={beat.shake ? `shake-${index}` : "board"}
          className={cn("grid grid-cols-4 gap-[1.6cqw]", beat.shake && "shake")}
        >
          {left.map((id) => {
            const on = beat.picked.includes(id);
            return (
              <div
                key={id}
                className={cn(
                  "flex h-[min(13cqw,13cqh,3.25rem)] items-center justify-center rounded-[min(2.5cqw,2.5cqh,0.6rem)] text-[min(3.4cqw,3.4cqh,0.85rem)] font-semibold uppercase transition-colors duration-150",
                  on ? "bg-foreground text-background" : "bg-surface-2",
                )}
              >
                {FOURSORT_PREVIEW_GROUPS[Math.floor(id / 4)]!.words[id % 4]}
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-center gap-[1.5cqw] pt-[1cqw]">
          {Array.from({ length: MAX_MISTAKES }, (_, i) => (
            <span
              key={i}
              className={cn(
                "size-[min(2.5cqw,2.5cqh,0.6rem)] rounded-full transition-colors duration-300",
                i < MAX_MISTAKES - run.mistakes ? "bg-foreground/70" : "bg-foreground/15",
              )}
            />
          ))}
        </div>
        <p className="h-[min(5cqw,5cqh,1.25rem)] text-center text-[min(4cqw,4cqh,1rem)] font-semibold">
          {beat.notice}
        </p>
      </div>
      {beat.gain && (
        <FloatingPoints key={index} note={FOURSORT_PREVIEW_GROUPS[beat.gain.group]!.title}>
          +{beat.gain.points}
        </FloatingPoints>
      )}
    </PreviewStage>
  );
}
