/**
 * Offline support: registers the service worker (`public/sw.js`) and keeps every
 * playable game ready to open without a connection.
 *
 * Registration is production-only: the dev server serves source modules that
 * change on every edit, and a worker holding on to them would only get in the way.
 *
 * Warming asks the worker to keep the play page of every playable game, and reads
 * each game's catalogue entry through it so the worker keeps that too. It runs at
 * most once a day per device, after the page has settled, and only online.
 */

import { useSyncExternalStore } from "react";

import { fetchCategories, fetchGame, fetchGames, MAX_PAGE_SIZE } from "@/lib/games/catalog";

const WARMED_AT_KEY = "unbored:offline-warmed-at";
const WARM_EVERY_MS = 24 * 60 * 60 * 1000;
const WARM_DELAY_MS = 5000;

let registered = false;

export function registerServiceWorker(): void {
  if (registered || !import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  registered = true;
  navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then(() => navigator.serviceWorker.ready)
    .then((registration) => {
      setTimeout(() => void warm(registration), WARM_DELAY_MS);
    })
    .catch(() => undefined);
}

async function warm(registration: ServiceWorkerRegistration): Promise<void> {
  if (!navigator.onLine || !registration.active) return;
  if (Date.now() - readWarmedAt() < WARM_EVERY_MS) return;
  try {
    const list = await fetchGames({ limit: MAX_PAGE_SIZE });
    const games = list.items.filter((game) => game.playable && game.runtime);
    // Read through the worker, which keeps each answer for offline use.
    await Promise.all([
      fetchCategories().catch(() => undefined),
      ...games.map((game) => fetchGame(game.slug).catch(() => undefined)),
    ]);
    registration.active.postMessage({
      type: "warm",
      games: games.map((game) => ({ slug: game.slug, title: game.title })),
    });
    writeWarmedAt(Date.now());
  } catch {
    // Offline or the catalogue is down: try again on the next visit.
  }
}

function readWarmedAt(): number {
  try {
    return Number(localStorage.getItem(WARMED_AT_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeWarmedAt(value: number): void {
  try {
    localStorage.setItem(WARMED_AT_KEY, String(value));
  } catch {
    // Storage blocked: warming simply runs again next visit.
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Whether the browser reports a network. Always true during SSR. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
