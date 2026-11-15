import { POINTS_PER_ANSWER } from "@/lib/games/only-once";
import { QUESTIONS_PER_PUZZLE } from "@/lib/games/only-once-bank";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

/**
 * Two questions of the preview's own: France fits the first, is spent there, and
 * is turned down when it fits the second too. "Borders Spain" is not a question
 * the puzzles ask, so the feed never answers one somebody is about to see.
 */
export const ONLY_ONCE_PREVIEW_QUESTIONS = [
  "Name a country in Europe",
  "Name a country that borders Spain",
] as const;
export const ONLY_ONCE_PREVIEW_TYPED = ["France", "France", "Portugal"] as const;

export type OnlyOnceBeat = Beat & {
  /** Questions answered so far. */
  readonly answered: number;
  readonly typed: string;
  readonly used: readonly string[];
  readonly refused: boolean;
  readonly gain: number | null;
};

const TYPE_MS = 85;

function build(): OnlyOnceBeat[] {
  const beats: OnlyOnceBeat[] = [
    { ms: 450, answered: 0, typed: "", used: [], refused: false, gain: null },
  ];
  const used: string[] = [];
  let answered = 0;
  ONLY_ONCE_PREVIEW_TYPED.forEach((word, attempt) => {
    for (let n = 1; n <= word.length; n += 1) {
      beats.push({
        ms: TYPE_MS,
        answered,
        typed: word.slice(0, n),
        used: [...used],
        refused: false,
        gain: null,
      });
    }
    if (used.includes(word)) {
      beats.push({ ms: 650, answered, typed: word, used: [...used], refused: true, gain: null });
      return;
    }
    used.push(word);
    answered += 1;
    const last = attempt === ONLY_ONCE_PREVIEW_TYPED.length - 1;
    beats.push({
      ms: last ? 950 : 450,
      answered,
      typed: "",
      used: [...used],
      refused: false,
      gain: last ? POINTS_PER_ANSWER : null,
    });
  });
  const end = beats[beats.length - 1]!;
  beats.push({ ...end, ms: FADE_MS, gain: null, fading: true });
  return beats;
}

export const ONLY_ONCE_PREVIEW_BEATS: readonly OnlyOnceBeat[] = build();

/** Only Once: an answer spent on one question, turned down on the next. */
export function OnlyOncePreview({ playing }: { playing: boolean }) {
  const index = useBeats(ONLY_ONCE_PREVIEW_BEATS, playing);
  const beat = ONLY_ONCE_PREVIEW_BEATS[index];
  const question =
    ONLY_ONCE_PREVIEW_QUESTIONS[Math.min(beat.answered, ONLY_ONCE_PREVIEW_QUESTIONS.length - 1)];
  return (
    <PreviewStage
      name="only-once"
      fading={beat.fading}
      className="flex items-center justify-center"
    >
      <div className="flex w-full flex-col gap-[3.5cqw] p-[5cqw]">
        <div className="flex gap-[1.5cqw]">
          {Array.from({ length: QUESTIONS_PER_PUZZLE }, (_, i) => (
            <div
              key={i}
              className={cn(
                "h-[min(2cqw,2cqh,0.5rem)] flex-1 rounded-full bg-surface-2 transition-colors duration-300",
                i < beat.answered && "bg-primary",
              )}
            />
          ))}
        </div>
        <p className="min-h-[2.4em] text-[min(7cqw,7cqh,1.75rem)] font-semibold leading-tight">
          {t(question)}
        </p>
        <div
          className={cn(
            "flex h-[min(12cqw,12cqh,3rem)] items-center rounded-[min(3cqw,3cqh,0.75rem)] border-[min(0.5cqw,0.5cqh,0.125rem)] bg-surface px-[3cqw] text-[min(6cqw,6cqh,1.5rem)] font-medium transition-colors duration-200",
            beat.refused ? "shake border-destructive" : "border-foreground/20",
          )}
        >
          {beat.typed}
          <span className="ml-px inline-block h-[60%] w-[min(0.6cqw,0.6cqh,0.15rem)] bg-foreground/70" />
        </div>
        <p
          className={cn(
            "text-[min(4.5cqw,4.5cqh,1.1rem)] text-muted-foreground transition-opacity duration-200",
            beat.refused ? "opacity-100" : "opacity-0",
          )}
        >
          {t("You've already used {name}.", { name: ONLY_ONCE_PREVIEW_TYPED[0] })}
        </p>
        <div className="flex min-h-[min(8cqw,8cqh,2rem)] flex-wrap gap-[2cqw]">
          {beat.used.map((name) => (
            <span
              key={name}
              className="rounded-full bg-surface-2 px-[3cqw] py-[1cqw] text-[min(4.2cqw,4.2cqh,1rem)]"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
      {beat.gain !== null && (
        <FloatingPoints
          key={index}
          note={t("{n} of {max} answered", { n: beat.answered, max: QUESTIONS_PER_PUZZLE })}
        >
          +{beat.gain}
        </FloatingPoints>
      )}
    </PreviewStage>
  );
}
