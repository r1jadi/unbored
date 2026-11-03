/**
 * Real blocked-users list backed by `public.blocked_users` (RLS: own rows
 * only). Blocking is enforced in discovery surfaces by filtering blocked ids;
 * it never bypasses access restrictions and never shows another user's list.
 */

import { getAccessToken, getAuthState } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/client";
import { fetchProfilesByIds, resolveUserId } from "@/lib/social/follows";
import { restGet, restMutate } from "@/lib/supabase/rest";

import { t } from "@/lib/settings/language";
export type BlockedEntry = { id: string; username: string; displayName: string };

type Row = { blocker_id: string; blocked_id: string; created_at: string };

export async function listBlocked(): Promise<BlockedEntry[]> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") {
    throw new ApiError(t("Sign in to view blocked users."), { code: "unauthorized", status: 401 });
  }
  const rows = await restGet<Row[]>(
    `blocked_users?blocker_id=eq.${auth.session.userId}&select=blocked_id&order=created_at.desc`,
    token,
  );
  const ids = rows.map((row) => row.blocked_id);
  if (ids.length === 0) return [];
  const profiles = await fetchProfilesByIds(ids);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return ids.map((id) => {
    const profile = byId.get(id);
    return {
      id,
      username: profile?.username ?? id.slice(0, 8),
      displayName: profile?.display_name ?? t("Unknown account"),
    };
  });
}

export async function listBlockedIds(): Promise<Set<string>> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") return new Set();
  try {
    const rows = await restGet<Row[]>(
      `blocked_users?blocker_id=eq.${auth.session.userId}&select=blocked_id`,
      token,
    );
    return new Set(rows.map((row) => row.blocked_id));
  } catch {
    return new Set();
  }
}

export async function blockUsername(username: string): Promise<void> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") {
    throw new ApiError(t("Sign in to block users."), { code: "unauthorized", status: 401 });
  }
  const targetId = await resolveUserId(username);
  if (!targetId)
    throw new ApiError(t("That account could not be found."), { code: "not_found", status: 404 });
  if (targetId === auth.session.userId) {
    throw new ApiError(t("You can't block yourself."), { code: "bad_request", status: 400 });
  }
  await restMutate("blocked_users", "POST", token, {
    blocker_id: auth.session.userId,
    blocked_id: targetId,
  });
}

export async function unblockUser(blockedId: string): Promise<void> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") {
    throw new ApiError(t("Sign in to unblock users."), { code: "unauthorized", status: 401 });
  }
  await restMutate(
    `blocked_users?blocker_id=eq.${auth.session.userId}&blocked_id=eq.${blockedId}`,
    "DELETE",
    token,
  );
}
