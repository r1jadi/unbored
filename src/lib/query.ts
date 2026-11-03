import { QueryClient } from "@tanstack/react-query";

/**
 * The app's data cache.
 *
 * Every public read (the catalogue, a game, a leaderboard, engagement counts) goes
 * through this client, so a screen the player has already seen opens instantly
 * from cache and refreshes quietly in the background instead of showing a
 * skeleton again.
 *
 *   - **staleTime** — data is treated as fresh for a short while, so moving
 *     between screens does not refetch what was just read.
 *   - **retry: false** — `apiFetch` already retries a cold gateway's 502/503/504
 *     for reads; retrying again here would multiply the wait on a real outage.
 *   - **refetchOnWindowFocus: false** — a game screen must not reshuffle under
 *     the player's thumb when they switch apps and come back.
 *   - **networkMode: offlineFirst** — a read is attempted even when the device
 *     reports no network, instead of pausing until it does. Offline, the service
 *     worker and the catalogue's own copy (`games/catalog-offline.ts`) answer
 *     what they can; anything else fails visibly rather than spinning forever.
 *
 * On the server a new client is made per request so no cache is ever shared
 * between visitors; in the browser there is exactly one, shared by the router
 * (which prefetches into it) and by every hook (which reads from it).
 */
const DEFAULTS = {
  queries: {
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    networkMode: "offlineFirst",
  },
} as const;

let browserClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return new QueryClient({ defaultOptions: DEFAULTS });
  browserClient ??= new QueryClient({ defaultOptions: DEFAULTS });
  return browserClient;
}

/** Whether this code is running in the browser, where prefetching makes sense. */
export const isBrowser = typeof window !== "undefined";
