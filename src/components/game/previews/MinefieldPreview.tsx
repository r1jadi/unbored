import { MineCellFace, mineCellClass } from "@/components/game/MinefieldCell";
import { points } from "@/lib/format";
import {
  chordTargetsOn,
  CLOSED,
  FLAGGED,
  numbersFor,
  openInto,
  type MineCell,
} from "@/lib/games/minefield";
import { cn } from "@/lib/utils";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

export type MinefieldBeat = Beat & {
  readonly cells: readonly MineCell[];
  readonly pressed: number | null;
  /** The units this beat's opened cells earned, floated over the board. */
  readonly gain: number | null;
};

const SIDE = 6;

/** A board of its own, not one a seed deals. */
export const MINEFIELD_PREVIEW_MINES: readonly number[] = [5, 16, 22, 29, 33];

/** The flags the script puts up, on cell 10's two mines. */
export const MINEFIELD_PREVIEW_FLAGS: readonly number[] = [5, 16];

const NUMBERS = numbersFor(MINEFIELD_PREVIEW_MINES, SIDE);
const FIRST_TAP = 0;
const CHORD_TAP = 10;

function build(): MinefieldBeat[] {
  const still = { pressed: null, gain: null };
  const closed: MineCell[] = Array.from({ length: SIDE * SIDE }, () => CLOSED);

  // The first tap opens the clear area under the rules' own spread.
  const opened = [...closed];
  const firstGain = openInto(opened, NUMBERS, SIDE, FIRST_TAP);

  const beats: MinefieldBeat[] = [
    { ...still, ms: 450, cells: closed },
    { ...still, ms: 220, cells: closed, pressed: FIRST_TAP },
    { ...still, ms: 800, cells: opened, gain: firstGain },
  ];

  // Two flags, then a tap on the number they add up to opens what is left around it.
  let flagged = opened;
  for (const flag of MINEFIELD_PREVIEW_FLAGS) {
    const next = [...flagged];
    next[flag] = FLAGGED;
    beats.push({ ...still, ms: 220, cells: flagged, pressed: flag });
    beats.push({ ...still, ms: 280, cells: next });
    flagged = next;
  }

  const chorded = [...flagged];
  let chordGain = 0;
  for (const target of chordTargetsOn(flagged, NUMBERS, SIDE, CHORD_TAP)) {
    chordGain += openInto(chorded, NUMBERS, SIDE, target);
  }
  beats.push({ ...still, ms: 220, cells: flagged, pressed: CHORD_TAP });
  beats.push({ ...still, ms: 900, cells: chorded, gain: chordGain });
  beats.push({ ...still, ms: FADE_MS, cells: chorded, fading: true });
  return beats;
}

export const MINEFIELD_PREVIEW_BEATS: readonly MinefieldBeat[] = build();

/** Minefield: one tap opens an area, two flags and a number open more. */
export function MinefieldPreview({ playing }: { playing: boolean }) {
  const index = useBeats(MINEFIELD_PREVIEW_BEATS, playing);
  const beat = MINEFIELD_PREVIEW_BEATS[index];
  return (
    <PreviewStage name="minefield" fading={beat.fading}>
      <div
        className="absolute inset-0 grid gap-[1.5%] rounded-2xl bg-surface p-[2.5%] text-[min(7cqw,7cqh,1.75rem)]"
        style={{
          gridTemplateColumns: `repeat(${SIDE}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${SIDE}, minmax(0, 1fr))`,
        }}
      >
        {beat.cells.map((state, at) => (
          <div
            key={at}
            className={cn(
              "flex items-center justify-center rounded-md transition-colors duration-100",
              mineCellClass(state),
              beat.pressed === at && "scale-90 ring-2 ring-foreground",
            )}
          >
            <MineCellFace state={state} number={NUMBERS[at]} />
          </div>
        ))}
      </div>
      {beat.gain !== null && <FloatingPoints key={index}>+{points(beat.gain)}</FloatingPoints>}
    </PreviewStage>
  );
}
