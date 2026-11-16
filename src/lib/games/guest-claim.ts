/**
 * "Sign up and save this score": keeping a guest's run once they have an account.
 *
 * A guest run is verified and closed with no owner. `POST /sessions/{id}/claim`
 * (`public.claim_guest_run`) adopts it for the signed-in caller and records the
 * score the server already derived — the request carries no number at all.
 *
 * How it flows:
 *
 *   1. A guest finishes a run. `noteGuestRun` keeps its id in memory, so the end
 *      screen can offer to save *this* score.
 *   2. The guest taps the offer. `holdGuestRun` writes that run to local storage —
 *      local, not session, storage, because the sign-up confirmation link opens in
 *      a new tab. Only a run the player asked to keep is written, and it lapses
 *      with the server's claim window.
 *   3. Once there is a finished account, `claimHeldGuestRun` sends the claim and
 *      forgets the run, whatever the answer, unless the answer was "try again".
 *
 * The run id is the proof of the claim, exactly as it is for completing the run,
 * so it is never put in a URL and is gone from the device as soon as it is used.
 */

import { ApiError, apiFetch } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { getQueryClient } from "@/lib/query";
import { safeLocalStorage } from "@/lib/storage";

/** The server's claim window (`public.guest_claim_window()`). */
export const GUEST_CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;

const HELD_KEY = "unbored-held-guest-run";

/** A finished guest run that can still be saved to an account. */
export type GuestRun = {
  sessionId: string;
  gameSlug: string;
  score: number;
  /** When the run finished, in epoch milliseconds. */
  finishedAt: number;
};

/** The answer to a claim, as `POST /sessions/{id}/claim` gives it. */
export type ClaimedRun = {
  sessionId: string;
  gameSlug: string;
  score: number;
  personalBest: number | null;
  rank: number | null;
  duplicate: boolean;
};

export type ClaimOutcome =
  | { kind: "saved"; run: ClaimedRun }
  /** Today's board was already played on this account: the first run counts. */
  | { kind: "already-played"; gameSlug: string }
  /** Too old, already someone else's, or gone: nothing to save. */
  | { kind: "gone"; gameSlug: string }
  /** The API could not answer; the run is kept for the next try. */
  | { kind: "later" };

const UUID = /^[0-9a-f-]{36}$/;

let lastGuestRun: GuestRun | null = null;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** Subscribes to the in-memory guest run. Shaped for `useSyncExternalStore`. */
export function subscribeGuestRun(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Records a guest run that just finished and was verified. */
export function noteGuestRun(run: GuestRun): void {
  if (!UUID.test(run.sessionId)) return;
  lastGuestRun = run;
  changed();
}

/** The guest run that just finished for this game, while it can still be saved. */
export function guestRunFor(gameSlug: string, now = Date.now()): GuestRun | null {
  const run = lastGuestRun;
  if (!run || run.gameSlug !== gameSlug) return null;
  return now - run.finishedAt < GUEST_CLAIM_WINDOW_MS ? run : null;
}

/** Keeps the run on this device until the player has an account to save it to. */
export function holdGuestRun(run: GuestRun): void {
  try {
    safeLocalStorage()?.setItem(HELD_KEY, JSON.stringify(run));
  } catch {
    // Storage full or blocked: the offer still leads to sign-up, it just can't
    // carry this run through it.
  }
}

/** The run waiting to be saved, if there is one and it hasn't lapsed. */
export function heldGuestRun(now = Date.now()): GuestRun | null {
  const storage = safeLocalStorage();
  let raw: string | null = null;
  try {
    raw = storage?.getItem(HELD_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const run = JSON.parse(raw) as Partial<GuestRun>;
    if (
      typeof run.sessionId === "string" &&
      UUID.test(run.sessionId) &&
      typeof run.gameSlug === "string" &&
      typeof run.score === "number" &&
      typeof run.finishedAt === "number" &&
      now - run.finishedAt < GUEST_CLAIM_WINDOW_MS
    ) {
      return run as GuestRun;
    }
  } catch {
    // Not ours, or damaged: dropped below.
  }
  forgetHeldGuestRun();
  return null;
}

export function forgetHeldGuestRun(): void {
  try {
    safeLocalStorage()?.removeItem(HELD_KEY);
  } catch {
    // Nothing to do: the server's window ends the claim either way.
  }
}

let inFlight: Promise<ClaimOutcome | null> | null = null;

/**
 * Saves the held run to the signed-in account. Resolves null when there is
 * nothing to save or no account yet. Safe to call repeatedly: one claim runs at a
 * time, and a repeat of a saved claim is answered as the same claim.
 */
export function claimHeldGuestRun(): Promise<ClaimOutcome | null> {
  if (inFlight) return inFlight;
  const run = heldGuestRun();
  const token = getAccessToken();
  if (!run || !token) return Promise.resolve(null);

  inFlight = apiFetch<ClaimedRun>(`/sessions/${encodeURIComponent(run.sessionId)}/claim`, {
    method: "POST",
    token,
    retryable: true,
  })
    .then((claimed): ClaimOutcome => {
      forgetHeldGuestRun();
      if (lastGuestRun?.sessionId === run.sessionId) {
        lastGuestRun = null;
        changed();
      }
      const client = getQueryClient();
      void client.invalidateQueries({ queryKey: ["leaderboard", claimed.gameSlug] });
      void client.invalidateQueries({ queryKey: ["leaderboard", "all-games"] });
      void client.invalidateQueries({ queryKey: ["my-game-stats", claimed.gameSlug] });
      void client.invalidateQueries({ queryKey: ["my-game-streak", claimed.gameSlug] });
      void client.invalidateQueries({ queryKey: ["my-daily-streak"] });
      return { kind: "saved", run: claimed };
    })
    .catch((error: unknown): ClaimOutcome => {
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        forgetHeldGuestRun();
        const alreadyPlayed = error.details.some((detail) => detail.rule === "already_played");
        return alreadyPlayed
          ? { kind: "already-played", gameSlug: run.gameSlug }
          : { kind: "gone", gameSlug: run.gameSlug };
      }
      // Offline, a cold gateway, a 5xx or a token that needs refreshing: keep it
      // for the next sign-in or reload, until the window closes.
      return { kind: "later" };
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Test seam: forget the in-memory run and any claim in flight. */
export function resetGuestClaimForTests(): void {
  lastGuestRun = null;
  inFlight = null;
  changed();
}
