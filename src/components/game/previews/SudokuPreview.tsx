import { SUDOKU_BOX, SUDOKU_POINTS_PER_BOARD, SUDOKU_SIDE } from "@/lib/games/sudoku";

import { DigitGridPreview, digitGridBeats } from "./DigitGridPreview";

/** A solved grid of its own, not one of the bank's. */
export const SUDOKU_PREVIEW_SOLVED = (
  "483921657" +
  "967345821" +
  "251876493" +
  "548132976" +
  "729564138" +
  "136798245" +
  "372689514" +
  "814253769" +
  "695417382"
)
  .split("")
  .map(Number);

/** The cells still to fill. */
export const SUDOKU_PREVIEW_OPEN = [40, 22, 58, 4, 76, 36, 44, 30];

export const SUDOKU_PREVIEW_BEATS = digitGridBeats(
  SUDOKU_PREVIEW_SOLVED,
  SUDOKU_PREVIEW_OPEN,
  SUDOKU_POINTS_PER_BOARD,
);

/** Sudoku: the last few digits go in, and the board is done. */
export function SudokuPreview({ playing }: { playing: boolean }) {
  return (
    <DigitGridPreview
      name="sudoku"
      side={SUDOKU_SIDE}
      boxRows={SUDOKU_BOX}
      boxColumns={SUDOKU_BOX}
      open={SUDOKU_PREVIEW_OPEN}
      beats={SUDOKU_PREVIEW_BEATS}
      playing={playing}
    />
  );
}
