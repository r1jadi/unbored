/**
 * Cookie consent: whether this browser lets Unbored run analytics.
 *
 * Two kinds of storage exist. **Essential** ones are what the app cannot work
 * without and are always on: the sign-in session, the language cookie, settings
 * kept on the device and the offline copies of the app and catalogue.
 * **Analytics** (PostHog, which sets cookies, and Vercel Analytics) is optional
 * and only starts once the visitor accepts it — `lib/analytics.ts` and the root
 * route ask here first.
 *
 * The choice is kept in `localStorage` for this browser only. Until one is made
 * the answer is "not decided", which counts as no, and the cookie pop-up asks.
 * The server never knows the choice, so it always renders as "not decided" and
 * the pop-up appears after hydration.
 */

import { useSyncExternalStore } from "react";

import { safeLocalStorage } from "@/lib/storage";

const KEY = "unbored:consent";
const VERSION = 1;

export type Consent = { analytics: boolean; decidedAt: string };

const listeners = new Set<() => void>();
let cached: Consent | null | undefined;

function readStored(): Consent | null {
  try {
    const raw = safeLocalStorage()?.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { v?: number; analytics?: unknown; decidedAt?: unknown };
    if (value.v !== VERSION || typeof value.analytics !== "boolean") return null;
    return { analytics: value.analytics, decidedAt: String(value.decidedAt ?? "") };
  } catch {
    return null;
  }
}

/** The choice this browser made, or null when it has not made one. */
export function getConsent(): Consent | null {
  if (cached === undefined) cached = readStored();
  return cached;
}

function publish(next: Consent | null): void {
  cached = next;
  for (const listener of listeners) listener();
}

/** Records the visitor's choice. */
export function setConsent(analytics: boolean): void {
  const next = { analytics, decidedAt: new Date().toISOString() };
  try {
    safeLocalStorage()?.setItem(KEY, JSON.stringify({ v: VERSION, ...next }));
  } catch {
    // Storage blocked: the choice holds for this visit.
  }
  publish(next);
}

/** Forgets the choice, so the pop-up asks again (Settings → Privacy). */
export function resetConsent(): void {
  try {
    safeLocalStorage()?.removeItem(KEY);
  } catch {
    // Nothing stored to forget.
  }
  publish(null);
}

export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The choice, reactively. `undefined` while rendering on the server or
 * hydrating — the server cannot know it — then the browser's choice or null.
 */
export function useConsent(): Consent | null | undefined {
  return useSyncExternalStore(subscribeConsent, getConsent, () => undefined);
}
