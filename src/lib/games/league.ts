import type { OverallEntry, OverallStanding } from "@/lib/games/overall-board";

/**
 * The weekly league: you and the people you follow, on the all-games rating for
 * the calendar week (`this-week`, from Monday 00:00 on this device's clock), so it
 * resets at the player's own midnight, as the daily games do. It is the all-games board narrowed down, not a separate
 * scoring, so a league number always matches what the Ranks page shows.
 */
export type LeagueStanding = {
  /** Players in the league with a rating this week, you included. */
  size: number;
  /** Your place in it, 1 at the top. */
  position: number;
  rating: number;
  /** The player just above you and how far ahead they are; null at the top. */
  ahead: { username: string; gap: number } | null;
};

/**
 * Where you stand among the people you follow this week, or null before you have
 * a rating this week. `members` holds your username and everyone you follow.
 * You're counted from `me` even when the board doesn't rank you yet (too few
 * games), so a new player still has a place.
 */
export function leagueStanding(
  entries: readonly OverallEntry[],
  members: ReadonlySet<string>,
  me: OverallStanding | null,
  myUsername: string,
): LeagueStanding | null {
  if (!me || me.games === 0) return null;
  const others = entries.filter((row) => members.has(row.username) && row.username !== myUsername);
  const table = [...others, { username: myUsername, rating: me.rating }].sort(
    // Ties go to the other player: you have to pass someone to be above them.
    (a, b) =>
      b.rating - a.rating || (a.username === myUsername ? 1 : b.username === myUsername ? -1 : 0),
  );
  const index = table.findIndex((row) => row.username === myUsername);
  const above = index > 0 ? table[index - 1] : null;
  return {
    size: table.length,
    position: index + 1,
    rating: me.rating,
    ahead: above ? { username: above.username, gap: above.rating - me.rating } : null,
  };
}

/** Time left until the next local Monday 00:00, when the league resets: "2d 4h" or "3h 20m". */
export function untilReset(now: Date): string {
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + ((8 - now.getDay()) % 7 || 7),
  );
  const minutes = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes % 60}m`;
}
