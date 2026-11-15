import type { HoneycombPuzzle } from "@/lib/games/honeycomb-bank";
import { usesAllSeven, wordPoints } from "@/lib/games/honeycomb";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

/**
 * Seven letters of the preview's own — KITCHEN's, with E in the centre — in no day's
 * puzzle. The three words are scored by the real rules: a four-letter word, a
 * longer one, and the one that uses all seven.
 */
export const HONEYCOMB_PREVIEW_PUZZLE: HoneycombPuzzle = {
  letters: "ekitchn",
  words: ["kitchen", "niche", "tent"],
};
export const HONEYCOMB_PREVIEW_WORDS = ["tent", "niche", "kitchen"] as const;

const puzzle = HONEYCOMB_PREVIEW_PUZZLE;

export type HoneycombBeat = Beat & {
  readonly typed: string;
  readonly score: number;
  readonly words: number;
  readonly gain: { readonly points: number; readonly allSeven: boolean } | null;
};

function build(): HoneycombBeat[] {
  let score = 0;
  let words = 0;
  const beats: HoneycombBeat[] = [{ ms: 350, typed: "", score, words, gain: null }];
  HONEYCOMB_PREVIEW_WORDS.forEach((word, i) => {
    const step = word.length > 5 ? 90 : word.length > 4 ? 100 : 110;
    for (let k = 1; k <= word.length; k += 1) {
      beats.push({ ms: step, typed: word.slice(0, k), score, words, gain: null });
    }
    const points = wordPoints(puzzle, word);
    score += points;
    words += 1;
    beats.push({
      ms: i === HONEYCOMB_PREVIEW_WORDS.length - 1 ? 1100 : 500,
      typed: "",
      score,
      words,
      gain: { points, allSeven: usesAllSeven(puzzle, word) },
    });
  });
  const last = beats[beats.length - 1]!;
  beats.push({ ...last, ms: FADE_MS, gain: null, fading: true });
  return beats;
}

export const HONEYCOMB_PREVIEW_BEATS: readonly HoneycombBeat[] = build();

const SPOTS = [
  [50, 19],
  [76, 34.5],
  [76, 65.5],
  [50, 81],
  [24, 65.5],
  [24, 34.5],
] as const;

/** Honeycomb: three words typed on the hive, the last one using every letter. */
export function HoneycombPreview({ playing }: { playing: boolean }) {
  const index = useBeats(HONEYCOMB_PREVIEW_BEATS, playing);
  const beat = HONEYCOMB_PREVIEW_BEATS[index];
  const last = beat.typed.at(-1);
  const centre = puzzle.letters[0]!;
  const cells = [
    { letter: centre, x: 50, y: 50 },
    ...[...puzzle.letters.slice(1)].map((letter, i) => ({
      letter,
      x: SPOTS[i]![0],
      y: SPOTS[i]![1],
    })),
  ];
  return (
    <PreviewStage
      name="honeycomb"
      fading={beat.fading}
      className="flex items-center justify-center"
    >
      <div className="flex w-full flex-col items-center gap-[3cqw] p-[5cqw]">
        <p className="h-[min(9cqw,9cqh,2.25rem)] text-[min(8cqw,8cqh,2rem)] font-bold leading-none tracking-wide uppercase">
          {[...beat.typed].map((ch, i) => (
            <span key={i} className={cn(ch === centre && "text-primary")}>
              {ch}
            </span>
          ))}
        </p>
        <div className="relative aspect-square w-[70%]">
          {cells.map(({ letter, x, y }) => (
            <div
              key={letter}
              className={cn(
                "absolute flex size-[32%] -translate-x-1/2 -translate-y-1/2 items-center justify-center text-[min(7cqw,7cqh,1.75rem)] font-bold uppercase transition-transform duration-100",
                "[clip-path:polygon(25%_5%,75%_5%,100%_50%,75%_95%,25%_95%,0%_50%)]",
                letter === centre ? "bg-primary text-primary-foreground" : "bg-surface-2",
                letter === last && "scale-90",
              )}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              {letter}
            </div>
          ))}
        </div>
        <p className="text-[min(4.2cqw,4.2cqh,1rem)] font-semibold text-muted-foreground tabular">
          {beat.words === 1 ? t("1 word") : t("{n} words", { n: beat.words })} · {beat.score}
        </p>
      </div>
      {beat.gain && (
        <FloatingPoints
          key={index}
          note={beat.gain.allSeven ? t("All seven!") : undefined}
          top="top-[38%]"
        >
          +{beat.gain.points}
        </FloatingPoints>
      )}
    </PreviewStage>
  );
}
