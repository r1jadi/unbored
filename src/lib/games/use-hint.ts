import { useCallback, useEffect, useRef, useState } from "react";

import { HINT_COOLDOWN_MS, HINT_IDLE_MS } from "@/lib/games/hints";

/**
 * When a hint may be asked for, and the one the player last asked for.
 *
 * The Hint button appears once the player has gone `HINT_IDLE_MS` without a
 * right move — `progress` is whatever the game counts as one (a cleared board,
 * a placed Queen, a tile moved) and changes when one is made. Asking shows the
 * hint and starts a `HINT_COOLDOWN_MS` wait before the next one. A right move
 * clears the hint and starts the idle wait again from zero.
 *
 * `compute` is read when the player asks, so a hint always describes the board
 * as it is at that moment. `asked` counts the hints since the last right move,
 * for a game whose hints get more specific (One Move). When `compute` has no
 * hint — every move left would end the run — the button is not offered.
 */
export function useHint<T>({
  progress,
  active,
  compute,
}: {
  progress: string | number;
  active: boolean;
  compute: (asked: number) => T | null;
}) {
  const [offered, setOffered] = useState(false);
  const [hint, setHint] = useState<T | null>(null);
  const [asked, setAsked] = useState(0);
  const [readyAt, setReadyAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef(compute);
  useEffect(() => {
    latest.current = compute;
  });

  // A right move (or a run that stops accepting moves) resets everything.
  useEffect(() => {
    setOffered(false);
    setHint(null);
    setAsked(0);
    setReadyAt(0);
    if (!active) return;
    // No hint to give — e.g. every move left loses — means no button at all.
    const timer = setTimeout(() => setOffered(latest.current(0) !== null), HINT_IDLE_MS);
    return () => clearTimeout(timer);
  }, [progress, active]);

  // The countdown on the button while the next hint is not ready.
  useEffect(() => {
    if (readyAt <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(1000, readyAt - now));
    return () => clearTimeout(timer);
  }, [readyAt, now]);

  const ask = useCallback(() => {
    const at = Date.now();
    if (at < readyAt) return;
    const next = latest.current(asked);
    if (next === null) {
      setOffered(false);
      setHint(null);
      return;
    }
    setHint(next);
    setAsked((n) => n + 1);
    setReadyAt(at + HINT_COOLDOWN_MS);
    setNow(at);
  }, [asked, readyAt]);

  const waitSeconds = readyAt > now ? Math.ceil((readyAt - now) / 1000) : 0;
  return { offered: offered && active, hint: active ? hint : null, ask, waitSeconds };
}
