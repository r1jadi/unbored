/**
 * The personal For You order: every game scored for one viewer.
 *
 * A signed-in player's feed leans towards what they play and like, steps back
 * from what they have just played, and still makes room for launches; a guest's
 * feed is the same order without the personal part. Each day the order shifts a
 * little, so the top of the feed is not the same every morning.
 *
 * For each game:
 *
 *   score = popularity                     log(1 + plays), scaled 0–1 by the most played game
 *         + 0.6 × category affinity        share of the viewer's games in its category, 0–1
 *         + 0.4 if liked or saved
 *         − 0.8 × how recently it was played, falling from 0.8 to 0 over 24 hours
 *         + 0.5 × how new it is, falling from 0.5 to 0 over the fresh window
 *         + a daily jitter of ±0.1, seeded by the viewer, the day and the game
 *
 * Then the feed is laid out from the highest score down, with two rules:
 *
 *   - **new games keep their slots** — the third card and every third after it
 *     goes to the best new game left, as in {@link forYouOrder};
 *   - **no two games of a category in a row** — at each card the best game whose
 *     category differs from the previous card's goes first, and only when none is
 *     left does a repeat come.
 *
 * Pure: the same games, signals, viewer and day give the same order.
 */

import {
  FRESH_SLOT_EVERY,
  FRESH_SLOT_START,
  FRESH_WINDOW_MS,
  isFresh,
  type Game,
} from "@/lib/games/catalog";

/** What the feed knows about one viewer. `null` is a guest, or a viewer it could not read. */
export type ForYouSignals = {
  /** Who is looking: the jitter's seed, so two players' feeds shift differently. */
  readonly viewer: string;
  /** Games the viewer finished, with when, newest first. Repeats allowed. */
  readonly played: readonly { readonly slug: string; readonly at: string }[];
  readonly liked: readonly string[];
  readonly saved: readonly string[];
};

export const WEIGHTS = {
  affinity: 0.6,
  likedOrSaved: 0.4,
  justPlayed: 0.8,
  fresh: 0.5,
  jitter: 0.1,
} as const;

/** How long a game played counts as just played. */
export const JUST_PLAYED_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** FNV-1a over a string, as a number in [0, 1). */
function unit(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 4294967296;
}

const categoryOf = (game: Game): string => game.category?.slug ?? "";

/** Every game's score for this viewer, today. */
export function forYouScores(
  games: readonly Game[],
  signals: ForYouSignals | null,
  now: number = Date.now(),
): Map<string, number> {
  const maxPlays = Math.max(0, ...games.map((game) => game.plays));
  const day = Math.floor(now / DAY_MS);
  const viewer = signals?.viewer ?? "guest";

  // The viewer's categories: one count for every game they played, liked or saved.
  const bySlug = new Map(games.map((game) => [game.slug, game]));
  const theirs = new Set([
    ...(signals?.played.map((p) => p.slug) ?? []),
    ...(signals?.liked ?? []),
    ...(signals?.saved ?? []),
  ]);
  const categories = new Map<string, number>();
  for (const slug of theirs) {
    const category = bySlug.get(slug) ? categoryOf(bySlug.get(slug)!) : "";
    if (category) categories.set(category, (categories.get(category) ?? 0) + 1);
  }
  const topCategory = Math.max(0, ...categories.values());

  // When each game was last played.
  const lastPlayed = new Map<string, number>();
  for (const { slug, at } of signals?.played ?? []) {
    const time = Date.parse(at);
    if (Number.isFinite(time) && time > (lastPlayed.get(slug) ?? -Infinity)) {
      lastPlayed.set(slug, time);
    }
  }
  const kept = new Set([...(signals?.liked ?? []), ...(signals?.saved ?? [])]);

  const scores = new Map<string, number>();
  for (const game of games) {
    let score = maxPlays > 0 ? Math.log1p(game.plays) / Math.log1p(maxPlays) : 0;

    const category = categoryOf(game);
    if (topCategory > 0 && category) {
      score += (WEIGHTS.affinity * (categories.get(category) ?? 0)) / topCategory;
    }
    if (kept.has(game.slug)) score += WEIGHTS.likedOrSaved;

    const played = lastPlayed.get(game.slug);
    if (played !== undefined) {
      const ago = Math.max(0, now - played);
      if (ago < JUST_PLAYED_MS) score -= WEIGHTS.justPlayed * (1 - ago / JUST_PLAYED_MS);
    }

    if (isFresh(game, now)) {
      const age = Math.max(0, now - Date.parse(game.publishedAt!));
      score += WEIGHTS.fresh * (1 - age / FRESH_WINDOW_MS);
    }

    score += WEIGHTS.jitter * (2 * unit(`${viewer}:${day}:${game.slug}`) - 1);
    scores.set(game.slug, score);
  }
  return scores;
}

/** The For You order for one viewer: see the module comment. */
export function personalOrder(
  games: readonly Game[],
  signals: ForYouSignals | null,
  now: number = Date.now(),
): Game[] {
  const scores = forYouScores(games, signals, now);
  // Highest score first; ties keep the catalogue's own (newest-first) order.
  const ranked = games
    .map((game, index) => ({ game, index, score: scores.get(game.slug) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ game }) => game);

  const left = [...ranked];
  const ordered: Game[] = [];
  while (left.length > 0) {
    const position = ordered.length;
    const slot =
      position >= FRESH_SLOT_START && (position - FRESH_SLOT_START) % FRESH_SLOT_EVERY === 0;
    const previous = ordered.length ? categoryOf(ordered[ordered.length - 1]!) : null;
    const differs = (game: Game) => !previous || categoryOf(game) !== previous;

    const pool =
      slot && left.some((game) => isFresh(game, now))
        ? left.filter((game) => isFresh(game, now))
        : left;
    const pick = pool.find(differs) ?? pool[0]!;
    ordered.push(pick);
    left.splice(left.indexOf(pick), 1);
  }
  return ordered;
}
