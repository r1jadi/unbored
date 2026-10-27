/**
 * Product analytics (PostHog).
 *
 * Browser-only: PostHog is initialised after hydration and never during SSR.
 * The project key is a *public* ingestion key (`phc_...`), designed to ship in
 * the bundle like the Supabase publishable key. Without it every function here
 * is a no-op, so local development and tests send nothing.
 *
 * Page views are captured automatically on client-side navigation
 * (`defaults` turns on `capture_pageview: "history_change"`). Identity follows
 * the auth session: a signed-in user is identified by their account id only —
 * never by email — and signing out resets the anonymous id.
 */

import posthog from "posthog-js";

import { publicConfig } from "./config";

const { key, host } = publicConfig.posthog;

let initialized = false;

export function isAnalyticsEnabled(): boolean {
  return key !== "" && typeof window !== "undefined" && import.meta.env?.MODE !== "test";
}

export function initAnalytics(): void {
  if (initialized || !isAnalyticsEnabled()) return;
  initialized = true;
  posthog.init(key, {
    api_host: host,
    defaults: "2026-08-30",
    person_profiles: "identified_only",
    // Inputs can hold passwords, emails and usernames; recordings never see them.
    session_recording: { maskAllInputs: true },
  });
}

/** Ties subsequent events to an account. Call with the user id, never an email. */
export function identifyUser(userId: string, properties?: Record<string, unknown>): void {
  if (!initialized) return;
  if (posthog.get_distinct_id() === userId) return;
  posthog.identify(userId, properties);
}

/** Starts a fresh anonymous identity, e.g. after sign-out. */
export function resetAnalytics(): void {
  if (!initialized) return;
  posthog.reset();
}

export function track(event: string, properties?: Record<string, unknown>): void {
  if (!initialized) return;
  posthog.capture(event, properties);
}
