/**
 * Unbored's service worker: what lets the games be played without a connection.
 *
 * Every game runs in the browser; the network is only needed to start a ranked
 * run and to verify it. So once the app's code, the pages a player opens and the
 * public catalogue are on the device, a game can be played offline as practice
 * (see `src/lib/games/offline.ts`). This worker keeps those three things:
 *
 *   - **The build** (`/offline-manifest.json`, emitted by `vite.config.ts`): every
 *     script, stylesheet and font, cached on install, so a game whose puzzle bank
 *     is a lazily loaded chunk still has it offline. Hashed file names never
 *     change content, so they are served from the cache first.
 *   - **Pages**: network first, so a visitor online always gets a fresh render;
 *     the copy is kept for when the network is gone. The app warms the play page
 *     of every playable game (`src/lib/offline-warm.ts`), so a game the player has
 *     never opened still starts offline.
 *   - **The public catalogue** (`/games`, `/games/{slug}`, `/categories`): network
 *     first, with the last answer kept. Only unauthenticated JSON reads are kept,
 *     so nothing personal is ever written to the cache.
 *
 * Nothing else is cached: sessions, boards, accounts and every write always go
 * to the network, and fail there as they would without this worker.
 */

const BUILD_CACHE_PREFIX = "unbored-build-";
const PAGE_CACHE = "unbored-pages-v1";
const CATALOG_CACHE = "unbored-catalog-v1";
const MANIFEST_URL = "/offline-manifest.json";
/** The games the app last asked to keep, for the offline fallback page. */
const OFFLINE_GAMES_KEY = "/__offline-games.json";

const STATIC_FILES = [
  "/manifest.webmanifest",
  "/favicon.svg",
  "/favicon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

/** Pages that are personal or one-off, and never worth keeping. */
const UNCACHED_PAGES =
  /^\/(admin|auth|login|signup|forgot-password|reset-password|verify-email)(\/|$)/;

/** The catalogue's public reads, relative to wherever the API is mounted. */
const CATALOG_PATH = /\/(games(\/[^/]+)?|categories)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await cacheBuild();
      const pages = await caches.open(PAGE_CACHE);
      await pages.add(new Request("/", { cache: "reload" })).catch(() => undefined);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const current = await currentBuildCache();
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(BUILD_CACHE_PREFIX) && name !== current)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * Caches every file of the current build under a cache named for its version.
 * A build without a manifest (the dev server) caches only the static files, and
 * whatever is fetched later is kept as it is used.
 */
async function cacheBuild() {
  let manifest = { version: "dev", files: [] };
  try {
    const response = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (response.ok) manifest = await response.json();
  } catch {
    // Offline or no manifest: keep whatever build is already cached.
  }
  const name = `${BUILD_CACHE_PREFIX}${manifest.version}`;
  const cache = await caches.open(name);
  const wanted = [...STATIC_FILES, ...manifest.files];
  const missing = [];
  for (const url of wanted) {
    if (!(await cache.match(url))) missing.push(url);
  }
  // One file at a time would be slow and all at once can trip a rate limit; a
  // few in parallel is enough. A file that fails is fetched again on use.
  for (let i = 0; i < missing.length; i += 8) {
    await Promise.all(missing.slice(i, i + 8).map((url) => cache.add(url).catch(() => undefined)));
  }
  await cache.put(
    "/__build-version",
    new Response(manifest.version, { headers: { "content-type": "text/plain" } }),
  );
}

async function currentBuildCache() {
  const names = (await caches.keys()).filter((name) => name.startsWith(BUILD_CACHE_PREFIX));
  // The newest cache is the one this worker filled on install.
  return names[names.length - 1];
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    if (url.origin === self.location.origin && !UNCACHED_PAGES.test(url.pathname)) {
      event.respondWith(page(request, url));
    }
    return;
  }

  if (url.origin === self.location.origin && isBuildFile(url.pathname)) {
    event.respondWith(buildFile(request));
    return;
  }

  if (isCatalogRead(request, url)) {
    event.respondWith(catalog(request));
  }
});

function isBuildFile(pathname) {
  return pathname.startsWith("/assets/") || STATIC_FILES.includes(pathname);
}

function isCatalogRead(request, url) {
  return (
    CATALOG_PATH.test(url.pathname) &&
    !request.headers.has("Authorization") &&
    (request.headers.get("Accept") ?? "").includes("application/json")
  );
}

/** A page: the network's render when there is one, else the copy kept for it. */
async function page(request, url) {
  const key = url.pathname;
  try {
    const response = await fetch(request);
    if (response.ok && (response.headers.get("content-type") ?? "").includes("text/html")) {
      const copy = response.clone();
      caches.open(PAGE_CACHE).then((cache) => cache.put(key, copy));
    }
    return response;
  } catch (error) {
    const cached = await caches.match(key, { cacheName: PAGE_CACHE });
    if (cached) return cached;
    return offlinePage();
  }
}

/** A hashed build file never changes, so the cached copy is always right. */
async function buildFile(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const name = (await currentBuildCache()) ?? `${BUILD_CACHE_PREFIX}dev`;
    const copy = response.clone();
    caches.open(name).then((cache) => cache.put(request, copy));
  }
  return response;
}

/** A catalogue read: fresh when online, the last answer when not. */
async function catalog(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      caches.open(CATALOG_CACHE).then((cache) => cache.put(request.url, copy));
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request.url, { cacheName: CATALOG_CACHE, ignoreVary: true });
    if (cached) return cached;
    const list = await listFromCache(new URL(request.url));
    if (list) return list;
    throw error;
  }
}

/**
 * A game list nobody asked for while online, answered from the lists that were.
 *
 * The feed, Explore and a category page each ask for a different address
 * (`limit`, `sort`, `category`), and only an address that was read online has a
 * copy. Every list holds the same games in the same order, so the longest one
 * kept can answer any first page: filtered to the category asked for, cut to the
 * limit, with no next page. A search (`q`) or a later page (`cursor`) cannot be
 * answered that way, and stays an error.
 */
async function listFromCache(url) {
  if (!url.pathname.endsWith("/games")) return null;
  if (url.searchParams.get("q") || url.searchParams.get("cursor")) return null;
  const cache = await caches.open(CATALOG_CACHE);
  let items = null;
  for (const key of await cache.keys()) {
    const kept = new URL(key.url);
    if (kept.pathname !== url.pathname || kept.searchParams.get("q")) continue;
    if (kept.searchParams.get("cursor") || kept.searchParams.get("category")) continue;
    try {
      const body = await (await cache.match(key)).json();
      if (Array.isArray(body.items) && (!items || body.items.length > items.length)) {
        items = body.items;
      }
    } catch {
      // An unreadable copy: try the next.
    }
  }
  if (!items) return null;
  const category = url.searchParams.get("category");
  const limit = Number(url.searchParams.get("limit")) || items.length;
  const chosen = items
    .filter((game) => !category || game.category?.slug === category)
    .slice(0, limit);
  return new Response(JSON.stringify({ items: chosen, nextCursor: null }), {
    headers: { "content-type": "application/json" },
  });
}

/**
 * The page for an address that was never kept: what can still be played. It is
 * plain HTML with no script, so it needs no nonce and works without the app.
 */
async function offlinePage() {
  const games = await readOfflineGames();
  const items = games
    .map(
      (game) =>
        `<li><a href="/play/${encodeURIComponent(game.slug)}">${escapeHtml(game.title)}</a></li>`,
    )
    .join("");
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#16171b">
<title>Offline — Unbored</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #16171b; color: #f4f4f5; font: 16px/1.5 system-ui, sans-serif; }
  main { width: 100%; max-width: 24rem; padding: 2rem 1rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { color: #a1a1aa; font-size: .875rem; margin: 0 0 1.5rem; }
  ul { list-style: none; padding: 0; margin: 0; display: grid; gap: .5rem; }
  a { display: block; padding: .75rem 1rem; border-radius: .75rem; background: #232429;
    color: inherit; text-decoration: none; font-weight: 600; }
  a:focus-visible, a:hover { background: #2e2f35; }
</style>
</head>
<body>
<main>
  <h1>You're offline</h1>
  <p>${
    items
      ? "This page isn't saved on this device, but these games are. Offline runs are practice: they aren't ranked or saved."
      : "This page isn't saved on this device. Open Unbored once while online and its games will be ready to play offline."
  }</p>
  ${items ? `<ul>${items}</ul>` : ""}
</main>
</body>
</html>`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function readOfflineGames() {
  try {
    const response = await caches.match(OFFLINE_GAMES_KEY, { cacheName: PAGE_CACHE });
    return response ? await response.json() : [];
  } catch {
    return [];
  }
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

/**
 * `{ type: "warm", games: [{ slug, title }] }` from the app: keep the play page of
 * each game, so it opens offline even if the player never visited it.
 */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "warm" || !Array.isArray(data.games)) return;
  const games = data.games
    .filter((game) => game && typeof game.slug === "string" && typeof game.title === "string")
    .map((game) => ({ slug: game.slug, title: game.title }));
  event.waitUntil(warm(games));
});

async function warm(games) {
  const cache = await caches.open(PAGE_CACHE);
  await cache.put(
    OFFLINE_GAMES_KEY,
    new Response(JSON.stringify(games), { headers: { "content-type": "application/json" } }),
  );
  for (const game of games) {
    const path = `/play/${encodeURIComponent(game.slug)}`;
    try {
      const response = await fetch(path, { credentials: "same-origin" });
      if (response.ok) await cache.put(path, response);
    } catch {
      return; // The connection went: try again on the next visit.
    }
  }
}
