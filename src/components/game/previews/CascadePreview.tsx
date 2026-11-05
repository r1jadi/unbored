import type { CSSProperties } from "react";

import { CascadeTile } from "@/components/game/CascadeTile";
import {
  CASCADE_CELLS,
  canSwap,
  colourOf,
  columnOf,
  createRun,
  rowOf,
  specialOf,
  swap,
  type CascadeBoard,
  type CascadeRun,
} from "@/lib/games/cascade";
import { cn } from "@/lib/utils";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

export type CascadeBeat = Beat & {
  readonly board: CascadeBoard;
  /** Two tiles picked up, about to swap. */
  readonly picked: readonly number[];
  readonly swapping: readonly [number, number] | null;
  readonly cleared: readonly number[];
  readonly created: readonly (readonly [number, number])[];
  /** How many rows the tile now in each cell fell. */
  readonly fall: readonly number[] | null;
  readonly points: number | null;
  readonly wave: number;
};

/** A deal with chain reactions in reach. */
export const CASCADE_PREVIEW_SEED = 9;
const SWAPS = 2;
/** A chain long enough to fill the loop needs no second swap. */
const ENOUGH_MS = 2600;
/** More waves than this would outlast the loop. */
const MOST_WAVES = 3;

/** The legal swap that sets off the longest cascade, as a player would hope to find. */
function bestSwap(run: CascadeRun): number {
  let best = -1;
  let bestWaves = -1;
  let bestCleared = -1;
  for (let action = 0; action < CASCADE_CELLS * 2; action += 1) {
    if (!canSwap(run, action)) continue;
    const waves = swap(run, action).lastMove?.waves ?? [];
    if (waves.length > MOST_WAVES) continue;
    const cleared = waves.reduce((sum, wave) => sum + wave.cleared.length, 0);
    if (waves.length > bestWaves || (waves.length === bestWaves && cleared > bestCleared)) {
      best = action;
      bestWaves = waves.length;
      bestCleared = cleared;
    }
  }
  return best;
}

function build(): CascadeBeat[] {
  let run = createRun(CASCADE_PREVIEW_SEED);
  const still = {
    picked: [],
    swapping: null,
    cleared: [],
    created: [],
    fall: null,
    points: null,
    wave: 0,
  };
  const beats: CascadeBeat[] = [{ ...still, ms: 400, board: run.board }];
  for (let turn = 0; turn < SWAPS; turn += 1) {
    if (beats.reduce((sum, beat) => sum + beat.ms, 0) > ENOUGH_MS) break;
    const next = swap(run, bestSwap(run));
    const move = next.lastMove;
    if (!move) break;
    beats.push({ ...still, ms: 280, board: run.board, picked: [move.from, move.to] });
    beats.push({ ...still, ms: 170, board: move.swapped, swapping: [move.from, move.to] });
    let shown: CascadeBoard = move.swapped;
    move.waves.forEach((wave, w) => {
      beats.push({
        ...still,
        ms: 300,
        board: shown,
        cleared: wave.cleared,
        created: wave.created,
        points: wave.points,
        wave: w + 1,
      });
      beats.push({ ...still, ms: 280, board: wave.board, fall: wave.fall });
      shown = wave.board;
    });
    run = next;
  }
  beats.push({ ...still, ms: 240, board: run.board });
  beats.push({ ...still, ms: FADE_MS, board: run.board, fading: true });
  return beats;
}

export const CASCADE_PREVIEW_BEATS: readonly CascadeBeat[] = build();

/** Cascade: a swap lines up three, they clear, and what falls can clear again. */
export function CascadePreview({ playing }: { playing: boolean }) {
  const index = useBeats(CASCADE_PREVIEW_BEATS, playing);
  const beat = CASCADE_PREVIEW_BEATS[index];
  return (
    <PreviewStage name="cascade" fading={beat.fading}>
      <div className="absolute inset-0 rounded-2xl bg-surface p-[2%]">
        <div
          className="grid size-full grid-cols-8 grid-rows-8 overflow-hidden rounded-xl"
          style={{ gap: 3, "--cascade-step": "calc(100% + 3px)" } as CSSProperties}
        >
          {beat.board.map((tile, cell) => {
            let shown = tile;
            let motion = "";
            const vars: Record<string, number> = {};
            if (beat.swapping?.includes(cell)) {
              const other = cell === beat.swapping[0] ? beat.swapping[1] : beat.swapping[0];
              motion = "cascade-swap";
              vars["--dx"] = columnOf(other) - columnOf(cell);
              vars["--dy"] = rowOf(other) - rowOf(cell);
            } else if (beat.created.some(([at]) => at === cell)) {
              shown = beat.created.find(([at]) => at === cell)?.[1] ?? tile;
              motion = "cascade-made";
            } else if (beat.cleared.includes(cell)) {
              motion = "cascade-clear";
            } else if (beat.fall && beat.fall[cell] > 0) {
              motion = "cascade-fall";
              vars["--fall"] = beat.fall[cell];
            }
            const picked = beat.picked.includes(cell);
            return (
              <div
                key={cell}
                className={cn(
                  "relative rounded-[0.3rem] bg-surface-2/60",
                  picked && "bg-foreground/15 ring-2 ring-primary ring-inset",
                )}
              >
                <span
                  key={motion ? `${index}-${motion}` : "still"}
                  className={cn("absolute inset-[8%] block", motion)}
                  style={vars as CSSProperties}
                >
                  <CascadeTile colour={colourOf(shown)} special={specialOf(shown)} />
                </span>
              </div>
            );
          })}
        </div>
        {beat.points !== null && (
          <FloatingPoints key={index} note={beat.wave > 1 ? `×${beat.wave}` : undefined}>
            +{beat.points}
          </FloatingPoints>
        )}
      </div>
    </PreviewStage>
  );
}
