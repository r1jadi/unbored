/**
 * Web push on this device: the browser's subscription, and the account it belongs to.
 *
 * Whether a notification is wanted is decided on the server by the toggles in
 * Settings. This is only the per-device choice. The subscription itself lives in the
 * browser, so what the browser says is the truth about whether this device is on;
 * the server's copy (`push_subscriptions`) is what lets it send here.
 *
 * Signing out unsubscribes the browser, so a shared device stops showing the previous
 * player's notifications even if the server can't be reached. The server's row dies
 * the next time it tries to send, when the push service answers that it's gone.
 */

import { getAccessToken, getAuthState, subscribe as subscribeToAuth } from "@/lib/auth/session";
import { publicConfig } from "@/lib/config";
import { currentLanguage, t } from "@/lib/settings/language";
import { restMutate } from "@/lib/supabase/rest";

export type PushStatus =
  /** Can't be used here, and nothing the player does in the app changes that. */
  | "unsupported"
  /** iPhone and iPad only offer push once the app is on the Home Screen. */
  | "needs-install"
  /** This deployment has no VAPID key. */
  | "unconfigured"
  /** The player blocked notifications for this site in the browser. */
  | "denied"
  | "off"
  | "on";

/** The service worker is production-only, and `ready` never settles without one. */
const WORKER_TIMEOUT_MS = 4000;

function isAppleMobile(): boolean {
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac, but no Mac has a touch screen.
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

function isInstalled(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function hasPushApis(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function workerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), WORKER_TIMEOUT_MS)),
  ]);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await workerRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

export async function readPushStatus(): Promise<PushStatus> {
  if (typeof window === "undefined") return "unsupported";
  // Checked first: Safari on iOS has no push APIs until the app is installed, and
  // "add to Home Screen" is a more useful answer than "not supported".
  if (isAppleMobile() && !isInstalled()) return "needs-install";
  if (!hasPushApis()) return "unsupported";
  if (publicConfig.push.vapidPublicKey === "") return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  return (await currentSubscription()) ? "on" : "off";
}

/** A VAPID key arrives as base64url; the browser wants the raw bytes. */
export function vapidKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const standard = key.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard.padEnd(standard.length + ((4 - (standard.length % 4)) % 4), "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function saveSubscription(subscription: PushSubscription, token: string): Promise<void> {
  const { endpoint, keys } = subscription.toJSON();
  await restMutate("rpc/register_push_subscription", "POST", token, {
    p_endpoint: endpoint,
    p_p256dh: keys?.["p256dh"],
    p_auth: keys?.["auth"],
    p_language: currentLanguage() === "sq" ? "sq" : "en",
  });
}

/**
 * Turns push on for this device. Call it from a tap: browsers refuse the permission
 * prompt otherwise. Answers the resulting status rather than throwing when the
 * player says no, because declining is a choice and not an error.
 */
export async function enablePush(): Promise<PushStatus> {
  const token = getAccessToken();
  if (!token || getAuthState().status !== "authenticated") {
    throw new Error(t("Sign in to turn on push notifications."));
  }
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "off";

  const registration = await workerRegistration();
  if (!registration) throw new Error(t("Couldn't turn on push notifications. Try again."));

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyBytes(publicConfig.push.vapidPublicKey),
    }));
  try {
    await saveSubscription(subscription, token);
  } catch {
    // On in the browser but unknown to the server would look on and never deliver.
    await subscription.unsubscribe().catch(() => undefined);
    throw new Error(t("Couldn't turn on push notifications. Try again."));
  }
  return "on";
}

/** Turns push off for this device. The browser is what stops the notifications. */
export async function disablePush(): Promise<PushStatus> {
  const subscription = await currentSubscription();
  if (!subscription) return "off";
  const token = getAccessToken();
  if (token) {
    // Best effort: a row left behind is removed the next time a send to it fails.
    await restMutate("rpc/unregister_push_subscription", "POST", token, {
      p_endpoint: subscription.endpoint,
    }).catch(() => undefined);
  }
  await subscription.unsubscribe();
  return "off";
}

let started = false;

/**
 * Keeps this device's subscription matched to the account, once per app load:
 *   - signed in with a subscription: tell the server, which also picks up a changed
 *     language, a browser-replaced subscription and a new player on a shared browser;
 *   - signed out: unsubscribe.
 */
export function startPushSync(): void {
  if (started || !hasPushApis()) return;
  started = true;

  let syncedUser: string | undefined;
  let wasSignedIn = false;

  const sync = () => {
    const auth = getAuthState();
    if (auth.status === "authenticated") {
      wasSignedIn = true;
      // Once per account: the session also publishes each time its token refreshes.
      if (syncedUser === auth.session.userId) return;
      syncedUser = auth.session.userId;
      const token = getAccessToken();
      void currentSubscription()
        .then((subscription) =>
          subscription && token ? saveSubscription(subscription, token) : undefined,
        )
        .catch(() => undefined);
    } else if (auth.status === "anonymous" && wasSignedIn) {
      // Only on a real sign-out: every page load starts out anonymous for a moment.
      wasSignedIn = false;
      syncedUser = undefined;
      void currentSubscription()
        .then((subscription) => subscription?.unsubscribe())
        .catch(() => undefined);
    }
  };

  sync();
  subscribeToAuth(sync);
}
