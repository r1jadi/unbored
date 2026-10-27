import { publicConfig } from "./config";

/**
 * Request header that carries the per-request CSP nonce from the server entry
 * (`src/server.ts`) to the router (`src/router.tsx`), which stamps it on every
 * script TanStack renders: hydration data, stream boundaries and the module
 * entry. The server entry always overwrites it, so a client cannot choose it.
 */
export const CSP_NONCE_HEADER = "x-unbored-csp-nonce";

/** 128 random bits, base64 — the size the CSP spec recommends. */
export function createCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * The policy for rendered documents.
 *
 * Scripts: only those carrying this response's nonce, plus whatever they load
 * (`'strict-dynamic'`), so an injected `<script>` cannot run. `'self'` is a
 * fallback for browsers without `'strict-dynamic'` support.
 *
 * Styles allow inline: SSR renders `style` attributes and the chart component
 * injects a `<style>` element. Inline CSS cannot execute code, so this is the
 * accepted trade-off; scripts are where the policy is strict.
 *
 * The browser talks to this origin (the API is same-origin by default), to
 * Supabase directly (auth, storage, avatars) and, when configured, to PostHog
 * (event ingestion, plus the extension scripts it loads from its assets host),
 * so those are the only connections allowed.
 */
export function contentSecurityPolicy(nonce: string): string {
  const supabase = originOf(publicConfig.supabase.url);
  const api = originOf(publicConfig.apiBaseUrl);

  const connect = new Set(["'self'"]);
  if (supabase) {
    connect.add(supabase);
    connect.add(supabase.replace(/^http/, "ws"));
  }
  if (api) connect.add(api);
  const posthog = publicConfig.posthog.key ? originOf(publicConfig.posthog.host) : undefined;
  if (posthog) {
    connect.add(posthog);
    // https://us.i.posthog.com → https://us-assets.i.posthog.com
    connect.add(posthog.replace(/:\/\/(\w+)\.i\.posthog\.com$/, "://$1-assets.i.posthog.com"));
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src ${[...connect].join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}
