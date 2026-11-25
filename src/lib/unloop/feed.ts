/**
 * Unloop for viewers: the feed, likes and saves.
 *
 * The same pattern as `src/lib/social/engagement.ts`: Supabase's Data API with the
 * publishable key, and the caller's own token when there is one. Row Level Security
 * is the boundary — a like or a save can only be written for `auth.uid()`, and only
 * on a published video — and the feed is one definer function
 * (`public.unloop_feed`) that never returns a draft.
 *
 * Every count is the database's: likes and saves are counted from their rows when
 * the page is read. Nothing here estimates or pads a number.
 */

import { useInfiniteQuery } from "@tanstack/react-query";

import { ApiError } from "@/lib/api/client";
import { getAccessToken, getAuthState, useAuth } from "@/lib/auth/session";
import { publicConfig } from "@/lib/config";
import { SITE_URL } from "@/lib/seo";
import { t } from "@/lib/settings/language";
import { restGet, restMutate, SupabaseRestError } from "@/lib/supabase/rest";
import type { UnloopCategory } from "@/lib/unloop/categories";

export const UNLOOP_BUCKET = "unloop";
export const UNLOOP_PAGE_SIZE = 8;

export type UnloopVideo = {
  id: string;
  title: string;
  description: string;
  category: UnloopCategory;
  videoUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  publishedAt: string;
  likes: number;
  saves: number;
  liked: boolean;
  saved: boolean;
};

type FeedRow = {
  id: string;
  title: string;
  description: string;
  category: UnloopCategory;
  video_path: string;
  thumbnail_path: string | null;
  duration_seconds: number | string | null;
  published_at: string;
  likes: number | string;
  saves: number | string;
  liked: boolean;
  saved: boolean;
};

/** The public address of a file in the Unloop bucket. */
export function unloopFileUrl(path: string): string {
  const base = publicConfig.supabase.url.replace(/\/+$/, "");
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${UNLOOP_BUCKET}/${encoded}`;
}

/** The link a shared video opens: Unloop, starting on that video. */
export function unloopShareUrl(id: string): string {
  return `${SITE_URL}/unloop?v=${encodeURIComponent(id)}`;
}

function toVideo(row: FeedRow): UnloopVideo {
  const duration = row.duration_seconds === null ? null : Number(row.duration_seconds);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    videoUrl: unloopFileUrl(row.video_path),
    thumbnailUrl: row.thumbnail_path ? unloopFileUrl(row.thumbnail_path) : null,
    durationSeconds: duration !== null && Number.isFinite(duration) ? duration : null,
    publishedAt: row.published_at,
    likes: Number(row.likes),
    saves: Number(row.saves),
    liked: row.liked,
    saved: row.saved,
  };
}

export type UnloopFilter = {
  category?: UnloopCategory;
  /** Only the viewer's saved videos. */
  saved?: boolean;
};

/** One page of published videos. */
export async function fetchUnloopPage(
  filter: UnloopFilter & { video?: string; offset?: number; limit?: number },
): Promise<UnloopVideo[]> {
  const params = new URLSearchParams();
  if (filter.category) params.set("p_category", filter.category);
  if (filter.saved) params.set("p_saved", "true");
  if (filter.video) params.set("p_video", filter.video);
  params.set("p_limit", String(filter.limit ?? UNLOOP_PAGE_SIZE));
  params.set("p_offset", String(filter.offset ?? 0));
  try {
    const rows = await restGet<FeedRow[]>(
      `rpc/unloop_feed?${params.toString()}`,
      getAccessToken() ?? undefined,
    );
    return rows.map(toVideo);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(t("Couldn't load Unloop. Try again."), {
      code: "unloop_failed",
      status: error instanceof SupabaseRestError ? error.status : 0,
    });
  }
}

/**
 * The feed for one filter, a page at a time. A shared video (`first`) leads the
 * feed and is not repeated further down.
 */
export function useUnloopFeed(filter: UnloopFilter, first?: string) {
  const auth = useAuth();
  const viewer = auth.status === "authenticated" ? auth.session.userId : auth.status;
  return useInfiniteQuery({
    queryKey: ["unloop", filter.category ?? "all", filter.saved ?? false, first ?? null, viewer],
    enabled: auth.status !== "restoring" && !(filter.saved && auth.status !== "authenticated"),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const page = await fetchUnloopPage({ ...filter, offset: pageParam });
      if (pageParam !== 0 || !first) return page;
      const lead = await fetchUnloopPage({ video: first, limit: 1 });
      return [...lead, ...page.filter((video) => video.id !== first)];
    },
    getNextPageParam: (last, pages) =>
      last.length < UNLOOP_PAGE_SIZE
        ? undefined
        : pages.reduce((sum, page) => sum + page.length, 0) - (first ? 1 : 0),
    staleTime: 30_000,
  });
}

function requireViewer(): { token: string; userId: string } {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") {
    throw new ApiError(t("Sign in to like and save loops."), {
      code: "unauthorized",
      status: 401,
    });
  }
  return { token, userId: auth.session.userId };
}

/**
 * Likes or saves a video, or takes it back. Idempotent: a second like conflicts on
 * the primary key and counts as done, and removing a row that isn't there is a no-op.
 */
export async function setUnloopMark(
  kind: "like" | "save",
  videoId: string,
  on: boolean,
): Promise<void> {
  const { token, userId } = requireViewer();
  const table = kind === "like" ? "unloop_likes" : "unloop_saves";
  try {
    if (on) {
      await restMutate(
        table,
        "POST",
        token,
        { user_id: userId, video_id: videoId },
        "return=minimal",
      );
    } else {
      await restMutate(
        `${table}?user_id=eq.${encodeURIComponent(userId)}&video_id=eq.${encodeURIComponent(videoId)}`,
        "DELETE",
        token,
        undefined,
        "return=minimal",
      );
    }
  } catch (error) {
    if (
      on &&
      error instanceof SupabaseRestError &&
      (error.status === 409 || error.code === "23505")
    ) {
      return;
    }
    if (error instanceof SupabaseRestError && error.status === 401) {
      throw new ApiError(t("Sign in to like and save loops."), {
        code: "unauthorized",
        status: 401,
      });
    }
    throw new ApiError(
      kind === "like"
        ? t("Couldn't update the like. Try again.")
        : t("Couldn't save that loop. Try again."),
      { code: `${kind}_failed`, status: error instanceof SupabaseRestError ? error.status : 0 },
    );
  }
}
