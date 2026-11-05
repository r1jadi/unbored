import { cn } from "@/lib/utils";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

const CELL_EDGE = "color-mix(in oklch, var(--foreground) 12%, transparent)";
const BOX_EDGE = "color-mix(in oklch, var(--foreground) 40%, transparent)";

export type DigitGridBeat = Beat & {
  readonly cells: readonly number[];
  readonly selected: number | null;
  /** The digit on the pad being pressed. */
  readonly pressed: number | null;
  readonly gain: number | null;
};

/**
 * A digit puzzle's script: the solved grid with some cells open, filled one at a
 * time: the cell is picked, then its digit is pressed on the pad.
 */
export function digitGridBeats(
  solved: readonly number[],
  open: readonly number[],
  points: number,
): DigitGridBeat[] {
  const cells = solved.map((digit, cell) => (open.includes(cell) ? 0 : digit));
  const still = { selected: null, pressed: null, gain: null };
  const beats: DigitGridBeat[] = [{ ...still, ms: 340, cells: [...cells] }];
  open.forEach((cell, step) => {
    beats.push({ ...still, ms: 190, cells: [...cells], selected: cell });
    cells[cell] = solved[cell];
    const last = step === open.length - 1;
    beats.push({
      ...still,
      ms: last ? 900 : 230,
      cells: [...cells],
      selected: cell,
      pressed: solved[cell],
      gain: last ? points : null,
    });
  });
  beats.push({ ...still, ms: FADE_MS, cells: [...cells], fading: true });
  return beats;
}

/** Sudoku and Mini Sudoku share a look: a boxed grid over a number pad. */
export function DigitGridPreview({
  name,
  side,
  boxRows,
  boxColumns,
  open,
  beats,
  playing,
}: {
  name: string;
  side: number;
  boxRows: number;
  boxColumns: number;
  open: readonly number[];
  beats: readonly DigitGridBeat[];
  playing: boolean;
}) {
  const index = useBeats(beats, playing);
  const beat = beats[index];
  const box = (cell: number) =>
    Math.floor(Math.floor(cell / side) / boxRows) * side + Math.floor((cell % side) / boxColumns);
  const related = (cell: number) =>
    beat.selected !== null &&
    (Math.floor(cell / side) === Math.floor(beat.selected / side) ||
      cell % side === beat.selected % side ||
      box(cell) === box(beat.selected));
  const digit = beat.selected !== null ? beat.cells[beat.selected] : 0;
  return (
    <PreviewStage name={name} fading={beat.fading} className="flex flex-col items-center gap-[3%]">
      <div
        className="grid aspect-square min-h-0 flex-1 overflow-hidden rounded-lg border-2 bg-surface"
        style={{
          borderColor: BOX_EDGE,
          gridTemplateColumns: `repeat(${side}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${side}, minmax(0, 1fr))`,
        }}
      >
        {beat.cells.map((value, cell) => {
          const row = Math.floor(cell / side);
          const column = cell % side;
          return (
            <div
              key={cell}
              style={{
                borderStyle: "solid",
                borderRightWidth: column < side - 1 ? ((column + 1) % boxColumns === 0 ? 2 : 1) : 0,
                borderBottomWidth: row < side - 1 ? ((row + 1) % boxRows === 0 ? 2 : 1) : 0,
                borderRightColor: (column + 1) % boxColumns === 0 ? BOX_EDGE : CELL_EDGE,
                borderBottomColor: (row + 1) % boxRows === 0 ? BOX_EDGE : CELL_EDGE,
              }}
              className={cn(
                "flex items-center justify-center leading-none tabular",
                side > 6 ? "text-[min(4.4cqw,4.4cqh,1.05rem)]" : "text-[min(6cqw,6cqh,1.4rem)]",
                open.includes(cell) ? "font-medium text-primary" : "font-semibold text-foreground",
                related(cell) ? "bg-surface-2" : "bg-surface",
                value !== 0 && value === digit && cell !== beat.selected && "bg-primary/15",
                cell === beat.selected && "bg-primary/25",
              )}
            >
              {value !== 0 ? value : ""}
            </div>
          );
        })}
      </div>
      <div
        className="grid w-full shrink-0 gap-[1%]"
        style={{ gridTemplateColumns: `repeat(${side}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: side }, (_, i) => (
          <span
            key={i}
            className={cn(
              "flex h-[min(9cqw,9cqh,2.25rem)] items-center justify-center rounded-md bg-secondary text-[min(4cqw,4cqh,0.95rem)] font-semibold text-secondary-foreground transition-transform duration-100 tabular",
              beat.pressed === i + 1 && "scale-90 bg-primary text-primary-foreground",
            )}
          >
            {i + 1}
          </span>
        ))}
      </div>
      {beat.gain !== null && <FloatingPoints key={index}>+{beat.gain}</FloatingPoints>}
    </PreviewStage>
  );
}
