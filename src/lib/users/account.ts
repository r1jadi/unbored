/**
 * Deleting the signed-in account.
 *
 * The database does the deleting: `public.delete_my_account()` (see
 * `supabase/migrations/20261118120000_delete_my_account.sql`) removes the
 * caller's account and, by cascade, everything that belongs to it. It acts on
 * the verified token, so this module never names a user.
 *
 * Profile pictures live in Storage, outside that cascade, so they are removed
 * first through the Storage API, which lets an owner delete their own objects.
 * That step is best effort: a picture left behind is unreachable once the
 * profile pointing at it is gone, and it must not stop the account from being
 * deleted.
 */

import { ApiError } from "@/lib/api/client";
import { clearSession, getAccessToken, getSessionUserId } from "@/lib/auth/session";
import { restMutate, supabaseBase, supabaseHeaders } from "@/lib/supabase/rest";
import { clearProfile } from "@/lib/users/profile";

const AVATAR_BUCKET = "avatars";

/** Removes every object in the caller's avatar folder. Never throws. */
async function removeAvatars(token: string, userId: string): Promise<void> {
  const base = supabaseBase();
  if (base === "") return;
  try {
    const listed = await fetch(`${base}/storage/v1/object/list/${AVATAR_BUCKET}`, {
      method: "POST",
      headers: supabaseHeaders(token),
      body: JSON.stringify({ prefix: userId, limit: 1000 }),
    });
    if (!listed.ok) return;
    const objects = (await listed.json()) as { name: string }[];
    const prefixes = objects.map((object) => `${userId}/${object.name}`);
    if (prefixes.length === 0) return;
    await fetch(`${base}/storage/v1/object/${AVATAR_BUCKET}`, {
      method: "DELETE",
      headers: supabaseHeaders(token),
      body: JSON.stringify({ prefixes }),
    });
  } catch {
    // Best effort; see the module comment.
  }
}

/**
 * Deletes the signed-in account for good, then forgets the session locally.
 * Throws an `ApiError` with a message the screen can show when the account was
 * not deleted.
 */
export async function deleteAccount(): Promise<void> {
  const token = getAccessToken();
  const userId = getSessionUserId();
  if (!token || !userId) {
    throw new ApiError("Log in again to delete your account.", {
      code: "unauthorized",
      status: 401,
    });
  }

  await removeAvatars(token, userId);

  let outcome: string;
  try {
    const response = await restMutate("rpc/delete_my_account", "POST", token, {});
    outcome = (await response.json()) as string;
  } catch {
    throw new ApiError("Couldn't delete your account. Check your connection and try again.", {
      code: "delete_failed",
    });
  }

  if (outcome === "has_moderation_history") {
    throw new ApiError(
      "This account has moderation actions on record, so it can't delete itself. Ask an administrator to remove it.",
      { code: "forbidden", status: 403 },
    );
  }
  if (outcome === "not_signed_in") {
    throw new ApiError("Log in again to delete your account.", {
      code: "unauthorized",
      status: 401,
    });
  }
  if (outcome !== "deleted") {
    throw new ApiError("Your account couldn't be deleted. Nothing was removed — try again later.", {
      code: "delete_failed",
    });
  }

  // The account is gone, so its tokens are too: forget them here rather than
  // asking a server to revoke a session for a user that no longer exists.
  clearProfile();
  clearSession();
}
