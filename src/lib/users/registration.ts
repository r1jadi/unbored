/**
 * Completing registration: the moment a Supabase account becomes a registered
 * Unbored user.
 *
 * A valid Supabase authentication session and a registered account are not the
 * same thing. The session answers "who is this?"; `profiles.onboarded_at`
 * answers "did they finish signing up?" — the marker the auth service already
 * reports as `session.onboarded` and the users service as
 * `profile.onboardedAt`. Google sign-ins (and email sign-ins before the
 * confirmation link is opened) reach an authenticated session before that
 * marker exists, which is why the app routes them through the remaining
 * sign-up steps and records the marker here, exactly once.
 *
 * The write goes to the Data API with the caller's own access token — never the
 * secret key — so RLS stays the boundary: the grants expose `onboarded_at` to
 * `authenticated` and the `profiles_update_self` policy only allows the
 * caller's own row, so this cannot mark anyone else's account. The conditional
 * filter (`onboarded_at=is.null`) makes the write idempotent: a retry, a second
 * tab or a resumed sign-in converges on "registered", never a second
 * registration.
 */

import { ApiError } from "@/lib/api/client";
import { getAccessToken, getAuthState } from "@/lib/auth/session";
import { restGet, restMutate, SupabaseRestError } from "@/lib/supabase/rest";
import { updateProfile } from "@/lib/users/profile";

import { t } from "@/lib/settings/language";
/** The only column this module reads back; the rest of the row is not its business. */
type OnboardedRow = { onboarded_at: string | null };

/**
 * Records that the caller finished signing up. Safe to call again: an account
 * that is already registered resolves without a write.
 */
export async function completeRegistration(displayName?: string, username?: string): Promise<void> {
  const auth = getAuthState();
  const token = getAccessToken();
  if (auth.status !== "authenticated" || !token) {
    throw new ApiError(t("Sign in to finish creating your account."), {
      code: "unauthorized",
      status: 401,
    });
  }

  const name = displayName?.trim() ?? "";
  // A username is only passed when the person chose one other than the one the
  // account was given (a Google sign-up is assigned a generated one).
  const chosen = username?.trim() ?? "";
  if (name !== "" || chosen !== "") {
    // The name is written through the users API first: a refused name must not
    // leave an account marked registered with a name that was never stored.
    await updateProfile({
      ...(name !== "" ? { displayName: name } : {}),
      ...(chosen !== "" ? { username: chosen } : {}),
    });
  }

  const id = encodeURIComponent(auth.session.userId);
  let updated = false;
  try {
    const response = await restMutate(
      `profiles?id=eq.${id}&onboarded_at=is.null&select=onboarded_at`,
      "PATCH",
      token,
      { onboarded_at: new Date().toISOString() },
      "return=representation",
    );
    const rows = (await response.json()) as OnboardedRow[] | null;
    updated = Array.isArray(rows) && rows.some((row) => row.onboarded_at !== null);
  } catch (error) {
    throw toRegistrationError(error);
  }
  if (updated) return;

  // Nothing was updated: either the marker is already set (a retry, a second
  // device — the desired end state, not an error) or the account has no profile
  // row at all (the `handle_new_user` trigger never created one). Ask the
  // database which it is instead of guessing.
  let existing: OnboardedRow | undefined;
  try {
    const rows = await restGet<OnboardedRow[]>(`profiles?id=eq.${id}&select=onboarded_at`, token);
    existing = rows[0];
  } catch (error) {
    throw toRegistrationError(error);
  }
  if (existing?.onboarded_at) return;
  throw existing
    ? new ApiError(t("We couldn't finish setting up your account. Try again."), {
        code: "registration_failed",
      })
    : new ApiError(t("Your account has no profile yet. Sign out and back in, then try again."), {
        code: "profile_missing",
      });
}

function toRegistrationError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof SupabaseRestError && error.status === 401) {
    return new ApiError(t("Your session expired. Sign in again to finish your account."), {
      code: "unauthorized",
      status: 401,
    });
  }
  return new ApiError(t("We couldn't save your registration. Try again."), {
    code: "registration_failed",
  });
}
