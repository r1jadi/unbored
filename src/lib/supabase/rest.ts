/**
 * Minimal Supabase REST helpers for data the Go API does not serve yet.
 *
 * The Go gateway owns auth, users, games and admin. Social reads that Row
 * Level Security already authorises (public profile projection, follows,
 * notifications) go straight to the Supabase Data API with the publishable
 * key, exactly as the avatar upload already does (`src/lib/users/profile.ts`).
 * The caller's own access token is the credential, so RLS stays the boundary
 * and no secret ever reaches the browser.
 *
 * Nothing here invents data: a failed read is an error, never a fallback row.
 */

import { publicConfig } from "@/lib/config";

import { t } from "@/lib/settings/language";
export function supabaseBase(): string {
  return publicConfig.supabase.url.replace(/\/+$/, "");
}

export function supabaseHeaders(token?: string): Record<string, string> {
  const { publishableKey } = publicConfig.supabase;
  const headers: Record<string, string> = {
    apikey: publishableKey,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export function requireSupabaseRest(): { base: string; key: string } {
  const base = supabaseBase();
  const key = publicConfig.supabase.publishableKey;
  if (base === "" || key === "") {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example).",
    );
  }
  return { base, key };
}

/** A Supabase PostgREST error payload, trimmed to what callers need. */
export class SupabaseRestError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "SupabaseRestError";
    this.status = status;
    this.code = code;
  }
}

export async function restGet<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const { base } = requireSupabaseRest();
  const response = await fetch(`${base}/rest/v1/${path.replace(/^\/+/, "")}`, {
    ...init,
    headers: { ...supabaseHeaders(token), ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    throw await toRestError(response);
  }
  return (await response.json()) as T;
}

/**
 * An exact row count for a filtered read, without fetching the rows.
 *
 * PostgREST answers `Prefer: count=exact` with a `Content-Range: first-last/total`
 * header; the single row requested (`limit=1`) keeps the body trivial. A missing
 * or unparsable header is an error rather than a zero — a zero is a measurement
 * and must come from the database, never from a failed parse.
 */
export async function restCount(path: string, token?: string): Promise<number> {
  const { base } = requireSupabaseRest();
  const clean = path.replace(/^\/+/, "");
  // A minimal body: the total comes from the header, not the rows. Callers pass
  // their own `select=` for a column the table actually has.
  const withSelect = clean.includes("select=")
    ? clean
    : `${clean}${clean.includes("?") ? "&" : "?"}select=*`;
  const url = withSelect.includes("limit=") ? withSelect : `${withSelect}&limit=1`;
  const response = await fetch(`${base}/rest/v1/${url}`, {
    headers: { ...supabaseHeaders(token), Prefer: "count=exact" },
  });
  if (!response.ok) {
    throw await toRestError(response);
  }
  const range = response.headers.get("Content-Range");
  const total = range?.split("/")[1];
  const count = total === undefined ? NaN : Number(total);
  if (!Number.isInteger(count) || count < 0) {
    throw new SupabaseRestError(t("The count could not be read."), response.status, "count_failed");
  }
  return count;
}

export async function restMutate(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  token: string,
  body?: unknown,
  prefer?: string,
): Promise<Response> {
  const { base } = requireSupabaseRest();
  const headers: Record<string, string> = { ...supabaseHeaders(token) };
  if (prefer) headers["Prefer"] = prefer;
  const response = await fetch(`${base}/rest/v1/${path.replace(/^\/+/, "")}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw await toRestError(response);
  }
  return response;
}

async function toRestError(response: Response): Promise<SupabaseRestError> {
  let message = t("Request failed with status {status}.", { status: response.status });
  let code: string | undefined;
  try {
    const payload = (await response.json()) as { message?: string; code?: string; hint?: string };
    if (typeof payload.message === "string" && payload.message !== "") message = payload.message;
    if (typeof payload.code === "string") code = payload.code;
  } catch {
    // A non-JSON failure keeps the generic message; the status is the signal.
  }
  return new SupabaseRestError(message, response.status, code);
}
