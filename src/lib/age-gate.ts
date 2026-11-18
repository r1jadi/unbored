/**
 * The sign-up age screen (COPPA).
 *
 * Unbored is for people 13 and older. Sign-up asks for a date of birth in a
 * neutral way — no hint of the cut-off next to the field, no pre-filled year —
 * and the answer is used once, to decide, and never stored on the server: the
 * server only re-checks the date it is sent and keeps nothing.
 *
 * An answer under 13 is remembered in this browser (local storage and a
 * cookie), so pressing back and picking an older year does not get around it,
 * which is what the FTC expects of an age screen.
 */

import { safeLocalStorage } from "@/lib/storage";

export const MINIMUM_AGE = 13;

const KEY = "unbored:age-blocked";
const COOKIE = "unbored_age_blocked";
/** How long a browser stays blocked after an under-age answer. */
const BLOCK_DAYS = 30;

/**
 * Whole years between `birthDate` (YYYY-MM-DD) and `today`. Undefined when the
 * value is not a real date or lies in the future.
 */
export function ageOn(birthDate: string, today: Date = new Date()): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return undefined;
  }
  const nowYear = today.getFullYear();
  const nowMonth = today.getMonth() + 1;
  const nowDay = today.getDate();
  let age = nowYear - year;
  if (nowMonth < month || (nowMonth === month && nowDay < day)) age -= 1;
  if (age < 0 || age > 130) return undefined;
  return age;
}

export function isOldEnough(birthDate: string, today?: Date): boolean {
  const age = ageOn(birthDate, today);
  return age !== undefined && age >= MINIMUM_AGE;
}

/** Whether this browser answered the age screen with an age under 13 recently. */
export function isAgeBlocked(): boolean {
  try {
    const until = Number(safeLocalStorage()?.getItem(KEY) ?? "");
    if (Number.isFinite(until) && until > Date.now()) return true;
  } catch {
    // Storage blocked: fall through to the cookie.
  }
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((part) => part.trim().startsWith(`${COOKIE}=`));
}

/** Remembers an under-age answer in this browser. */
export function blockAge(): void {
  const until = Date.now() + BLOCK_DAYS * 24 * 60 * 60 * 1000;
  try {
    safeLocalStorage()?.setItem(KEY, String(until));
  } catch {
    // The cookie below still holds it.
  }
  if (typeof document !== "undefined") {
    document.cookie = `${COOKIE}=1; Max-Age=${BLOCK_DAYS * 24 * 60 * 60}; Path=/; SameSite=Lax`;
  }
}
