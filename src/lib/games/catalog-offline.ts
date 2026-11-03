/**
 * The catalogue as this device last saw it, for when the API cannot be reached.
 *
 * The service worker (`public/sw.js`) keeps catalogue answers too, but only for
 * pages it controls, and a phone can resume an app from memory, or open it
 * before a new worker takes over. So the catalogue also keeps its own copy: the
 * last full first page of games and the categories, saved after every successful
 * read. Offline, a list, a game or the categories are answered from it — the
 * feed, Explore and a game's play screen keep working — and anything it cannot
 * answer (a search, a later page, a game it never listed) stays an error.
 *
 * Storage rule: the catalogue is public and the same for every visitor, so
 * keeping it in `localStorage` leaks nothing about the person using the device.
 * It is only ever read when the network has failed; online, every read is fresh.
 */

import type { CategoryList, Game, GameList, GameQuery } from "@/lib/games/catalog";
import { safeLocalStorage } from "@/lib/storage";

const GAMES_KEY = "unbored:catalog-snapshot:games";
const CATEGORIES_KEY = "unbored:catalog-snapshot:categories";

function read<T>(key: string): T | undefined {
  try {
    const raw = safeLocalStorage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  try {
    safeLocalStorage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: offline simply has less to show.
  }
}

/** Keeps a list answer when it is a whole, unfiltered first page — the longest seen. */
export function rememberGames(query: GameQuery, list: GameList): void {
  if (query.cursor || query.q || query.category) return;
  const kept = read<Game[]>(GAMES_KEY);
  if (kept && kept.length > list.items.length && list.nextCursor !== null) return;
  write(GAMES_KEY, list.items);
}

/** Keeps one game's full entry, replacing its listing in the snapshot. */
export function rememberGame(game: Game): void {
  const kept = read<Game[]>(GAMES_KEY);
  if (!kept) return;
  const index = kept.findIndex((item) => item.slug === game.slug);
  if (index < 0) return;
  kept[index] = { ...kept[index], ...game };
  write(GAMES_KEY, kept);
}

export function rememberCategories(list: CategoryList): void {
  write(CATEGORIES_KEY, list);
}

/** A first page of games from the snapshot: filtered by category, cut to the limit. */
export function rememberedGames(query: GameQuery): GameList | undefined {
  if (query.cursor || query.q) return undefined;
  const kept = read<Game[]>(GAMES_KEY);
  if (!kept) return undefined;
  const items = kept
    .filter((game) => !query.category || game.category?.slug === query.category)
    .slice(0, query.limit ?? kept.length);
  return { items, nextCursor: null };
}

export function rememberedGame(slug: string): Game | undefined {
  return read<Game[]>(GAMES_KEY)?.find((game) => game.slug === slug);
}

export function rememberedCategories(): CategoryList | undefined {
  return read<CategoryList>(CATEGORIES_KEY);
}
