/**
 * The game catalogue, as `services/games` defines it.
 *
 * The app reads the catalogue from `/api/v1/games`, `/api/v1/games/{slug}` and
 * `/api/v1/categories` (see packages/api-contracts/openapi-v1.yaml). Three
 * properties of that API shape everything here:
 *
 *   - **A slug is the identifier.** Routes and links use it (`/games/stack-10`),
 *     so a catalogue link survives a redeploy and matches the API's own path
 *     parameter.
 *   - **Activity is measured, never estimated.** A game's `plays` is its number of
 *     *completed* runs, counted in the database from persisted sessions, and a game
 *     nobody has finished reports zero. There is still no rating, comment total or
 *     average session anywhere, because no service records those — and nothing here
 *     invents, defaults or estimates one.
 *   - **An unpublished game is a 404.** The API answers the same way for an
 *     unknown slug and a draft, so a failed detail read is reported as "missing"
 *     rather than as an error to retry.
 *
 * Storage rule: the app caches the catalogue in memory, in its query cache
 * (`lib/query.ts`), for as long as the tab is open. The service worker
 * (`public/sw.js`) also keeps the last answer to each public read on disk, and
 * so does `catalog-offline.ts`, in `localStorage`, for a page the worker does not
 * control. Both are only an offline fallback: online, every read goes to the network, so a new
 * deployment is never served from a stale copy. The catalogue is public and the
 * same for every visitor, so nothing personal can leak between accounts through
 * it. A cached screen opens instantly and refreshes in the background.
 */

import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { ApiError, apiFetch, type ApiRequestOptions } from "@/lib/api/client";
import { publicConfig } from "@/lib/config";
import { getQueryClient } from "@/lib/query";
import {
  rememberCategories,
  rememberedCategories,
  rememberedGame,
  rememberedGames,
  rememberGame,
  rememberGames,
} from "@/lib/games/catalog-offline";
import { isUnreachable } from "@/lib/games/offline";

import { t, translateContent } from "@/lib/settings/language";
/** Routes implemented by `services/games`. Kept together so they cannot drift. */
const Routes = {
  games: "/games",
  categories: "/categories",
} as const;

/** The bucket the storage migration creates for game artwork. */
const GAME_ASSET_BUCKET = "game-assets";

/** The contract's default and maximum page size. */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Games ordered by completed runs, most first, leaving out games nobody has
 * finished. `plays` is counted by the database, so this is a real ranking of the
 * games it is given; ties keep the catalogue's own (newest-first) order.
 */
export function mostPlayed(games: readonly Game[]): Game[] {
  return games
    .filter((game) => game.plays > 0)
    .map((game, index) => ({ game, index }))
    .sort((a, b) => b.game.plays - a.game.plays || a.index - b.index)
    .map(({ game }) => game);
}

export const MAX_PAGE_SIZE = 100;

/**
 * Every game ordered by completed runs, most played first and least played last —
 * unplayed games included, unlike {@link mostPlayed}. `plays` is counted by the
 * database; ties keep the catalogue's own (newest-first) order, so a new game
 * with no runs yet still sits ahead of an older one with none.
 */
export function byPlays(games: readonly Game[]): Game[] {
  return games
    .map((game, index) => ({ game, index }))
    .sort((a, b) => b.game.plays - a.game.plays || a.index - b.index)
    .map(({ game }) => game);
}

/** How long after launch a game counts as new on For You. */
export const FRESH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** The feed positions held for new games, by index: the third card, then every third. */
export const FRESH_SLOT_START = 2;
export const FRESH_SLOT_EVERY = 3;

/** Whether `game` launched within the fresh window before `now`. */
export function isFresh(game: Pick<Game, "publishedAt">, now: number): boolean {
  if (!game.publishedAt) return false;
  const published = Date.parse(game.publishedAt);
  return Number.isFinite(published) && now - published < FRESH_WINDOW_MS;
}

/**
 * The For You order: the most played games on top, with room kept for new ones.
 *
 * Ranking by plays alone buries every launch, since a new game starts at zero
 * and sits under games that have had months to collect runs. So the feed is a
 * merge of two queues, both ranked by plays (ties newest first):
 *
 *   - **established** games, which earn their place by plays alone;
 *   - **fresh** games, published within {@link FRESH_WINDOW_MS}.
 *
 * Fresh games are guaranteed the third card and every third card after it. At
 * every other position the queue whose next game has more plays goes first, so
 * a launch that is already popular climbs above its slot on its own merit.
 * Once its window closes a game is established and competes on plays alone.
 * When either queue runs out the other fills the rest.
 */
export function forYouOrder(games: readonly Game[], now: number = Date.now()): Game[] {
  const ranked = byPlays(games);
  const fresh = ranked.filter((game) => isFresh(game, now));
  const established = ranked.filter((game) => !isFresh(game, now));

  const ordered: Game[] = [];
  let f = 0;
  let e = 0;
  while (f < fresh.length || e < established.length) {
    const index = ordered.length;
    const slot = index >= FRESH_SLOT_START && (index - FRESH_SLOT_START) % FRESH_SLOT_EVERY === 0;
    const takeFresh =
      e >= established.length ||
      (f < fresh.length && (slot || fresh[f]!.plays > established[e]!.plays));
    ordered.push(takeFresh ? fresh[f++]! : established[e++]!);
  }
  return ordered;
}

/**
 * The For You feed's query: the largest pages the API serves. The feed reads
 * every page before it orders them (`routes/index.tsx`), so the order ranks the
 * whole catalogue rather than only the newest page, at any catalogue size.
 */
export const FEED_QUERY = { limit: MAX_PAGE_SIZE } as const;

/** The only order the catalogue can compute from real data. */
export type GameSort = "latest";

/** A game's category, as a game embeds it. */
export type GameCategory = {
  slug: string;
  name: string;
};

/**
 * One published game.
 *
 * Every optional field is optional because the database column is nullable, not
 * because a screen may substitute a default: `tagline: undefined` means the game
 * has no tagline, and the UI omits the line rather than inventing copy.
 */
export type Game = {
  slug: string;
  title: string;
  tagline?: string | null;
  description?: string | null;
  /** How to play. Absent while a game has no written rules. */
  instructions?: string | null;
  category?: GameCategory | null;
  /**
   * The client runtime that plays this game, or null when none exists.
   * `playable` is false for every game until a runtime ships.
   */
  runtime?: string | null;
  /**
   * True only when a runtime genuinely exists. A published but unplayable game
   * is listed, not playable — no screen may offer to start it.
   */
  playable: boolean;
  /**
   * Completed runs, counted by the database. Always present, and always a real
   * measurement: zero means nobody has finished this game yet.
   */
  plays: number;
  /** First-party Unbored content, as opposed to a creator's. */
  isOfficial: boolean;
  /** Storage object path (`<slug>/<file>`), not a URL. See `coverUrl`. */
  coverPath?: string | null;
  publishedAt?: string | null;
  updatedAt: string;
};

/** A catalogue category with its real published-game count. */
export type Category = GameCategory & {
  description?: string | null;
  gameCount: number;
};

export type GameList = {
  items: Game[];
  /** Null on the last page. Opaque — pass it back as `cursor`. */
  nextCursor: string | null;
};

export type CategoryList = {
  items: Category[];
};

export type GameQuery = {
  limit?: number;
  cursor?: string;
  /** A category slug, as returned by `fetchCategories`. */
  category?: string;
  /** Case-insensitive substring match over title, tagline and description. */
  q?: string;
  sort?: GameSort;
};

type RequestOptions = { signal?: AbortSignal };

// ── Requests ────────────────────────────────────────────────────────────────

/**
 * A game's catalogue text in the player's language: its title, tagline,
 * description, instructions and category, where the dictionary has them (see
 * `lib/i18n/catalog-sq.ts`). Text an admin has since edited has no entry and is
 * shown as written. The language is fixed for a page load, so a game is
 * localized once, as it arrives.
 */
export function localizeGame<T extends LocalizableGame>(game: T): T {
  return {
    ...game,
    title: translateContent(game.title),
    tagline: translateContent(game.tagline),
    description: translateContent(game.description),
    instructions: translateContent(game.instructions),
    ...(game.category
      ? { category: { ...game.category, name: translateContent(game.category.name) } }
      : {}),
  };
}

type LocalizableGame = {
  title: string;
  tagline?: string | null;
  description?: string | null;
  instructions?: string | null;
  category?: { name: string } | null;
};

/** Reads a page of published games. Public: no token. */
export function fetchGames(query: GameQuery = {}, options: RequestOptions = {}): Promise<GameList> {
  return apiFetch<GameList>(Routes.games, {
    query: {
      limit: query.limit,
      cursor: query.cursor,
      category: query.category,
      q: query.q,
      sort: query.sort,
    },
    signal: options.signal,
  })
    .then(
      (list) => {
        rememberGames(query, list);
        return list;
      },
      offlineFallback(() => rememberedGames(query)),
    )
    .then((list) => ({ ...list, items: list.items.map(localizeGame) }));
}

/**
 * Answers a read the API could not serve from the device's copy of the
 * catalogue (`catalog-offline.ts`). Only for a network failure: a refusal is
 * an answer, and a read the copy cannot answer stays the error it was.
 */
function offlineFallback<T>(remembered: () => T | undefined): (error: unknown) => T {
  return (error) => {
    if (isUnreachable(error)) {
      const answer = remembered();
      if (answer !== undefined) return answer;
    }
    throw error;
  };
}

/**
 * Reads one published game by slug.
 *
 * An unpublished game and an unknown one both answer 404, which is why the
 * caller must treat them identically: `useGame` reports `missing` for both.
 */
export function fetchGame(slug: string, options: RequestOptions = {}): Promise<Game> {
  return apiFetch<Game>(`${Routes.games}/${encodeURIComponent(slug)}`, {
    signal: options.signal,
  })
    .then(
      (game) => {
        rememberGame(game);
        return game;
      },
      offlineFallback(() => rememberedGame(slug)),
    )
    .then(localizeGame);
}

/** Reads every category with its real published-game count. Public. */
export function fetchCategories(options: RequestOptions = {}): Promise<CategoryList> {
  return apiFetch<CategoryList>(Routes.categories, { signal: options.signal })
    .then((list) => {
      rememberCategories(list);
      return list;
    }, offlineFallback(rememberedCategories))
    .then((list) => ({
      ...list,
      items: list.items.map((category) => ({
        ...category,
        name: translateContent(category.name),
        description: translateContent(category.description),
      })),
    }));
}

// ── Presentation helpers ────────────────────────────────────────────────────

/**
 * The public URL of a game's cover art, or `undefined` when there is none — in
 * which case the generated `GameArt` stands in, as it always has.
 *
 * The `game-assets` bucket is public by design (artwork is public on the web),
 * so this is a plain object URL and not a signed one.
 */
export function coverUrl(game: Pick<Game, "coverPath"> | undefined): string | undefined {
  const path = game?.coverPath;
  if (!path) return undefined;
  const baseUrl = publicConfig.supabase.url.replace(/\/+$/, "");
  if (baseUrl === "") return undefined;
  return `${baseUrl}/storage/v1/object/public/${GAME_ASSET_BUCKET}/${path}`;
}

/**
 * Whether a game is in the "daily" category, which is what the Daily badge and
 * the Explore challenge card key on.
 *
 * It is derived from the category rather than a flag, because that is what the
 * catalogue actually models: there is no `isDaily` column, and inferring one
 * from a published date would be a guess.
 */
export function isDaily(game: Pick<Game, "category">): boolean {
  return game.category?.slug === "daily";
}

/** The category's display name, or `undefined` when the game has none. */
export function categoryName(game: Pick<Game, "category">): string | undefined {
  return game.category?.name;
}

/** A path to a category page, or `undefined` when the game has no category. */
export function categoryPath(game: Pick<Game, "category">): string | undefined {
  return game.category ? `/categories/${game.category.slug}` : undefined;
}

/**
 * A readable title for a slug.
 *
 * Used only where a page needs a heading before its data has arrived — document
 * metadata, and the heading of a category or game that turns out not to exist. It
 * is a rendering of the URL, never a substitute for the real title, which always
 * comes from the API.
 */
export function titleFromSlug(slug: string): string {
  return translateContent(englishTitleFromSlug(slug));
}

function englishTitleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      // A slug drops apostrophes, so "dont" is put back as "Don't".
      const restored = CONTRACTIONS[lower] ?? lower;
      // Title case keeps short joining words lower-case, except as the first word:
      // "Don't Break the Chain", the way the catalogue writes it.
      if (index > 0 && SMALL_WORDS.has(restored)) return restored;
      return restored[0].toUpperCase() + restored.slice(1);
    })
    .join(" ");
}

const CONTRACTIONS: Record<string, string> = {
  dont: "don't",
  doesnt: "doesn't",
  didnt: "didn't",
  cant: "can't",
  wont: "won't",
  isnt: "isn't",
  arent: "aren't",
  wasnt: "wasn't",
  shouldnt: "shouldn't",
  couldnt: "couldn't",
  wouldnt: "wouldn't",
  im: "i'm",
  ive: "i've",
  youre: "you're",
  thats: "that's",
  lets: "let's",
};

const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "vs",
]);

/**
 * The message to show a person when a catalogue call fails.
 *
 * The API writes messages that are safe to display ("The game catalogue is not
 * available right now."), so they are passed through rather than re-worded here.
 * Anything else is a bug or a transport failure and gets a generic message
 * instead of an internal detail.
 */
export function catalogErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : t("Something went wrong. Please try again.");
}

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError(t("Something went wrong. Please try again."));
}

// ── React bindings ──────────────────────────────────────────────────────────
//
// Every read goes through the shared query cache (`lib/query.ts`). The query
// definitions are exported so a route can prefetch exactly what its screen will
// ask for — the cache key is the contract between the two.

export const catalogKeys = {
  games: (query: Required<Pick<GameQuery, "limit" | "sort">> & Omit<GameQuery, "cursor">) =>
    ["games", "list", query] as const,
  game: (slug: string) => ["games", "detail", slug] as const,
  categories: () => ["categories"] as const,
};

function normaliseQuery(query: GameQuery = {}) {
  return {
    limit: query.limit ?? DEFAULT_PAGE_SIZE,
    sort: query.sort ?? ("latest" as GameSort),
    ...(query.category ? { category: query.category } : {}),
    ...(query.q ? { q: query.q } : {}),
  };
}

/** One game by slug, for `useGame` and for a route that prefetches it. */
export function gameQuery(slug: string) {
  return queryOptions({
    queryKey: catalogKeys.game(slug),
    queryFn: ({ signal }) => fetchGame(slug, { signal }),
  });
}

/** Every category, for `useCategories` and for prefetching. */
export function categoriesQuery() {
  return queryOptions({
    queryKey: catalogKeys.categories(),
    queryFn: ({ signal }) => fetchCategories({ signal }),
  });
}

/** A catalogue listing, page by page, for `useGames` and for prefetching. */
export function gamesQuery(query: GameQuery = {}) {
  const normalised = normaliseQuery(query);
  return infiniteQueryOptions({
    queryKey: catalogKeys.games(normalised),
    queryFn: ({ pageParam, signal }) =>
      fetchGames({ ...normalised, cursor: pageParam }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: GameList) => page.nextCursor ?? undefined,
  });
}

export type GameListState = {
  status: "loading" | "ready" | "error";
  items: Game[];
  nextCursor: string | null;
  /** A continuation is in flight; the list stays on screen while it is. */
  loadingMore: boolean;
  /** The first page failed. The screen shows an error state with a retry. */
  error?: ApiError;
  /**
   * A continuation failed. Kept apart from `error` on purpose: the items that
   * did load must stay on screen, so a failed "load more" is a note under the
   * grid rather than a screen that throws away what it already had.
   */
  loadMoreError?: ApiError;
};

export type GameListResult = GameListState & {
  retry: () => void;
  loadMore: () => void;
};

/**
 * Reads a page of the catalogue, from cache when it is there.
 *
 * `retry` is what every error affordance calls, and it is deliberately a re-read
 * rather than a fallback: there is no hardcoded catalogue to fall back to, so a
 * failed request shows a failure. A different query is a different cache entry,
 * so a new filter never shows the previous filter's results under its heading.
 */
export function useGames(query: GameQuery = {}): GameListResult {
  const list = useInfiniteQuery(gamesQuery(query), getQueryClient());

  const items = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data]);
  const lastPage = list.data?.pages.at(-1);
  const { refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = list;

  const retry = useCallback(() => void refetch(), [refetch]);
  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  if (list.data === undefined) {
    return list.isError
      ? {
          status: "error",
          items: [],
          nextCursor: null,
          loadingMore: false,
          error: asApiError(list.error),
          retry,
          loadMore,
        }
      : { status: "loading", items: [], nextCursor: null, loadingMore: false, retry, loadMore };
  }

  return {
    status: "ready",
    items,
    nextCursor: lastPage?.nextCursor ?? null,
    loadingMore: isFetchingNextPage,
    loadMoreError: list.isFetchNextPageError ? asApiError(list.error) : undefined,
    retry,
    loadMore,
  };
}

/**
 * What the app knows about one catalogue game.
 *
 * `missing` is not an error: an unknown slug and an unpublished game are the
 * same 404 by design, so retrying could not help and a "game not found" screen is
 * the answer.
 */
export type GameState =
  | { status: "loading" }
  | { status: "ready"; game: Game }
  | { status: "missing" }
  | { status: "error"; error: ApiError };

export function useGame(slug: string): GameState & { retry: () => void } {
  const game = useQuery(gameQuery(slug), getQueryClient());
  const { refetch } = game;
  const retry = useCallback(() => void refetch(), [refetch]);

  if (game.data !== undefined) return { status: "ready", game: game.data, retry };
  if (game.isError) {
    const apiError = asApiError(game.error);
    return apiError.status === 404
      ? { status: "missing", retry }
      : { status: "error", error: apiError, retry };
  }
  return { status: "loading", retry };
}

export type CategoryState =
  | { status: "loading" }
  | { status: "ready"; items: Category[] }
  | { status: "error"; error: ApiError };

export function useCategories(): CategoryState & { retry: () => void } {
  const categories = useQuery(categoriesQuery(), getQueryClient());
  const { refetch } = categories;
  const retry = useCallback(() => void refetch(), [refetch]);

  if (categories.data !== undefined) {
    return { status: "ready", items: categories.data.items, retry };
  }
  if (categories.isError) return { status: "error", error: asApiError(categories.error), retry };
  return { status: "loading", retry };
}

/** Re-exported so a caller building a custom request keeps the same header rules. */
export type { ApiRequestOptions };
