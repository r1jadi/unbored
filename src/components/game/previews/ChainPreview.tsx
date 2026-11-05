import { chainTempo, createRun, symbolAt, tap, type ChainRun } from "@/lib/games/chain";
import { cn } from "@/lib/utils";

import { FADE_MS, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

export type ChainBeat = Beat & {
  readonly lit: number | null;
  /** Whether the pad lit is a tap rather than part of the sequence being shown. */
  readonly tapping: boolean;
  readonly round: number;
  readonly score: number;
};

export const CHAIN_PREVIEW_SEED = 17;
/** Well into a run, so the beat moves at a pace a preview can show. */
const TEMPO_ROUND = 8;
const TAP_MS = 150;
const TAP_GAP_MS = 60;

function build(): ChainBeat[] {
  let run: ChainRun = createRun(CHAIN_PREVIEW_SEED);
  const beats: ChainBeat[] = [];
  const tempo = chainTempo(TEMPO_ROUND);
  const show = (round: number) => {
    const still = { tapping: false, round, score: run.score };
    beats.push({ ...still, ms: 160, lit: null });
    for (let i = 0; i < round; i += 1) {
      beats.push({ ...still, ms: tempo.litMs, lit: symbolAt(CHAIN_PREVIEW_SEED, i) });
      beats.push({ ...still, ms: tempo.gapMs, lit: null });
    }
  };
  const repeat = (round: number) => {
    for (let i = 0; i < round; i += 1) {
      const pad = symbolAt(CHAIN_PREVIEW_SEED, i);
      run = tap(run, pad);
      beats.push({ ms: TAP_MS, lit: pad, tapping: true, round, score: run.score });
      beats.push({ ms: TAP_GAP_MS, lit: null, tapping: true, round, score: run.score });
    }
  };
  for (let round = 1; round <= 3; round += 1) {
    show(round);
    repeat(round);
  }
  const last = beats[beats.length - 1];
  beats.push({ ...last, ms: 120 });
  beats.push({ ...last, ms: FADE_MS, fading: true });
  return beats;
}

export const CHAIN_PREVIEW_BEATS: readonly ChainBeat[] = build();

const PADS = ["bg-game-1", "bg-game-2", "bg-game-4", "bg-game-5"] as const;

/** Don't Break the Chain: watch the sequence, tap it back, and it grows by one. */
export function ChainPreview({ playing }: { playing: boolean }) {
  const index = useBeats(CHAIN_PREVIEW_BEATS, playing);
  const beat = CHAIN_PREVIEW_BEATS[index];
  return (
    <PreviewStage name="dont-break-the-chain" fading={beat.fading}>
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-[3%]">
        {PADS.map((colour, pad) => (
          <div
            key={pad}
            className={cn(
              "flex items-center justify-center rounded-2xl transition-all duration-100",
              colour,
              beat.lit === pad
                ? cn("opacity-100 brightness-125", beat.tapping ? "scale-95" : "scale-[1.03]")
                : beat.tapping
                  ? "opacity-80"
                  : "opacity-35",
            )}
          >
            <span className="flex size-[min(11cqw,11cqh,2.5rem)] items-center justify-center rounded-full bg-background/70 font-mono text-[min(4cqw,4cqh,0.875rem)] font-semibold text-foreground tabular">
              {pad + 1}
            </span>
          </div>
        ))}
      </div>
    </PreviewStage>
  );
}
