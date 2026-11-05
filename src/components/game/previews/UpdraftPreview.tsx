import { useCallback, useRef } from "react";

import {
  columnAt,
  createRun as createUpdraftRun,
  flap,
  step,
  UPDRAFT_COLUMN_WIDTH,
  UPDRAFT_GLIDER_RADIUS,
  UPDRAFT_GLIDER_X,
  UPDRAFT_GROUND,
  UPDRAFT_HEIGHT,
  UPDRAFT_MAX_FALL,
  UPDRAFT_TICK_MS,
  UPDRAFT_WIDTH,
} from "@/lib/games/updraft";
import { cn } from "@/lib/utils";

import { useFrameLoop } from "./use-preview";

/** One tick of the Flutter preview. */
export type UpdraftFrame = {
  readonly y: number;
  readonly vy: number;
  readonly distance: number;
  readonly score: number;
};

/** A field with some climb and drop in it. Any seed would do: its columns are random. */
export const UPDRAFT_PREVIEW_SEED = 7;
export const UPDRAFT_PREVIEW_TICKS = 280;
/** Ticks at each end of the loop spent fading, so it starts over without a jump. */
export const UPDRAFT_PREVIEW_FADE_TICKS = 14;
/** Enough columns to fill the loop. */
export const UPDRAFT_PREVIEW_COLUMNS = 4;

/**
 * Starts part of the way to the first column, because the real run's opening is
 * empty sky: the preview has under five seconds and spends them among columns.
 */
const UPDRAFT_PREVIEW_DISTANCE = 42_000;

/** How far under the gap's centre the glider sinks before it flaps. */
const FLAP_BELOW_CENTRE = 4_000;

function buildUpdraftFrames(): UpdraftFrame[] {
  let run = { ...createUpdraftRun(UPDRAFT_PREVIEW_SEED), distance: UPDRAFT_PREVIEW_DISTANCE };
  const frames: UpdraftFrame[] = [];
  for (let tick = 0; tick < UPDRAFT_PREVIEW_TICKS; tick += 1) {
    // Hold the column it is still inside; otherwise line up for the next one.
    const behind = run.passed > 0 ? columnAt(UPDRAFT_PREVIEW_SEED, run.passed - 1) : null;
    const inside =
      behind !== null &&
      behind.x + UPDRAFT_COLUMN_WIDTH + UPDRAFT_GLIDER_RADIUS - run.distance > UPDRAFT_GLIDER_X;
    const column = inside ? behind : columnAt(UPDRAFT_PREVIEW_SEED, run.passed);
    if (run.y > column.top + column.gap / 2 + FLAP_BELOW_CENTRE && run.vy >= 0) run = flap(run);
    run = step(run);
    frames.push({ y: run.y, vy: run.vy, distance: run.distance, score: run.score });
  }
  return frames;
}

export const UPDRAFT_PREVIEW_FRAMES: readonly UpdraftFrame[] = buildUpdraftFrames();

const across = (units: number) => `${(units / UPDRAFT_WIDTH) * 100}%`;
const down = (units: number) => `${(units / UPDRAFT_HEIGHT) * 100}%`;
const DIAMETER = UPDRAFT_GLIDER_RADIUS * 2;
const GROUND_STRIPE = 6_000;
const STRIPE_SHARE = (GROUND_STRIPE / (UPDRAFT_WIDTH + GROUND_STRIPE)) * 100;

const COLUMNS = Array.from({ length: UPDRAFT_PREVIEW_COLUMNS }, (_, k) =>
  columnAt(UPDRAFT_PREVIEW_SEED, k),
);

/** Each moving part's transform for a frame, in one place for the render and the loop. */
const fieldTransform = (frame: UpdraftFrame) =>
  `translateX(${(-frame.distance / UPDRAFT_WIDTH) * 100}%)`;
const groundTransform = (frame: UpdraftFrame) =>
  `translateX(${(-(frame.distance % GROUND_STRIPE) / (UPDRAFT_WIDTH + GROUND_STRIPE)) * 100}%)`;
const gliderTransform = (frame: UpdraftFrame) =>
  `translateY(${((frame.y - UPDRAFT_GLIDER_RADIUS) / DIAMETER) * 100}%)`;
const bodyTransform = (frame: UpdraftFrame) =>
  `rotate(${Math.max(-25, Math.min(70, (frame.vy / UPDRAFT_MAX_FALL) * 70))}deg)`;
const wingTransform = (frame: UpdraftFrame) => `rotate(${frame.vy < -900 ? -30 : 12}deg)`;

const LOOP_MS = UPDRAFT_PREVIEW_TICKS * UPDRAFT_TICK_MS;

/**
 * The scene's strength at a moment of the loop. It fades out at the end and back
 * in at the start, so it starts over without the field jumping; the very first
 * pass has no fade-in, because the waiting card is already showing that frame.
 */
function strengthAt(elapsedMs: number, tick: number): number {
  const fadeOut = (UPDRAFT_PREVIEW_TICKS - 1 - tick) / UPDRAFT_PREVIEW_FADE_TICKS;
  const fadeIn = elapsedMs < LOOP_MS ? 1 : tick / UPDRAFT_PREVIEW_FADE_TICKS;
  return Math.min(1, fadeOut, fadeIn);
}

/** Flutter: the glider threads the gaps on the game's own physics. */
export function UpdraftPreview({ playing }: { playing: boolean }) {
  const scene = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const ground = useRef<HTMLDivElement>(null);
  const glider = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const wing = useRef<HTMLSpanElement>(null);
  const score = useRef<HTMLParagraphElement>(null);

  const draw = useCallback((elapsedMs: number | null) => {
    // Stopped: back to the opening, at full strength.
    const tick =
      elapsedMs === null ? 0 : Math.floor(elapsedMs / UPDRAFT_TICK_MS) % UPDRAFT_PREVIEW_TICKS;
    const frame = UPDRAFT_PREVIEW_FRAMES[tick];
    if (scene.current) {
      scene.current.style.opacity = elapsedMs === null ? "1" : String(strengthAt(elapsedMs, tick));
    }
    if (field.current) field.current.style.transform = fieldTransform(frame);
    if (ground.current) ground.current.style.transform = groundTransform(frame);
    if (glider.current) glider.current.style.transform = gliderTransform(frame);
    if (body.current) body.current.style.transform = bodyTransform(frame);
    // These two rarely change, and writing them anyway costs a layout every frame.
    const wingNow = wingTransform(frame);
    if (wing.current && wing.current.style.transform !== wingNow) {
      wing.current.style.transform = wingNow;
    }
    const scoreNow = String(frame.score);
    if (score.current && score.current.textContent !== scoreNow) {
      score.current.textContent = scoreNow;
    }
  }, []);

  useFrameLoop(playing, draw);

  const first = UPDRAFT_PREVIEW_FRAMES[0];
  return (
    <div data-testid="updraft-preview" className="flex size-full items-center justify-center">
      <div className="relative aspect-[3/4] h-full overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-surface-2 to-surface">
        <div ref={scene} className="absolute inset-0">
          {/* Every column on one strip, so a frame moves a single layer. */}
          <div
            ref={field}
            className="absolute inset-0 will-change-transform"
            style={{ transform: fieldTransform(first) }}
          >
            {COLUMNS.map((column) => {
              const bottom = column.top + column.gap;
              return (
                <div key={column.x}>
                  <div
                    className="absolute top-0 rounded-b-xl border-x-2 border-b-4 border-background/25 bg-game-2"
                    style={{
                      left: across(column.x),
                      width: across(UPDRAFT_COLUMN_WIDTH),
                      height: down(column.top),
                    }}
                  />
                  <div
                    className="absolute rounded-t-xl border-x-2 border-t-4 border-background/25 bg-game-2"
                    style={{
                      left: across(column.x),
                      width: across(UPDRAFT_COLUMN_WIDTH),
                      top: down(bottom),
                      height: down(UPDRAFT_GROUND - bottom),
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* The score, large, over the sky. */}
          <p
            ref={score}
            className="absolute inset-x-0 top-[6%] text-center text-[min(13cqw,13cqh,3rem)] font-semibold leading-none text-foreground/80 tabular"
          >
            {first.score}
          </p>
        </div>

        {/* The ground stays put through the fade: it is the field's floor. */}
        <div
          className="absolute inset-x-0 bottom-0 overflow-hidden border-t-2 border-border bg-surface-2"
          style={{ height: down(UPDRAFT_HEIGHT - UPDRAFT_GROUND) }}
        >
          <div
            ref={ground}
            className="absolute inset-y-0 left-0"
            style={{
              width: `calc(100% + ${across(GROUND_STRIPE)})`,
              transform: groundTransform(first),
              backgroundImage: `repeating-linear-gradient(90deg, color-mix(in oklab, var(--foreground) 7%, transparent) 0 ${STRIPE_SHARE / 2}%, transparent ${STRIPE_SHARE / 2}% ${STRIPE_SHARE}%)`,
            }}
          />
        </div>

        <div
          ref={glider}
          className="absolute top-0 will-change-transform"
          style={{
            left: across(UPDRAFT_GLIDER_X - UPDRAFT_GLIDER_RADIUS),
            width: across(DIAMETER),
            aspectRatio: "1",
            transform: gliderTransform(first),
          }}
        >
          <div
            ref={body}
            className="relative size-full rounded-full bg-primary shadow-md ring-2 ring-background/40"
            style={{ transform: bodyTransform(first) }}
          >
            <span className="absolute top-[22%] right-[14%] size-[30%] rounded-full bg-background">
              <span className="absolute top-[25%] right-[15%] size-1/2 rounded-full bg-foreground" />
            </span>
            <span
              ref={wing}
              className={cn(
                "absolute top-[48%] left-[-8%] h-[30%] w-[55%] rounded-full bg-primary-foreground/25 transition-transform duration-100",
              )}
              style={{ transform: wingTransform(first) }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
