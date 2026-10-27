import { useEffect, useMemo, useState } from "react";

/** How long the board must sit still before a new clash is marked. */
export const CLASH_DELAY_MS = 3000;

/**
 * The clashes worth showing: a clash that goes away stops showing at once, but a
 * new one is only marked once the player has left the board alone for
 * `CLASH_DELAY_MS` — a cell on its way to the right symbol, or a line that is
 * half filled, is not a mistake yet. Display only: the moves are the run.
 */
export function useSettledClashes(clashes: Set<number>): Set<number> {
  const key = [...clashes].sort((a, b) => a - b).join(",");
  const [shown, setShown] = useState("");

  useEffect(() => {
    const current = key ? key.split(",") : [];
    // Resolved clashes clear now; the ones still standing stay marked.
    setShown((previous) =>
      previous
        .split(",")
        .filter((cell) => cell && current.includes(cell))
        .join(","),
    );
    if (!key) return;
    const timer = setTimeout(() => setShown(key), CLASH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key]);

  return useMemo(() => new Set(shown ? shown.split(",").map(Number) : []), [shown]);
}
