import type { ReactNode } from "react";

import { useAuth } from "@/lib/auth/session";

/**
 * Guest wording for a signed-out player, and `signedIn` for anyone else.
 *
 * An unranked run is not the same as a guest run: a signed-in player's practice,
 * unlimited or archive runs are unranked too, and must never be called guest
 * runs. While a saved session is still being restored, the neutral wording shows.
 */
export function GuestOr({ children, signedIn }: { children: ReactNode; signedIn: ReactNode }) {
  return useAuth().status === "anonymous" ? children : signedIn;
}
