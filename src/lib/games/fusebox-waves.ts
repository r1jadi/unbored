import { useCallback, useEffect, useRef, useState } from "react";

import type { FuseWave, FuseboxRun } from "@/lib/games/fusebox";
import { playChainNote } from "@/lib/sound";

/**
 * How long each wave of a chain shows. The rules settle a tap at once; this only
 * paces what the screen draws. Zero turns the playback off, which is what the play
 * tests use so they can play through a run without waiting on a clock.
 */
export const fuseboxTiming = { waveMs: 170 };

function motionReduced(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("a11y-reduce-motion")
  );
}

export type ChainPlayback = {
  /** The wave on screen, or null when the board is at rest. */
  readonly wave: FuseWave | null;
  /** Its number in the chain, from 1. */
  readonly number: number;
  /** The points of the waves still to come, so the score can climb with the chain. */
  readonly pending: number;
  /** Jumps to the end of the chain. */
  readonly skip: () => void;
};

const AT_REST = Number.POSITIVE_INFINITY;

/**
 * Plays the last tap's chain, wave by wave, with a note that rises with each.
 *
 * A board that mounts on a run already under way (a continued run, a retried
 * submission) has set off nothing in front of the player, so it plays nothing. The
 * first frame of a new chain is worked out during render, not in the effect, so
 * the settled board never flashes before the chain that made it.
 */
export function useChainPlayback(run: FuseboxRun): ChainPlayback {
  const taps = run.actions.length;
  const waves = run.last?.waves ?? [];
  const [shown, setShown] = useState({ taps, index: AT_REST });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (shown.taps === taps || waves.length === 0) return;
    const waveMs = fuseboxTiming.waveMs;
    if (waveMs <= 0 || motionReduced()) {
      setShown({ taps, index: AT_REST });
      return;
    }
    navigator.vibrate?.(Math.min(60, 8 + (run.last?.pops ?? 0) * 3));
    let index = 0;
    setShown({ taps, index });
    playChainNote(1);
    const timer = setInterval(() => {
      index += 1;
      if (index >= waves.length) {
        clearInterval(timer);
        setShown({ taps, index: AT_REST });
        return;
      }
      playChainNote(index + 1);
      setShown({ taps, index });
    }, waveMs);
    timerRef.current = timer;
    return () => clearInterval(timer);
    // A chain starts with a tap, and only then. `waves` and `shown` follow from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taps]);

  const skip = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setShown((now) => ({ taps: now.taps, index: AT_REST }));
  }, []);

  const playable = fuseboxTiming.waveMs > 0 && !motionReduced();
  const index = shown.taps === taps ? shown.index : playable ? 0 : AT_REST;
  const wave = index < waves.length ? waves[index]! : null;
  return {
    wave,
    number: wave ? index + 1 : 0,
    pending: wave ? waves.slice(index + 1).reduce((sum, later) => sum + later.gain, 0) : 0,
    skip,
  };
}
