/**
 * Offline practice: playing a game when the session API cannot be reached.
 *
 * Every runtime plays entirely in the browser; the server only issues a run's
 * seed and verifies the finished run. Without a connection neither can happen,
 * so instead of a dead "Could not reach the server" screen the run is issued
 * here, from a local seed, and marked `offline`. Three rules keep that honest:
 *
 *   - **An offline run is never a score.** It is not ranked, not submitted and
 *     not saved; its result is the client's own arithmetic and every screen
 *     labels it as practice, never as verified.
 *   - **Only a transport failure falls back.** A refusal from the API (a 4xx, a
 *     rate limit, an unpublished game) is an answer, and is shown as one.
 *   - **Nothing is queued for later.** The server picks a run's seed so a client
 *     cannot choose its own deck; a run played from a local seed could never be
 *     verified, so there is nothing to sync when the connection returns.
 */

import { ApiError } from "@/lib/api/client";
import { t } from "@/lib/settings/language";

import { localDayNumber } from "@/lib/games/crossword";
import type { PlaySession, RunResult, RunSubmission } from "@/lib/games/sessions";

const OFFLINE_PREFIX = "offline-";
const DAY_MS = 24 * 60 * 60 * 1000;
/** The daily crossword, in English or as Fjalekryqi: its seed is the day. */
const DAILY_CROSSWORD = /^(crossword|fjalekryqi)@/;

/** The game each offline run on this page belongs to, for its result. */
const offlineGames = new Map<string, string>();

/** True when the browser reports that it has no network at all. */
export function browserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Whether a failed request means the API could not be reached, rather than a refusal. */
export function isUnreachable(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "network_error" || error.code === "timeout" || browserOffline())
  );
}

export function isOfflineSession(sessionId: string): boolean {
  return sessionId.startsWith(OFFLINE_PREFIX);
}

/**
 * A run issued on this device. The crossword (and Fjalekryqi) is a daily puzzle whose seed is the
 * player's day number, so it gets today's; every other game gets a random seed.
 */
export function offlineSession(gameSlug: string, rulesVersion: string): PlaySession {
  const now = Date.now();
  const id = `${OFFLINE_PREFIX}${crypto.randomUUID()}`;
  offlineGames.set(id, gameSlug);
  return {
    id,
    gameSlug,
    rulesVersion,
    seed: DAILY_CROSSWORD.test(rulesVersion) ? String(localDayNumber(now)) : randomSeed(),
    tileCount: 0,
    startedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DAY_MS).toISOString(),
    ranked: false,
    offline: true,
  };
}

/** A non-zero 31-bit seed, as the decimal string the API would send. */
function randomSeed(): string {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return String(value[0]! & 0x7fffffff || 1);
}

/**
 * The result of an offline run, from the run's own summary. The fields the
 * server would derive by replaying it are read from the submission, which every
 * game's `submission()` fills with the same counts its result screen shows.
 */
export function offlineResult(
  sessionId: string,
  body: RunSubmission,
  durationMs: number,
): RunResult {
  const summary = body as RunSubmission & {
    tilesPlaced?: number;
    tapsPlaced?: number;
    clearedColumns?: number;
    roundsCleared?: number;
    levelsCleared?: number;
  };
  return {
    sessionId,
    gameSlug: offlineGames.get(sessionId) ?? "",
    score: body.score,
    clearedColumns: summary.clearedColumns ?? summary.roundsCleared ?? summary.levelsCleared ?? 0,
    tilesPlaced: summary.tilesPlaced ?? summary.tapsPlaced ?? body.actions.length,
    durationMs,
    ranked: false,
    recordedAt: new Date().toISOString(),
    personalBest: null,
    rank: null,
    duplicate: false,
    offline: true,
  };
}

/** The result screens' note for an offline run, in place of "Verified by replaying…". */
export function offlineResultNote(): string {
  return t(
    "You played this offline, so it was a practice run: it was not verified or saved, and it is not on the leaderboard.",
  );
}
