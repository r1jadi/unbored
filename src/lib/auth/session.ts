/**
 * The application session, as the Go auth service defines it.
 *
 * The web app never talks to Supabase Auth directly: `/api/v1/auth/*` is the
 * credential surface (see packages/api-contracts/openapi-v1.yaml), so no Supabase
 * key — publishable or secret — has to be embedded in a page, and one place
 * decides how a session is stored.
 *
 * Storage rule: the token pair and the last known session view are persisted
 * under one namespaced `localStorage` key (`unbored.auth.session.v1`), so a
 * reload can restore the session the visitor already earned instead of starting
 * anonymous. The pre-rename key (`onemore.auth.session.v1`) is still read once
 * and moved forward, so the rebrand signs nobody out. Nothing else is written: no cookies, and `sessionStorage` holds
 * only the short-lived OAuth PKCE verifier (never a session token). The server
 * stays authoritative: a restored pair is re-validated against
 * `GET /auth/session` before the app relies on it, and a pair the server
 * definitively refuses is cleared locally. A transient failure (network, rate
 * limit, 5xx) keeps the stored pair for a later attempt but reports anonymous
 * rather than claiming an unverified session.
 *
 * Rotation is single-flight: one refresh request per refresh token at a time,
 * shared by every caller. Supabase treats a second use of a rotated token as
 * reuse and can revoke the whole token family, so a burst of concurrent 401s
 * must not each spend the same token — that race is what used to sign people
 * out mid-session. A pair another tab rotated is adopted from storage instead
 * of being spent again.
 */

import { useSyncExternalStore } from "react";

import { ApiError, apiFetch } from "@/lib/api/client";
import { publicConfig } from "@/lib/config";
import {
  readWithLegacy,
  removeWithLegacy,
  safeLocalStorage,
  safeSessionStorage,
} from "@/lib/storage";

/** Routes implemented by `services/auth`. Kept together so they cannot drift. */
const Routes = {
  signUp: "/auth/sign-up",
  signIn: "/auth/sign-in",
  refresh: "/auth/refresh",
  session: "/auth/session",
  signOut: "/auth/sign-out",
} as const;

export type SessionRole = "user" | "moderator" | "admin";

/** The session view. It never contains a token. */
export type Session = {
  userId: string;
  role: SessionRole;
  email?: string;
  /** Absent when the server could not read it — not the same as `false`. */
  onboarded?: boolean;
  expiresAt?: string;
};

/** The Supabase token pair. Returned by the credential and refresh endpoints. */
export type Tokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt?: string;
  expiresIn?: number;
};

/** The Supabase user record, trimmed to what the app shows. */
export type AuthUser = {
  id: string;
  email: string;
  emailConfirmed: boolean;
  createdAt: string;
};

/**
 * What sign-up, sign-in and refresh return. `tokens` (and therefore a usable
 * session) are absent while Supabase still requires email confirmation.
 */
export type AuthSession = {
  session: Session;
  tokens?: Tokens;
  user?: AuthUser;
};

export type AuthState =
  { status: "anonymous" } | { status: "restoring" } | { status: "authenticated"; session: Session };

/**
 * The one web storage key the session is persisted under. The suffix is the
 * payload version, so a shape change is never read as an older payload.
 */
export const SESSION_STORAGE_KEY = "unbored.auth.session.v1";

/** The pre-rename session key. Read once and moved forward; never written. */
const LEGACY_SESSION_STORAGE_KEY = "onemore.auth.session.v1";

/** `sessionStorage` key for the single-use OAuth PKCE verifier. */
export const OAUTH_VERIFIER_STORAGE_KEY = "unbored-oauth-verifier";

/** The pre-rename verifier key. Read once and moved forward; never written. */
const LEGACY_OAUTH_VERIFIER_STORAGE_KEY = "onemore-oauth-verifier";

const STORAGE_VERSION = 1;

/** A token this close to expiry is treated as expired, front-running clock skew. */
const EXPIRY_SKEW_MS = 60_000;

/** How long to wait before retrying a refresh that failed for a transient reason. */
const REFRESH_RETRY_MS = 60_000;

/** `setTimeout` delays above this fire immediately instead of after the wait. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** The one shared anonymous snapshot, so identity comparisons stay meaningful. */
const ANONYMOUS: AuthState = { status: "anonymous" };

let state: AuthState = ANONYMOUS;
let tokens: Tokens | undefined;
/**
 * Counts every time the session actually changes (tokens adopted or cleared).
 * Async work captures it before awaiting and discards its answer when the
 * session moved on: a sign-in or sign-out that lands while a restore or refresh
 * is in flight must never be overwritten by the older result.
 */
let generation = 0;
const listeners = new Set<() => void>();

function publish(next: AuthState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Subscribes to session changes. Passed straight to `useSyncExternalStore`. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current session state. Stable between changes, so it is safe as a snapshot. */
export function getAuthState(): AuthState {
  return state;
}

/**
 * The bearer token to send with API calls, or `undefined` while anonymous.
 * Callers pass it to `apiFetch`'s `token` option; it is never put in a URL.
 */
export function getAccessToken(): string | undefined {
  return tokens?.accessToken;
}

/**
 * The subject (`sub`) of an access token, or `undefined` when the value is not
 * a JWT this app can read.
 *
 * The payload is decoded without checking the signature: the server verifies
 * it on every request, so this value is only ever used to *build* a request (the
 * actor a row has to belong to), never to authorize one. Reading it from the
 * token rather than the cached session view means a stale view can never aim a
 * write at — or read a follow state for — the wrong account: the database still
 * checks it against `auth.uid()` and refuses a mismatch instead of hiding it.
 */
export function accessTokenSubject(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    const decoded = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof decoded.sub === "string" && decoded.sub !== "" ? decoded.sub : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The account a request must act as: the token's own subject when it can be
 * read, otherwise the cached session view. Never a value from the caller.
 */
export function getSessionUserId(): string | undefined {
  return (
    accessTokenSubject(tokens?.accessToken) ??
    (state.status === "authenticated" ? state.session.userId : undefined)
  );
}

/**
 * The snapshot for the server render and the first client render. Restoring a
 * session runs after hydration (see `initializeSession`), so both renders agree
 * on anonymous and hydration cannot mismatch.
 */
function serverSnapshot(): AuthState {
  return ANONYMOUS;
}

/** Reads the session reactively. */
export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getAuthState, serverSnapshot);
}

// ── Persistence ────────────────────────────────────────────────────────────

/** What a stored session entry contains. */
type StoredSession = {
  version: number;
  tokens: Tokens;
  session: Session;
};

const ROLES: readonly SessionRole[] = ["user", "moderator", "admin"];

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** Keeps only a parseable date-time; anything else counts as unknown. */
function isoString(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function normalizeRole(value: unknown): SessionRole | undefined {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value)
    ? (value as SessionRole)
    : undefined;
}

/**
 * Parses a stored entry, strictly. Anything that is not exactly the shape this
 * module writes is rejected rather than repaired: a corrupt entry must never
 * become a session the app acts on.
 */
function parseStoredSession(raw: string): StoredSession | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record["version"] !== STORAGE_VERSION) return undefined;

  const pair = record["tokens"];
  if (typeof pair !== "object" || pair === null || Array.isArray(pair)) return undefined;
  const pairRecord = pair as Record<string, unknown>;
  const accessToken = pairRecord["accessToken"];
  const refreshToken = pairRecord["refreshToken"];
  if (!nonEmptyString(accessToken)) return undefined;
  if (!nonEmptyString(refreshToken)) return undefined;

  const view = record["session"];
  if (typeof view !== "object" || view === null || Array.isArray(view)) return undefined;
  const viewRecord = view as Record<string, unknown>;
  const userId = viewRecord["userId"];
  if (!nonEmptyString(userId)) return undefined;
  const role = normalizeRole(viewRecord["role"]);
  if (role === undefined) return undefined;

  const tokenType = pairRecord["tokenType"];
  const expiresIn = pairRecord["expiresIn"];
  const email = viewRecord["email"];
  const onboarded = viewRecord["onboarded"];

  return {
    version: STORAGE_VERSION,
    tokens: {
      accessToken,
      refreshToken,
      tokenType: typeof tokenType === "string" ? tokenType : "bearer",
      expiresAt: isoString(pairRecord["expiresAt"]),
      expiresIn:
        typeof expiresIn === "number" && Number.isFinite(expiresIn) ? expiresIn : undefined,
    },
    session: {
      userId,
      role,
      email: typeof email === "string" ? email : undefined,
      onboarded: typeof onboarded === "boolean" ? onboarded : undefined,
      expiresAt: isoString(viewRecord["expiresAt"]),
    },
  };
}

function readStoredSession(): StoredSession | undefined {
  const storage = safeLocalStorage();
  if (!storage) return undefined;
  const raw = readWithLegacy(storage, SESSION_STORAGE_KEY, LEGACY_SESSION_STORAGE_KEY);
  if (raw === null) return undefined;
  const stored = parseStoredSession(raw);
  // A malformed entry can never become a session; drop it rather than read it
  // again on every boot.
  if (!stored) clearStoredSession();
  return stored;
}

function persistSession(pair: Tokens, view: Session): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    const payload: StoredSession = { version: STORAGE_VERSION, tokens: pair, session: view };
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be full or denied. The session still works for this page.
  }
}

function clearStoredSession(): void {
  // Both keys: a legacy copy left behind would restore the signed-out session.
  removeWithLegacy(safeLocalStorage(), SESSION_STORAGE_KEY, LEGACY_SESSION_STORAGE_KEY);
}

// ── Expiry and refresh policy ──────────────────────────────────────────────

/** The moment the access token stops being accepted, when it is known. */
function expiryTime(pair: Tokens): number | undefined {
  if (pair.expiresAt === undefined) return undefined;
  const parsed = Date.parse(pair.expiresAt);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Fills in an absolute `expiresAt` from the relative `expiresIn` when the
 * server sent only the latter, so a reopened page can tell whether the token is
 * still fresh. The moment is computed once, when the pair is adopted.
 */
function withExpiry(pair: Tokens): Tokens {
  if (expiryTime(pair) !== undefined) return pair;
  if (pair.expiresIn !== undefined && Number.isFinite(pair.expiresIn) && pair.expiresIn > 0) {
    return { ...pair, expiresAt: new Date(Date.now() + pair.expiresIn * 1000).toISOString() };
  }
  return pair;
}

/**
 * A token with no usable expiry counts as expired: "cannot prove fresh" must
 * not be reported as "fresh". The skew means a token about to lapse rotates now
 * instead of failing a call first.
 */
function isExpired(pair: Tokens, now = Date.now()): boolean {
  const expiresAt = expiryTime(pair);
  if (expiresAt === undefined) return true;
  return expiresAt - EXPIRY_SKEW_MS <= now;
}

/** When to rotate the access token on a page that stays open, if at all. */
function refreshDelay(pair: Tokens | undefined): number | undefined {
  if (!pair) return undefined;
  const expiresAt = expiryTime(pair);
  if (expiresAt === undefined) return undefined;
  return expiresAt - Date.now() - EXPIRY_SKEW_MS;
}

/**
 * Statuses that mean the credential itself was refused. Anything else
 * (network, timeout, 429, 5xx) may pass on a retry and must not destroy a
 * session that could still be valid.
 */
const DEFINITIVE_AUTH_STATUSES = new Set([400, 401, 403, 422]);

function isDefinitiveAuthFailure(error: unknown): boolean {
  return error instanceof ApiError && DEFINITIVE_AUTH_STATUSES.has(error.status);
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

function cancelRefresh(): void {
  if (refreshTimer !== undefined) {
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }
}

/**
 * Schedules the next token rotation, if one is due. An explicit delay is used
 * for retries; otherwise the token's own expiry decides. Nothing is scheduled
 * for a token that is already at or past its refresh point.
 */
function scheduleRefresh(delay?: number): void {
  cancelRefresh();
  const wait = delay ?? refreshDelay(tokens);
  if (wait === undefined || wait <= 0 || wait > MAX_TIMER_DELAY_MS) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined;
    void refreshAheadOfExpiry();
  }, wait);
}

// ── Session lifecycle ──────────────────────────────────────────────────────

/**
 * Publishes a session and makes it the one stored session. Every path that
 * receives a fresh token pair goes through here, so the reactive state, the
 * stored copy and the refresh timer can never drift apart.
 */
function adoptTokens(input: Tokens, view: Session): Tokens {
  generation += 1;
  const pair = withExpiry(input);
  tokens = pair;
  persistSession(pair, view);
  publish({ status: "authenticated", session: view });
  scheduleRefresh();
  return pair;
}

/**
 * Adopts the session a credential call returned.
 *
 * A response without tokens means Supabase created the account and is waiting
 * for email confirmation: the caller is not signed in yet, and reporting one
 * would be a lie the rest of the app would act on.
 */
function adopt(payload: AuthSession): AuthSession {
  if (payload.tokens) {
    adoptTokens(payload.tokens, payload.session);
  }
  return payload;
}

/** Forgets the session locally: state, stored copy and refresh timer together. */
export function clearSession(): void {
  generation += 1;
  cancelRefresh();
  tokens = undefined;
  clearStoredSession();
  publish(ANONYMOUS);
}

/**
 * Posts the refresh token and returns the server's answer, unchanged. Failure
 * policy belongs to the caller: a boot restore and a pre-emptive rotation want
 * different things from the same refused or failed answer.
 */
function requestRefresh(refreshToken: string): Promise<AuthSession> {
  return apiFetch<AuthSession>(Routes.refresh, {
    method: "POST",
    body: { refreshToken },
  });
}

/**
 * The token rotation currently in flight, keyed by the refresh token it uses.
 *
 * Supabase rotates refresh tokens: one refresh token is single-use, and a
 * second use of it is treated as reuse, which can revoke the whole token
 * family. So every rotation goes through here. A page that fires several calls
 * at once — a profile read, the feed, the notification badge — makes one
 * request and every caller shares the answer. Without this, two concurrent
 * 401s rotated the same token twice and the loser cleared the session, which is
 * the intermittent "it logged me out" report.
 */
let rotation: { refreshToken: string; promise: Promise<AuthSession> } | undefined;

/**
 * Adopts a pair another tab stored while this one was failing, so a rotation
 * that lost a cross-tab race does not sign the visitor out. Returns true when a
 * newer, still-valid pair was adopted.
 */
function adoptNewerStoredPair(rejectedRefreshToken: string): boolean {
  const stored = readStoredSession();
  if (!stored) return false;
  if (stored.tokens.refreshToken === rejectedRefreshToken) return false;
  if (isExpired(stored.tokens)) return false;
  adoptTokens(stored.tokens, stored.session);
  return true;
}

/**
 * Rotates a pair, joining a rotation already in flight for the same token.
 * The caller keeps its own failure policy; this only removes the duplicate
 * request that made reuse detection possible.
 */
function rotate(refreshToken: string): Promise<AuthSession> {
  if (rotation?.refreshToken === refreshToken) return rotation.promise;
  const promise = requestRefresh(refreshToken).finally(() => {
    if (rotation?.promise === promise) rotation = undefined;
  });
  rotation = { refreshToken, promise };
  return promise;
}

/**
 * Rotates a pair before expiring, while the page stays open. The access token
 * is still valid, so a transient failure only reschedules the attempt; a
 * definitive refusal ends the session.
 */
async function refreshAheadOfExpiry(): Promise<void> {
  const pair = tokens;
  if (!pair) return;
  const startedAt = generation;
  try {
    const payload = await rotate(pair.refreshToken);
    if (generation !== startedAt) return;
    if (!payload.tokens) {
      clearSession();
      return;
    }
    adoptTokens(payload.tokens, payload.session);
  } catch (error) {
    if (generation !== startedAt) return;
    if (isDefinitiveAuthFailure(error)) {
      // Another tab may have rotated this token a moment before us; its pair is
      // in storage and is the session that survived. Adopt it rather than
      // ending a session that is still valid.
      if (adoptNewerStoredPair(pair.refreshToken)) return;
      clearSession();
      return;
    }
    scheduleRefresh(REFRESH_RETRY_MS);
  }
}

/**
 * Rotates a stored or no-longer-accepted pair as part of restoring a session.
 * There is no verified session to keep yet, so a transient failure reports
 * anonymous while keeping the stored copy for a later attempt.
 */
async function rotateRestoredSession(stored: Tokens, startedAt: number): Promise<void> {
  try {
    const payload = await rotate(stored.refreshToken);
    if (generation !== startedAt) return;
    if (!payload.tokens) {
      clearSession();
      return;
    }
    adoptTokens(payload.tokens, payload.session);
  } catch (error) {
    if (generation !== startedAt) return;
    if (isDefinitiveAuthFailure(error)) {
      if (adoptNewerStoredPair(stored.refreshToken)) return;
      clearSession();
      return;
    }
    tokens = undefined;
    cancelRefresh();
    publish(ANONYMOUS);
  }
}

let restoreTask: { generation: number; promise: Promise<void> } | undefined;

/**
 * Restores the stored session, if any.
 *
 * Called once after hydration by the root component (see `src/routes/__root.tsx`)
 * and safe to call again: a second call while one is in flight joins it instead
 * of racing it, which is what React StrictMode's doubled effects rely on.
 *
 * The cached view is published synchronously, so a valid session is usable
 * immediately while `GET /auth/session` re-validates it in the background. An
 * expired pair is rotated first, and the app waits (state `restoring`) because
 * the refresh token's answer is what decides whether the visitor is signed in —
 * reporting anonymous while that is unresolved would be wrong.
 */
export function initializeSession(): Promise<void> {
  if (restoreTask && restoreTask.generation === generation) return restoreTask.promise;
  const stored = readStoredSession();
  if (!stored) return Promise.resolve();
  const startedAt = generation;
  const promise = restoreSession(stored, startedAt).finally(() => {
    if (restoreTask?.promise === promise) restoreTask = undefined;
  });
  restoreTask = { generation: startedAt, promise };
  return promise;
}

async function restoreSession(stored: StoredSession, startedAt: number): Promise<void> {
  if (isExpired(stored.tokens)) {
    publish({ status: "restoring" });
    await rotateRestoredSession(stored.tokens, startedAt);
    return;
  }
  tokens = stored.tokens;
  publish({ status: "authenticated", session: stored.session });
  scheduleRefresh();
  await validateStoredSession(stored.tokens.accessToken, startedAt);
}

/**
 * Confirms the restored access token with `GET /auth/session`. The body of that
 * route comes from the verified token, so this is the authoritative answer to
 * "is this session still valid".
 */
async function validateStoredSession(accessToken: string, startedAt: number): Promise<void> {
  try {
    const view = await apiFetch<Session>(Routes.session, { token: accessToken });
    if (generation !== startedAt) return;
    if (tokens) persistSession(tokens, view); // keep the cached view fresh
    publish({ status: "authenticated", session: view });
  } catch (error) {
    if (generation !== startedAt) return;
    if (error instanceof ApiError && error.isUnauthorized) {
      // The access token lapsed between boot and the check: the refresh token
      // is the one that can still restore the session.
      if (tokens) await rotateRestoredSession(tokens, startedAt);
      return;
    }
    if (isDefinitiveAuthFailure(error)) {
      clearSession();
      return;
    }
    // The server could not answer. Keep the stored pair for a later attempt,
    // but do not claim a session that was not just verified.
    tokens = undefined;
    cancelRefresh();
    publish(ANONYMOUS);
  }
}

/**
 * The message to show a user when an auth call fails.
 *
 * The API writes messages that are safe to display ("That email and password do
 * not match."), so they are passed through unchanged rather than re-worded here
 * — one place decides what a caller is told. Anything else is a bug or a
 * transport failure, and gets a generic message instead of an internal detail.
 */
export function authErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

/**
 * Creates an account. Resolves with no tokens while confirmation is pending.
 *
 * `username` is the name chosen on the sign-up screen. The server validates and
 * checks it again, and the database trigger persists it on the profile when the
 * account is created — including while confirmation is pending. It is omitted
 * only when there is no choice to send (a resumed OAuth registration, whose
 * account already exists).
 *
 * `displayName` travels the same way: the trigger stores it and, together with
 * the username, records the registration as finished, so opening the
 * confirmation link signs straight in instead of re-asking for both.
 *
 * `marketing` is the optional "Product updates" choice. It is sent only when
 * ticked, and the database trigger turns it into the email-digest preference.
 */
export function signUp(
  email: string,
  password: string,
  username?: string,
  displayName?: string,
  marketing?: boolean,
): Promise<AuthSession> {
  const chosen = username?.trim();
  const name = displayName?.trim();
  return apiFetch<AuthSession>(Routes.signUp, {
    method: "POST",
    body: {
      email,
      password,
      ...(chosen ? { username: chosen } : {}),
      ...(name ? { displayName: name } : {}),
      ...(marketing ? { marketing: true } : {}),
    },
  }).then(adopt);
}

function supabaseAuthBase(): { url: string; publishableKey: string } {
  const url = publicConfig.supabase.url.replace(/\/+$/, "");
  const publishableKey = publicConfig.supabase.publishableKey;
  if (url === "" || publishableKey === "") {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example).",
    );
  }
  return { url, publishableKey };
}

/** Asks Supabase to re-send the confirmation email for an unconfirmed address. */
export async function resendConfirmation(email: string): Promise<void> {
  const { url, publishableKey } = supabaseAuthBase();
  const response = await fetch(`${url}/auth/v1/resend`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "signup", email }),
  });
  if (!response.ok) {
    throw new ApiError("We could not re-send the confirmation email. Try again shortly.", {
      code: "resend_failed",
      status: response.status,
    });
  }
}

/**
 * Verifies a Supabase email-confirmation link (`token_hash` + `type`) and
 * returns the Supabase token pair. This is the link format Supabase sends for
 * signup confirmation; no six-digit code is involved.
 */
export async function verifyEmailLink(
  tokenHash: string,
  type: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const { url, publishableKey } = supabaseAuthBase();
  const response = await fetch(`${url}/auth/v1/verify`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token_hash: tokenHash, type }),
  });
  if (!response.ok) {
    throw new ApiError("That confirmation link is invalid or has expired. Request a new one.", {
      code: "invalid_confirmation",
      status: response.status,
    });
  }
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!payload.access_token || !payload.refresh_token) {
    throw new ApiError("That confirmation link is invalid or has expired. Request a new one.", {
      code: "invalid_confirmation",
      status: 400,
    });
  }
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token };
}

/**
 * Exchanges a verified Supabase access token for the application session and
 * adopts the returned token pair. `POST /auth/session` verifies the token
 * server-side, so an arbitrary URL parameter can never count as proof of
 * authentication — only a token Supabase issued and the backend verified does.
 */
export async function adoptSupabaseTokens(input: {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
}): Promise<AuthSession> {
  const view = await apiFetch<Session>(Routes.session, {
    method: "POST",
    body: { accessToken: input.accessToken },
  });
  const pair = adoptTokens(
    {
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      tokenType: "bearer",
      expiresIn: input.expiresIn,
    },
    view,
  );
  return { session: view, tokens: pair };
}

/**
 * The Supabase OAuth entry point for Google sign-in/up (PKCE, no secrets).
 *
 * Async because the S256 code challenge must be derived before the redirect:
 * without `code_challenge` Supabase falls back to the implicit flow instead of
 * returning the `?code=` the callback exchanges. The `apikey` query parameter
 * is required too — a browser redirect carries no headers, and the gateway
 * rejects authorize calls without it.
 */
export async function googleAuthorizeUrl(next = "/"): Promise<string> {
  const { url, publishableKey } = supabaseAuthBase();
  const redirectTo = new URL("/auth/callback", window.location.origin);
  redirectTo.searchParams.set("next", next);
  // PKCE: generate a verifier now and keep it for the callback exchange. It is
  // a single-use random value in sessionStorage, never a long-lived token.
  const verifier = randomVerifier();
  try {
    sessionStorage.setItem(OAUTH_VERIFIER_STORAGE_KEY, verifier);
  } catch {
    // Storage may be unavailable (private mode); the callback then reports a
    // clear error instead of silently failing.
  }
  const challenge = await codeChallenge(verifier);
  const authorize = new URL(`${url}/auth/v1/authorize`);
  authorize.searchParams.set("provider", "google");
  authorize.searchParams.set("redirect_to", redirectTo.toString());
  // The publishable key is public by design (it ships in the web bundle).
  authorize.searchParams.set("apikey", publishableKey);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "s256");
  return authorize.toString();
}

function randomVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Exchanges an OAuth authorization `code` for Supabase tokens (PKCE) and then
 * for the application session. Rejects when the verifier is missing (a fresh
 * tab, cleared storage) rather than inventing a session.
 */
export async function exchangeOAuthCode(code: string): Promise<AuthSession> {
  const { url, publishableKey } = supabaseAuthBase();
  let verifier: string | null = null;
  try {
    verifier = readWithLegacy(
      safeSessionStorage(),
      OAUTH_VERIFIER_STORAGE_KEY,
      LEGACY_OAUTH_VERIFIER_STORAGE_KEY,
    );
  } catch {
    verifier = null;
  }
  if (!verifier) {
    throw new ApiError("That sign-in did not finish. Start again from Log in.", {
      code: "oauth_verifier_missing",
      status: 400,
    });
  }
  const response = await fetch(`${url}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  if (!response.ok) {
    throw new ApiError("That Google sign-in did not complete. Try again.", {
      code: "oauth_exchange_failed",
      status: response.status,
    });
  }
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token || !payload.refresh_token) {
    throw new ApiError("That Google sign-in did not complete. Try again.", {
      code: "oauth_exchange_failed",
      status: 400,
    });
  }
  // Best effort cleanup only, of both keys.
  removeWithLegacy(
    safeSessionStorage(),
    OAUTH_VERIFIER_STORAGE_KEY,
    LEGACY_OAUTH_VERIFIER_STORAGE_KEY,
  );
  // Tokens are verified by the backend before they are trusted (see above).
  return adoptSupabaseTokens({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in,
  });
}

/** Changes the password for the current session through Supabase Auth. */
export async function changePassword(newPassword: string): Promise<void> {
  const token = getAccessToken();
  if (!token) {
    throw new ApiError("Sign in to change your password.", {
      code: "unauthorized",
      status: 401,
    });
  }
  if (newPassword.length < 8) {
    throw new ApiError("Use at least 8 characters for your password.", {
      code: "unprocessable_entity",
      status: 422,
    });
  }
  const { url, publishableKey } = supabaseAuthBase();
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: newPassword }),
  });
  if (!response.ok) {
    throw new ApiError("That password could not be saved. Try a stronger one.", {
      code: "password_change_failed",
      status: response.status,
    });
  }
}

/** Reads the provider identities linked to the current Supabase user. */
export async function fetchLinkedProviders(): Promise<Array<{ provider: string }>> {
  const token = getAccessToken();
  if (!token) return [];
  const { url, publishableKey } = supabaseAuthBase();
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { identities?: Array<{ provider?: string }> };
  return (payload.identities ?? [])
    .map((identity) => ({ provider: String(identity.provider ?? "").toLowerCase() }))
    .filter((entry) => entry.provider !== "");
}

/** Exchanges an email and password for a session. */
export function signIn(email: string, password: string): Promise<AuthSession> {
  return apiFetch<AuthSession>(Routes.signIn, {
    method: "POST",
    body: { email, password },
  }).then(adopt);
}

/**
 * Rotates the current session: the new pair always replaces the stored one.
 *
 * Whether Supabase also invalidates the *previous* refresh token depends on the
 * project's refresh-token rotation setting, and it is a project setting rather
 * than something this client controls. It was measured **off** for this project
 * on 2026-10-08 — the same refresh token was accepted repeatedly, a minute
 * apart — so until that changes, a refresh token has to be treated as a live
 * credential for its whole lifetime rather than as single-use. See the
 * production verification section of docs/deployment/vercel.md.
 */
export function refreshSession(): Promise<AuthSession> {
  const refreshToken = tokens?.refreshToken;
  if (!refreshToken) {
    return Promise.reject(new Error("There is no session to refresh."));
  }
  const startedAt = generation;
  return rotate(refreshToken).then((payload) => {
    // A sign-in or sign-out that landed while this was in flight wins.
    if (generation !== startedAt) return payload;
    return adopt(payload);
  });
}

/** What rotating a refused access token produced. */
export type RefusedSessionOutcome = "rotated" | "signed-out" | "transient";

/**
 * Reacts to a call refused with 401 while a session is held: rotates the pair
 * if the refresh token can still do it. A refused *access* token may merely
 * have lapsed, so the session is forgotten only when the credential itself is
 * definitively refused — clearing it on any 401 would sign out a visitor whose
 * refresh token is still valid.
 *
 * `transient` means the server could not answer (network, 429, 5xx): the
 * session is kept for a later attempt and nothing new was adopted, so the
 * caller must not retry with the token that was refused.
 */
export async function rotateRefusedSession(): Promise<RefusedSessionOutcome> {
  const pair = tokens;
  if (!pair) return "signed-out";
  const startedAt = generation;
  try {
    const payload = await rotate(pair.refreshToken);
    if (generation !== startedAt) {
      // The session moved on while this was in flight — usually because a
      // concurrent rotation adopted the new pair. That is a usable credential,
      // not a transient failure: the caller retries with it.
      return state.status === "authenticated" ? "rotated" : "signed-out";
    }
    if (!payload.tokens) {
      clearSession();
      return "signed-out";
    }
    adoptTokens(payload.tokens, payload.session);
    return "rotated";
  } catch (error) {
    if (generation !== startedAt) {
      return state.status === "authenticated" ? "rotated" : "signed-out";
    }
    if (isDefinitiveAuthFailure(error)) {
      if (adoptNewerStoredPair(pair.refreshToken)) return "rotated";
      clearSession();
      return "signed-out";
    }
    return "transient";
  }
}

/**
 * Confirms the stored token against the server, adopts the answer and returns
 * it. The body of `GET /auth/session` comes from the verified token, so this is
 * the authoritative answer to "is this session still valid" — and to "is this
 * account registered": a registration recorded a moment ago shows up in the
 * reactive state and in the stored copy without a full sign-in.
 */
export async function loadSession(): Promise<Session> {
  const token = getAccessToken();
  if (!token) {
    throw new Error("There is no session to read.");
  }
  const startedAt = generation;
  const view = await apiFetch<Session>(Routes.session, { token });
  // A sign-in or sign-out that landed while this was in flight wins.
  if (generation !== startedAt) return view;
  if (tokens) persistSession(tokens, view);
  publish({ status: "authenticated", session: view });
  return view;
}

/**
 * Revokes the session and forgets it locally.
 *
 * The local session is cleared before the request is sent, so a failure cannot
 * leave a signed-out user holding a token. A failed revoke is reported to the
 * caller rather than swallowed; the access token stops being accepted when it
 * expires regardless.
 */
export async function signOut(): Promise<void> {
  const token = getAccessToken();
  clearSession();
  if (!token) return;
  await apiFetch<void>(Routes.signOut, { method: "POST", token });
}
