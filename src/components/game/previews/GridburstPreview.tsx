import {
  createRun as createGridburstRun,
  dropped,
  fullLines,
  GRIDBURST_CELLS,
  GRIDBURST_SIZE,
  place,
  shapeCells,
  type GridburstRun,
} from "@/lib/games/gridburst";
import { t } from "@/lib/settings/language";
import { cn } from "@/lib/utils";

import { FADE_MS } from "./shared";
import { useBeats } from "./use-preview";

/** One moment of the Gridburst preview. */
export type GridburstBeat = {
  readonly ms: number;
  readonly board: readonly number[];
  readonly tray: readonly (number | null)[];
  /** The tray piece on its way to the board, and the cell its corner will land on. */
  readonly moving: { readonly slot: number; readonly cell: number } | null;
  /** The cells bursting right now. */
  readonly popping: readonly number[];
  /** What this placement scored and the combo it reached, while it bursts. */
  readonly gain: number | null;
  readonly combo: number;
  readonly fading: boolean;
};

/** A digit is the shape that filled the cell, plus one: only its colour matters here. */
const GRIDBURST_BOARD = [
  "........",
  "........",
  "..4.....",
  ".25...3.",
  ".61...75",
  "342...16",
  "513.7..2",
  "267.3..4",
];

/** Three pieces: a bar that bursts a row, a block that sets up, a stick that bursts two. */
const GRIDBURST_TRAY = [3, 7, 2];
const GRIDBURST_PLACEMENTS = [
  { slot: 0, cell: 5 * GRIDBURST_SIZE + 3, burstMs: 800 },
  { slot: 1, cell: 6 * GRIDBURST_SIZE + 5, burstMs: 0 },
  { slot: 2, cell: 6 * GRIDBURST_SIZE + 3, burstMs: 950 },
];

const LANDED_MS = 240;
const MOVING_MS = 480;

/** The script's opening run: the board above, holding the tray above. */
export function gridburstPreviewStart(): GridburstRun {
  return {
    ...createGridburstRun(1),
    board: GRIDBURST_BOARD.join("")
      .split("")
      .map((mark) => (mark === "." ? 0 : Number(mark))),
    tray: GRIDBURST_TRAY,
  };
}

function cellsIn(lines: { rows: number[]; columns: number[] }): number[] {
  const cells: number[] = [];
  for (let cell = 0; cell < GRIDBURST_SIZE * GRIDBURST_SIZE; cell += 1) {
    if (
      lines.rows.includes(Math.floor(cell / GRIDBURST_SIZE)) ||
      lines.columns.includes(cell % GRIDBURST_SIZE)
    ) {
      cells.push(cell);
    }
  }
  return cells;
}

function buildGridburstBeats(): GridburstBeat[] {
  let run = gridburstPreviewStart();
  const still = { moving: null, popping: [], gain: null, combo: 0, fading: false };
  const beats: GridburstBeat[] = [{ ...still, ms: 450, board: run.board, tray: run.tray }];

  GRIDBURST_PLACEMENTS.forEach(({ slot, cell, burstMs }) => {
    const shape = run.tray[slot] as number;
    beats.push({
      ...still,
      ms: MOVING_MS,
      board: run.board,
      tray: run.tray,
      moving: { slot, cell },
    });

    const filled = dropped(run.board, shape, cell);
    const next = place(run, slot, cell);
    const tray = run.tray.map((piece, index) => (index === slot ? null : piece));
    const popping = cellsIn(fullLines(filled));
    beats.push({
      ...still,
      ms: popping.length > 0 ? burstMs : LANDED_MS,
      board: filled,
      tray,
      popping,
      gain: popping.length > 0 ? next.score - run.score : null,
      combo: next.combo,
    });
    run = { ...next, tray };
  });

  beats.push({ ...still, ms: 300, board: run.board, tray: run.tray });
  beats.push({ ...still, ms: FADE_MS, board: run.board, tray: run.tray, fading: true });
  return beats;
}

export const GRIDBURST_PREVIEW_BEATS: readonly GridburstBeat[] = buildGridburstBeats();

/** The same mosaic as the real board: the shape picks the hue. */
const TONES = [
  "var(--game-1)",
  "var(--game-2)",
  "var(--game-4)",
  "var(--game-5)",
  "var(--game-6)",
  "var(--game-7)",
  "var(--info)",
];

// Everything is placed in percentages of the square stage, so a moving piece can
// line up exactly with the cells it lands on, at any size.
const BOARD_LEFT = 12;
const BOARD_WIDTH = 76;
const CELL = BOARD_WIDTH / GRIDBURST_SIZE;
const CELL_GAP = 0.7;
const SLOT_WIDTH = 24;
const SLOT_TOP = 79;
const SLOT_HEIGHT = 21;
const slotLeft = (slot: number) => BOARD_LEFT + slot * (SLOT_WIDTH + 2);
const TRAY_SCALE = 0.5;

function cellBox(row: number, column: number) {
  return {
    left: `${BOARD_LEFT + column * CELL + CELL_GAP / 2}%`,
    top: `${row * CELL + CELL_GAP / 2}%`,
    width: `${CELL - CELL_GAP}%`,
    height: `${CELL - CELL_GAP}%`,
  };
}

/**
 * A tray piece, laid out on the cells it will land on and shrunk back to its
 * slot. Dropping the transform is the whole journey to the board.
 */
function Piece({
  shape,
  slot,
  cell,
  moving,
}: {
  shape: number;
  slot: number;
  cell: number;
  moving: boolean;
}) {
  const cells = shapeCells(shape);
  const row = Math.floor(cell / GRIDBURST_SIZE);
  const column = cell % GRIDBURST_SIZE;
  const rows = Math.max(...cells.map(([r]) => r)) + 1;
  const columns = Math.max(...cells.map(([, c]) => c)) + 1;
  const centreX = BOARD_LEFT + (column + columns / 2) * CELL;
  const centreY = (row + rows / 2) * CELL;
  const toSlotX = slotLeft(slot) + SLOT_WIDTH / 2 - centreX;
  const toSlotY = SLOT_TOP + SLOT_HEIGHT / 2 - centreY;
  return (
    <div
      className={cn(
        "absolute inset-0 transition-transform duration-[440ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
        moving && "z-10",
      )}
      style={{
        transformOrigin: `${centreX}% ${centreY}%`,
        transform: moving ? "none" : `translate(${toSlotX}%, ${toSlotY}%) scale(${TRAY_SCALE})`,
      }}
    >
      {cells.map(([dr, dc]) => (
        <div
          key={`${dr}-${dc}`}
          className="absolute rounded-[min(1cqw,1cqh,0.3rem)] shadow-[inset_0_-3px_0_oklch(0_0_0/0.18)]"
          style={{
            ...cellBox(row + dr, column + dc),
            backgroundColor: TONES[shape % TONES.length],
          }}
        />
      ))}
    </div>
  );
}

/** Gridburst: three pieces leave the tray, a row bursts, then two at once. */
export function GridburstPreview({ playing }: { playing: boolean }) {
  const index = useBeats(GRIDBURST_PREVIEW_BEATS, playing);
  const beat = GRIDBURST_PREVIEW_BEATS[index];
  return (
    <div
      data-testid="gridburst-preview"
      className={cn(
        "relative size-full transition-opacity duration-200",
        beat.fading && "opacity-0",
      )}
    >
      {Array.from({ length: GRIDBURST_CELLS }, (_, cell) => {
        const value = beat.board[cell];
        return (
          <div
            key={cell}
            className={cn(
              "absolute rounded-[min(1cqw,1cqh,0.3rem)]",
              value === 0 ? "bg-surface-2/50" : "shadow-[inset_0_-3px_0_oklch(0_0_0/0.18)]",
              beat.popping.includes(cell) && "gridburst-pop",
            )}
            style={{
              ...cellBox(Math.floor(cell / GRIDBURST_SIZE), cell % GRIDBURST_SIZE),
              backgroundColor: value === 0 ? undefined : TONES[(value - 1) % TONES.length],
            }}
          />
        );
      })}

      {[0, 1, 2].map((slot) => (
        <div
          key={slot}
          className="absolute rounded-xl border border-border bg-surface"
          style={{
            left: `${slotLeft(slot)}%`,
            top: `${SLOT_TOP}%`,
            width: `${SLOT_WIDTH}%`,
            height: `${SLOT_HEIGHT}%`,
          }}
        />
      ))}

      {PIECE_TARGETS.map(({ slot, cell }) => {
        const shape = beat.tray[slot];
        return shape === null || shape === undefined ? null : (
          <Piece
            key={slot}
            shape={shape}
            slot={slot}
            cell={cell}
            moving={beat.moving?.slot === slot}
          />
        );
      })}

      {beat.gain !== null && (
        <div key={index} className="gridburst-float absolute inset-x-0 top-[24%] text-center">
          <p className="text-[min(11cqw,11cqh,2.75rem)] font-bold leading-none text-foreground drop-shadow tabular">
            +{beat.gain}
          </p>
          {beat.combo > 1 && (
            <p className="mt-1 text-[min(4.5cqw,4.5cqh,1.1rem)] font-semibold text-primary">
              {t("Combo ×{combo}", { combo: beat.combo })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Where each slot's piece lands: read from the script, so the two cannot disagree. */
const PIECE_TARGETS = GRIDBURST_PREVIEW_BEATS.flatMap((beat) => (beat.moving ? [beat.moving] : []));
