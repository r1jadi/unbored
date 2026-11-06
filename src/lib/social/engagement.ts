/**
 * Persistent likes, comments and saves backed by Supabase tables through the
 * Data API. RLS is the boundary: inserts and deletes require the row to belong
 * to `auth.uid()`, so the acting user always comes from the verified token and
 * never from a browser-supplied id — the same pattern `follows.ts` uses.
 *
 * What lives where:
 *
 *   - `public.likes` (user_id, target_kind, target_id) — the primary key is the
 *     duplicate guard, so a second like conflicts instead of inserting and
 *     concurrent requests cannot create two rows. Likes are public; states are
 *     per-caller.
 *   - `public.comments` (game_id, author_id, parent_id, body, …) — top-level
 *     comments and one level of replies (RLS requires a reply's parent to be a
 *     visible top-level comment on the same game), 1–2000 characters by CHECK,
 *     on published games only. Authors read their own hidden rows; everyone else
 *     reads visible ones. Authors delete their own; hiding runs through the
 *     moderation service, never through this module.
 *   - `public.saves` (user_id, game_id) — private rows: no anonymous grant, and
 *     every policy is owner-scoped. Only published games can be saved.
 *
 * The catalogue API deliberately omits game uuids, so slugs are resolved to ids
 * through the public games projection first. Every count below is measured —
 * an exact `Content-Range` total or a row list that is counted — never a
 * placeholder.
 */

import { listBlockedIds } from "@/lib/settings/blocked";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import {
  getAccessToken,
  getAuthState,
  subscribe as subscribeToAuth,
  useAuth,
} from "@/lib/auth/session";
import { getQueryClient } from "@/lib/query";
import { localizeGame, type Game } from "@/lib/games/catalog";
import type { ForYouSignals } from "@/lib/games/for-you-personal";
import { fetchProfilesByIds, type PublicProfile } from "@/lib/social/follows";
import { restCount, restGet, restMutate, SupabaseRestError } from "@/lib/supabase/rest";

import { t } from "@/lib/settings/language";
export const MAX_COMMENT_LENGTH = 2000;
const COMMENT_PAGE_SIZE = 100;
const LIST_PAGE_SIZE = 200;

type GameIdRow = { id: string; slug: string };

type LikeRow = { user_id: string; target_kind: "game" | "comment"; target_id: string };

type SaveRow = { user_id: string; game_id: string; created_at: string };

type CommentRow = {
  id: string;
  game_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  updated_at: string | null;
};

type GameRecord = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  instructions: string | null;
  runtime: string | null;
  playable: boolean;
  is_official: boolean;
  cover_path: string | null;
  published_at: string | null;
  updated_at: string;
  categories: { slug: string; name: string } | null;
};

type GameStatRow = { slug: string; plays: number };

export type GameComment = {
  id: string;
  gameId: string;
  authorId: string;
  /** The top-level comment this replies to, or null for a top-level comment. */
  parentId: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  author: PublicProfile | null;
};

function toApiError(error: unknown, area: "like" | "comment" | "save" | "score"): ApiError {
  const nouns = {
    like: t("Couldn't update the like. Try again."),
    comment: t("Couldn't load comments. Try again."),
    save: t("Couldn't update the saved games. Try again."),
    score: t("Couldn't load your scores. Try again."),
  } as const;
  const codes = {
    like: "like_failed",
    comment: "comment_failed",
    save: "save_failed",
    score: "score_failed",
  } as const;
  if (error instanceof ApiError) return error;
  if (error instanceof SupabaseRestError) {
    if (error.status === 401) {
      return new ApiError(t("Sign in to join the conversation."), {
        code: "unauthorized",
        status: 401,
      });
    }
    return new ApiError(nouns[area], { code: codes[area], status: error.status });
  }
  return new ApiError(nouns[area], { code: codes[area] });
}

function requireCaller(): { token: string; userId: string } {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") {
    throw new ApiError(t("Sign in to join the conversation."), {
      code: "unauthorized",
      status: 401,
    });
  }
  return { token, userId: auth.session.userId };
}

/** A PostgREST unique violation: the row already exists, which is a success for
 * an idempotent action rather than a failure. */
function isDuplicate(error: unknown): boolean {
  return error instanceof SupabaseRestError && (error.status === 409 || error.code === "23505");
}

// ── Game id resolution ──────────────────────────────────────────────────────
// The catalogue names games by slug; likes, comments and saves address them by
// uuid. The public games projection resolves one to the other.

/** Resolves one slug to its game id, or null when no published game has it. */
export async function resolveGameId(slug: string): Promise<string | null> {
  const rows = await restGet<GameIdRow[]>(
    `games?slug=eq.${encodeURIComponent(slug)}&select=id,slug&limit=1`,
  );
  return rows[0]?.id ?? null;
}

/** Resolves many slugs in one request. Unknown slugs are absent from the map. */
export async function resolveGameIds(slugs: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(slugs.filter((s) => s !== ""))];
  if (unique.length === 0) return new Map();
  const filter = `slug=in.(${unique.map((s) => encodeURIComponent(s)).join(",")})`;
  const rows = await restGet<GameIdRow[]>(`games?${filter}&select=id,slug&limit=${unique.length}`);
  return new Map(rows.map((row) => [row.slug, row.id]));
}

// ── Likes ───────────────────────────────────────────────────────────────────

/** How many players like one game. Public: no token needed. */
export async function fetchLikeCount(gameId: string): Promise<number> {
  return restCount(
    `likes?target_kind=eq.game&target_id=eq.${encodeURIComponent(gameId)}&select=user_id`,
  );
}

/** Whether the signed-in caller likes one game. Anonymous callers like nothing. */
export async function isLiked(gameId: string): Promise<boolean> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") return false;
  const rows = await restGet<LikeRow[]>(
    `likes?user_id=eq.${auth.session.userId}&target_kind=eq.game&target_id=eq.${encodeURIComponent(gameId)}&select=user_id`,
    token,
  );
  return rows.length > 0;
}

/**
 * Likes a game. A concurrent second like conflicts on the primary key and is
 * reported as already-liked rather than failing: liking is idempotent, so two
 * requests can never create two rows.
 */
export async function likeGame(gameId: string): Promise<void> {
  const { token, userId } = requireCaller();
  try {
    await restMutate("likes", "POST", token, {
      user_id: userId,
      target_kind: "game",
      target_id: gameId,
    });
  } catch (error) {
    if (isDuplicate(error)) return;
    throw toApiError(error, "like");
  }
}

/**
 * Unlikes a game. Deleting a row that is not there still answers success, so
 * unliking is idempotent too.
 */
export async function unlikeGame(gameId: string): Promise<void> {
  const { token, userId } = requireCaller();
  try {
    await restMutate(
      `likes?user_id=eq.${userId}&target_kind=eq.game&target_id=eq.${encodeURIComponent(gameId)}`,
      "DELETE",
      token,
    );
  } catch (error) {
    throw toApiError(error, "like");
  }
}

/** The game ids the signed-in caller likes, newest first. */
export async function listLikedGameIds(limit = LIST_PAGE_SIZE): Promise<string[]> {
  const { token, userId } = requireCaller();
  const rows = await restGet<LikeRow[]>(
    `likes?user_id=eq.${userId}&target_kind=eq.game&select=target_id&order=created_at.desc&limit=${limit}`,
    token,
  ).catch((error: unknown) => {
    throw toApiError(error, "like");
  });
  return rows.map((row) => row.target_id);
}

// ── Saves ───────────────────────────────────────────────────────────────────

/** Whether the signed-in caller saved one game. Anonymous callers save nothing. */
export async function isSaved(gameId: string): Promise<boolean> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") return false;
  const rows = await restGet<SaveRow[]>(
    `saves?user_id=eq.${auth.session.userId}&game_id=eq.${encodeURIComponent(gameId)}&select=user_id`,
    token,
  );
  return rows.length > 0;
}

/**
 * Saves a game. Like liking, this is idempotent: a concurrent second save
 * conflicts on the primary key and is reported as already-saved.
 */
export async function saveGame(gameId: string): Promise<void> {
  const { token, userId } = requireCaller();
  try {
    await restMutate("saves", "POST", token, { user_id: userId, game_id: gameId });
  } catch (error) {
    if (isDuplicate(error)) return;
    throw toApiError(error, "save");
  }
}

/** Removes a save. Removing what is not saved still answers success. */
export async function unsaveGame(gameId: string): Promise<void> {
  const { token, userId } = requireCaller();
  try {
    await restMutate(
      `saves?user_id=eq.${userId}&game_id=eq.${encodeURIComponent(gameId)}`,
      "DELETE",
      token,
    );
  } catch (error) {
    throw toApiError(error, "save");
  }
}

/** The game ids the signed-in caller saved, newest first. */
export async function listSavedGameIds(limit = LIST_PAGE_SIZE): Promise<string[]> {
  const { token, userId } = requireCaller();
  const rows = await restGet<SaveRow[]>(
    `saves?user_id=eq.${userId}&select=game_id&order=created_at.desc&limit=${limit}`,
    token,
  ).catch((error: unknown) => {
    throw toApiError(error, "save");
  });
  return rows.map((row) => row.game_id);
}

// ── Comments ────────────────────────────────────────────────────────────────

function toComment(row: CommentRow, authors: Map<string, PublicProfile>): GameComment {
  return {
    id: row.id,
    gameId: row.game_id,
    authorId: row.author_id,
    parentId: row.parent_id ?? null,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.updated_at,
    author: authors.get(row.author_id) ?? null,
  };
}

/**
 * One page of a game's comments, oldest first, with author profiles attached.
 * Hidden rows are withheld by RLS unless the caller wrote them or moderates —
 * the list is what the caller may see, never a filtered mock of it.
 */
export async function fetchComments(
  gameId: string,
  limit = COMMENT_PAGE_SIZE,
): Promise<GameComment[]> {
  let rows: CommentRow[];
  try {
    rows = await restGet<CommentRow[]>(
      `comments?game_id=eq.${encodeURIComponent(gameId)}&select=id,game_id,author_id,parent_id,body,created_at,updated_at&order=created_at.asc&limit=${limit}`,
    );
  } catch (error) {
    throw toApiError(error, "comment");
  }
  const authors = await fetchProfilesByIds(rows.map((row) => row.author_id)).catch(() => []);
  const byId = new Map(authors.map((profile) => [profile.id, profile]));
  return rows.map((row) => toComment(row, byId));
}

/** How many comments a game shows. Public: no token needed. */
export async function fetchCommentCount(gameId: string): Promise<number> {
  try {
    return await restCount(`comments?game_id=eq.${encodeURIComponent(gameId)}&select=id`);
  } catch (error) {
    throw toApiError(error, "comment");
  }
}

/**
 * Posts a comment as the signed-in caller. The body is validated here — empty
 * and over-long bodies never reach the database — and again by the CHECK
 * constraint, which stays the authority. A `parentId` makes the comment a
 * reply; RLS accepts it only when the parent is a visible top-level comment on
 * the same game, so threads stay one level deep.
 */
export async function postComment(
  gameId: string,
  body: string,
  parentId?: string,
): Promise<GameComment> {
  const { token, userId } = requireCaller();
  const text = body.trim();
  if (text === "") {
    throw new ApiError(t("Write a comment first."), { code: "bad_request", status: 400 });
  }
  if (text.length > MAX_COMMENT_LENGTH) {
    throw new ApiError(
      t("Keep comments to {MAX_COMMENT_LENGTH} characters or fewer.", { MAX_COMMENT_LENGTH }),
      {
        code: "bad_request",
        status: 400,
      },
    );
  }
  let rows: CommentRow[];
  try {
    const response = await restMutate(
      "comments",
      "POST",
      token,
      {
        game_id: gameId,
        author_id: userId,
        body: text,
        ...(parentId ? { parent_id: parentId } : {}),
      },
      "return=representation",
    );
    rows = (await response.json()) as CommentRow[];
  } catch (error) {
    throw toApiError(error, "comment");
  }
  const row = rows[0];
  if (!row) {
    throw new ApiError(t("Couldn't post the comment. Try again."), { code: "comment_failed" });
  }
  const authors = await fetchProfilesByIds([userId]).catch(() => []);
  return toComment(row, new Map(authors.map((profile) => [profile.id, profile])));
}

/**
 * Deletes a comment. Authors remove their own; moderators remove anyone's
 * through the same RLS rule the admin console relies on — anything else is
 * refused by the policy, not by a frontend check.
 */
export async function deleteComment(commentId: string): Promise<void> {
  const { token } = requireCaller();
  try {
    await restMutate(`comments?id=eq.${encodeURIComponent(commentId)}`, "DELETE", token);
  } catch (error) {
    throw toApiError(error, "comment");
  }
}

/** The signed-in caller's recent comments, newest first. */
export async function listMyComments(limit = 20): Promise<GameComment[]> {
  const { token, userId } = requireCaller();
  let rows: CommentRow[];
  try {
    rows = await restGet<CommentRow[]>(
      `comments?author_id=eq.${userId}&select=id,game_id,author_id,parent_id,body,created_at,updated_at&order=created_at.desc&limit=${limit}`,
      token,
    );
  } catch (error) {
    throw toApiError(error, "comment");
  }
  const authors = await fetchProfilesByIds([userId]).catch(() => []);
  const byId = new Map(authors.map((profile) => [profile.id, profile]));
  return rows.map((row) => toComment(row, byId));
}

/** The signed-in caller's recent scores, newest first. */
export async function listMyRecentScores(
  limit = 10,
): Promise<Array<{ gameId: string; score: number; createdAt: string }>> {
  const { token, userId } = requireCaller();
  try {
    return await restGet<Array<{ game_id: string; score: number; created_at: string }>>(
      `scores?user_id=eq.${userId}&select=game_id,score,created_at&order=created_at.desc&limit=${limit}`,
      token,
    ).then((rows) =>
      rows.map((row) => ({ gameId: row.game_id, score: row.score, createdAt: row.created_at })),
    );
  } catch (error) {
    throw toApiError(error, "comment");
  }
}

/**
 * The signed-in caller's best verified score per game, highest first.
 *
 * One row per game, taken from the scores the database retained. A game whose
 * only run was a guest run has no row, because an unranked run is not saved —
 * which is the honest answer, not a zero.
 */
export async function listMyBestScores(
  limit = 200,
): Promise<Array<{ gameId: string; score: number }>> {
  const { token, userId } = requireCaller();
  try {
    const rows = await restGet<Array<{ game_id: string; score: number }>>(
      `scores?user_id=eq.${userId}&select=game_id,score&order=score.desc&limit=${limit}`,
      token,
    );
    const best = new Map<string, number>();
    for (const row of rows) {
      if (!best.has(row.game_id)) best.set(row.game_id, row.score);
    }
    return [...best]
      .map(([gameId, score]) => ({ gameId, score }))
      .sort((a, b) => b.score - a.score);
  } catch (error) {
    throw toApiError(error, "score");
  }
}

/** The signed-in caller's best verified score in one game, or null when they have none. */
export async function getMyBestScoreFor(slug: string): Promise<number | null> {
  const { token, userId } = requireCaller();
  try {
    const gameId = await resolveGameId(slug);
    if (!gameId) return null;
    const rows = await restGet<Array<{ score: number }>>(
      `scores?user_id=eq.${userId}&game_id=eq.${gameId}&select=score&order=score.desc&limit=1`,
      token,
    );
    return rows[0]?.score ?? null;
  } catch (error) {
    throw toApiError(error, "score");
  }
}

/**
 * The caller's best score in a game, loaded once when play starts. Null for a
 * guest, for a first run, or when it can't be loaded: the header just omits it.
 */
export function useMyBestScore(slug: string): number | null {
  const [best, setBest] = useState<number | null>(null);
  useEffect(() => {
    if (getAuthState().status !== "authenticated") return;
    let cancelled = false;
    getMyBestScoreFor(slug)
      .then((score) => {
        if (!cancelled) setBest(score);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [slug]);
  return best;
}

export type ScoreEntry = { game: Game | null; score: number };

type ScoreListState = {
  entries: ScoreEntry[];
  status: "anonymous" | "loading" | "ready" | "error";
  error: string | undefined;
  retry: () => void;
};

/** The caller's personal bests, with their catalogue games resolved. */
export function useBestScores(): ScoreListState {
  const [entries, setEntries] = useState<ScoreEntry[]>([]);
  const [status, setStatus] = useState<ScoreListState["status"]>("loading");
  const [error, setError] = useState<string | undefined>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const auth = getAuthState();
    if (auth.status !== "authenticated") {
      setStatus("anonymous");
      setEntries([]);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError(undefined);
    listMyBestScores()
      .then(async (rows) => {
        const games = new Map(
          (await fetchGameRecords(rows.map((row) => row.gameId))).map((record) => [
            record.id,
            record.game,
          ]),
        );
        if (cancelled) return;
        setEntries(rows.map((row) => ({ game: games.get(row.gameId) ?? null, score: row.score })));
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : t("Couldn't load your scores. Try again."),
        );
        setStatus("error");
      });
    const unsubscribe = subscribeToAuth(() => setTick((n) => n + 1));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [tick]);

  return { entries, status, error, retry: useCallback(() => setTick((n) => n + 1), []) };
}

/**
 * Games the caller played, newest first, derived from saved scores.
 *
 * There is no separate play-history table. A score is written only when a run
 * finished and was verified, so it is the only record of a played game — using
 * it keeps this page consistent with Activity instead of claiming nothing was
 * played after a scored run.
 */
export function useRecentlyPlayed(limit = 20): GameListState {
  const [games, setGames] = useState<Game[]>([]);
  const [status, setStatus] = useState<GameListState["status"]>("loading");
  const [error, setError] = useState<string | undefined>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const auth = getAuthState();
    if (auth.status !== "authenticated") {
      setStatus("anonymous");
      setGames([]);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError(undefined);
    listMyRecentScores(limit)
      .then(async (rows) => {
        // Newest first, one card per game: the score list can name a game more
        // than once and the page is "games you played", not "runs you played".
        const ids = [...new Set(rows.map((row) => row.gameId))];
        const byId = new Map(
          (await fetchGameRecords(ids)).map((record) => [record.id, record.game]),
        );
        if (cancelled) return;
        setGames(ids.map((id) => byId.get(id)).filter((game): game is Game => Boolean(game)));
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : t("Couldn't load recent games. Try again."),
        );
        setStatus("error");
      });
    const unsubscribe = subscribeToAuth(() => setTick((n) => n + 1));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [limit, tick]);

  return { games, status, error, retry: useCallback(() => setTick((n) => n + 1), []) };
}

// ── Games by id (liked / saved / activity lists) ────────────────────────────
// Liked and saved pages list catalogue games, so ids are mapped back onto the
// catalogue shape: the row from the public projection plus the measured play
// count. A game that no longer resolves (unpublished, deleted) is omitted
// rather than listed as a dead row.

/** Maps game ids onto catalogue games, preserving the input order. */
export async function fetchGamesByIds(ids: string[]): Promise<Game[]> {
  return (await fetchGameRecords(ids)).map((record) => record.game);
}

/** Like {@link fetchGamesByIds}, but keeping each row's id for random access. */
export async function fetchGameRecords(ids: string[]): Promise<Array<{ id: string; game: Game }>> {
  const unique = [...new Set(ids.filter((id) => id !== ""))];
  if (unique.length === 0) return [];
  const filter = `id=in.(${unique.map(encodeURIComponent).join(",")})`;
  const [rows, stats] = await Promise.all([
    restGet<GameRecord[]>(
      `games?${filter}&select=id,slug,title,tagline,description,instructions,runtime,playable,is_official,cover_path,published_at,updated_at,categories(slug,name)`,
    ),
    restGet<GameStatRow[]>(`game_stats?select=slug,plays`).catch(() => [] as GameStatRow[]),
  ]);
  const plays = new Map(stats.map((stat) => [stat.slug, stat.plays]));
  const byId = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        game: localizeGame({
          slug: row.slug,
          title: row.title,
          tagline: row.tagline,
          description: row.description,
          instructions: row.instructions,
          category: row.categories,
          runtime: row.runtime,
          playable: row.playable,
          plays: plays.get(row.slug) ?? 0,
          isOfficial: row.is_official,
          coverPath: row.cover_path,
          publishedAt: row.published_at,
          updatedAt: row.updated_at,
        } satisfies Game),
      },
    ]),
  );
  return unique.map((id) => byId.get(id)).filter((record) => record !== undefined);
}

// ── Reactive hooks ──────────────────────────────────────────────────────────

export type EngagementState = {
  gameId: string | null;
  liked: boolean;
  saved: boolean;
  likeCount: number | null;
  commentCount: number | null;
  loading: boolean;
  busy: boolean;
  error: string | undefined;
  toggleLike: () => Promise<void>;
  toggleSave: () => Promise<void>;
  refresh: () => void;
};

// ── Engagement, batched ─────────────────────────────────────────────────────

/** What one game's like/save controls need, for one viewer. */
export type Engagement = {
  gameId: string | null;
  likeCount: number | null;
  commentCount: number | null;
  liked: boolean;
  saved: boolean;
};

type CountsRow = { game_id: string; slug: string; like_count: number; comment_count: number };

/** The cache key for one game's engagement as one viewer sees it. */
export function engagementKey(slug: string, viewer: string | null) {
  return ["engagement", slug, viewer] as const;
}

/**
 * Reads engagement for many games at once: one read of the counts view, plus
 * the viewer's own likes and saves for those games when signed in — three
 * requests for a whole feed instead of four per card.
 */
export async function fetchEngagementBatch(slugs: string[]): Promise<Map<string, Engagement>> {
  const unique = [...new Set(slugs.filter((slug) => slug !== ""))];
  if (unique.length === 0) return new Map();
  const slugFilter = unique.map((slug) => encodeURIComponent(slug)).join(",");
  const counts = await restGet<CountsRow[]>(
    `game_engagement_counts?slug=in.(${slugFilter})&select=game_id,slug,like_count,comment_count`,
  );

  const token = getAccessToken();
  const auth = getAuthState();
  const ids = counts.map((row) => row.game_id);
  let liked = new Set<string>();
  let saved = new Set<string>();
  if (token && auth.status === "authenticated" && ids.length > 0) {
    const idFilter = ids.map((id) => encodeURIComponent(id)).join(",");
    const userId = auth.session.userId;
    const [likeRows, saveRows] = await Promise.all([
      restGet<LikeRow[]>(
        `likes?user_id=eq.${userId}&target_kind=eq.game&target_id=in.(${idFilter})&select=target_id`,
        token,
      ).catch(() => [] as LikeRow[]),
      restGet<SaveRow[]>(
        `saves?user_id=eq.${userId}&game_id=in.(${idFilter})&select=game_id`,
        token,
      ).catch(() => [] as SaveRow[]),
    ]);
    liked = new Set(likeRows.map((row) => row.target_id));
    saved = new Set(saveRows.map((row) => row.game_id));
  }

  const bySlug = new Map(counts.map((row) => [row.slug, row]));
  return new Map(
    unique.map((slug) => {
      const row = bySlug.get(slug);
      return [
        slug,
        row
          ? {
              gameId: row.game_id,
              likeCount: row.like_count,
              commentCount: row.comment_count,
              liked: liked.has(row.game_id),
              saved: saved.has(row.game_id),
            }
          : { gameId: null, likeCount: null, commentCount: null, liked: false, saved: false },
      ];
    }),
  );
}

/** One game's engagement, the per-game way: the fallback when the view is missing. */
async function fetchEngagementOne(slug: string): Promise<Engagement> {
  const gameId = await resolveGameId(slug);
  if (!gameId)
    return { gameId: null, likeCount: null, commentCount: null, liked: false, saved: false };
  const [likeCount, commentCount, liked, saved] = await Promise.all([
    fetchLikeCount(gameId).catch(() => null),
    fetchCommentCount(gameId).catch(() => null),
    isLiked(gameId).catch(() => false),
    isSaved(gameId).catch(() => false),
  ]);
  return { gameId, likeCount, commentCount, liked, saved };
}

// Requests made in the same tick are collected and sent as one batch: a feed
// mounts all its cards at once, and each card asks for its own game.
let queued: Array<{
  slug: string;
  resolve: (e: Engagement) => void;
  reject: (e: unknown) => void;
}> = [];
let flushScheduled = false;
// Set once the batch view has failed, so the rest of the session goes straight
// to the per-game reads instead of failing a batch first every time.
let batchUnavailable = false;

function flushEngagement(): void {
  flushScheduled = false;
  const pending = queued;
  queued = [];
  const perGame = () =>
    pending.forEach(({ slug, resolve, reject }) => fetchEngagementOne(slug).then(resolve, reject));
  if (batchUnavailable) {
    perGame();
    return;
  }
  fetchEngagementBatch(pending.map((item) => item.slug))
    .then((bySlug) => {
      pending.forEach(({ slug, resolve }) =>
        resolve(
          bySlug.get(slug) ?? {
            gameId: null,
            likeCount: null,
            commentCount: null,
            liked: false,
            saved: false,
          },
        ),
      );
    })
    .catch(() => {
      batchUnavailable = true;
      perGame();
    });
}

/** Forgets batching state between tests, so one test's missing view cannot leak. */
export function resetEngagementBatching(): void {
  queued = [];
  flushScheduled = false;
  batchUnavailable = false;
}

/** One game's engagement, batched with every other request made in the same tick. */
export function loadEngagement(slug: string): Promise<Engagement> {
  return new Promise((resolve, reject) => {
    queued.push({ slug, resolve, reject });
    if (!flushScheduled) {
      flushScheduled = true;
      setTimeout(flushEngagement, 0);
    }
  });
}

/** One game's engagement as a cacheable query, for the hook and for prefetching. */
export function engagementQuery(slug: string, viewer: string | null) {
  return queryOptions({
    queryKey: engagementKey(slug, viewer),
    queryFn: () => loadEngagement(slug),
    // Likes move faster than the catalogue; keep it fresh-ish without refetching
    // on every scroll.
    staleTime: 30_000,
  });
}

/**
 * Like/save state plus measured counts for one game slug. Anonymous visitors
 * get counts and `false` states; toggling as one throws the unauthorized error
 * the screen turns into a sign-in nudge.
 */
export function useGameEngagement(slug: string | undefined): EngagementState {
  const auth = useAuth();
  const viewer = auth.status === "authenticated" ? auth.session.userId : null;
  const client = getQueryClient();
  const query = useQuery(
    { ...engagementQuery(slug ?? "", viewer), enabled: !!slug && auth.status !== "restoring" },
    client,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const data = query.data;
  const key = engagementKey(slug ?? "", viewer);
  const patch = useCallback(
    (change: (current: Engagement) => Engagement) =>
      client.setQueryData<Engagement>(key, (current) => (current ? change(current) : current)),
    // `key` is rebuilt every render; its parts are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, slug, viewer],
  );

  const toggleLike = useCallback(async () => {
    const gameId = data?.gameId;
    if (!gameId || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (data.liked) {
        await unlikeGame(gameId);
        patch((e) => ({
          ...e,
          liked: false,
          likeCount: e.likeCount === null ? null : Math.max(0, e.likeCount - 1),
        }));
      } else {
        await likeGame(gameId);
        patch((e) => ({
          ...e,
          liked: true,
          likeCount: e.likeCount === null ? null : e.likeCount + 1,
        }));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Couldn't update the like. Try again."));
      throw err;
    } finally {
      setBusy(false);
    }
  }, [data, busy, patch]);

  const toggleSave = useCallback(async () => {
    const gameId = data?.gameId;
    if (!gameId || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (data.saved) {
        await unsaveGame(gameId);
        patch((e) => ({ ...e, saved: false }));
      } else {
        await saveGame(gameId);
        patch((e) => ({ ...e, saved: true }));
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t("Couldn't update the saved games. Try again."),
      );
      throw err;
    } finally {
      setBusy(false);
    }
  }, [data, busy, patch]);

  const { refetch } = query;
  const refresh = useCallback(() => void refetch(), [refetch]);

  return {
    gameId: data?.gameId ?? null,
    liked: data?.liked ?? false,
    saved: data?.saved ?? false,
    likeCount: data?.likeCount ?? null,
    commentCount: data?.commentCount ?? null,
    loading: !!slug && data === undefined && !query.isError,
    busy,
    error,
    toggleLike,
    toggleSave,
    refresh,
  };
}

export type CommentsState = {
  items: GameComment[];
  count: number | null;
  loading: boolean;
  posting: boolean;
  error: string | undefined;
  post: (body: string, parentId?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  retry: () => void;
};

/** A game's thread: the visible rows, the measured total, posting and own-delete. */
/**
 * A thread as this viewer should see it: comments by anyone they blocked are left
 * out, along with the replies under them, and the total counts what's left.
 */
async function readThread(gameId: string): Promise<{ rows: GameComment[]; total: number }> {
  const [all, total, blocked] = await Promise.all([
    fetchComments(gameId),
    fetchCommentCount(gameId).catch(() => null),
    listBlockedIds(),
  ]);
  const removed = new Set(all.filter((row) => blocked.has(row.authorId)).map((row) => row.id));
  const rows = all.filter(
    (row) => !removed.has(row.id) && !(row.parentId !== null && removed.has(row.parentId)),
  );
  return { rows, total: (total ?? all.length) - (all.length - rows.length) };
}

export function useComments(gameId: string | undefined): CommentsState {
  const [items, setItems] = useState<GameComment[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!gameId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    readThread(gameId)
      .then(({ rows, total }) => {
        if (cancelled) return;
        setItems(rows);
        setCount(total);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : t("Couldn't load comments. Try again."));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, tick]);

  const post = useCallback(
    async (body: string, parentId?: string) => {
      if (!gameId || posting) return;
      setPosting(true);
      try {
        await postComment(gameId, body, parentId);
        const { rows, total } = await readThread(gameId);
        setItems(rows);
        setCount(total);
      } catch (err) {
        throw err instanceof ApiError
          ? err
          : new ApiError(t("Couldn't post the comment. Try again."));
      } finally {
        setPosting(false);
      }
    },
    [gameId, posting],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteComment(id);
      // Deleting a top-level comment cascades to its replies in the database.
      const removed = 1 + items.filter((row) => row.parentId === id).length;
      setItems((rows) => rows.filter((row) => row.id !== id && row.parentId !== id));
      setCount((total) => (total === null ? null : Math.max(0, total - removed)));
    },
    [items],
  );

  const retry = useCallback(() => setTick((n) => n + 1), []);

  return { items, count, loading, posting, error, post, remove, retry };
}

export type GameListState = {
  games: Game[];
  status: "anonymous" | "loading" | "ready" | "error";
  error: string | undefined;
  retry: () => void;
};

function useOwnGameIds(kind: "likes" | "saves"): GameListState {
  const [games, setGames] = useState<Game[]>([]);
  const [status, setStatus] = useState<GameListState["status"]>("loading");
  const [error, setError] = useState<string | undefined>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const auth = getAuthState();
    if (auth.status !== "authenticated") {
      setStatus("anonymous");
      setGames([]);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError(undefined);
    (kind === "likes" ? listLikedGameIds() : listSavedGameIds())
      .then((ids) => fetchGamesByIds(ids))
      .then((resolved) => {
        if (cancelled) return;
        setGames(resolved);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : t("Couldn't load games. Try again."));
        setStatus("error");
      });
    const unsubscribe = subscribeToAuth(() => setTick((n) => n + 1));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [kind, tick]);

  // A sign-out mid-list must not leave another player's games on screen: the
  // auth subscription above resets through `anonymous`.
  return { games, status, error, retry: useCallback(() => setTick((n) => n + 1), []) };
}

export type ForYouSignalsState = {
  /** `anonymous` and `error` both mean the feed orders as it would for a guest. */
  status: "anonymous" | "loading" | "ready" | "error";
  signals: ForYouSignals | null;
};

/** Three small reads, then one lookup of every id they name. */
async function loadForYouSignals(viewer: string): Promise<ForYouSignals> {
  const [scores, liked, saved] = await Promise.all([
    listMyRecentScores(50),
    listLikedGameIds(),
    listSavedGameIds(),
  ]);
  const records = await fetchGameRecords([...scores.map((row) => row.gameId), ...liked, ...saved]);
  const slugOf = new Map(records.map((record) => [record.id, record.game.slug]));
  const slugs = (ids: string[]) =>
    ids.map((id) => slugOf.get(id)).filter((slug): slug is string => Boolean(slug));
  return {
    viewer,
    played: scores
      .filter((row) => slugOf.has(row.gameId))
      .map((row) => ({ slug: slugOf.get(row.gameId)!, at: row.createdAt })),
    liked: slugs(liked),
    saved: slugs(saved),
  };
}

/** One viewer's For You signals as a cacheable query, kept per viewer. */
export function forYouSignalsQuery(viewer: string) {
  return queryOptions({
    queryKey: ["for-you-signals", viewer] as const,
    queryFn: () => loadForYouSignals(viewer),
    // A return visit orders the feed from the cache at once and refreshes behind
    // it; a minute is short enough that a game just played steps back soon.
    staleTime: 60_000,
  });
}

/**
 * What the personal For You order knows about the signed-in caller: the games
 * they finished lately, with when, and the games they liked and saved, as slugs.
 *
 * Cached per viewer, so only the first feed of a visit waits for it. A guest
 * needs none; a failed read is a guest's feed, never an empty one.
 */
export function useForYouSignals(): ForYouSignalsState {
  const auth = useAuth();
  const viewer = auth.status === "authenticated" ? auth.session.userId : null;
  const query = useQuery(
    { ...forYouSignalsQuery(viewer ?? ""), enabled: viewer !== null },
    getQueryClient(),
  );
  if (auth.status === "restoring") return { status: "loading", signals: null };
  if (viewer === null) return { status: "anonymous", signals: null };
  if (query.data) return { status: "ready", signals: query.data };
  if (query.isError) return { status: "error", signals: null };
  return { status: "loading", signals: null };
}

/** Games the signed-in caller liked, newest first. */
export function useLikedGames(): GameListState {
  return useOwnGameIds("likes");
}

/** Games the signed-in caller saved, newest first. */
export function useSavedGames(): GameListState {
  return useOwnGameIds("saves");
}

export type ActivitySection = {
  likes: Game[];
  saves: Game[];
  comments: Array<GameComment & { gameSlug: string; gameTitle: string }>;
  scores: Array<{ game: Game | null; score: number; createdAt: string }>;
};

/** Recent likes, saves, comments and scores for the activity page. */
export function useActivity(): {
  data: ActivitySection;
  status: "anonymous" | "loading" | "ready" | "error";
  error: string | undefined;
  retry: () => void;
} {
  const [data, setData] = useState<ActivitySection>({
    likes: [],
    saves: [],
    comments: [],
    scores: [],
  });
  const [status, setStatus] = useState<"anonymous" | "loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | undefined>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const auth = getAuthState();
    if (auth.status !== "authenticated") {
      setStatus("anonymous");
      setData({ likes: [], saves: [], comments: [], scores: [] });
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError(undefined);
    Promise.all([
      listLikedGameIds(5).then((ids) => fetchGamesByIds(ids)),
      listSavedGameIds(5).then((ids) => fetchGamesByIds(ids)),
      listMyComments(5),
      listMyRecentScores(5),
    ])
      .then(async ([likes, saves, comments, scores]) => {
        if (cancelled) return;
        const gameIds = [
          ...comments.map((comment) => comment.gameId),
          ...scores.map((entry) => entry.gameId),
        ];
        const gamesById = new Map(
          (await fetchGameRecords(gameIds)).map((record) => [record.id, record.game]),
        );
        if (cancelled) return;
        setData({
          likes,
          saves,
          comments: comments.map((comment) => {
            const game = gamesById.get(comment.gameId);
            return {
              ...comment,
              gameSlug: game?.slug ?? "",
              gameTitle: game?.title ?? t("A game"),
            };
          }),
          scores: scores.map((entry) => ({
            game: gamesById.get(entry.gameId) ?? null,
            score: entry.score,
            createdAt: entry.createdAt,
          })),
        });
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : t("Couldn't load activity. Try again."));
        setStatus("error");
      });
    const unsubscribe = subscribeToAuth(() => setTick((n) => n + 1));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [tick]);

  return { data, status, error, retry: useCallback(() => setTick((n) => n + 1), []) };
}
