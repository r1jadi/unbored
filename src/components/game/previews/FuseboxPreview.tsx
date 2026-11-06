import { FuseBolts, FuseCellFace, fuseCellClass } from "@/components/game/FuseboxCell";
import {
  FUSEBOX_SIDE,
  PLAIN,
  refundFor,
  settle,
  type FuseBolt,
  type FuseCell,
} from "@/lib/games/fusebox";
import { points } from "@/lib/format";
import { cn } from "@/lib/utils";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

export type FuseboxBeat = Beat & {
  readonly cells: readonly FuseCell[];
  readonly pressed: number | null;
  readonly fired: readonly number[];
  readonly bolts: readonly FuseBolt[];
  readonly gain: number | null;
};

/** A board of its own, row by row, with a chain lined up from the tapped cell. */
const CHARGES = [
  [0, 1, 0, 2, 0, 1],
  [2, 0, 3, 0, 1, 0],
  [0, 3, 3, 3, 0, 2],
  [1, 0, 3, 0, 3, 0],
  [0, 2, 0, 3, 3, 1],
  [1, 0, 1, 0, 2, 0],
];

export const FUSEBOX_PREVIEW_START: readonly FuseCell[] = CHARGES.flat().map((charge) => ({
  charge,
  kind: PLAIN,
}));

/** The tapped cell: the middle of the 3s, row 3, column 3. */
export const FUSEBOX_PREVIEW_TAP = 2 * FUSEBOX_SIDE + 2;

/** What the script's one tap does, under the real rules. */
export const FUSEBOX_PREVIEW_CHAIN = settle(FUSEBOX_PREVIEW_START, FUSEBOX_PREVIEW_TAP);

/** The sparks that chain pays back on board one. */
export const FUSEBOX_PREVIEW_REFUND = refundFor(FUSEBOX_PREVIEW_CHAIN.pops, 1);

function build(): FuseboxBeat[] {
  const still = { pressed: null, fired: [], bolts: [], gain: null };
  const beats: FuseboxBeat[] = [
    { ...still, ms: 420, cells: FUSEBOX_PREVIEW_START },
    { ...still, ms: 240, cells: FUSEBOX_PREVIEW_START, pressed: FUSEBOX_PREVIEW_TAP },
  ];
  FUSEBOX_PREVIEW_CHAIN.waves.forEach((wave) => {
    beats.push({ ...still, ms: 260, cells: wave.cells, fired: wave.fired, bolts: wave.bolts });
  });
  beats.push({
    ...still,
    ms: 900,
    cells: FUSEBOX_PREVIEW_CHAIN.cells,
    gain: FUSEBOX_PREVIEW_CHAIN.gain,
  });
  beats.push({ ...still, ms: FADE_MS, cells: FUSEBOX_PREVIEW_CHAIN.cells, fading: true });
  return beats;
}

export const FUSEBOX_PREVIEW_BEATS: readonly FuseboxBeat[] = build();

/** Fusebox: one tap, and a chain runs across the board. */
export function FuseboxPreview({ playing }: { playing: boolean }) {
  const index = useBeats(FUSEBOX_PREVIEW_BEATS, playing);
  const beat = FUSEBOX_PREVIEW_BEATS[index];
  return (
    <PreviewStage name="fusebox" fading={beat.fading}>
      <div
        className="absolute inset-0 grid gap-[1.5%] rounded-2xl bg-surface p-[2.5%] [--fusebox-inset:2.5%]"
        style={{
          gridTemplateColumns: `repeat(${FUSEBOX_SIDE}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${FUSEBOX_SIDE}, minmax(0, 1fr))`,
        }}
      >
        {beat.cells.map((cell, at) => (
          <div
            key={at}
            className={cn(
              "relative flex items-center justify-center rounded-md transition-colors duration-100",
              fuseCellClass(cell),
              beat.pressed === at && "scale-90 ring-2 ring-foreground",
            )}
          >
            <FuseCellFace cell={cell} popping={beat.fired.includes(at)} />
          </div>
        ))}
        {beat.bolts.length > 0 && <FuseBolts key={index} bolts={beat.bolts} durationMs={260} />}
      </div>
      {beat.gain !== null && <FloatingPoints key={index}>+{points(beat.gain)}</FloatingPoints>}
    </PreviewStage>
  );
}
