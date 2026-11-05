import {
  boardCells,
  boardSide,
  createRun,
  patternAt,
  showMs,
  tap,
  type MemoryFlashRun,
} from "@/lib/games/memory-flash";
import { cn } from "@/lib/utils";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

export type MemoryFlashBeat = Beat & {
  readonly round: number;
  readonly lit: readonly number[];
  readonly entered: readonly number[];
  readonly gain: number | null;
};

export const MEMORY_FLASH_PREVIEW_SEED = 31;
const ROUNDS = [3, 4];
const TAP_MS = 190;

function build(): MemoryFlashBeat[] {
  const beats: MemoryFlashBeat[] = [];
  let run: MemoryFlashRun = createRun(MEMORY_FLASH_PREVIEW_SEED);
  ROUNDS.forEach((round) => {
    run = { ...run, round, entered: [] };
    const pattern = patternAt(MEMORY_FLASH_PREVIEW_SEED, round);
    const still = { round, gain: null };
    beats.push({ ...still, ms: 240, lit: [], entered: [] });
    beats.push({ ...still, ms: showMs(round), lit: pattern, entered: [] });
    beats.push({ ...still, ms: 260, lit: [], entered: [] });
    // Rebuilt in another order: the round is a set, and the rules say so.
    const order = [...pattern].reverse();
    order.forEach((cell, step) => {
      const before = run.score;
      run = tap(run, cell);
      const entered = order.slice(0, step + 1);
      beats.push({
        ...still,
        ms: step === order.length - 1 ? 420 : TAP_MS,
        lit: [],
        entered,
        gain: run.score > before ? run.score - before : null,
      });
    });
  });
  const last = beats[beats.length - 1];
  beats.push({ ...last, ms: FADE_MS, gain: null, fading: true });
  return beats;
}

export const MEMORY_FLASH_PREVIEW_BEATS: readonly MemoryFlashBeat[] = build();

/** Memory Flash: a pattern lights for a moment, then has to be rebuilt from memory. */
export function MemoryFlashPreview({ playing }: { playing: boolean }) {
  const index = useBeats(MEMORY_FLASH_PREVIEW_BEATS, playing);
  const beat = MEMORY_FLASH_PREVIEW_BEATS[index];
  const side = boardSide(beat.round);
  return (
    <PreviewStage name="memory-flash" fading={beat.fading}>
      <div
        className="absolute inset-0 grid gap-[2%]"
        style={{
          gridTemplateColumns: `repeat(${side}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${side}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: boardCells(beat.round) }, (_, cell) => (
          <div
            key={cell}
            className={cn(
              "rounded-xl border transition-colors duration-100",
              beat.entered.includes(cell)
                ? "border-primary/60 bg-primary/70"
                : beat.lit.includes(cell)
                  ? "border-transparent bg-foreground"
                  : "border-border bg-surface",
            )}
          />
        ))}
      </div>
      {beat.gain !== null && <FloatingPoints key={index}>+{beat.gain}</FloatingPoints>}
    </PreviewStage>
  );
}
