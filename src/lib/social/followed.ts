import { useEffect, useState } from "react";

import { fetchProfilesByIds, listFollowees } from "@/lib/social/follows";

/** How many rows of the global board the following view looks through. */
export const FOLLOWING_SCAN = 100;

export type FollowedState =
  | { status: "loading" }
  | { status: "ready"; usernames: Set<string>; following: number; me: string | undefined }
  | { status: "error" };

/** The usernames of the signed-in player and everyone they follow. */
export function useFollowedUsernames(
  userId: string | undefined,
): FollowedState & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<FollowedState>({ status: "loading" });

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setState({ status: "loading" });
    listFollowees(userId)
      .then(async (ids) => {
        const profiles = await fetchProfilesByIds([userId, ...ids]);
        if (cancelled) return;
        setState({
          status: "ready",
          usernames: new Set(profiles.map((profile) => profile.username)),
          following: ids.length,
          // Your own username, read alongside: no separate profile request.
          me: profiles.find((profile) => profile.id === userId)?.username,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
