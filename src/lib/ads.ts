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
import { isIndexable } from "@/lib/seo";

export const ADSENSE_CLIENT = "ca-pub-4469987351010196";

/**
 * Whether Google ads may load on this screen.
 *
 * Google's publisher policies don't allow its ads on screens without publisher
 * content: sign-in and account forms, settings, messages, error and "not
 * found" pages, and the game screens themselves, where an ad next to the
 * controls invites accidental clicks. The screens that are content are exactly
 * the ones we let search engines index (`lib/seo.ts`), so ads follow that list,
 * minus any page that turned out to be missing or broken.
 *
 * Auto ads load once and then stay for the visit, so this decides on the
 * screen a visit starts on, and on later screens until it has loaded. A visit
 * that starts on a game screen gets no ads until the player reaches a content
 * page. Exclude the remaining screens in AdSense too (Auto ads → Page
 * exclusions), which covers overlay formats after a client-side navigation.
 */
export function adsAllowedOn(pathname: string, pageFailed = false): boolean {
  return !pageFailed && isIndexable(pathname);
}

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
