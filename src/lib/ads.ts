/**
 * Google AdSense, loaded on the client only.
 *
 * It is never in the server-rendered `<head>`: auto ads insert `<ins>` nodes
 * into the page, and doing that before React hydrates makes every page fail
 * hydration and re-render from scratch. Loading it from an effect means the
 * tree is already hydrated when the ads arrive.
 *
 * It loads for every visitor. Consent for ads is Google's to ask: its
 * certified consent message (AdSense → Privacy & messaging) asks visitors in
 * the EEA, the UK and Switzerland, and serves limited ads to those who say
 * no. Our own cookie choice (`lib/consent.ts`) covers analytics only.
 *
 * Under the CSP's `'strict-dynamic'` a script added by our own (nonced)
 * bundle is trusted, so no nonce is needed.
 */
export const ADSENSE_CLIENT = "ca-pub-4469987351010196";

const ADSENSE_SRC = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;

let requested = false;

export function loadAdSense(): void {
  if (requested || typeof document === "undefined") return;
  requested = true;
  const script = document.createElement("script");
  script.src = ADSENSE_SRC;
  script.async = true;
  script.crossOrigin = "anonymous";
  document.head.appendChild(script);
}
