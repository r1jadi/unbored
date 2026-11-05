import { Moon, Sun } from "lucide-react";

import { EMPTY, MOON, SUN, TANGO_SIDE, type TangoSign, type TangoValue } from "@/lib/games/tango";
import { cn } from "@/lib/utils";

import { FADE_MS, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

export type TangoBeat = Beat & { readonly cells: readonly TangoValue[] };

/** A solved grid of its own: 1 is a sun, 2 a moon. */
export const TANGO_PREVIEW_SOLVED: readonly TangoValue[] = (
  "112212" +
  "221121" +
  "121212" +
  "212121" +
  "112122" +
  "221211"
)
  .split("")
  .map((value) => Number(value) as TangoValue);

/** The cells still to fill, in the order they are tapped. */
export const TANGO_PREVIEW_OPEN = [14, 15, 20, 8, 9, 27, 26, 33, 3];

/** Signs on a few edges: `=` the two match, `×` they differ. */
export const TANGO_PREVIEW_SIGNS: readonly TangoSign[] = [
  { a: 14, b: 15, same: false },
  { a: 8, b: 14, same: true },
  { a: 26, b: 27, same: false },
  { a: 3, b: 9, same: false },
];

export const TANGO_PREVIEW_START: readonly TangoValue[] = TANGO_PREVIEW_SOLVED.map((value, cell) =>
  TANGO_PREVIEW_OPEN.includes(cell) ? EMPTY : value,
);

function build(): TangoBeat[] {
  const cells = [...TANGO_PREVIEW_START];
  const beats: TangoBeat[] = [{ ms: 380, cells: [...cells] }];
  TANGO_PREVIEW_OPEN.forEach((cell) => {
    // A tap makes a sun; a moon takes a second tap, as it does in play.
    cells[cell] = SUN;
    beats.push({ ms: TANGO_PREVIEW_SOLVED[cell] === MOON ? 140 : 300, cells: [...cells] });
    if (TANGO_PREVIEW_SOLVED[cell] === MOON) {
      cells[cell] = MOON;
      beats.push({ ms: 240, cells: [...cells] });
    }
  });
  beats.push({ ms: 520, cells: [...cells] });
  beats.push({ ms: FADE_MS, cells: [...cells], fading: true });
  return beats;
}

export const TANGO_PREVIEW_BEATS: readonly TangoBeat[] = build();

const CELL_EDGE = "color-mix(in oklch, var(--foreground) 12%, transparent)";

function Symbol({ value, given }: { value: TangoValue; given: boolean }) {
  if (value === SUN) {
    return (
      <Sun
        className={cn("size-[62%] fill-current text-game-4", given ? "opacity-80" : "cascade-made")}
        strokeWidth={2}
      />
    );
  }
  if (value === MOON) {
    return (
      <Moon
        className={cn("size-[56%] fill-current text-game-1", given ? "opacity-80" : "cascade-made")}
        strokeWidth={2}
      />
    );
  }
  return null;
}

/** Sun and Moon: tap through the symbols until every line balances. */
export function TangoPreview({ playing }: { playing: boolean }) {
  const index = useBeats(TANGO_PREVIEW_BEATS, playing);
  const beat = TANGO_PREVIEW_BEATS[index];
  const side = TANGO_SIDE;
  return (
    <PreviewStage name="sun-and-moon" fading={beat.fading}>
      <div
        className="absolute inset-0 grid overflow-hidden rounded-lg border bg-surface"
        style={{
          borderColor: CELL_EDGE,
          gridTemplateColumns: `repeat(${side}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${side}, minmax(0, 1fr))`,
        }}
      >
        {beat.cells.map((value, cell) => {
          const given = TANGO_PREVIEW_START[cell] !== EMPTY;
          return (
            <div
              key={cell}
              style={{
                borderStyle: "solid",
                borderRightWidth: cell % side < side - 1 ? 1 : 0,
                borderBottomWidth: Math.floor(cell / side) < side - 1 ? 1 : 0,
                borderColor: CELL_EDGE,
              }}
              className={cn(
                "flex items-center justify-center p-[8%]",
                given ? "bg-surface-2" : "bg-surface",
              )}
            >
              <Symbol key={value} value={value} given={given} />
            </div>
          );
        })}
        {TANGO_PREVIEW_SIGNS.map((sign) => {
          const across = sign.b === sign.a + 1;
          const row = Math.floor(sign.a / side);
          const column = sign.a % side;
          return (
            <span
              key={`${sign.a}-${sign.b}`}
              className="absolute z-10 flex size-[7%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-background text-[min(3.2cqw,3.2cqh,0.8rem)] font-semibold leading-none text-muted-foreground"
              style={{
                left: `${((across ? column + 1 : column + 0.5) / side) * 100}%`,
                top: `${((across ? row + 0.5 : row + 1) / side) * 100}%`,
                borderColor: CELL_EDGE,
              }}
            >
              {sign.same ? "=" : "×"}
            </span>
          );
        })}
      </div>
    </PreviewStage>
  );
}
