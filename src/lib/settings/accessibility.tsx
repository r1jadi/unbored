/**
 * Real accessibility preferences. Each toggle changes the interface and
 * persists; controls that would do nothing are not rendered.
 */

import { useEffect, useState } from "react";

import { readWithLegacy, safeLocalStorage } from "@/lib/storage";

export type AccessibilityPrefs = {
  reduceMotion: boolean;
  largerText: boolean;
  increaseContrast: boolean;
};

const STORAGE_KEY = "unbored-accessibility";
/** Pre-rename key: read once and moved forward by `readWithLegacy`. */
const LEGACY_STORAGE_KEY = "onemore-accessibility";

const defaults: AccessibilityPrefs = {
  reduceMotion: false,
  largerText: false,
  increaseContrast: false,
};

function readStored(): AccessibilityPrefs {
  const raw = readWithLegacy(safeLocalStorage(), STORAGE_KEY, LEGACY_STORAGE_KEY);
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Partial<AccessibilityPrefs>;
    return {
      reduceMotion: parsed.reduceMotion === true,
      largerText: parsed.largerText === true,
      increaseContrast: parsed.increaseContrast === true,
    };
  } catch {
    return defaults;
  }
}

/**
 * The preferences in force: what the player saved, or until they have chosen, the
 * defaults with the OS's reduce-motion setting respected. A choice saved before
 * the rename counts as a choice, so it is read (and moved forward) by `readStored`
 * rather than mistaken for "never chose".
 */
function currentPrefs(): AccessibilityPrefs {
  if (typeof window === "undefined") return defaults;
  if (readWithLegacy(safeLocalStorage(), STORAGE_KEY, LEGACY_STORAGE_KEY)) return readStored();
  try {
    return {
      ...defaults,
      reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
  } catch {
    return defaults;
  }
}

/** Whether motion should be held still right now. */
export function motionIsReduced(): boolean {
  return currentPrefs().reduceMotion;
}

/**
 * Sets the preferences on the document before the first paint, so a saved larger
 * text size never shows the page at the smaller one first. It runs ahead of the
 * app, so it cannot import anything and repeats `currentPrefs` by hand;
 * `accessibility.test.ts` holds the two to the same answers. If it cannot run or
 * trips over something unusual, `restoreAccessibility` still applies them once
 * the app starts.
 */
export const ACCESSIBILITY_BOOT_SCRIPT = `(function(){try{var s=localStorage,r=s.getItem(${JSON.stringify(STORAGE_KEY)})||s.getItem(${JSON.stringify(LEGACY_STORAGE_KEY)}),p=r?JSON.parse(r):{reduceMotion:matchMedia("(prefers-reduced-motion: reduce)").matches},c=document.documentElement.classList;c.toggle("a11y-reduce-motion",p.reduceMotion===true);c.toggle("a11y-larger-text",p.largerText===true);c.toggle("a11y-contrast",p.increaseContrast===true)}catch(e){}})()`;

/** Applies the preferences in force to the document. Called once as the app starts. */
export function restoreAccessibility(): void {
  apply(currentPrefs());
}

function apply(prefs: AccessibilityPrefs): void {
  const root = document.documentElement;
  root.classList.toggle("a11y-reduce-motion", prefs.reduceMotion);
  root.classList.toggle("a11y-larger-text", prefs.largerText);
  root.classList.toggle("a11y-contrast", prefs.increaseContrast);
}

export function useAccessibility(): {
  prefs: AccessibilityPrefs;
  setPrefs: (next: AccessibilityPrefs) => void;
} {
  // Read after mounting: hydration keeps what the server drew, which knows nothing
  // of this browser, so reading any earlier leaves the switches showing "off".
  const [prefs, setPrefsState] = useState<AccessibilityPrefs>(defaults);

  useEffect(() => {
    setPrefsState(currentPrefs());
  }, []);

  function setPrefs(next: AccessibilityPrefs): void {
    setPrefsState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Best effort.
    }
    apply(next);
  }

  return { prefs, setPrefs };
}
