/**
 * Optional New Year's theme. Off unless the player turns it on in Appearance; it
 * layers a midnight-and-gold palette over whichever of dark or light is in force
 * (`.theme-new-year` on `<html>`, styled in styles.css) and persists per browser.
 */

import { useEffect, useState } from "react";

import { safeLocalStorage } from "@/lib/storage";

const STORAGE_KEY = "unbored-new-year-theme";
const CLASS_NAME = "theme-new-year";

function readStored(): boolean {
  try {
    return safeLocalStorage()?.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function apply(on: boolean): void {
  document.documentElement.classList.toggle(CLASS_NAME, on);
}

/**
 * Adds the class before the first paint so a saved choice never flashes the
 * plain palette. It runs ahead of the app, so it repeats `readStored` by hand.
 */
export const NEW_YEAR_BOOT_SCRIPT = `(function(){try{document.documentElement.classList.toggle(${JSON.stringify(CLASS_NAME)},localStorage.getItem(${JSON.stringify(STORAGE_KEY)})==="on")}catch(e){}})()`;

/** Applies the saved choice to the document. Called once as the app starts. */
export function restoreNewYearTheme(): void {
  apply(readStored());
}

export function useNewYearTheme(): [boolean, (next: boolean) => void] {
  // Read after mounting so hydration matches the server render.
  const [on, setOnState] = useState(false);

  useEffect(() => {
    setOnState(readStored());
  }, []);

  function setOn(next: boolean): void {
    setOnState(next);
    try {
      if (next) localStorage.setItem(STORAGE_KEY, "on");
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Best effort; the live document still updates.
    }
    apply(next);
  }

  return [on, setOn];
}
