import {
  SUMDOKU_BOX_COLS,
  SUMDOKU_BOX_ROWS,
  SUMDOKU_POINTS_PER_BOARD,
  SUMDOKU_SIDE,
  type SumdokuBoard,
  type SumdokuDigit,
} from "@/lib/games/sumdoku";

import { DigitGridPreview, digitGridBeats } from "./DigitGridPreview";

/** A solved grid of its own, not one of the bank's. */
const SOLVED = ("123456" + "456123" + "214365" + "365214" + "531642" + "642531")
  .split("")
  .map(Number) as SumdokuDigit[];

/** Each cell's cage, by letter: dominoes, each adding to the total in its corner. */
const CAGES = ["aabccd", "efbghd", "efighj", "klimnj", "klomnp", "qqorrp"].join("");

/** The cells still to fill. */
export const SUMDOKU_PREVIEW_OPEN = [8, 1, 20, 33, 13, 27, 22, 4];

function build(): SumdokuBoard {
  const ids = new Map<string, number>();
  const cageOf = [...CAGES].map((letter) => {
    if (!ids.has(letter)) ids.set(letter, ids.size);
    return ids.get(letter)!;
  });
  const cages: { cells: number[]; total: number }[] = [];
  cageOf.forEach((id, cell) => {
    cages[id] ??= { cells: [], total: 0 };
    cages[id].cells.push(cell);
    cages[id].total += SOLVED[cell];
  });
  const start = SOLVED.map((digit, cell) =>
    SUMDOKU_PREVIEW_OPEN.includes(cell) ? 0 : digit,
  ) as SumdokuDigit[];
  return { solution: SOLVED, start, cageOf, cages, tier: "gentle" };
}

/** The preview's board, cages and all, as the rules see one. */
export const SUMDOKU_PREVIEW_BOARD = build();

export const SUMDOKU_PREVIEW_BEATS = digitGridBeats(
  SOLVED,
  SUMDOKU_PREVIEW_OPEN,
  SUMDOKU_POINTS_PER_BOARD,
);

const CAGE_EDGE = "color-mix(in oklch, var(--foreground) 55%, transparent)";
const CAGE_EDGE_ACTIVE = "var(--primary)";

/** A cell's share of its cage: dashed sides where it meets another, the total in the first. */
function CageMarks({ cell, selected }: { cell: number; selected: number | null }) {
  const { cageOf, cages } = SUMDOKU_PREVIEW_BOARD;
  const side = SUMDOKU_SIDE;
  const row = Math.floor(cell / side);
  const column = cell % side;
  const cage = cageOf[cell];
  const same = (r: number, c: number) =>
    r >= 0 && r < side && c >= 0 && c < side && cageOf[r * side + c] === cage;
  const top = !same(row - 1, column);
  const bottom = !same(row + 1, column);
  const left = !same(row, column - 1);
  const right = !same(row, column + 1);
  const active = selected !== null && cageOf[selected] === cage;
  const line = `min(0.45cqw,0.45cqh,1.5px) dashed ${active ? CAGE_EDGE_ACTIVE : CAGE_EDGE}`;
  const inset = "9%";
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          top: top ? inset : "-1px",
          bottom: bottom ? inset : "-1px",
          left: left ? inset : "-1px",
          right: right ? inset : "-1px",
          borderTop: top ? line : undefined,
          borderBottom: bottom ? line : undefined,
          borderLeft: left ? line : undefined,
          borderRight: right ? line : undefined,
        }}
      />
      {cages[cage].cells[0] === cell && (
        <span
          aria-hidden
          className={
            "pointer-events-none absolute left-[13%] top-[12%] z-[1] text-[min(3.2cqw,3.2cqh,0.75rem)] font-semibold leading-none tabular " +
            (active ? "text-primary" : "text-foreground/80")
          }
        >
          {cages[cage].total}
        </span>
      )}
    </>
  );
}

/** Sumdoku: Mini Sudoku's fill, with every pair of cells adding to its cage's total. */
export function SumdokuPreview({ playing }: { playing: boolean }) {
  return (
    <DigitGridPreview
      name="sumdoku"
      side={SUMDOKU_SIDE}
      boxRows={SUMDOKU_BOX_ROWS}
      boxColumns={SUMDOKU_BOX_COLS}
      open={SUMDOKU_PREVIEW_OPEN}
      beats={SUMDOKU_PREVIEW_BEATS}
      playing={playing}
      decorate={(cell, selected) => <CageMarks cell={cell} selected={selected} />}
    />
  );
}
