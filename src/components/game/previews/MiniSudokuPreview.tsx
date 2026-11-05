import {
  MINI_SUDOKU_BOX_COLS,
  MINI_SUDOKU_BOX_ROWS,
  MINI_SUDOKU_POINTS_PER_BOARD,
  MINI_SUDOKU_SIDE,
} from "@/lib/games/mini-sudoku";

import { DigitGridPreview, digitGridBeats } from "./DigitGridPreview";

/** A solved grid of its own, not one of the bank's. */
export const MINI_SUDOKU_PREVIEW_SOLVED = (
  "123456" +
  "456123" +
  "214365" +
  "365214" +
  "531642" +
  "642531"
)
  .split("")
  .map(Number);

/** The cells still to fill. */
export const MINI_SUDOKU_PREVIEW_OPEN = [14, 3, 21, 32, 8, 27, 18, 11];

export const MINI_SUDOKU_PREVIEW_BEATS = digitGridBeats(
  MINI_SUDOKU_PREVIEW_SOLVED,
  MINI_SUDOKU_PREVIEW_OPEN,
  MINI_SUDOKU_POINTS_PER_BOARD,
);

/** Mini Sudoku: the same fill on a 6×6 grid. */
export function MiniSudokuPreview({ playing }: { playing: boolean }) {
  return (
    <DigitGridPreview
      name="mini-sudoku"
      side={MINI_SUDOKU_SIDE}
      boxRows={MINI_SUDOKU_BOX_ROWS}
      boxColumns={MINI_SUDOKU_BOX_COLS}
      open={MINI_SUDOKU_PREVIEW_OPEN}
      beats={MINI_SUDOKU_PREVIEW_BEATS}
      playing={playing}
    />
  );
}
