import { Lock } from "lucide-react";
import type { CSSProperties } from "react";

import {
  BOLTED_DEPTH,
  isLocked,
  moveAmount,
  moved,
  topColour,
  type Bolt,
} from "@/lib/games/bolted";
import { cn } from "@/lib/utils";

import { FADE_MS, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

export type BoltedBeat = Beat & {
  readonly bolts: readonly Bolt[];
  readonly held: number | null;
  readonly carrying: {
    readonly from: number;
    readonly to: number;
    readonly colour: number;
    readonly amount: number;
    readonly fromHeight: number;
  } | null;
};

/** Three colours a few moves from locked. Bottom to top; a number indexes the nuts. */
export const BOLTED_PREVIEW_START: readonly Bolt[] = [
  [6, 6, 4, 4],
  [4, 4, 6],
  [1, 1, 1, 6],
  [1],
  [],
];

export const BOLTED_PREVIEW_MOVES: readonly (readonly [number, number])[] = [
  [2, 1],
  [3, 2],
  [0, 3],
  [1, 0],
  [1, 3],
];

function build(): BoltedBeat[] {
  let bolts: readonly Bolt[] = BOLTED_PREVIEW_START;
  const beats: BoltedBeat[] = [{ ms: 320, bolts, held: null, carrying: null }];
  BOLTED_PREVIEW_MOVES.forEach(([from, to]) => {
    beats.push({ ms: 240, bolts, held: from, carrying: null });
    const carrying = {
      from,
      to,
      colour: topColour(bolts[from]),
      amount: moveAmount(bolts, from, to),
      fromHeight: bolts[from].length,
    };
    bolts = moved(bolts, from, to);
    beats.push({ ms: 440, bolts, held: null, carrying });
  });
  beats.push({ ms: 640, bolts, held: null, carrying: null });
  beats.push({ ms: FADE_MS, bolts, held: null, carrying: null, fading: true });
  return beats;
}

export const BOLTED_PREVIEW_BEATS: readonly BoltedBeat[] = build();

const NUTS = [
  "var(--game-5)",
  "var(--game-7)",
  "var(--game-4)",
  "var(--game-2)",
  "var(--game-6)",
  "var(--game-1)",
];

// In percentages of the square stage, so nuts can travel between bolts.
const BOLT_WIDTH = 16;
const BOLT_GAP = (100 - 5 * BOLT_WIDTH) / 6;
const BOLT_TOP = 16;
const BOLT_HEIGHT = 70;
const NUT_HEIGHT = BOLT_WIDTH * 0.88 * (20 / 48);
const STACK_BOTTOM = BOLT_TOP + BOLT_HEIGHT - 4.6;
const OVER = 5;

const boltLeft = (bolt: number) => BOLT_GAP + bolt * (BOLT_WIDTH + BOLT_GAP);
const stackTop = (height: number) => STACK_BOTTOM - height * (NUT_HEIGHT + 0.7);

function Nut({ colour }: { colour: number }) {
  return (
    <svg viewBox="0 0 48 20" className="block w-full shrink-0" aria-hidden>
      <path
        d="M7 1h34l6 9-6 9H7l-6-9Z"
        fill={NUTS[colour - 1]}
        stroke="oklch(0 0 0 / 0.25)"
        strokeWidth="1.2"
      />
      <rect x="18" y="5" width="12" height="10" rx="2" fill="oklch(0 0 0 / 0.28)" />
      <path
        d="M8 3h32"
        stroke="white"
        strokeOpacity="0.3"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Bolted: nuts move in runs between bolts, and a bolt of one colour locks. */
export function BoltedPreview({ playing }: { playing: boolean }) {
  const index = useBeats(BOLTED_PREVIEW_BEATS, playing);
  const beat = BOLTED_PREVIEW_BEATS[index];
  const { carrying } = beat;
  const landing = carrying ? beat.bolts[carrying.to].length : 0;
  const top = carrying ? stackTop(landing) : 0;

  return (
    <PreviewStage name="bolted" fading={beat.fading}>
      {beat.bolts.map((bolt, b) => {
        const shown = carrying?.to === b ? bolt.slice(0, bolt.length - carrying.amount) : bolt;
        const locked = carrying?.to !== b && isLocked(bolt);
        return (
          <div
            key={b}
            className={cn(
              "absolute flex flex-col items-center justify-end rounded-xl transition-[transform,background-color] duration-150 ease-out",
              beat.held === b ? "-translate-y-3 bg-primary/15" : "bg-transparent",
            )}
            style={{
              left: `${boltLeft(b)}%`,
              top: `${BOLT_TOP}%`,
              width: `${BOLT_WIDTH}%`,
              height: `${BOLT_HEIGHT}%`,
            }}
          >
            <span className="absolute top-1 bottom-3 left-1/2 w-[18%] -translate-x-1/2 rounded-t-full bg-[repeating-linear-gradient(180deg,oklch(0.72_0.01_270)_0_3px,oklch(0.6_0.01_270)_3px_5px)]" />
            <span
              className={cn(
                "absolute bottom-1 left-1/2 h-2 w-[92%] -translate-x-1/2 rounded-full transition-colors",
                locked ? "bg-success/80" : "bg-foreground/25",
              )}
            />
            <span className="relative z-10 flex w-full flex-col-reverse gap-[3px] px-[6%] pb-[14%]">
              {shown.map((colour, nut) => (
                <Nut key={nut} colour={colour} />
              ))}
              {Array.from({ length: BOLTED_DEPTH - shown.length }, (_, slot) => (
                <span key={`empty-${slot}`} className="block aspect-[48/20] w-full" />
              ))}
            </span>
            {locked && (
              <span className="cascade-made absolute -top-2 right-0 z-20 flex size-5 items-center justify-center rounded-full bg-success text-background">
                <Lock className="size-3" />
              </span>
            )}
          </div>
        );
      })}

      {carrying && (
        <div
          key={index}
          className="preview-pour absolute inset-0 z-10"
          style={
            {
              "--from-x": `${boltLeft(carrying.from) - boltLeft(carrying.to)}%`,
              "--from-y": `${stackTop(carrying.fromHeight) - top - 3}%`,
              "--over-y": `${OVER - top}%`,
            } as CSSProperties
          }
        >
          <div
            className="absolute flex flex-col gap-[3px]"
            style={{
              left: `${boltLeft(carrying.to) + BOLT_WIDTH * 0.06}%`,
              top: `${top}%`,
              width: `${BOLT_WIDTH * 0.88}%`,
            }}
          >
            {Array.from({ length: carrying.amount }, (_, nut) => (
              <Nut key={nut} colour={carrying.colour} />
            ))}
          </div>
        </div>
      )}
    </PreviewStage>
  );
}
