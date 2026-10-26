import { queryOptions, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { ApiError, apiFetch } from "@/lib/api/client";
import { getAccessToken, getSessionUserId } from "@/lib/auth/session";
import { getQueryClient } from "@/lib/query";
import { DEFAULT_BOARD_SIZE, type BoardPeriod } from "@/lib/games/sessions";

/**
 * The all-games board: one rating across every published game.
 *
 * Scores are on different scales in different games, so the server turns each
 * player's best score in a game into a percentile — the share of that game's
 * players they matched or beat, 1 to 100 — and the rating is the sum. A player
 * is ranked once they are rated in `minGames` games; below that they still get
 * their rating as `me`, with no rank. All of it comes from
 * `GET /api/v1/games/leaderboard`; nothing is computed here.
 */

export type OverallEntry = {
  rank: number;
  username: string;
  /** The sum of the player's per-game percentiles. */
  rating: number;
  /** How many games the rating covers. */
  games: number;
};

export type OverallStanding = {
  /** Null while the caller is rated in fewer than `minGames` games. */
  rank: number | null;
  rating: number;
  games: number;
};

export type OverallBoard = {
  scope: "global";
  period: BoardPeriod;
  minGames: number;
  entries: OverallEntry[];
  hasMore: boolean;
  /** Null for an anonymous caller, and for one with no scored run in the window. */
  me: OverallStanding | null;
};

export function fetchOverallBoard(
  query: { period?: BoardPeriod; limit?: number; offset?: number } = {},
  options: { signal?: AbortSignal } = {},
): Promise<OverallBoard> {
  return apiFetch<OverallBoard>("/games/leaderboard", {
    query: { period: query.period, limit: query.limit, offset: query.offset },
    token: getAccessToken(),
    signal: options.signal,
  });
}

export function overallBoardQuery(query: { period?: BoardPeriod; limit?: number } = {}) {
  const period = query.period ?? "all";
  const limit = query.limit ?? DEFAULT_BOARD_SIZE;
  return queryOptions({
    // Under "leaderboard", so a verified run (which invalidates its game's board)
    // can refresh this one too; the viewer is in the key because `me` is theirs.
    queryKey: ["leaderboard", "all-games", period, limit, getSessionUserId() ?? null] as const,
    queryFn: ({ signal }) => fetchOverallBoard({ period, limit }, { signal }),
    staleTime: 10_000,
  });
}

export type OverallBoardState =
  | { status: "loading" }
  | { status: "ready"; board: OverallBoard }
  | { status: "error"; error: ApiError };

export function useOverallBoard(
  query: { period?: BoardPeriod; limit?: number; enabled?: boolean } = {},
): OverallBoardState & { retry: () => void } {
  const board = useQuery(
    { ...overallBoardQuery(query), enabled: query.enabled ?? true },
    getQueryClient(),
  );
  const { refetch } = board;
  const retry = useCallback(() => void refetch(), [refetch]);

  if (board.data !== undefined) return { status: "ready", board: board.data, retry };
  if (board.isError) {
    const error =
      board.error instanceof ApiError
        ? board.error
        : new ApiError("Something went wrong. Please try again.");
    return { status: "error", error, retry };
  }
  return { status: "loading", retry };
}
