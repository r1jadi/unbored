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

/** `false` only when the API answered that there is no such game. */
export async function gameExists(slug: string, base = serverApiBase()): Promise<boolean> {
  const response = await read(`/games/${encodeURIComponent(slug)}`, base);
  return response?.status !== 404;
}

/** `false` only when the API listed the categories and this one is not among them. */
export async function categoryExists(slug: string, base = serverApiBase()): Promise<boolean> {
  const response = await read("/categories", base);
  if (!response?.ok) return true;
  try {
    const body = (await response.json()) as { items?: unknown };
    if (!Array.isArray(body.items) || body.items.length === 0) return true;
    return body.items.some(
      (item) => typeof item === "object" && item !== null && "slug" in item && item.slug === slug,
    );
  } catch {
    return true;
  }
}

const onServer = createIsomorphicFn()
  .server(async (check: () => Promise<boolean>) => check())
  .client(async (_check: () => Promise<boolean>) => true);

/** For a route `loader`: throws the router's `notFound()` for an unknown game. */
export async function requireGame(slug: string): Promise<void> {
  if (!(await onServer(() => gameExists(slug)))) throw notFound();
}

/** For a route `loader`: throws the router's `notFound()` for an unknown category. */
export async function requireCategory(slug: string): Promise<void> {
  if (!(await onServer(() => categoryExists(slug)))) throw notFound();
}
