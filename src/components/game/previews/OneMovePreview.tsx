import {
  boardPattern,
  createRun,
  crossCells,
  solvedCell,
  tap,
  winningCell,
  type OneMoveRun,
} from "@/lib/games/one-move";
import { cn } from "@/lib/utils";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

export type OneMoveBeat = Beat & {
  readonly size: number;
  readonly cells: readonly boolean[];
  /** The cell being tapped, and the cross it flips. */
  readonly tapped: number | null;
  readonly flipping: readonly number[];
  readonly gain: number | null;
  /** The board's number, so a new board's cells are new elements. */
  readonly level: number;
};

export const ONE_MOVE_PREVIEW_SEED = 41;
/** From the level before the board grows, so the loop shows it growing. */
const FIRST_LEVEL = 3;
const BOARDS = 3;

function build(): OneMoveBeat[] {
  let run: OneMoveRun = { ...createRun(ONE_MOVE_PREVIEW_SEED), level: FIRST_LEVEL };
  const beats: OneMoveBeat[] = [];
  for (let board = 0; board < BOARDS; board += 1) {
    const { level, seed } = run;
    const pattern = boardPattern(seed, level);
    const cell = winningCell(seed, level);
    const still = { size: pattern.size, tapped: null, flipping: [], gain: null, level };
    beats.push({ ...still, ms: 520, cells: pattern.cells });
    beats.push({ ...still, ms: 180, cells: pattern.cells, tapped: cell });
    const next = tap(run, cell);
    beats.push({
      ...still,
      ms: 560,
      cells: pattern.cells.map((_, at) => solvedCell(level, at)),
      flipping: crossCells(level, cell),
      gain: next.score - run.score,
    });
    run = next;
  }
  const last = beats[beats.length - 1];
  beats.push({ ...last, ms: FADE_MS, flipping: [], gain: null, fading: true });
  return beats;
}

export const ONE_MOVE_PREVIEW_BEATS: readonly OneMoveBeat[] = build();

/** One Move: one tap flips a cross and restores the checkerboard. */
export function OneMovePreview({ playing }: { playing: boolean }) {
  const index = useBeats(ONE_MOVE_PREVIEW_BEATS, playing);
  const beat = ONE_MOVE_PREVIEW_BEATS[index];
  return (
    <PreviewStage name="one-move" fading={beat.fading}>
      <div
        key={beat.level}
        className="absolute inset-0 grid gap-[2%]"
        style={{
          gridTemplateColumns: `repeat(${beat.size}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${beat.size}, minmax(0, 1fr))`,
        }}
      >
        {beat.cells.map((dark, cell) => (
          <div
            key={cell}
            className={cn(
              "rounded-lg border transition-[background-color,transform] duration-200",
              dark ? "border-transparent bg-foreground" : "border-border bg-surface-2",
              beat.tapped === cell && "scale-90 ring-2 ring-primary",
              beat.flipping.includes(cell) && "cascade-made",
            )}
          />
        ))}
      </div>
      {beat.gain !== null && <FloatingPoints key={index}>+{beat.gain}</FloatingPoints>}
    </PreviewStage>
  );
}
