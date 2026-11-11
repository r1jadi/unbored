/**
 * The daily puzzle archive: a past day's board of a daily game, as practice.
 *
 * A daily game's board comes from its seed, and its seed is the day (hashed for
 * 7 Second). So a past day can be dealt on the device, exactly as offline practice
 * deals today's: never ranked, never submitted, never saved. Today's board stays
 * the one ranked attempt, and the archive only goes back ARCHIVE_DAYS days.
 *
 * Like a callout (`challenge-run.ts`), the play screen sets the day while it is
 * open, so every runtime's ordinary `startSession` picks it up without knowing.
 */

import { localDayNumber } from "@/lib/games/crossword";

/** How far back the archive goes. */
export const ARCHIVE_DAYS = 30;

/** The daily word games: their seed is the day number itself. */
const DAY_SEEDED = /^(crossword|fjalekryqi|guesswork|gjeje)@/;
const SEVEN_SECOND = /^seven-second@/;
/** As `seven_second_seed` hashes the day on the server. */
const SEVEN_SECOND_HASH = 2_654_435_761n;

let active: number | null = null;
let pendingRelease: ReturnType<typeof setTimeout> | undefined;

/** Set by the play screen while it renders, so it is in place before a runtime starts. */
export function setArchiveDay(day: number | null): void {
  clearTimeout(pendingRelease);
  active = day;
}

/**
 * Lets go when the play screen leaves. A tick later, not now: React can run an
 * effect's cleanup and set it up again straight away, and a run starting in that gap
 * would be today's instead of the past day.
 */
export function releaseArchiveDay(): void {
  clearTimeout(pendingRelease);
  pendingRelease = setTimeout(() => {
    active = null;
  }, 0);
}

export function getArchiveDay(): number | null {
  return active;
}

/** Whether a day can be played from the archive: before today, and not too far back. */
export function isArchiveDay(day: number, today = localDayNumber(Date.now())): boolean {
  return Number.isInteger(day) && day < today && day >= today - ARCHIVE_DAYS;
}

/** The seed a daily game deals for a day, or null for a game that isn't daily. */
export function archiveSeed(rulesVersion: string, day: number): string | null {
  if (DAY_SEEDED.test(rulesVersion)) return String(day);
  if (SEVEN_SECOND.test(rulesVersion)) return (BigInt(day) * SEVEN_SECOND_HASH + 7n).toString();
  return null;
}

/** The past days on offer, newest first. */
export function archiveDays(today = localDayNumber(Date.now())): number[] {
  return Array.from({ length: ARCHIVE_DAYS }, (_, index) => today - 1 - index);
}
