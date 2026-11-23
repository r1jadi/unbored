/**
 * "Does this catalogue page exist?", asked once, on the server, so that a URL
 * naming no game or no category is answered with a real 404.
 *
 * The app reads its data in the browser (see `lib/prefetch.ts`), so without
 * this the server renders the same 200 shell for `/games/anything-at-all` and
 * only the browser finds out the game is missing: a soft 404, which a crawler
 * may index as a page. These checks run in the route's loader during the server
 * render only; in the browser they resolve at once and the screen's own
 * "not found" state does the work, as before.
 *
 * They fail open. Only the API saying "no such thing" produces a 404 — a
 * timeout, an outage or an answer in an unexpected shape renders the page as
 * usual, because a real game must never 404 just because the API was slow.
 */

import { notFound } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";

import { publicConfig } from "@/lib/config";
import { localizeGame } from "@/lib/games/catalog";
import { translateContent } from "@/lib/settings/language";

/** The render waits on this, so it is short: the catalogue is edge-cached. */
const TIMEOUT_MS = 1500;

/**
 * The API's absolute base on the server. A relative base is resolved against
 * the canonical site origin rather than the request's `Host` header, which a
 * client chooses: the server must not be steerable into fetching another host.
 * In development a relative base has no server to resolve to, so nothing is
 * checked.
 */
export function serverApiBase(
  apiBaseUrl: string = publicConfig.apiBaseUrl,
  siteUrl: string = publicConfig.siteUrl,
  production: boolean = import.meta.env.PROD,
): string | undefined {
  if (!apiBaseUrl.startsWith("/")) return apiBaseUrl;
  return production ? `${siteUrl}${apiBaseUrl}` : undefined;
}

async function read(path: string, base: string | undefined): Promise<Response | undefined> {
  if (!base) return undefined;
  try {
    return await fetch(`${base}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return undefined;
  }
}

/**
 * The text of a game that the server renders into the page, so that a crawler
 * (and anyone on a slow connection) gets the game's description and rules in
 * the HTML instead of a loading skeleton. Only plain strings: it travels to the
 * browser inside the router's loader data.
 */
export type CrawlGame = {
  slug: string;
  title: string;
  tagline?: string;
  description?: string;
  instructions?: string;
  category?: { slug: string; name: string };
};

export type CrawlCategory = { slug: string; name: string; description?: string };

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function toCrawlGame(slug: string, body: unknown): CrawlGame | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const title = text(record["title"]);
  if (!title) return undefined;
  const rawCategory = record["category"];
  const category =
    typeof rawCategory === "object" && rawCategory !== null
      ? {
          slug: text((rawCategory as Record<string, unknown>)["slug"]),
          name: text((rawCategory as Record<string, unknown>)["name"]),
        }
      : undefined;
  const game = localizeGame({
    title,
    tagline: text(record["tagline"]),
    description: text(record["description"]),
    instructions: text(record["instructions"]),
    category: category?.slug && category.name ? { slug: category.slug, name: category.name } : null,
  });
  return {
    slug: text(record["slug"]) ?? slug,
    title: game.title,
    ...(text(game.tagline) ? { tagline: game.tagline as string } : {}),
    ...(text(game.description) ? { description: game.description as string } : {}),
    ...(text(game.instructions) ? { instructions: game.instructions as string } : {}),
    ...(game.category ? { category: game.category } : {}),
  };
}

/**
 * The game, `"missing"` when the API answered that there is no such game, or
 * `undefined` when it could not say (no base, a timeout, an error, an odd shape).
 */
export async function readGame(
  slug: string,
  base = serverApiBase(),
): Promise<CrawlGame | "missing" | undefined> {
  const response = await read(`/games/${encodeURIComponent(slug)}`, base);
  if (response?.status === 404) return "missing";
  if (!response?.ok) return undefined;
  try {
    return toCrawlGame(slug, await response.json());
  } catch {
    return undefined;
  }
}

/** `false` only when the API answered that there is no such game. */
export async function gameExists(slug: string, base = serverApiBase()): Promise<boolean> {
  return (await readGame(slug, base)) !== "missing";
}

/** Like `readGame`, for a category: `"missing"` only when a non-empty list lacks it. */
export async function readCategory(
  slug: string,
  base = serverApiBase(),
): Promise<CrawlCategory | "missing" | undefined> {
  const response = await read("/categories", base);
  if (!response?.ok) return undefined;
  try {
    const body = (await response.json()) as { items?: unknown };
    if (!Array.isArray(body.items) || body.items.length === 0) return undefined;
    const item = body.items.find(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && "slug" in entry && entry.slug === slug,
    );
    if (!item) return "missing";
    const name = text(item["name"]);
    if (!name) return undefined;
    const description = text(translateContent(text(item["description"])));
    return {
      slug,
      name: translateContent(name) ?? name,
      ...(description ? { description } : {}),
    };
  } catch {
    return undefined;
  }
}

/** `false` only when the API listed the categories and this one is not among them. */
export async function categoryExists(slug: string, base = serverApiBase()): Promise<boolean> {
  return (await readCategory(slug, base)) !== "missing";
}

/** True during the server render; the browser never asks. */
const onServer = createIsomorphicFn()
  .server(() => true)
  .client(() => false);

/**
 * For a route `loader`: throws the router's `notFound()` for an unknown game and
 * otherwise returns its text, on the server only. In the browser it resolves at
 * once with nothing, and the screen reads the game itself, as before.
 */
export async function loadGame(slug: string): Promise<{ game?: CrawlGame }> {
  const game = onServer() ? await readGame(slug) : undefined;
  if (game === "missing") throw notFound();
  return game ? { game } : {};
}

/** For a route `loader`: like `loadGame`, for a category. */
export async function loadCategory(slug: string): Promise<{ category?: CrawlCategory }> {
  const category = onServer() ? await readCategory(slug) : undefined;
  if (category === "missing") throw notFound();
  return category ? { category } : {};
}
