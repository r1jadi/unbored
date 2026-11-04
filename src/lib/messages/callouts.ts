/**
 * Callouts: a friend, a game, the same board, and a claim to back up. `challenges` in
 * the schema. Everything here is a database function, which works out what this player
 * may see: a sealed score isn't in the answer until it is settled.
 */

import { useCallback, useEffect, useState } from "react";

import { subscribeSignals } from "@/lib/messages/realtime";
import { rpc } from "@/lib/messages/store";
import { t } from "@/lib/settings/language";
import { restGet } from "@/lib/supabase/rest";
import { getAccessToken, getSessionUserId } from "@/lib/auth/session";

export type CalloutFormat = "sealed" | "beat_my_score" | "score_target";
export type CalloutStatus =
  "pending" | "active" | "finished" | "declined" | "cancelled" | "expired";

export type Callout = {
  id: string;
  challengerId: string;
  opponentId: string;
  gameSlug: string;
  gameTitle: string;
  format: CalloutFormat;
  status: CalloutStatus;
  /** A forfeit in the players' own words, like "loser buys coffee". */
  stake: string | null;
  margin: number;
  targetScore: number | null;
  isDouble: boolean;
  rematchOf: string | null;
  respondBy: string | null;
  playBy: string | null;
  finishedAt: string | null;
  winnerId: string | null;
  myScore: number | null;
  theirScore: number | null;
  iStarted: boolean;
  theyFinished: boolean;
  rematchTaken: boolean;
};

export type Rivalry = { myWins: number; theirWins: number; draws: number };

export type CreateOutcome =
  | "created"
  | "invalid"
  | "suspended"
  | "not_friends"
  | "not_allowed"
  | "not_available"
  | "already_open"
  | "rematch_closed"
  | "rate_limited";

type Row = {
  id: string;
  challenger_id: string;
  opponent_id: string;
  game_slug: string;
  game_title: string;
  format: CalloutFormat;
  status: CalloutStatus;
  stake: string | null;
  margin: number;
  target_score: number | null;
  is_double: boolean;
  rematch_of: string | null;
  respond_by: string | null;
  play_by: string | null;
  finished_at: string | null;
  winner_id: string | null;
  my_score: number | null;
  their_score: number | null;
  i_started: boolean;
  they_finished: boolean;
  rematch_taken: boolean;
};

function toCallout(row: Row): Callout {
  return {
    id: row.id,
    challengerId: row.challenger_id,
    opponentId: row.opponent_id,
    gameSlug: row.game_slug,
    gameTitle: row.game_title,
    format: row.format,
    status: row.status,
    stake: row.stake,
    margin: row.margin,
    targetScore: row.target_score,
    isDouble: row.is_double,
    rematchOf: row.rematch_of,
    respondBy: row.respond_by,
    playBy: row.play_by,
    finishedAt: row.finished_at,
    winnerId: row.winner_id,
    myScore: row.my_score,
    theirScore: row.their_score,
    iStarted: row.i_started,
    theyFinished: row.they_finished,
    rematchTaken: row.rematch_taken,
  };
}

export async function createCallout(input: {
  opponentId: string;
  gameSlug: string;
  format: CalloutFormat;
  stake?: string;
  margin?: number;
  target?: number;
  rematchOf?: string;
  double?: boolean;
}): Promise<{ outcome: CreateOutcome; id?: string }> {
  const rows = await rpc<Array<{ outcome: CreateOutcome; challenge_id: string | null }>>(
    "create_challenge",
    {
      p_opponent: input.opponentId,
      p_game_slug: input.gameSlug,
      p_format: input.format,
      p_stake: input.stake?.trim() || null,
      p_rematch_of: input.rematchOf ?? null,
      p_double: input.double ?? false,
      p_margin: input.margin ?? 0,
      p_target: input.target ?? null,
    },
  );
  const row = rows[0];
  return { outcome: row?.outcome ?? "invalid", id: row?.challenge_id ?? undefined };
}

/** What to tell the player when a callout wasn't created. */
export function createRefusal(outcome: CreateOutcome): string {
  switch (outcome) {
    case "not_friends":
      return t("You can only call out friends: people who follow each other.");
    case "not_allowed":
      return t("You can't message this account.");
    case "already_open":
      return t("You two already have a callout going on this game.");
    case "rate_limited":
      return t("That's ten callouts today. Try again tomorrow.");
    case "suspended":
      return t("Your account is suspended, so you can't send messages.");
    case "not_available":
      return t("This game can't be used for a callout.");
    case "rematch_closed":
      return t("This result can't be rematched.");
    default:
      return t("Check your callout and try again.");
  }
}

export function respondToCallout(id: string, accept: boolean): Promise<string> {
  return rpc<string>("respond_to_challenge", { p_challenge: id, p_accept: accept });
}

export function cancelCallout(id: string): Promise<string> {
  return rpc<string>("cancel_challenge", { p_challenge: id });
}

/** A chat's callouts and the scoreline between its two players, kept live. */
export function useCallouts(conversationId: string | null, otherId: string) {
  const [callouts, setCallouts] = useState<Map<string, Callout>>(new Map());
  const [rivalry, setRivalry] = useState<Rivalry | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [rows, record] = await Promise.all([
        conversationId
          ? rpc<Row[]>("conversation_challenges", { p_conversation: conversationId })
          : Promise.resolve([] as Row[]),
        rpc<Array<{ my_wins: number; their_wins: number; draws: number }>>("rivalry_record", {
          p_other: otherId,
        }),
      ]);
      setCallouts(new Map(rows.map((row) => [row.id, toCallout(row)])));
      const first = record[0];
      if (first) {
        setRivalry({ myWins: first.my_wins, theirWins: first.their_wins, draws: first.draws });
      }
    } catch {
      // Whatever is on screen stays. The next signal or tick reads again.
    }
  }, [conversationId, otherId]);

  useEffect(() => {
    void refresh();
    const unsubscribe = subscribeSignals(() => void refresh());
    // Deadlines pass with nothing to signal them.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60_000);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { callouts, rivalry, refresh };
}

export type CalloutBadge = { winnerUsername: string; gameTitle: string; until: string };

/** The line a recent loss puts on a profile, or null. */
export function useCalloutBadge(userId: string | undefined, self?: boolean): CalloutBadge | null {
  const [badge, setBadge] = useState<CalloutBadge | null>(null);
  const id = userId ?? (self ? getSessionUserId() : undefined);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    restGet<Array<{ winner_username: string; game_title: string; until: string }>>(
      "rpc/challenge_badge",
      getAccessToken() ?? undefined,
      { method: "POST", body: JSON.stringify({ p_user: id }) },
    )
      .then((rows) => {
        const row = rows[0];
        if (!cancelled) {
          setBadge(
            row
              ? { winnerUsername: row.winner_username, gameTitle: row.game_title, until: row.until }
              : null,
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id]);

  return badge;
}
