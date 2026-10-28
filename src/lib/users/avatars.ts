/**
 * Profile pictures for any account, by username.
 *
 * Most lists that show a player — leaderboards, search, follower lists, the admin
 * console — know the username and not the picture. Rather than every one of them
 * growing its own profile read, they ask here: lookups made in the same tick are
 * batched into one `profiles` read, and the answer is cached for the page's life,
 * so a leaderboard of twenty rows costs one request and a second visit costs none.
 *
 * The cache holds the storage path, not the URL, because that is what the
 * database stores; `avatarUrlFromPath` turns it into the public URL.
 */

import { useEffect, useState } from "react";

import { restGet } from "@/lib/supabase/rest";

/** username → avatar path; `null` means the account has no picture (or no row). */
const cache = new Map<string, string | null>();
const waiting = new Set<string>();
const listeners = new Set<() => void>();
let scheduled = false;

function key(username: string): string {
  return username.trim().toLowerCase();
}

function notify(): void {
  for (const listener of listeners) listener();
}

async function flush(): Promise<void> {
  scheduled = false;
  const names = [...waiting];
  waiting.clear();
  if (names.length === 0) return;
  // PostgREST's `in` list: quoted, so a username is never read as syntax.
  const list = names.map((name) => `"${name.replace(/"/g, "")}"`).join(",");
  try {
    const rows = await restGet<{ username: string; avatar_path: string | null }[]>(
      `profiles?username=in.(${encodeURIComponent(list)})&select=username,avatar_path`,
    );
    const found = new Map(rows.map((row) => [key(row.username), row.avatar_path]));
    for (const name of names) cache.set(name, found.get(name) ?? null);
  } catch {
    // A failed read leaves these names unknown, so a later screen tries again;
    // until then the initials stand in, as they do for an account with no picture.
    return;
  }
  notify();
}

function request(username: string): void {
  const name = key(username);
  if (name === "" || cache.has(name) || waiting.has(name)) return;
  waiting.add(name);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(() => void flush());
  }
}

/**
 * Records an account's picture the app already knows — a profile row it read, or
 * the caller's own picture right after they change it — so no lookup is needed
 * and no screen shows a stale one.
 */
export function rememberAvatar(username: string, path: string | null | undefined): void {
  const name = key(username);
  if (name === "") return;
  const next = path ?? null;
  if (cache.get(name) === next) return;
  cache.set(name, next);
  notify();
}

/**
 * The avatar path for `username`: `known` when the caller already has it (a
 * string, or `null` for "no picture"), otherwise looked up and cached. Returns
 * `undefined` while unknown.
 */
export function useAvatarPath(
  username: string | undefined,
  known?: string | null,
): string | null | undefined {
  const name = username ? key(username) : "";
  const [, rerender] = useState(0);

  useEffect(() => {
    if (known !== undefined || name === "") return;
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    request(name);
    return () => {
      listeners.delete(listener);
    };
  }, [name, known]);

  if (known !== undefined) return known;
  return name === "" ? undefined : cache.get(name);
}
