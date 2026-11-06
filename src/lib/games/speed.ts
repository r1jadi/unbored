/**
 * The speed bonus the untimed puzzle games share: Crowns, Sudoku and Mini Sudoku.
 *
 * These games have no clock to lose to. Instead every board has a par time, and a
 * run that is ahead of the par of its solved boards earns a bonus when it ends: its
 * points again, scaled by how much of the par it had left. At par or slower the
 * bonus is nothing and the board's points still stand, so being slow never costs
 * anything but the bonus; a run can never earn more than double.
 *
 * The time is the server's. `public.complete_*_speed_run` measures it from the
 * session and adds the bonus itself, so the screen's figure is only an estimate, and
 * the number a run ends on is the one the server sends back. Mirrored by
 * `public.speed_bonus` in `supabase/migrations/20261217120000_speed_runs.sql`.
 */
export function speedBonus(baseScore: number, parMs: number, elapsedMs: number): number {
  if (parMs <= 0 || baseScore <= 0) return 0;
  const ahead = Math.min(parMs, Math.max(0, parMs - Math.max(0, elapsedMs)));
  return Math.floor((baseScore * ahead) / parMs);
}
