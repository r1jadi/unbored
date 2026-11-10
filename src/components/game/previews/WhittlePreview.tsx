import { points } from "@/lib/format";
import {
  boardFrom,
  columnSum,
  CROSSED,
  WHITTLE_POINTS_PER_BOARD,
  WHITTLE_SIDE,
  isSolved,
  rowSum,
  UNMARKED,
  type WhittleBoard,
  type WhittleMark,
} from "@/lib/games/whittle";
import { cn } from "@/lib/utils";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

export type WhittleBeat = Beat & {
  readonly marks: readonly WhittleMark[];
  readonly pressed: number | null;
  /** The points the solved board earned, floated over it. */
  readonly gain: number | null;
};

const NUMBERS = [4, 7, 2, 9, 5, 8, 3, 6, 1, 7, 5, 9, 4, 2, 3, 1, 6, 8, 7, 4, 9, 2, 5, 3, 6];

/** The cells already crossed out when the preview opens, and the ones it crosses. */
export const WHITTLE_PREVIEW_DONE: readonly number[] = [1, 5, 14, 20];
export const WHITTLE_PREVIEW_TAPS: readonly number[] = [3, 12, 16, 19, 23];

/** A board of its own, not one a seed deals. */
export const WHITTLE_PREVIEW_BOARD: WhittleBoard = boardFrom(
  NUMBERS,
  NUMBERS.map(
    (_, cell) => WHITTLE_PREVIEW_DONE.includes(cell) || WHITTLE_PREVIEW_TAPS.includes(cell),
  ),
);

function build(): WhittleBeat[] {
  const still = { pressed: null, gain: null };
  let marks: WhittleMark[] = NUMBERS.map((_, cell) =>
    WHITTLE_PREVIEW_DONE.includes(cell) ? CROSSED : UNMARKED,
  );
  const beats: WhittleBeat[] = [{ ...still, ms: 400, marks }];
  for (const cell of WHITTLE_PREVIEW_TAPS) {
    const next = [...marks];
    next[cell] = CROSSED;
    beats.push({ ...still, ms: 180, marks, pressed: cell });
    beats.push({ ...still, ms: 320, marks: next });
    marks = next;
  }
  // The last cross makes every target: the board is solved by the rules' own check.
  const last = beats[beats.length - 1];
  beats[beats.length - 1] = {
    ...last,
    ms: 900,
    gain: isSolved(WHITTLE_PREVIEW_BOARD, marks) ? WHITTLE_POINTS_PER_BOARD : null,
  };
  beats.push({ ...still, ms: FADE_MS, marks, fading: true });
  return beats;
}

export const WHITTLE_PREVIEW_BEATS: readonly WhittleBeat[] = build();

const LINES = Array.from({ length: WHITTLE_SIDE }, (_, i) => i);
const TRACK = `repeat(${WHITTLE_SIDE}, minmax(0, 1fr)) minmax(0, 0.8fr)`;

function Target({ target, met }: { target: number; met: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-md font-semibold transition-colors duration-150",
        met ? "bg-primary text-primary-foreground" : "bg-surface-2 text-foreground",
      )}
    >
      {target}
    </div>
  );
}

/** Whittle: numbers crossed out one by one until every target lights. */
export function WhittlePreview({ playing }: { playing: boolean }) {
  const index = useBeats(WHITTLE_PREVIEW_BEATS, playing);
  const beat = WHITTLE_PREVIEW_BEATS[index];
  const drawn = WHITTLE_PREVIEW_BOARD;
  return (
    <PreviewStage name="whittle" fading={beat.fading}>
      <div
        className="absolute inset-0 grid gap-[1.5%] p-[2.5%] text-[min(6cqw,6cqh,1.5rem)] leading-none tabular"
        style={{ gridTemplateColumns: TRACK, gridTemplateRows: TRACK }}
      >
        {LINES.flatMap((row) => [
          ...LINES.map((column) => {
            const cell = row * WHITTLE_SIDE + column;
            const crossed = beat.marks[cell] === CROSSED;
            return (
              <div
                key={cell}
                className={cn(
                  "relative flex items-center justify-center rounded-md bg-surface font-semibold transition-transform duration-100",
                  beat.pressed === cell && "scale-90 ring-2 ring-foreground",
                )}
              >
                <span className={cn("transition-opacity duration-150", crossed && "opacity-30")}>
                  {drawn.numbers[cell]}
                </span>
                {crossed && (
                  <span className="absolute text-[1.5em] font-normal text-foreground/70">×</span>
                )}
              </div>
            );
          }),
          <Target
            key={`row-${row}`}
            target={drawn.rowTargets[row]}
            met={rowSum(drawn, beat.marks, row) === drawn.rowTargets[row]}
          />,
        ])}
        {LINES.map((column) => (
          <Target
            key={`column-${column}`}
            target={drawn.columnTargets[column]}
            met={columnSum(drawn, beat.marks, column) === drawn.columnTargets[column]}
          />
        ))}
      </div>
      {beat.gain !== null && <FloatingPoints key={index}>+{points(beat.gain)}</FloatingPoints>}
    </PreviewStage>
  );
}
