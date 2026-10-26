import { useEffect, useRef } from "react";

/**
 * Tapping Home (or For You) while already on the feed: back to the top, and a
 * fresh read of the catalogue — what every feed app does with its home tab.
 *
 * The links that ask for it live in the navigation, far from the feed's scroller
 * and its query, so the request travels as a window event rather than through
 * props. A link elsewhere in the app just navigates; this is only for a tap on
 * the screen the player is already on.
 */
const EVENT = "unbored:feed-refresh";

export function requestFeedRefresh(): void {
  window.dispatchEvent(new Event(EVENT));
}

/** Runs `handler` whenever a feed refresh is requested. */
export function useFeedRefresh(handler: () => void): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const listener = () => latest.current();
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
  }, []);
}
