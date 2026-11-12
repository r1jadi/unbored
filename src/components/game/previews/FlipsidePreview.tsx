import { useCallback, useRef } from "react";

import { FLIPSIDE_VIEWBOX, rockColor, runnerAngle } from "@/lib/games/flipside-view";
import { TunnelHazard, TunnelRock } from "@/components/game/FlipsideScene";
import {
  createRun,
  FLIPSIDE_HALF,
  FLIPSIDE_RUNNER_X,
  FLIPSIDE_TICK_MS,
  grounded,
  hazardAt,
  step,
  tap,
  type FlipsideRun,
} from "@/lib/games/flipside";

import { useFrameLoop } from "./use-preview";

/** One tick of the Flipside preview. */
export type FlipsideFrame = {
  readonly y: number;
  readonly distance: number;
  readonly score: number;
};

/** A tunnel with both holes and spikes early on. */
export const FLIPSIDE_PREVIEW_SEED = 1;
export const FLIPSIDE_PREVIEW_TICKS = 300;
const FADE_TICKS = 14;
/** Enough hazards to fill the loop. */
export const FLIPSIDE_PREVIEW_HAZARDS = 8;
/** Starts close to the first hazard: the real run opens with empty tunnel. */
const START_DISTANCE = 40_000;

function survives(run: FlipsideRun, ticks: number): boolean {
  let next = run;
  for (let i = 0; i < ticks && next.outcome === "playing"; i += 1) next = step(next);
  return next.outcome === "playing";
}

function landsSafely(run: FlipsideRun): boolean {
  let next = step(tap(run));
  for (let i = 0; i < 120 && next.outcome === "playing"; i += 1) {
    if (grounded(next)) return survives(next, 1);
    next = step(next);
  }
  return false;
}

/** The pilot from the fairness test: it flips on the last tick a flip lands safely. */
function buildFrames(): FlipsideFrame[] {
  let run: FlipsideRun = { ...createRun(FLIPSIDE_PREVIEW_SEED), distance: START_DISTANCE };
  let flipAt = -1;
  const frames: FlipsideFrame[] = [];
  for (let tick = 0; tick < FLIPSIDE_PREVIEW_TICKS; tick += 1) {
    if (run.tick === flipAt) {
      run = tap(run);
      flipAt = -1;
    } else if (flipAt < 0 && grounded(run) && run.buffer === 0 && !survives(run, 50)) {
      let latest = 0;
      let ahead = run;
      for (let i = 0; i < 50 && ahead.outcome === "playing" && grounded(ahead); i += 1) {
        if (landsSafely(ahead)) latest = i;
        ahead = step(ahead);
      }
      if (latest === 0) run = tap(run);
      else flipAt = run.tick + latest;
    }
    run = step(run);
    frames.push({ y: run.y, distance: run.distance, score: run.score });
  }
  return frames;
}

export const FLIPSIDE_PREVIEW_FRAMES: readonly FlipsideFrame[] = buildFrames();

const HAZARDS = Array.from({ length: FLIPSIDE_PREVIEW_HAZARDS }, (_, k) =>
  hazardAt(FLIPSIDE_PREVIEW_SEED, k),
);
const LOOP_MS = FLIPSIDE_PREVIEW_TICKS * FLIPSIDE_TICK_MS;

const hazardsTransform = (frame: FlipsideFrame) => `translate(${-frame.distance} 0)`;
const runnerTransform = (frame: FlipsideFrame) =>
  `translate(${FLIPSIDE_RUNNER_X} ${frame.y}) rotate(${runnerAngle(frame.y)})`;

function strengthAt(elapsedMs: number, tick: number): number {
  const fadeOut = (FLIPSIDE_PREVIEW_TICKS - 1 - tick) / FADE_TICKS;
  const fadeIn = elapsedMs < LOOP_MS ? 1 : tick / FADE_TICKS;
  return Math.min(1, fadeOut, fadeIn);
}

/** Flipside: the runner flips across the tunnel on the game's own physics. */
export function FlipsidePreview({ playing }: { playing: boolean }) {
  const scene = useRef<SVGGElement>(null);
  const hazards = useRef<SVGGElement>(null);
  const runner = useRef<SVGGElement>(null);
  const score = useRef<HTMLParagraphElement>(null);

  const draw = useCallback((elapsedMs: number | null) => {
    const tick =
      elapsedMs === null ? 0 : Math.floor(elapsedMs / FLIPSIDE_TICK_MS) % FLIPSIDE_PREVIEW_TICKS;
    const frame = FLIPSIDE_PREVIEW_FRAMES[tick];
    if (scene.current) {
      scene.current.style.opacity = elapsedMs === null ? "1" : String(strengthAt(elapsedMs, tick));
    }
    hazards.current?.setAttribute("transform", hazardsTransform(frame));
    runner.current?.setAttribute("transform", runnerTransform(frame));
    const scoreNow = String(frame.score * 10);
    if (score.current && score.current.textContent !== scoreNow) {
      score.current.textContent = scoreNow;
    }
  }, []);

  useFrameLoop(playing, draw);

  const first = FLIPSIDE_PREVIEW_FRAMES[0];
  return (
    <div data-testid="flipside-preview" className="flex size-full items-center justify-center">
      <div className="relative aspect-[3/4] h-full overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-surface-2 via-surface to-surface-2">
        <svg
          viewBox={FLIPSIDE_VIEWBOX}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full"
        >
          <TunnelRock color={rockColor(0)} />
          <g ref={scene}>
            <g ref={hazards} transform={hazardsTransform(first)}>
              {HAZARDS.map((hazard) => (
                <TunnelHazard key={hazard.x} hazard={hazard} />
              ))}
            </g>
            <g ref={runner} transform={runnerTransform(first)}>
              <rect
                x={-FLIPSIDE_HALF}
                y={-FLIPSIDE_HALF}
                width={FLIPSIDE_HALF * 2}
                height={FLIPSIDE_HALF * 2}
                rx={900}
                fill="var(--primary)"
              />
              <circle cx={1300} cy={-600} r={1000} fill="var(--background)" />
              <circle cx={1650} cy={-500} r={480} fill="var(--foreground)" />
            </g>
          </g>
        </svg>
        <p
          ref={score}
          className="absolute inset-x-0 top-[16%] text-center text-[min(13cqw,13cqh,3rem)] font-semibold leading-none text-foreground/80 tabular"
        >
          {first.score * 10}
        </p>
      </div>
    </div>
  );
}
