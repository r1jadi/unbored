/**
 * Deep Cut Party: hot potato, pass-and-play on one device.
 *
 * Two to eight players share a phone. Each round deals one question; whoever
 * holds the phone must name a correct answer nobody has given this round, and
 * a valid answer passes the phone to the next player. A hidden fuse burns the
 * whole time; whoever holds the phone when it goes off loses a life, and the last
 * player with a life left wins. Rarer answers score more, as in the daily game,
 * which settles nothing here but makes a good table of bragging rights.
 *
 * The bank stays on the server (`deep_cut_party_question`, `deep_cut_party_answer`
 * in `supabase/migrations/20270103120300_deep_cut_party.sql`): it deals each
 * round's question and judges each answer, refusing repeats. The players, the
 * fuse, the turns and the lives live here — Party is unranked and records no
 * score. Names never leave the device.
 */

import { apiFetch } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import type { Tier } from "@/lib/games/deep-cut";

export const PARTY_MIN_PLAYERS = 2;
export const PARTY_MAX_PLAYERS = 8;
export const PARTY_MAX_ROUNDS = 60;
/** The fuse burns for a hidden time in this range, fresh each round. */
export const FUSE_MIN_MS = 20_000;
export const FUSE_MAX_MS = 45_000;

// ── The calls ─────────────────────────────────────────────────────────────────

const Routes = {
  parties: "/deep-cut/parties",
  round: (partyId: string, round: number) =>
    `/deep-cut/parties/${encodeURIComponent(partyId)}/rounds/${round}`,
  answers: (partyId: string, round: number) =>
    `/deep-cut/parties/${encodeURIComponent(partyId)}/rounds/${round}/answers`,
};

export type PartyRound = {
  round: number;
  category: string;
  prompt: string;
  /** What has been said this round, in order. */
  used: { player: number; canonical: string; tier: Tier }[];
};

export type PartyVerdict =
  | { result: "valid"; canonical: string; tier: Tier; points: number }
  | { result: "repeat"; canonical: string }
  | {
      result: "invalid" | "ambiguous" | "unknown" | "empty";
      /** Up to two answers the player may have meant, not yet said this round. */
      suggestions?: string[];
    };

export async function startParty(players: number, signal?: AbortSignal): Promise<string> {
  const body = await apiFetch<{ partyId: string }>(Routes.parties, {
    method: "POST",
    body: { players },
    token: getAccessToken(),
    signal,
  });
  return body.partyId;
}

/** Deals round `round` (or returns it again). */
export async function dealRound(
  partyId: string,
  round: number,
  signal?: AbortSignal,
): Promise<PartyRound> {
  const body = await apiFetch<PartyRound>(Routes.round(partyId, round), {
    method: "POST",
    body: {},
    token: getAccessToken(),
    signal,
    retryable: true,
  });
  return { round: body.round, category: body.category, prompt: body.prompt, used: body.used ?? [] };
}

/** Judges one player's answer. Only `valid` is recorded. */
export async function answerRound(
  partyId: string,
  round: number,
  player: number,
  answer: string,
  signal?: AbortSignal,
): Promise<PartyVerdict> {
  return apiFetch<PartyVerdict>(Routes.answers(partyId, round), {
    method: "POST",
    body: { player, answer: answer.slice(0, 60) },
    token: getAccessToken(),
    signal,
    // The judge may be consulted: give it room, but the fuse is burning.
    timeoutMs: 9_000,
  });
}

// ── The table ─────────────────────────────────────────────────────────────────

export type PartyPlayer = {
  name: string;
  lives: number;
  points: number;
  /** Valid answers given, over the whole party. */
  answers: number;
};

export function newPlayers(names: readonly string[], lives: number): PartyPlayer[] {
  return names.map((name) => ({ name, lives, points: 0, answers: 0 }));
}

export function alive(players: readonly PartyPlayer[]): number[] {
  return players.flatMap((player, index) => (player.lives > 0 ? [index] : []));
}

/** The next player still in, after `from`, going round the table. */
export function nextAlive(players: readonly PartyPlayer[], from: number): number {
  for (let step = 1; step <= players.length; step++) {
    const index = (from + step) % players.length;
    if (players[index]!.lives > 0) return index;
  }
  return from;
}

/** `player` scored a valid answer worth `points`. */
export function scored(
  players: readonly PartyPlayer[],
  player: number,
  points: number,
): PartyPlayer[] {
  return players.map((entry, index) =>
    index === player
      ? { ...entry, points: entry.points + points, answers: entry.answers + 1 }
      : entry,
  );
}

/** The fuse went off in `player`'s hands. */
export function boom(players: readonly PartyPlayer[], player: number): PartyPlayer[] {
  return players.map((entry, index) =>
    index === player ? { ...entry, lives: Math.max(0, entry.lives - 1) } : entry,
  );
}

/** The players in finishing order: most lives, then most points. */
export function standings(
  players: readonly PartyPlayer[],
): { index: number; player: PartyPlayer }[] {
  return players
    .map((player, index) => ({ index, player }))
    .sort(
      (a, b) =>
        b.player.lives - a.player.lives || b.player.points - a.player.points || a.index - b.index,
    );
}

/** A fuse length for one round, hidden from the players. */
export function fuseLength(random: () => number = Math.random): number {
  return Math.round(FUSE_MIN_MS + random() * (FUSE_MAX_MS - FUSE_MIN_MS));
}

/** Cleans the names typed at the table: trimmed, defaulted, de-duplicated. */
export function tidyNames(raw: readonly string[], fallback: (n: number) => string): string[] {
  const seen = new Map<string, number>();
  return raw.map((value, index) => {
    const base = value.trim().slice(0, 20) || fallback(index + 1);
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), count);
    return count === 1 ? base : `${base} ${count}`;
  });
}
