/**
 * Keeps the server's copy of the player's time zone current
 * (`user_preferences.time_zone`, via `set_my_time_zone`). The daily games send the
 * zone with each request; the things the server does on its own — the weekly recap,
 * the evening streak reminder — need it stored. Saved once per account and zone on
 * this device, so a page load doesn't write it again, but travelling does.
 */

import { getAccessToken, getAuthState, subscribe as subscribeToAuth } from "@/lib/auth/session";
import { safeLocalStorage } from "@/lib/storage";
import { restMutate } from "@/lib/supabase/rest";
import { deviceTimeZone } from "@/lib/time-zone";

const SAVED_KEY = "unbored-time-zone-saved";

let started = false;

export function startTimeZoneSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  const sync = () => {
    const auth = getAuthState();
    const token = getAccessToken();
    if (auth.status !== "authenticated" || !token) return;
    const zone = deviceTimeZone();
    const marker = `${auth.session.userId}:${zone}`;
    const storage = safeLocalStorage();
    if (storage?.getItem(SAVED_KEY) === marker) return;
    void restMutate("rpc/set_my_time_zone", "POST", token, { p_time_zone: zone })
      .then(() => {
        try {
          storage?.setItem(SAVED_KEY, marker);
        } catch {
          // Best effort: it is simply saved again next time.
        }
      })
      // Until the migration is applied the call fails; nothing else depends on it.
      .catch(() => undefined);
  };

  sync();
  subscribeToAuth(sync);
}
