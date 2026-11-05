import { useEffect, useState } from "react";

/**
 * Walks a preview's beats on a loop while it plays and returns the current one.
 * Stopping goes back to the first beat, so a card scrolled back to starts from
 * the top. CSS transitions carry the motion between beats, so this renders a
 * dozen times a loop, not sixty times a second.
 */
export function useBeats(beats: readonly { readonly ms: number }[], playing: boolean): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!playing) return;
    let current = 0;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        current = (current + 1) % beats.length;
        setIndex(current);
        schedule();
      }, beats[current].ms);
    };
    schedule();
    return () => {
      clearTimeout(timer);
      setIndex(0);
    };
  }, [beats, playing]);
  return index;
}

/**
 * Calls `onFrame` with the elapsed milliseconds on every animation frame while
 * playing, and once with `null` on stopping. `onFrame` must be stable: it writes
 * to the DOM directly, so continuous motion never re-renders React.
 */
export function useFrameLoop(playing: boolean, onFrame: (elapsedMs: number | null) => void): void {
  useEffect(() => {
    if (!playing) return;
    let handle = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      start ??= now;
      onFrame(now - start);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(handle);
      onFrame(null);
    };
  }, [playing, onFrame]);
}
