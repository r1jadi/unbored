/**
 * The tapered clock the timed level games share: Decant, Trail (Zip), 8 Puzzle,
 * Sun & Moon (Tango) and Sudoku.
 *
 * A run plays boards against one clock, and every solved board adds time. The
 * first boards add a little more than the game's base bonus and later ones less,
 * so a run opens gently and tightens as it goes: board 1 earns 120% of the
 * bonus, board 2 110%, board 3 100%, then ten points less a board down to half
 * from board 8 on.
 *
 * Whole percentages of whole seconds keep the arithmetic exact, so the verifier
 * (`public.clock_taper_pct` in `supabase/migrations/20261123120000_tapered_clocks.sql`)
 * agrees with this to the millisecond.
 */

/** The share of a game's base bonus that solving board `level` earns, in percent. */
export function clockTaperPercent(level: number): number {
  return Math.max(50, 130 - 10 * level);
}

/** `bonusMs` as solving board `level` earns it. */
export function taperedBonusMs(bonusMs: number, level: number): number {
  return (bonusMs * clockTaperPercent(level)) / 100;
}

/** Time a board adds, as a label: "27.5 s" under a minute, "4:48" from one up. */
export function formatClockGain(ms: number): string {
  if (ms < 60_000) return `${ms / 1000} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
