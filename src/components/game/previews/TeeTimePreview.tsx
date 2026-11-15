import {
  createRun,
  holePoints,
  INNER_RING,
  OUTER_RING,
  playShot,
  type Hole,
  type Shot,
  type TeeTimeRun,
} from "@/lib/games/tee-time";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

/**
 * A par 4 of the preview's own — no day builds it — played by the real rules: a
 * full drive up the fairway, then a wedge that stops inside the inner ring. One
 * putt makes a birdie.
 */
export const TEE_TIME_PREVIEW_HOLE: Hole = {
  par: 4,
  length: 350,
  pin: { x: 20, y: 350 },
  green: 14,
  fairway: Array.from({ length: 15 }, (_, i) => ({ x: 0, y: 120 + i * 15, r: 20 })),
  bunkers: [
    { x: 36, y: 338, r: 5 },
    { x: -12, y: 362, r: 5 },
  ],
  water: [{ x: -34, y: 220, r: 14 }],
  wind: { x: 0, y: 0 },
  bounds: { minX: -80, maxX: 90, minY: -30, maxY: 385 },
};

export const TEE_TIME_PREVIEW_SHOTS: readonly Shot[] = [
  { club: 0, angle: 0, power: 100 },
  { club: 5, angle: 14, power: 63 },
];

/** The preview's run, shot by shot: the start, then after each shot. */
export const TEE_TIME_PREVIEW_RUNS: readonly TeeTimeRun[] = TEE_TIME_PREVIEW_SHOTS.reduce(
  (runs, shot) => [...runs, playShot(runs[runs.length - 1]!, shot)],
  [{ ...createRun(0), course: [TEE_TIME_PREVIEW_HOLE] }] as TeeTimeRun[],
);

type Point = { readonly x: number; readonly y: number };

export type TeeTimeBeat = Beat & {
  readonly ball: Point;
  /** The meter's fill, 0–100, or null when no swing is on. */
  readonly meter: number | null;
  readonly aim: Point | null;
  readonly gain: number | null;
};

function build(): TeeTimeBeat[] {
  const [, afterDrive, afterApproach] = TEE_TIME_PREVIEW_RUNS;
  const tee = { x: 0, y: 0 };
  const drive = afterDrive!.lastShot!.rest;
  const approach = afterApproach!.lastShot!.rest;
  const card = afterApproach!.cards[0]!;
  const pin = TEE_TIME_PREVIEW_HOLE.pin;
  return [
    { ms: 500, ball: tee, meter: null, aim: drive, gain: null },
    { ms: 450, ball: tee, meter: TEE_TIME_PREVIEW_SHOTS[0]!.power, aim: drive, gain: null },
    { ms: 800, ball: drive, meter: null, aim: null, gain: null },
    { ms: 300, ball: drive, meter: null, aim: pin, gain: null },
    { ms: 450, ball: drive, meter: TEE_TIME_PREVIEW_SHOTS[1]!.power, aim: pin, gain: null },
    { ms: 800, ball: approach, meter: null, aim: null, gain: null },
    {
      ms: 1000,
      ball: approach,
      meter: null,
      aim: null,
      gain: holePoints(TEE_TIME_PREVIEW_HOLE.par, card.strokes),
    },
    { ms: FADE_MS, ball: approach, meter: null, aim: null, gain: null, fading: true },
  ];
}

export const TEE_TIME_PREVIEW_BEATS: readonly TeeTimeBeat[] = build();

const H = TEE_TIME_PREVIEW_HOLE;
const W = H.bounds.maxX - H.bounds.minX;
const HT = H.bounds.maxY - H.bounds.minY;
const sx = (x: number) => x - H.bounds.minX;
const sy = (y: number) => H.bounds.maxY - y;

/** Tee Time: a hole from above, a drive, an approach into the ring, and a birdie. */
export function TeeTimePreview({ playing }: { playing: boolean }) {
  const index = useBeats(TEE_TIME_PREVIEW_BEATS, playing);
  const beat = TEE_TIME_PREVIEW_BEATS[index];
  return (
    <PreviewStage name="tee-time" fading={beat.fading} className="flex items-center justify-center">
      <div className="relative flex h-full items-center gap-[3cqw] p-[3cqw]">
        <div className="relative h-full" style={{ aspectRatio: `${W} / ${HT}` }}>
          <svg viewBox={`0 0 ${W} ${HT}`} className="size-full rounded-[min(3cqw,3cqh,0.75rem)]">
            <rect width={W} height={HT} fill="#3f7d3a" />
            {H.fairway.map((d, i) => (
              <circle key={i} cx={sx(d.x)} cy={sy(d.y)} r={d.r} fill="#62a84f" />
            ))}
            <circle cx={sx(0)} cy={sy(0)} r={5} fill="#7fc06a" />
            {H.water.map((d, i) => (
              <circle key={i} cx={sx(d.x)} cy={sy(d.y)} r={d.r} fill="#4a90d9" />
            ))}
            {H.bunkers.map((d, i) => (
              <circle key={i} cx={sx(d.x)} cy={sy(d.y)} r={d.r} fill="#e8d39a" />
            ))}
            <circle cx={sx(H.pin.x)} cy={sy(H.pin.y)} r={H.green} fill="#86cf6a" />
            <circle
              cx={sx(H.pin.x)}
              cy={sy(H.pin.y)}
              r={OUTER_RING}
              fill="none"
              stroke="#fff"
              strokeOpacity={0.55}
              strokeWidth={0.8}
            />
            <circle
              cx={sx(H.pin.x)}
              cy={sy(H.pin.y)}
              r={INNER_RING}
              fill="#f5c542"
              fillOpacity={0.4}
              stroke="#f5c542"
              strokeWidth={0.8}
            />
            <line
              x1={sx(H.pin.x)}
              y1={sy(H.pin.y)}
              x2={sx(H.pin.x)}
              y2={sy(H.pin.y) - 12}
              stroke="#fff"
              strokeWidth={1.2}
            />
            <polygon
              points={`${sx(H.pin.x)},${sy(H.pin.y) - 12} ${sx(H.pin.x) + 8},${sy(H.pin.y) - 9.5} ${sx(H.pin.x)},${sy(H.pin.y) - 7}`}
              fill="#e5484d"
            />
            {beat.aim && (
              <line
                x1={sx(beat.ball.x)}
                y1={sy(beat.ball.y)}
                x2={sx(beat.aim.x)}
                y2={sy(beat.aim.y)}
                stroke="#fff"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
          </svg>
          <div
            className="absolute size-[min(4cqw,4cqh,1rem)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/60 bg-white shadow transition-[left,top] duration-700 ease-out"
            style={{
              left: `${(sx(beat.ball.x) / W) * 100}%`,
              top: `${(sy(beat.ball.y) / HT) * 100}%`,
            }}
          />
        </div>
        <div className="flex h-[70%] w-[min(4cqw,4cqh,1rem)] flex-col-reverse overflow-hidden rounded-full bg-surface-2">
          <div
            className={cn(
              "w-full rounded-full bg-primary transition-[height] ease-linear",
              beat.meter === null ? "duration-0" : "duration-[400ms]",
            )}
            style={{ height: `${beat.meter ?? 0}%` }}
          />
        </div>
      </div>
      {beat.gain !== null && (
        <FloatingPoints key={index} note={t("Birdie!")}>
          +{beat.gain}
        </FloatingPoints>
      )}
    </PreviewStage>
  );
}
