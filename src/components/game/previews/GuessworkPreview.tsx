import {
  MAX_GUESSES,
  POINTS_PER_SPARE,
  WORD_LENGTH,
  marksFor,
  type Mark,
} from "@/lib/games/guesswork";
import { cn } from "@/lib/utils";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

/** A word of its own, accepted as a guess but never a day's answer. */
export const GUESSWORK_PREVIEW_ANSWER = "BLUNT";

/** The guesses, in order: the last one finds the word. */
export const GUESSWORK_PREVIEW_GUESSES = ["SLATE", "GLINT", "BLUNT"] as const;

type Row = { readonly letters: string; readonly marks: readonly Mark[] | null };

export type GuessworkBeat = Beat & {
  readonly rows: readonly Row[];
  readonly gain: number | null;
};

const TYPE_MS = 130;
const REVEAL_MS = 650;
/** How long each square waits after the one before it to turn over. */
const STAGGER_MS = 70;

function build(): GuessworkBeat[] {
  const mark = (word: string): Row => ({
    letters: word,
    marks: marksFor(word, GUESSWORK_PREVIEW_ANSWER),
  });
  // The first guess is already in, so a card that is not playing still shows the game.
  const [first, ...rest] = GUESSWORK_PREVIEW_GUESSES;
  const played: Row[] = [mark(first)];
  const beats: GuessworkBeat[] = [{ ms: 600, rows: [...played], gain: null }];
  rest.forEach((word, step) => {
    for (let typed = 1; typed <= WORD_LENGTH; typed += 1) {
      beats.push({
        ms: TYPE_MS,
        rows: [...played, { letters: word.slice(0, typed), marks: null }],
        gain: null,
      });
    }
    played.push(mark(word));
    const last = step === rest.length - 1;
    beats.push({
      ms: last ? 1000 : REVEAL_MS,
      rows: [...played],
      gain: last ? (MAX_GUESSES + 1 - played.length) * POINTS_PER_SPARE : null,
    });
  });
  beats.push({ ms: FADE_MS, rows: [...played], gain: null, fading: true });
  return beats;
}

export const GUESSWORK_PREVIEW_BEATS: readonly GuessworkBeat[] = build();

/** Guesswork: a word typed in, its squares turned over, until one row lights up whole. */
export function GuessworkPreview({ playing }: { playing: boolean }) {
  const index = useBeats(GUESSWORK_PREVIEW_BEATS, playing);
  const beat = GUESSWORK_PREVIEW_BEATS[index];
  return (
    <PreviewStage
      name="guesswork"
      fading={beat.fading}
      className="flex items-center justify-center"
    >
      <div className="grid aspect-[5/6] h-full max-w-full gap-[min(1.3cqw,1.3cqh,0.35rem)]">
        {Array.from({ length: MAX_GUESSES }, (_, r) => {
          const row = beat.rows[r];
          return (
            <div key={r} className="grid grid-cols-5 gap-[min(1.3cqw,1.3cqh,0.35rem)]">
              {Array.from({ length: WORD_LENGTH }, (_, i) => {
                const letter = row?.letters[i] ?? "";
                const mark = row?.marks?.[i];
                const fresh = row?.marks === null && i === row.letters.length - 1;
                return (
                  <div
                    key={i}
                    style={{ transitionDelay: mark !== undefined ? `${i * STAGGER_MS}ms` : "0ms" }}
                    className={cn(
                      "flex items-center justify-center rounded-[min(1.3cqw,1.3cqh,0.35rem)] border-[min(0.5cqw,0.5cqh,0.125rem)] text-[min(6.5cqw,6.5cqh,1.6rem)] font-bold leading-none transition-[background-color,border-color,color,transform] duration-200",
                      mark === 2 && "border-primary bg-primary text-primary-foreground",
                      mark === 1 && "border-dashed border-primary bg-primary/10 text-primary",
                      mark === 0 && "border-transparent bg-surface-2 text-muted-foreground/70",
                      mark === undefined &&
                        letter &&
                        "border-foreground/40 bg-surface text-foreground",
                      fresh && "scale-110",
                      mark === undefined && !letter && "border-foreground/10 bg-surface",
                    )}
                  >
                    {letter}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {beat.gain !== null && <FloatingPoints key={index}>+{beat.gain}</FloatingPoints>}
    </PreviewStage>
  );
}
