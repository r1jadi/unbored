/**
 * Who the share sheet offers to send to: recent chats first, then friends (people who
 * follow each other), who are who can message by default. It is only a shortlist, and
 * sending still goes through `send_direct_message`, which has the final say.
 */

import { useEffect, useState } from "react";

import { getSessionUserId } from "@/lib/auth/session";
import { fetchInbox } from "@/lib/messages/store";
import { fetchProfilesByIds, listFollowees, listFollowers } from "@/lib/social/follows";

export type ShareTarget = {
  id: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
};

const MAX_TARGETS = 20;

export async function fetchShareTargets(): Promise<ShareTarget[]> {
  const me = getSessionUserId();
  if (!me) return [];

  // Either half failing still leaves the other half to offer.
  const [inbox, followees, followers] = await Promise.allSettled([
    fetchInbox(),
    listFollowees(me),
    listFollowers(me),
  ]);

  const targets = new Map<string, ShareTarget>();
  if (inbox.status === "fulfilled") {
    for (const entry of inbox.value) {
      targets.set(entry.otherId, {
        id: entry.otherId,
        username: entry.username,
        displayName: entry.displayName,
        avatarPath: entry.avatarPath,
      });
    }
  }

  if (followees.status === "fulfilled" && followers.status === "fulfilled") {
    const following = new Set(followees.value);
    const friends = followers.value.filter((id) => following.has(id) && !targets.has(id));
    const room = MAX_TARGETS - targets.size;
    if (friends.length > 0 && room > 0) {
      const profiles = await fetchProfilesByIds(friends.slice(0, room)).catch(() => []);
      for (const profile of profiles) {
        targets.set(profile.id, {
          id: profile.id,
          username: profile.username,
          displayName: profile.display_name,
          avatarPath: profile.avatar_path,
        });
      }
    }
  }

  return [...targets.values()].slice(0, MAX_TARGETS);
}

/** Loaded when the sheet opens, and not before: most feed cards are never shared. */
export function useShareTargets(open: boolean): {
  targets: ShareTarget[];
  loading: boolean;
} {
  const [targets, setTargets] = useState<ShareTarget[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !getSessionUserId()) return;
    let cancelled = false;
    setLoading(true);
    fetchShareTargets()
      .then((next) => {
        if (!cancelled) setTargets(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return { targets, loading };
}
