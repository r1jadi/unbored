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

/** Hosts Google AdSense reports to and serves its ad iframes from. */
const ADSENSE_HOSTS = [
  "https://*.googlesyndication.com",
  "https://*.doubleclick.net",
  "https://*.google.com",
  "https://*.adtrafficquality.google",
  "https://*.gstatic.com",
];

/**
 * The policy for rendered documents.
 *
 * Scripts: only those carrying this response's nonce, plus whatever they load
 * (`'strict-dynamic'`), so an injected `<script>` cannot run. `'self'` is a
 * fallback for browsers without `'strict-dynamic'` support.
 *
 * Styles are split. `<style>` elements need this response's nonce
 * (`style-src-elem`), so markup injected into the page cannot bring its own
 * stylesheet. Libraries that add `<style>` at runtime (sonner, vaul, Radix's
 * scroll lock, the chart) get the nonce from `STYLE_NONCE_BOOT_SCRIPT`.
 * `style` attributes stay allowed (`style-src-attr`): SSR renders them on
 * every page, and an attribute cannot load anything or run code. `style-src`
 * keeps `'unsafe-inline'` only as the fallback for browsers that predate the
 * split directives; browsers that know them ignore it.
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

  for (const host of ADSENSE_HOSTS) connect.add(host);

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    `style-src-elem 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src ${[...connect].join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    `frame-src ${ADSENSE_HOSTS.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * Runs first in `<head>`, carrying the response nonce, and stamps that nonce on
 * every `<style>` element created through `document.createElement`. Libraries
 * that insert their CSS at runtime do it that way and know nothing about CSP.
 *
 * This does not widen the policy for an attacker: script is already nonce-only,
 * so nothing an attacker injects can call `createElement`, and a `<style>` in
 * injected markup is parsed, not created, so it still has no nonce.
 */
export const STYLE_NONCE_BOOT_SCRIPT = `(function(){var s=document.currentScript,n=s&&s.nonce;if(!n)return;var c=Document.prototype.createElement;Document.prototype.createElement=function(t){var e=c.apply(this,arguments);if(typeof t==="string"&&t.toLowerCase()==="style"){e.setAttribute("nonce",n)}return e}})()`;
