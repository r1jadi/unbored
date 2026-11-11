/**
 * When to ask for the home-screen install and for push: after a player's third
 * finished game, never on arrival.
 *
 * A browser that can install the app fires `beforeinstallprompt` on its own, and
 * left alone Chrome shows its install bar the moment someone lands. That event is
 * held here instead (`startInstallCapture`), and offered back on a result screen
 * once the player has finished three games on this device, by which point they
 * know whether they like it. Push is offered at the same moment, because it is
 * the same question: "keep Unbored close".
 *
 * "Not now" puts the question away for ten more games; a second "Not now" puts it
 * away for good on this device. Settings still has the push switch.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/lib/auth/session";
import { enablePush, readPushStatus, type PushStatus } from "@/lib/notifications/push";
import { safeLocalStorage } from "@/lib/storage";

/** Finished games before the first ask. */
export const ASK_AFTER_GAMES = 3;
/** Games a "Not now" waits before asking once more. */
export const ASK_AGAIN_AFTER_GAMES = 10;

const FINISHED_KEY = "unbored-games-finished";
const DISMISSED_KEY = "unbored-install-ask-dismissed";

/** The event Chromium browsers fire when the page can be installed. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function readNumber(key: string): number {
  const value = Number(safeLocalStorage()?.getItem(key) ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function writeNumber(key: string, value: number): void {
  try {
    safeLocalStorage()?.setItem(key, String(value));
  } catch {
    // Best effort: without storage the ask simply comes later or not at all.
  }
}

/**
 * Holds the browser's install prompt back from the moment the app starts. Called
 * once, early, from the root, so the event is never missed.
 */
export function startInstallCapture(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    notify();
  });
}

/** Counts a finished game on this device. Called once per verified run. */
export function noteGameFinished(): void {
  writeNumber(FINISHED_KEY, readNumber(FINISHED_KEY) + 1);
  notify();
}

export function gamesFinished(): number {
  return readNumber(FINISHED_KEY);
}

function isStandalone(): boolean {
  return (
    installed ||
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isAppleMobile(): boolean {
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

/**
 * Whether the ask is due by the count alone: three games finished, and any "Not
 * now" has waited out its ten games (a second one is final). The dismissal is stored
 * as the game count it happened at, negated once it is final.
 */
export function askDue(finished: number, dismissedAt: number | null): boolean {
  if (finished < ASK_AFTER_GAMES) return false;
  if (dismissedAt === null) return true;
  if (dismissedAt < 0) return false;
  return finished >= dismissedAt + ASK_AGAIN_AFTER_GAMES;
}

function readDismissed(): number | null {
  const raw = safeLocalStorage()?.getItem(DISMISSED_KEY);
  if (raw === null || raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What the result screen can offer right now, and the taps that do it. */
export type InstallAsk = {
  /** Install from the browser's own prompt (Chrome, Edge, Android). */
  canInstall: boolean;
  /** iPhone and iPad: no prompt to call, so the screen says how. */
  installSteps: boolean;
  /** Push can be turned on from a tap here. */
  canPush: boolean;
  install: () => Promise<void>;
  turnOnPush: () => Promise<PushStatus>;
  dismiss: () => void;
};

/**
 * The ask for this result screen, or null when nothing is due or nothing can be
 * offered. Read after mounting: the server render knows nothing of this device.
 */
export function useInstallAsk(): InstallAsk | null {
  const signedIn = useAuth().status === "authenticated";
  // Re-render when the prompt arrives, the app is installed or a game is counted.
  const version = useSyncExternalStore(
    subscribe,
    () => `${deferred ? 1 : 0}${installed ? 1 : 0}${gamesFinished()}`,
    () => "",
  );
  const [push, setPush] = useState<PushStatus | null>(null);
  const [dismissed, setDismissed] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    setDismissed(readDismissed());
    let live = true;
    void readPushStatus()
      .then((status) => live && setPush(status))
      .catch(() => live && setPush("unsupported"));
    return () => {
      live = false;
    };
  }, [version]);

  const install = useCallback(async () => {
    const event = deferred;
    if (!event) return;
    deferred = null;
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") installed = true;
    notify();
  }, []);

  const turnOnPush = useCallback(async () => {
    const status = await enablePush();
    setPush(status);
    return status;
  }, []);

  const dismiss = useCallback(() => {
    // The first "Not now" remembers the game count; the second is final (-1).
    const next = readDismissed() === null ? gamesFinished() : -1;
    try {
      safeLocalStorage()?.setItem(DISMISSED_KEY, String(next));
    } catch {
      // Best effort: without storage the ask only stays away for this screen.
    }
    setDismissed(next);
  }, []);

  if (typeof window === "undefined" || dismissed === undefined || push === null) return null;
  if (!askDue(gamesFinished(), dismissed)) return null;

  const standalone = isStandalone();
  const canInstall = !standalone && deferred !== null;
  const installSteps = !standalone && !canInstall && isAppleMobile();
  // Push needs an account to send to, and on iPhone it needs the install first.
  const canPush = signedIn && push === "off";
  if (!canInstall && !installSteps && !canPush) return null;
  return { canInstall, installSteps, canPush, install, turnOnPush, dismiss };
}
