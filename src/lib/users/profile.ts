/**
 * The signed-in user's profile, as `services/users` defines it.
 *
 * The web app reads and writes its own identity through `/api/v1/users/me`
 * (see packages/api-contracts/openapi-v1.yaml). Two properties of that endpoint
 * shape everything here:
 *
 *   - the profile is keyed by the verified token, so this module never sends a
 *     user id and cannot ask for somebody else's row — the "me" is the caller;
 *   - the row's `updatedAt` is the concurrency control. An edit sends the value
 *     it read, so a second writer gets a 409 instead of silently overwriting a
 *     change they never saw.
 *
 * Storage rule: the profile lives in memory. The session it belongs to is
 * persisted by `lib/auth/session` so a reload can restore it, but the profile
 * itself is re-read from the API rather than stored: nothing writes it to
 * `localStorage` or `sessionStorage`, and it is dropped the moment the session
 * ends, so a signed-out or switched account can never be shown the previous
 * person's profile.
 *
 * Avatar images are the one thing that does not travel through the Go API: the
 * `avatars` bucket in Supabase Storage is built for direct owner uploads
 * (`avatars/<user id>/<file>`, policy `avatars_owner_insert`), so the file is
 * uploaded with the caller's own access token, which is the same credential —
 * and the same folder rule — the database policies already enforce. Only the
 * publishable key is used, never the secret key.
 */

import { useEffect, useSyncExternalStore } from "react";

import { ApiError, apiFetch } from "@/lib/api/client";
import {
  clearSession,
  getAccessToken,
  getAuthState,
  rotateRefusedSession,
  subscribe as subscribeToAuth,
  type SessionRole,
} from "@/lib/auth/session";
import { publicConfig } from "@/lib/config";
import { rememberAvatar } from "@/lib/users/avatars";

/** Routes implemented by `services/users`. Kept together so they cannot drift. */
const Routes = {
  me: "/users/me",
} as const;

/** The bucket the storage migration creates for profile pictures. */
const AVATAR_BUCKET = "avatars";

/** The bucket's own limits, repeated here so a bad file fails before it is sent. */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** One `public.profiles` row as the API exposes it. Never contains a secret. */
export type Profile = {
  id: string;
  username: string;
  displayName: string;
  /** Absent when the user has not written one. */
  bio?: string;
  /** Storage object path (`<account id>/<file>`), not a URL. See `avatarUrl`. */
  avatarPath?: string;
  role: SessionRole;
  /** Absent until onboarding is finished — not the same as "not onboarded". */
  onboardedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * A profile edit. Only the fields named are written, so an edit to the display
 * name cannot clear a bio. `null` clears a nullable field, which is how the
 * existing "remove" affordances are expected to work.
 */
export type ProfilePatch = {
  displayName?: string;
  /** A new username. Only sent when it differs from the stored one. */
  username?: string;
  bio?: string | null;
  avatarPath?: string | null;
  /** The `updatedAt` the edit was made against. See `updateProfile`. */
  expectedUpdatedAt?: string;
};

/**
 * What the app knows about the caller's profile.
 *
 * `missing` is not an error: a profile row is created by a database trigger when
 * the account is created, so an account without one predates the trigger or had
 * its row removed. It is reported separately because "you have no profile yet"
 * and "the server failed" call for different screens.
 */
export type ProfileState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; profile: Profile }
  | { status: "anonymous" }
  | { status: "missing" }
  | { status: "error"; error: ApiError };

// The starting state is read from the session rather than assumed: a page that
// loads signed out must say so, not sit on a skeleton waiting for a read that
// will never happen.
let state: ProfileState =
  getAuthState().status === "authenticated" ? { status: "idle" } : { status: "anonymous" };
let inFlight: Promise<ProfileState> | undefined;
const listeners = new Set<() => void>();

function adopt(next: ProfileState): ProfileState {
  state = next;
  // Lists that look pictures up by username must see a change straight away.
  if (next.status === "ready") rememberAvatar(next.profile.username, next.profile.avatarPath);
  for (const listener of listeners) listener();
  return next;
}

/** Subscribes to profile changes. Passed straight to `useSyncExternalStore`. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current profile state. Stable between changes, so it is safe as a snapshot. */
export function getProfileState(): ProfileState {
  return state;
}

/**
 * Forgets the cached profile. Called when the session ends and between tests;
 * also used by the account settings screen after a delete so a stale identity is
 * never left on screen.
 */
export function clearProfile(): void {
  adopt({ status: "anonymous" });
}

/**
 * Drops the cached profile whenever the signed-in account changes.
 *
 * This is the rule that keeps two people from sharing one screen: the moment the
 * session ends (or a different account signs in), the profile on display belongs
 * to somebody else and is discarded rather than re-rendered.
 */
let cachedFor: string | undefined;
subscribeToAuth(() => {
  const auth = getAuthState();
  const userId = auth.status === "authenticated" ? auth.session.userId : undefined;
  if (userId === cachedFor) return;
  cachedFor = userId;
  adopt(userId ? { status: "idle" } : { status: "anonymous" });
});

/**
 * Reads the profile. Resolves with the state it settled on, so a caller that
 * needs the value (a form load) does not have to watch the store.
 *
 * Concurrent callers share one request: several screens can mount at once and
 * none of them should cause a second read.
 */
export function loadProfile(): Promise<ProfileState> {
  if (inFlight) return inFlight;

  const token = getAccessToken();
  if (!token) {
    return Promise.resolve(adopt({ status: "anonymous" }));
  }

  // A re-read keeps the profile on screen; only the first read has nothing to
  // show, and the screens draw their skeleton for it.
  if (state.status !== "ready") adopt({ status: "loading" });

  inFlight = readProfile(token).finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

/** One read, with the refused-token policy below applied to a 401. */
async function readProfile(token: string): Promise<ProfileState> {
  try {
    return adopt({ status: "ready", profile: await apiFetch<Profile>(Routes.me, { token }) });
  } catch (error) {
    const apiError = asApiError(error);
    if (!apiError.isUnauthorized) return adopt(failure(apiError));
    return adopt(await recoverRefusedToken(apiError));
  }
}

/**
 * A refused access token is not automatically a dead session: it may only have
 * lapsed, and the session module's rotation decides which of the two it is.
 * Retry the read once with the rotated credential; a session the server
 * definitively refuses is dropped, and a server that could not answer leaves
 * the session in place with a retryable error rather than signing the visitor
 * out — the logout this path used to perform on any 401.
 */
async function recoverRefusedToken(apiError: ApiError): Promise<ProfileState> {
  const outcome = await rotateRefusedSession();
  if (outcome === "signed-out") return { status: "anonymous" };
  if (outcome === "transient") return { status: "error", error: apiError };
  const token = getAccessToken();
  if (!token) return { status: "anonymous" };
  try {
    return { status: "ready", profile: await apiFetch<Profile>(Routes.me, { token }) };
  } catch (error) {
    const retryError = asApiError(error);
    // The freshly rotated token was refused too: that is definitive.
    if (retryError.isUnauthorized) {
      clearSession();
      return { status: "anonymous" };
    }
    return failure(retryError);
  }
}

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError("Something went wrong. Please try again.");
}

/**
 * Maps a failed read onto a state.
 *
 * A 404 is `missing`, and everything else stays an error so the screen can
 * offer a retry instead of inventing a profile. A refused token never reaches
 * this point (see `recoverRefusedToken`), which is also the only place a dead
 * session is dropped.
 */
function failure(apiError: ApiError): ProfileState {
  if (apiError.status === 404) return { status: "missing" };
  return { status: "error", error: apiError };
}

/**
 * Re-reads the profile. Used by every retry affordance.
 *
 * It deliberately does not fall back to an empty screen while it works: a profile
 * that is already on screen stays there, so a failed refresh or a conflict does
 * not blank out the values the user is looking at.
 */
export function refreshProfile(): Promise<ProfileState> {
  return loadProfile();
}

/**
 * Reads the profile reactively, loading it on first use.
 *
 * Mounting a screen is what triggers the read, so a signed-out visitor causes no
 * request at all and a signed-in one gets the profile without the screen having
 * to remember to ask.
 */
export function useProfile(): ProfileState {
  const snapshot = useSyncExternalStore(subscribe, getProfileState, getProfileState);
  const auth = useSyncExternalStore(subscribeToAuth, getAuthState, getAuthState);

  // The session is what decides whether there is anything to read, so a change
  // of session is what triggers the read — on mount and on every sign-in.
  useEffect(() => {
    if (auth.status !== "authenticated") {
      // Signed out: there is nobody to read, and saying so is the answer.
      if (getProfileState().status !== "anonymous") clearProfile();
      return;
    }
    if (getProfileState().status === "idle") void loadProfile();
  }, [auth]);

  return snapshot;
}

/**
 * Writes the named fields and adopts the row the database returned, so what is
 * on screen is what was stored — including the new `updatedAt` the next edit
 * must use.
 *
 * Passing `expectedUpdatedAt` makes the write conditional: if the row moved on
 * since it was read, the API answers 409 and nothing is overwritten.
 */
export async function updateProfile(patch: ProfilePatch): Promise<Profile> {
  const token = getAccessToken();
  if (!token) {
    throw new ApiError("Sign in to change your profile.", { code: "unauthorized", status: 401 });
  }
  const profile = await apiFetch<Profile>(Routes.me, { method: "PATCH", token, body: patch });
  adopt({ status: "ready", profile });
  return profile;
}

/**
 * Replaces the profile picture.
 *
 * The file goes to Storage first, then the profile is pointed at it, because the
 * database check constraint only accepts a path of the form `<account id>/<file>`
 * — the object has to exist under the caller's own folder before it can be
 * referenced. Replacing a picture leaves the previous object in place: removing
 * it is a deletion the UI does not offer, and a failed cleanup must never break a
 * successful upload.
 */
export async function changeAvatar(file: File): Promise<Profile> {
  const extension = AVATAR_TYPES[file.type];
  if (!extension) {
    throw new ApiError("Choose a PNG, JPEG or WebP image.", { code: "bad_request" });
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new ApiError("That image is larger than 2 MB.", { code: "bad_request" });
  }

  const auth = getAuthState();
  const token = getAccessToken();
  if (auth.status !== "authenticated" || !token) {
    throw new ApiError("Sign in to change your photo.", { code: "unauthorized", status: 401 });
  }

  const baseUrl = publicConfig.supabase.url.replace(/\/+$/, "");
  const publishableKey = publicConfig.supabase.publishableKey;
  if (baseUrl === "" || publishableKey === "") {
    throw new ApiError("Photo uploads are not configured for this deployment.", {
      code: "internal_error",
    });
  }

  // A fresh name per upload: the object path is immutable, so no cache ever has
  // to be invalidated and no upload can overwrite an earlier picture.
  const objectPath = `${auth.session.userId}/${crypto.randomUUID()}.${extension}`;
  // Each segment is escaped separately: escaping the whole path would turn the
  // folder separator into %2F and break the owner-folder rule the bucket policy
  // checks (`avatars/<caller id>/<file>`).
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${baseUrl}/storage/v1/object/${AVATAR_BUCKET}/${encodedPath}`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      // The caller's own token: the bucket policy only allows writes inside a
      // folder named after this account.
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type,
      "x-upsert": "false",
      "cache-control": "max-age=3600",
    },
    body: file,
  });

  if (!response.ok) {
    throw new ApiError("That photo could not be uploaded. Try again.", {
      code: "upload_failed",
      status: response.status,
    });
  }

  return updateProfile({ avatarPath: objectPath, expectedUpdatedAt: currentUpdatedAt() });
}

/**
 * The public URL for a stored profile picture, or `undefined` when there is no
 * path — in which case the avatar renders the account's initials, as it always
 * has.
 *
 * The bucket is public by design (a profile picture is public on the web), so
 * this is a plain object URL and not a signed one. It takes the storage path
 * rather than a whole `Profile` because other accounts arrive as
 * `PublicProfile` rows from the Data API, whose field is `avatar_path`; both
 * shapes hold the same object path and must build the same URL.
 */
export function avatarUrlFromPath(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const baseUrl = publicConfig.supabase.url.replace(/\/+$/, "");
  if (baseUrl === "") return undefined;
  return `${baseUrl}/storage/v1/object/public/${AVATAR_BUCKET}/${path}`;
}

/** The public URL for the signed-in caller's profile picture. */
export function avatarUrl(profile: Profile | undefined): string | undefined {
  return avatarUrlFromPath(profile?.avatarPath);
}

/**
 * The message to show a user when a profile call fails.
 *
 * The API writes messages that are safe to display ("Add a display name."), so
 * they are passed through rather than re-worded here. Anything else is a bug or a
 * transport failure and gets a generic message instead of an internal detail.
 */
export function profileErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

/**
 * The API's message when it named this field as the problem, so a form can show
 * it under the input it belongs to instead of in a banner. `undefined` means the
 * failure was not about this field.
 */
export function fieldError(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  return error.details.some((detail) => detail.field === field) ? error.message : undefined;
}

/** The `updatedAt` of the profile on screen, for a conditional write. */
function currentUpdatedAt(): string | undefined {
  return state.status === "ready" ? state.profile.updatedAt : undefined;
}
