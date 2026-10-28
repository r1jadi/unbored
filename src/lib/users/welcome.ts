import { safeLocalStorage } from "@/lib/storage";
import type { Profile } from "@/lib/users/profile";

/** How long after the account was created its first visit still counts as a first visit. */
const FRESH_FOR_MS = 3 * 24 * 60 * 60 * 1000;

export function welcomeKey(userId: string): string {
  return `unbored-welcomed:${userId}`;
}

/**
 * Whether this account gets the welcome. It is for accounts that have just
 * finished registering — opened the confirmation link, or completed sign-up —
 * and it plays once: the seen marker is per account, so a second account on
 * the same browser is still welcomed.
 */
export function shouldWelcome(
  profile: Profile,
  storage: Storage | undefined,
  now: number = Date.now(),
): boolean {
  const created = Date.parse(profile.createdAt);
  if (Number.isNaN(created) || now - created > FRESH_FOR_MS) return false;
  // Without storage the marker cannot be kept, and a welcome that replays on
  // every visit is worse than none.
  if (!storage) return false;
  try {
    return storage.getItem(welcomeKey(profile.id)) === null;
  } catch {
    return false;
  }
}

export function markWelcomed(userId: string): void {
  try {
    safeLocalStorage()?.setItem(welcomeKey(userId), new Date().toISOString());
  } catch {
    // Best effort: at worst the welcome plays once more.
  }
}
