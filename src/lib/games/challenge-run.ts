/**
 * Playing a callout through the ordinary game runtimes.
 *
 * Every runtime starts through `startSession`, submits through `completeRun` and checks
 * `fetchSavedRun` first, so those three look here instead of each runtime learning about
 * callouts. While the play screen has a callout active, a run comes from
 * `start_challenge_run`: the shared board, one attempt, no saved progress. Submitting it
 * is the same verified submission as any other run, and the database records the score
 * on the callout. See `supabase/migrations/20261215120200_challenges.sql`.
 */

import { ApiError } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { t } from "@/lib/settings/language";
import { restGet } from "@/lib/supabase/rest";

import type { PlaySession } from "@/lib/games/sessions";

let active: string | null = null;
const finishListeners = new Set<(score: number) => void>();

let pendingRelease: ReturnType<typeof setTimeout> | undefined;

/** Set by the play screen while it renders, so it is in place before a runtime starts. */
export function setActiveChallenge(id: string | null): void {
  clearTimeout(pendingRelease);
  active = id;
}

/**
 * Lets go when the play screen leaves. A tick later, not now: React can run an effect's
 * cleanup and set it up again straight away, and a run starting in that gap would be an
 * ordinary run instead of the callout.
 */
export function releaseActiveChallenge(): void {
  clearTimeout(pendingRelease);
  pendingRelease = setTimeout(() => {
    active = null;
  }, 0);
}

export function getActiveChallenge(): string | null {
  return active;
}

/** Tells the play screen a callout run has its verified score. */
export function announceChallengeRunDone(score: number): void {
  finishListeners.forEach((listener) => listener(score));
}

export function subscribeChallengeRunDone(listener: (score: number) => void): () => void {
  finishListeners.add(listener);
  return () => finishListeners.delete(listener);
}

type StartRow = {
  outcome: string;
  session_id: string | null;
  game_slug: string | null;
  rules_version: string | null;
  seed: string | null;
  tile_count: number | null;
  started_at: string | null;
  expires_at: string | null;
};

function refusal(outcome: string): string {
  switch (outcome) {
    case "already_played":
      return t("You've already used your attempt on this callout.");
    case "update_required":
      return t("Refresh the app to play this callout: the game has been updated.");
    case "not_playable":
      return t("This game can't be played right now.");
    default:
      return t("This callout isn't open for you to play right now.");
  }
}

export async function startChallengeRun(
  challengeId: string,
  rulesVersion: string,
  client: string,
  signal?: AbortSignal,
): Promise<PlaySession> {
  const token = getAccessToken();
  if (!token) {
    throw new ApiError(t("Sign in to use messages."), { code: "unauthorized", status: 401 });
  }
  const rows = await restGet<StartRow[]>("rpc/start_challenge_run", token, {
    method: "POST",
    signal,
    body: JSON.stringify({
      p_challenge: challengeId,
      p_rules_version: rulesVersion,
      p_client: client,
    }),
  });
  const row = rows[0];
  if (
    !row ||
    row.outcome !== "started" ||
    !row.session_id ||
    !row.game_slug ||
    !row.rules_version ||
    !row.seed ||
    row.tile_count === null ||
    !row.started_at ||
    !row.expires_at
  ) {
    throw new ApiError(refusal(row?.outcome ?? ""), { code: row?.outcome ?? "callout_failed" });
  }
  return {
    id: row.session_id,
    gameSlug: row.game_slug,
    rulesVersion: row.rules_version,
    seed: row.seed,
    tileCount: row.tile_count,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    ranked: true,
  };
}
