import { readPuzzle } from "@/lib/games/crossword";
import { cn } from "@/lib/utils";

import { FADE_MS, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

/**
 * A grid of its own, never a day's: TOAST, ROBIN and DRYER across, TIRED, ABBEY
 * and TENOR down. `previews.test.tsx` checks it is in neither bank.
 */
export const CROSSWORD_PREVIEW_GRID = ["TOAST", "I#B#E", "ROBIN", "E#E#O", "DRYER"].join("");
export const CROSSWORD_PREVIEW = readPuzzle(0, CROSSWORD_PREVIEW_GRID);

export type CrosswordBeat = Beat & {
  readonly letters: readonly string[];
  readonly selected: number | null;
  /** The word being filled. */
  readonly word: readonly number[];
};

const LETTER_MS = 125;

function build(): CrosswordBeat[] {
  const letters = new Array<string>(CROSSWORD_PREVIEW_GRID.length).fill("");
  const beats: CrosswordBeat[] = [];
  CROSSWORD_PREVIEW.entries.forEach(({ cells }) => {
    // A word's crossing letters are already in: only its gaps are left to type.
    const gaps = cells.filter((cell) => letters[cell] === "");
    if (gaps.length === 0) return;
    beats.push({
      ms: beats.length === 0 ? 320 : 150,
      letters: [...letters],
      selected: gaps[0],
      word: cells,
    });
    gaps.forEach((cell, step) => {
      letters[cell] = CROSSWORD_PREVIEW_GRID[cell];
      beats.push({
        ms: LETTER_MS,
        letters: [...letters],
        selected: gaps[step + 1] ?? null,
        word: cells,
      });
    });
  });
  beats.push({ ms: 500, letters: [...letters], selected: null, word: [] });
  beats.push({ ms: FADE_MS, letters: [...letters], selected: null, word: [], fading: true });
  return beats;
}

export const CROSSWORD_PREVIEW_BEATS: readonly CrosswordBeat[] = build();

const INK = "#18181b";
const PAPER = "#ffffff";
const ENTRY_TINT = "color-mix(in oklch, var(--primary) 22%, white)";
const SELECTED_TINT = "color-mix(in oklch, var(--primary) 55%, white)";

/** The Daily Crossword: letters fill the grid, word by word. */
export function CrosswordPreview({ playing }: { playing: boolean }) {
  const index = useBeats(CROSSWORD_PREVIEW_BEATS, playing);
  const beat = CROSSWORD_PREVIEW_BEATS[index];
  const { side, numbers } = CROSSWORD_PREVIEW;
  const { selected, word } = beat;
  return (
    <PreviewStage name="crossword" fading={beat.fading}>
      <div
        className="absolute inset-0 grid overflow-hidden rounded-lg border-2"
        style={{
          borderColor: INK,
          background: INK,
          gap: 1,
          gridTemplateColumns: `repeat(${side}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${side}, minmax(0, 1fr))`,
        }}
      >
        {beat.letters.map((letter, cell) =>
          CROSSWORD_PREVIEW_GRID[cell] === "#" ? (
            <div key={cell} style={{ background: INK }} />
          ) : (
            <div
              key={cell}
              style={{
                background:
                  cell === selected ? SELECTED_TINT : word.includes(cell) ? ENTRY_TINT : PAPER,
              }}
              className="relative flex items-center justify-center text-[min(9cqw,9cqh,2.2rem)] font-semibold uppercase leading-none text-zinc-900"
            >
              {numbers[cell] > 0 && (
                <span className="absolute left-[6%] top-[4%] text-[min(2.8cqw,2.8cqh,0.7rem)] font-medium leading-none text-zinc-500">
                  {numbers[cell]}
                </span>
              )}
              <span key={letter} className={cn(letter && "cascade-made")}>
                {letter}
              </span>
            </div>
          ),
        )}
      </div>
    </PreviewStage>
  );
}
