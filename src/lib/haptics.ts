/**
 * Haptic feedback for game moves, through the Vibration API.
 *
 * On by default, remembered on this device, and independent of sound: plenty of
 * people play muted and still want to feel a move land. The API exists on Android
 * browsers but not on iOS Safari, so `hapticsSupported()` is how Settings knows
 * whether to offer the switch at all. Everywhere it is missing, every call is a no-op.
 *
 * Reduced motion counts: someone who asked for less on the screen hasn't asked for
 * more in their hand, so that preference turns these off too.
 */

import { useSyncExternalStore } from "react";

import type { SoundCue } from "@/lib/sound";
import { safeLocalStorage } from "@/lib/storage";

const STORAGE_KEY = "unbored-haptics";

/** Milliseconds of vibration, then of rest, alternating. */
const PATTERNS: Record<SoundCue, number | number[]> = {
  tap: 8,
  score: 15,
  clear: [20, 40, 30],
  error: [40, 30, 40],
  win: [25, 40, 25, 40, 60],
  lose: 120,
  stop: 20,
};

const listeners = new Set<() => void>();
let enabled: boolean | null = null;

function readEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = safeLocalStorage()?.getItem(STORAGE_KEY) !== "off";
    } catch {
      enabled = true;
    }
  }
  return enabled;
}

export function hapticsSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function setHapticsEnabled(next: boolean): void {
  enabled = next;
  try {
    safeLocalStorage()?.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {
    // Best effort: the choice still holds for this visit.
  }
  for (const listener of listeners) listener();
  if (next) playHaptic("tap");
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHapticsEnabled(): [boolean, (next: boolean) => void] {
  const on = useSyncExternalStore(subscribe, readEnabled, () => true);
  return [on, setHapticsEnabled];
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

export function playHaptic(cue: SoundCue): void {
  if (!readEnabled() || !hapticsSupported() || prefersReducedMotion()) return;
  try {
    navigator.vibrate(PATTERNS[cue]);
  } catch {
    // Feedback is never worth an error.
  }
}
