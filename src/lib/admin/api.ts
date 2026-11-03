/**
 * The admin API, as `services/admin` defines it.
 *
 * Three properties of that API shape everything here, and each one exists to keep
 * the dashboard honest:
 *
 *   - **The server decides who may read what.** Every call carries the caller's
 *     own access token in the `Authorization` header, and the API answers from
 *     the server-side `ADMIN_EMAILS` allowlist matched against the verified
 *     token email. There is no role, user id, email or admin flag in any
 *     request body — this module has nothing to send one with.
 *   - **A value that cannot be measured is `null`.** `avgRunSeconds` is null until
 *     a run has been completed, and a rate the platform does not track is absent
 *     rather than zero. Nothing here substitutes a default for a missing number.
 *   - **A 403 is an answer, not an error to retry.** The API says "moderator or
 *     administrator" when the verified email is not allowlisted, and the screens
 *     report that as a state of its own.
 *
 * Storage rule, the same as the catalogue's: nothing is cached across a session,
 * so removal from the allowlist takes effect on the next read.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiFetch, type ApiRequestOptions } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";

/** Routes implemented by `services/admin`. Kept together so they cannot drift. */
const Routes = {
  session: "/admin/session",
  overview: "/admin/overview",
  analytics: "/admin/analytics",
  games: "/admin/games",
  categories: "/admin/categories",
  reports: "/admin/reports",
  comments: "/admin/comments",
  users: "/admin/users",
  leaderboards: "/admin/leaderboards",
  moderationLog: "/admin/moderation-log",
  feedback: "/admin/feedback",
  systemServices: "/admin/system/services",
  game: (id: string) => `/admin/games/${id}`,
  report: (id: string) => `/admin/reports/${id}`,
  comment: (id: string) => `/admin/comments/${id}`,
  user: (id: string) => `/admin/users/${id}`,
} as const;

export const ADMIN_LIMIT = 50;
export const ADMIN_MAX_LIMIT = 100;

export type AdminRole = "user" | "moderator" | "admin";
export type GameStatus = "draft" | "review" | "published" | "rejected" | "archived";
export type ReportStatus = "open" | "reviewing" | "resolved" | "dismissed";
export type CommentState = "all" | "visible" | "hidden";

/** Who the database says the caller is. */
export type AdminSession = {
  userId: string;
  username: string;
  displayName: string;
  role: AdminRole;
  isStaff: boolean;
  isAdmin: boolean;
  isSuspended: boolean;
};

export type AdminSeriesPoint = {
  day: string;
  runs: number;
  scores: number;
  signups: number;
  players: number;
};

export type AdminActivity = {
  kind: "moderation" | "game" | "score";
  at: string;
  actor: string;
  action: string;
  subjectKind: string;
  subject: string;
  href: string | null;
};

export type AdminTopGame = { slug: string; title: string; runs: number };

export type AdminOverview = {
  totalUsers: number;
  activeUsers: number;
  games: number;
  publishedGames: number;
  playableGames: number;
  gamesPlayed: number;
  runsOpen: number;
  scoresRecorded: number;
  players: number;
  openReports: number;
  pendingReview: number;
  reviewingReports: number;
  comments: number;
  hiddenComments: number;
  newUsersToday: number;
  /** Null until a run has been completed — an unmeasured average is not zero. */
  avgRunSeconds: number | null;
  runsMeasured: number;
  series: AdminSeriesPoint[];
  activity: AdminActivity[];
  topGames: AdminTopGame[];
};

export type AdminAnalyticsGame = {
  slug: string;
  title: string;
  runs: number;
  players: number;
  bestScore: number;
};

export type AdminTopPlayer = {
  username: string;
  bestScore: number;
  scores: number;
  lastScoredAt: string | null;
};

export type AdminAnalytics = {
  days: number;
  totalUsers: number;
  newUsers: number;
  runs: number;
  players: number;
  scores: number;
  comments: number;
  avgRunSeconds: number | null;
  series: AdminSeriesPoint[];
  topGames: AdminAnalyticsGame[];
  topPlayers: AdminTopPlayer[];
};

export type AdminGame = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  status: GameStatus;
  isOfficial: boolean;
  playable: boolean;
  runtime: string | null;
  categorySlug: string | null;
  categoryName: string | null;
  ownerUsername: string | null;
  plays: number;
  players: number;
  bestScore: number | null;
  comments: number;
  createdAt: string;
  publishedAt: string | null;
  updatedAt: string;
};

export type AdminUser = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: AdminRole;
  isSuspended: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  plays: number;
  bestScore: number | null;
  reportsAgainst: number;
};

export type AdminReport = {
  id: string;
  status: ReportStatus;
  targetKind: "game" | "comment" | "profile";
  targetId: string;
  targetLabel: string | null;
  targetDetail: string | null;
  reason: string;
  details: string | null;
  reporterUsername: string;
  resolvedByUsername: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type AdminComment = {
  id: string;
  body: string;
  authorUsername: string;
  gameSlug: string;
  gameTitle: string;
  isHidden: boolean;
  isReply: boolean;
  likes: number;
  reports: number;
  createdAt: string;
};

export type AdminScore = {
  id: string;
  gameSlug: string;
  gameTitle: string;
  username: string;
  score: number;
  sessionStartedAt: string | null;
  createdAt: string;
};

export type AdminCategory = {
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  publishedGames: number;
  totalGames: number;
};

export type AdminModerationEntry = {
  id: string;
  moderatorUsername: string;
  targetKind: "game" | "comment" | "profile";
  targetId: string;
  action: string;
  reason: string | null;
  createdAt: string;
};

export type AdminModerationResult = {
  id: string;
  previousStatus: string | null;
  status: string | null;
  hidden: boolean | null;
  suspended: boolean | null;
  action: string;
};

export type AdminServiceStatus = {
  name: string;
  status: "unmeasured";
  note: string;
};

export type AdminSystemReport = {
  measured: false;
  note: string;
  items: AdminServiceStatus[];
};

type Page<T> = { items: T[]; hasMore: boolean };

/** Every admin read needs the caller's token; without one there is nothing to send. */
function requireToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw new ApiError("Sign in to continue.", { code: "unauthorized", status: 401 });
  }
  return token;
}

// `async` on purpose: without a token the refusal has to arrive as a rejected
// promise. Throwing synchronously would escape the caller's `.catch` — and, in a
// screen, the effect that loads the data — turning "sign in" into a crash.
async function get<T>(
  path: string,
  query?: ApiRequestOptions["query"],
  signal?: AbortSignal,
): Promise<T> {
  return apiFetch<T>(path, { token: requireToken(), query, signal });
}

// ── Reads ───────────────────────────────────────────────────────────────────

export function fetchAdminSession(signal?: AbortSignal): Promise<AdminSession> {
  return get<AdminSession>(Routes.session, undefined, signal);
}

export function fetchAdminOverview(signal?: AbortSignal): Promise<AdminOverview> {
  return get<AdminOverview>(Routes.overview, undefined, signal);
}

export function fetchAdminAnalytics(days: number, signal?: AbortSignal): Promise<AdminAnalytics> {
  return get<AdminAnalytics>(Routes.analytics, { days }, signal);
}

export type GameFilters = { status?: GameStatus; q?: string; limit?: number; offset?: number };

export function fetchAdminGames(
  filters: GameFilters = {},
  signal?: AbortSignal,
): Promise<Page<AdminGame>> {
  return get<Page<AdminGame>>(Routes.games, { ...filters }, signal);
}

export type UserFilters = { role?: AdminRole; q?: string; limit?: number; offset?: number };

export function fetchAdminUsers(
  filters: UserFilters = {},
  signal?: AbortSignal,
): Promise<Page<AdminUser>> {
  return get<Page<AdminUser>>(Routes.users, { ...filters }, signal);
}

export type ReportFilters = { status?: ReportStatus; limit?: number; offset?: number };

export function fetchAdminReports(
  filters: ReportFilters = {},
  signal?: AbortSignal,
): Promise<Page<AdminReport>> {
  return get<Page<AdminReport>>(Routes.reports, { ...filters }, signal);
}

export type CommentFilters = {
  state?: CommentState;
  q?: string;
  limit?: number;
  offset?: number;
};

export function fetchAdminComments(
  filters: CommentFilters = {},
  signal?: AbortSignal,
): Promise<Page<AdminComment>> {
  return get<Page<AdminComment>>(Routes.comments, { ...filters }, signal);
}

export type FeedbackCategory = "idea" | "bug" | "praise" | "other";

/** One piece of player feedback, as `admin_feedback_directory` returns it. */
export type AdminFeedback = {
  id: string;
  /** 1 (rough) to 5 (love it). */
  mood: number;
  category: FeedbackCategory;
  message: string;
  /** The optional device note the sender chose to include. */
  context: string | null;
  senderUsername: string;
  /** When the notifications service mailed it to the team inbox; null until then. */
  emailedAt: string | null;
  createdAt: string;
};

export type FeedbackFilters = {
  category?: FeedbackCategory;
  q?: string;
  limit?: number;
  offset?: number;
};

/** Feedback uses the staff API, including its allowlisted-administrator bridge. */
export async function fetchAdminFeedback(
  filters: FeedbackFilters = {},
  signal?: AbortSignal,
): Promise<Page<AdminFeedback>> {
  return get<Page<AdminFeedback>>(Routes.feedback, { ...filters }, signal);
}

export type ScoreFilters = { game?: string; q?: string; limit?: number; offset?: number };

export function fetchAdminScores(
  filters: ScoreFilters = {},
  signal?: AbortSignal,
): Promise<Page<AdminScore>> {
  return get<Page<AdminScore>>(Routes.leaderboards, { ...filters }, signal);
}

export function fetchAdminCategories(signal?: AbortSignal): Promise<{ items: AdminCategory[] }> {
  return get<{ items: AdminCategory[] }>(Routes.categories, undefined, signal);
}

export function fetchAdminModerationLog(
  filters: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<Page<AdminModerationEntry>> {
  return get<Page<AdminModerationEntry>>(Routes.moderationLog, { ...filters }, signal);
}

export function fetchAdminSystemServices(signal?: AbortSignal): Promise<AdminSystemReport> {
  return get<AdminSystemReport>(Routes.systemServices, undefined, signal);
}

// ── Moderation writes ───────────────────────────────────────────────────────
//
// Each of these is one request that the server either performs or refuses. A
// screen must report success only after the promise resolves: the API is the
// only thing that knows whether the database accepted the change.

export async function moderateGame(
  gameId: string,
  status: Exclude<GameStatus, "draft">,
  reason?: string,
): Promise<AdminModerationResult> {
  return apiFetch<AdminModerationResult>(Routes.game(gameId), {
    method: "PATCH",
    token: requireToken(),
    body: { status, reason: reason ?? "" },
  });
}

export async function moderateReport(
  reportId: string,
  status: ReportStatus,
  reason?: string,
): Promise<AdminModerationResult> {
  return apiFetch<AdminModerationResult>(Routes.report(reportId), {
    method: "PATCH",
    token: requireToken(),
    body: { status, reason: reason ?? "" },
  });
}

export async function moderateComment(
  commentId: string,
  hidden: boolean,
  reason?: string,
): Promise<AdminModerationResult> {
  return apiFetch<AdminModerationResult>(Routes.comment(commentId), {
    method: "PATCH",
    token: requireToken(),
    body: { hidden, reason: reason ?? "" },
  });
}

export async function setAccountSuspension(
  userId: string,
  suspended: boolean,
  reason?: string,
): Promise<AdminModerationResult> {
  return apiFetch<AdminModerationResult>(Routes.user(userId), {
    method: "PATCH",
    token: requireToken(),
    body: { suspended, reason: reason ?? "" },
  });
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export type Resource<T> =
  { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: ApiError };

/**
 * One read, with a retry that re-reads.
 *
 * There is no cached or fallback copy of anything here, so a failed read shows a
 * failure and offers the only action that can help. The loader is held in a ref
 * so a caller can pass an inline closure without re-running the read on every
 * render.
 */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown>,
): Resource<T> & { retry: () => void } {
  const loader = useRef(load);
  loader.current = load;

  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Resource<T>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    loader
      .current(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", error: asApiError(error) });
      });

    return () => controller.abort();
    // `deps` is the caller's dependency list, not a value this hook can derive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  return { ...state, retry: useCallback(() => setAttempt((n) => n + 1), []) };
}

/** The caller's own role, which is what decides whether the dashboard opens. */
export function useAdminSession() {
  return useResource<AdminSession>((signal) => fetchAdminSession(signal), []);
}

export function useAdminOverview() {
  return useResource<AdminOverview>((signal) => fetchAdminOverview(signal), []);
}

export function useAdminAnalytics(days: number) {
  return useResource<AdminAnalytics>((signal) => fetchAdminAnalytics(days, signal), [days]);
}

export function useAdminGames(filters: GameFilters = {}) {
  const { status, q, limit = ADMIN_LIMIT, offset = 0 } = filters;
  return useResource<Page<AdminGame>>(
    (signal) => fetchAdminGames({ status, q, limit, offset }, signal),
    [status, q, limit, offset],
  );
}

export function useAdminUsers(filters: UserFilters = {}) {
  const { role, q, limit = ADMIN_LIMIT, offset = 0 } = filters;
  return useResource<Page<AdminUser>>(
    (signal) => fetchAdminUsers({ role, q, limit, offset }, signal),
    [role, q, limit, offset],
  );
}

export function useAdminReports(filters: ReportFilters = {}) {
  const { status, limit = ADMIN_LIMIT, offset = 0 } = filters;
  return useResource<Page<AdminReport>>(
    (signal) => fetchAdminReports({ status, limit, offset }, signal),
    [status, limit, offset],
  );
}

export function useAdminComments(filters: CommentFilters = {}) {
  const { state, q, limit = ADMIN_LIMIT, offset = 0 } = filters;
  return useResource<Page<AdminComment>>(
    (signal) => fetchAdminComments({ state, q, limit, offset }, signal),
    [state, q, limit, offset],
  );
}

export function useAdminFeedback(filters: FeedbackFilters = {}) {
  const { category, q, limit = ADMIN_LIMIT, offset = 0 } = filters;
  return useResource<Page<AdminFeedback>>(
    (signal) => fetchAdminFeedback({ category, q, limit, offset }, signal),
    [category, q, limit, offset],
  );
}

export function useAdminScores(filters: ScoreFilters = {}) {
  const { game, q, limit = ADMIN_LIMIT, offset = 0 } = filters;
  return useResource<Page<AdminScore>>(
    (signal) => fetchAdminScores({ game, q, limit, offset }, signal),
    [game, q, limit, offset],
  );
}

export function useAdminCategories() {
  return useResource<{ items: AdminCategory[] }>((signal) => fetchAdminCategories(signal), []);
}

export function useAdminModerationLog(filters: { limit?: number; offset?: number } = {}) {
  const { limit = ADMIN_LIMIT, offset = 0 } = filters;
  return useResource<Page<AdminModerationEntry>>(
    (signal) => fetchAdminModerationLog({ limit, offset }, signal),
    [limit, offset],
  );
}

export function useAdminSystemServices() {
  return useResource<AdminSystemReport>((signal) => fetchAdminSystemServices(signal), []);
}

// ── Presentation helpers ────────────────────────────────────────────────────

/**
 * Formats a duration the API may not have measured.
 *
 * Returns `null` when there is nothing to show, so a screen renders "not
 * measured yet" rather than "0s" — the two are different statements.
 */
export function formatSeconds(seconds: number | null): string | null {
  if (seconds === null || Number.isNaN(seconds)) return null;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes === 0) return `${rest}s`;
  return `${minutes}m ${rest.toString().padStart(2, "0")}s`;
}

/** A date the API returned, or null when it did not. */
export function formatWhen(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** A short relative time, for a list that is ordered by time. */
export function formatAgo(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A date and time, for an audit trail where the exact moment matters. */
export function formatStamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError("Something went wrong. Try again.", { code: "unknown_error" });
}
