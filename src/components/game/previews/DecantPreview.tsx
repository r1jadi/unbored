import type { CSSProperties } from "react";

import {
  DECANT_DEPTH,
  isComplete,
  pourAmount,
  poured,
  topColour,
  type Tube,
} from "@/lib/games/decant";
import { cn } from "@/lib/utils";

import { FADE_MS } from "./shared";
import { useBeats } from "./use-preview";

/** One moment of the Decant preview. */
export type DecantBeat = {
  readonly ms: number;
  readonly tubes: readonly Tube[];
  /** The tube picked up. */
  readonly held: number | null;
  /** The pour in the air: it lands on top of `to`, whose `tubes` entry already holds it. */
  readonly pour: {
    readonly from: number;
    readonly to: number;
    readonly colour: number;
    readonly amount: number;
    /** How many units the source held before the pour. */
    readonly fromHeight: number;
  } | null;
  readonly fading: boolean;
};

/** Three colours one good sequence from sorted. Bottom to top; a number indexes the liquids. */
export const DECANT_PREVIEW_START: readonly Tube[] = [
  [6, 6, 1, 1],
  [1, 1, 6, 6],
  [3, 3, 3],
  [3],
  [],
];

export const DECANT_PREVIEW_POURS: readonly (readonly [number, number])[] = [
  [3, 2],
  [0, 4],
  [1, 0],
  [1, 4],
];

const LIFT_MS = 280;
const POUR_MS = 460;

function buildDecantBeats(): DecantBeat[] {
  let tubes: readonly Tube[] = DECANT_PREVIEW_START;
  const beats: DecantBeat[] = [{ ms: 350, tubes, held: null, pour: null, fading: false }];
  DECANT_PREVIEW_POURS.forEach(([from, to]) => {
    beats.push({ ms: LIFT_MS, tubes, held: from, pour: null, fading: false });
    const pour = {
      from,
      to,
      colour: topColour(tubes[from]),
      amount: pourAmount(tubes, from, to),
      fromHeight: tubes[from].length,
    };
    tubes = poured(tubes, from, to);
    beats.push({ ms: POUR_MS, tubes, held: null, pour, fading: false });
  });
  beats.push({ ms: 800, tubes, held: null, pour: null, fading: false });
  beats.push({ ms: FADE_MS, tubes, held: null, pour: null, fading: true });
  return beats;
}

export const DECANT_PREVIEW_BEATS: readonly DecantBeat[] = buildDecantBeats();

/** The same liquids as the real board, indexed by colour number less one. */
const LIQUIDS = [
  "var(--game-5)",
  "var(--game-7)",
  "var(--game-4)",
  "var(--game-2)",
  "var(--game-6)",
  "var(--game-1)",
];

// In percentages of the square stage, so a pour can travel between tubes.
const TUBE_WIDTH = 15;
const TUBE_GAP = (100 - 5 * TUBE_WIDTH) / 6;
const TUBE_TOP = 14;
const TUBE_HEIGHT = 72;
const WALL = 1.4;
const UNIT = (TUBE_HEIGHT - 2 * WALL) / DECANT_DEPTH;
/** How far a picked-up tube's pour starts above where it sat. */
const LIFT = 4;
/** The height a pour crosses at, above the tubes' mouths. */
const OVER = 5;

const tubeLeft = (tube: number) => TUBE_GAP + tube * (TUBE_WIDTH + TUBE_GAP);
const stackTop = (height: number) => TUBE_TOP + TUBE_HEIGHT - WALL - height * UNIT;

/** Decant: four pours sort the last three colours, and the board reads as solved. */
export function DecantPreview({ playing }: { playing: boolean }) {
  const index = useBeats(DECANT_PREVIEW_BEATS, playing);
  const beat = DECANT_PREVIEW_BEATS[index];
  const { pour } = beat;
  const landing = pour ? beat.tubes[pour.to].length : 0;
  const top = pour ? stackTop(landing) : 0;

  return (
    <div
      data-testid="decant-preview"
      className={cn(
        "relative size-full transition-opacity duration-200",
        beat.fading && "opacity-0",
      )}
    >
      {beat.tubes.map((tube, t) => {
        // The units in the air are not in the tube yet.
        const shown = pour?.to === t ? tube.slice(0, tube.length - pour.amount) : tube;
        const done = pour?.to !== t && isComplete(tube);
        return (
          <div
            key={t}
            className={cn(
              "absolute flex flex-col-reverse gap-[3px] overflow-hidden rounded-t-md rounded-b-[1.4rem] border-2 bg-surface-2/50 p-[3px] transition-[transform,border-color,box-shadow] duration-150 ease-out",
              beat.held === t
                ? "-translate-y-3 border-primary shadow-[0_10px_24px_-8px_oklch(0.7_0.18_40/0.6)]"
                : done
                  ? "border-success/70"
                  : "border-foreground/15",
            )}
            style={{
              left: `${tubeLeft(t)}%`,
              top: `${TUBE_TOP}%`,
              width: `${TUBE_WIDTH}%`,
              height: `${TUBE_HEIGHT}%`,
            }}
          >
            {shown.map((colour, unit) => (
              <span
                key={unit}
                className={cn(
                  "w-full shrink-0 shadow-[inset_0_-3px_0_oklch(0_0_0/0.18)] ring-1 ring-inset ring-foreground/10",
                  unit === 0 ? "rounded-b-[1.1rem] rounded-t-[0.2rem]" : "rounded-[0.2rem]",
                )}
                style={{
                  height: `calc((100% - ${3 * (DECANT_DEPTH - 1)}px) / ${DECANT_DEPTH})`,
                  backgroundColor: LIQUIDS[colour - 1],
                }}
              />
            ))}
          </div>
        );
      })}

      {pour && (
        <div
          key={index}
          className="preview-pour absolute inset-0 z-10"
          style={
            {
              "--from-x": `${tubeLeft(pour.from) - tubeLeft(pour.to)}%`,
              "--from-y": `${stackTop(pour.fromHeight) - LIFT - top}%`,
              "--over-y": `${OVER - top}%`,
            } as CSSProperties
          }
        >
          <div
            className="absolute rounded-[0.2rem] shadow-[inset_0_-3px_0_oklch(0_0_0/0.18)]"
            style={{
              left: `${tubeLeft(pour.to) + WALL}%`,
              top: `${top}%`,
              width: `${TUBE_WIDTH - 2 * WALL}%`,
              height: `${pour.amount * UNIT}%`,
              backgroundColor: LIQUIDS[pour.colour - 1],
            }}
          />
        </div>
      )}
    </div>
  );
}
