/**
 * Links to Unbored itself inside a chat. A message that is nothing but a link to a game
 * is drawn as that game's card. Everything else stays text, with only links to this site
 * clickable, so a chat from a stranger can't be a way to deliver a phishing link.
 */

import { SITE_URL } from "@/lib/seo";

const GAME_PATH = /^\/games\/([a-z0-9-]{2,48})\/?$/;

/** The path of a link to this site, or `null` for anywhere else. */
export function ownPath(link: string): string | null {
  try {
    const url = new URL(link);
    const own = [new URL(SITE_URL).origin];
    if (typeof window !== "undefined") own.push(window.location.origin);
    return own.includes(url.origin) ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
}

/** The game a message shares, when the whole message is a link to one. */
export function sharedGameSlug(body: string): string | null {
  const text = body.trim();
  if (!/^https?:\/\/\S+$/.test(text)) return null;
  const path = ownPath(text);
  return path?.match(GAME_PATH)?.[1] ?? null;
}
