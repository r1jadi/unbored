import { cn } from "@/lib/utils";

import { FADE_MS, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

export const ZIP_PREVIEW_SIZE = 5;

/** One line through every cell, on a board of its own. */
export const ZIP_PREVIEW_PATH = [
  12, 7, 6, 11, 16, 21, 20, 15, 10, 5, 0, 1, 2, 3, 8, 13, 18, 17, 22, 23, 24, 19, 14, 9, 4,
];

/** The numbers the line must pass in order, as positions along it. */
const NUMBERED_STEPS = [0, 6, 11, 15, 19, 24];

export const ZIP_PREVIEW_NUMBERS: readonly number[] = Array.from(
  { length: ZIP_PREVIEW_SIZE * ZIP_PREVIEW_SIZE },
  (_, cell) => NUMBERED_STEPS.indexOf(ZIP_PREVIEW_PATH.indexOf(cell)) + 1,
);

export type ZipBeat = Beat & { readonly reached: number };

const STEP_MS = 125;

function build(): ZipBeat[] {
  const beats: ZipBeat[] = [{ ms: 380, reached: 0 }];
  for (let reached = 1; reached < ZIP_PREVIEW_PATH.length; reached += 1) {
    beats.push({ ms: STEP_MS, reached });
  }
  const last = ZIP_PREVIEW_PATH.length - 1;
  beats.push({ ms: 800, reached: last });
  beats.push({ ms: FADE_MS, reached: last, fading: true });
  return beats;
}

export const ZIP_PREVIEW_BEATS: readonly ZipBeat[] = build();

const CELL_EDGE = "color-mix(in oklch, var(--foreground) 12%, transparent)";
const POINTS = ZIP_PREVIEW_PATH.map(
  (cell) => `${(cell % ZIP_PREVIEW_SIZE) + 0.5},${Math.floor(cell / ZIP_PREVIEW_SIZE) + 0.5}`,
).join(" ");
const SEGMENTS = ZIP_PREVIEW_PATH.length - 1;

/** Zip: one line fills the grid, passing the numbers in order. */
export function ZipPreview({ playing }: { playing: boolean }) {
  const index = useBeats(ZIP_PREVIEW_BEATS, playing);
  const beat = ZIP_PREVIEW_BEATS[index];
  const size = ZIP_PREVIEW_SIZE;
  const visited = new Set(ZIP_PREVIEW_PATH.slice(0, beat.reached + 1));
  return (
    <PreviewStage name="trail" fading={beat.fading}>
      <div
        className="absolute inset-0 grid overflow-hidden rounded-lg border bg-surface"
        style={{
          borderColor: CELL_EDGE,
          gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${size}, minmax(0, 1fr))`,
        }}
      >
        {ZIP_PREVIEW_NUMBERS.map((_, cell) => (
          <div
            key={cell}
            style={{
              borderStyle: "solid",
              borderRightWidth: cell % size < size - 1 ? 1 : 0,
              borderBottomWidth: Math.floor(cell / size) < size - 1 ? 1 : 0,
              borderColor: CELL_EDGE,
            }}
            className={cn(
              "transition-colors duration-100",
              visited.has(cell) ? "bg-primary/20" : "bg-transparent",
            )}
          />
        ))}

        <svg className="absolute inset-0 size-full" viewBox={`0 0 ${size} ${size}`}>
          {/* One line, drawn out along its length, so the head moves smoothly. */}
          <polyline
            points={POINTS}
            pathLength={SEGMENTS}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={0.36}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={SEGMENTS}
            strokeDashoffset={SEGMENTS - beat.reached}
            style={{
              transition: beat.reached === 0 ? "none" : `stroke-dashoffset ${STEP_MS}ms linear`,
              opacity: beat.reached === 0 ? 0 : 1,
            }}
          />
        </svg>

        <div
          className="pointer-events-none absolute inset-0 grid [container-type:inline-size]"
          style={{
            gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${size}, minmax(0, 1fr))`,
          }}
        >
          {ZIP_PREVIEW_NUMBERS.map((number, cell) =>
            number > 0 ? (
              <span
                key={cell}
                className="flex items-center justify-center"
                style={{
                  gridColumn: (cell % size) + 1,
                  gridRow: Math.floor(cell / size) + 1,
                }}
              >
                <span
                  className="flex aspect-square w-[60%] items-center justify-center rounded-full bg-foreground font-semibold leading-none text-background transition-shadow duration-100 tabular"
                  style={{
                    fontSize: `${32 / size}cqw`,
                    boxShadow: visited.has(cell)
                      ? `0 0 0 ${7 / size}cqw var(--primary)`
                      : undefined,
                  }}
                >
                  {number}
                </span>
              </span>
            ) : null,
          )}
        </div>
      </div>
    </PreviewStage>
  );
}
