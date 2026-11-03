/**
 * Typed client for the versioned Go API (`/api/v1`).
 *
 * Rules this module exists to enforce:
 *   - the caller identity is never sent in a body or query string; it travels
 *     in the `Authorization` header (a verified Supabase access token);
 *   - every response is either the documented payload or the shared error
 *     envelope, so failures surface as one `ApiError` type;
 *   - requests are bounded by a timeout and correlated by `X-Request-ID`.
 */

import { publicConfig } from "@/lib/config";

import { t } from "@/lib/settings/language";
export type ApiErrorDetail = { field?: string; rule?: string; message?: string };

type ApiErrorEnvelope = {
  error?: {
    code?: string;
    message?: string;
    /** The envelope's own field name: the Go API serialises it snake_case. */
    request_id?: string;
    /** Read as a fallback so a response written against the older spelling still works. */
    requestId?: string;
    details?: Array<ApiErrorDetail>;
  };
};

/** A failure returned by the API, or a transport failure talking to it. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly details: Array<ApiErrorDetail>;

  constructor(
    message: string,
    options: {
      code?: string;
      status?: number;
      requestId?: string;
      details?: Array<ApiErrorDetail>;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = options.code ?? "unknown_error";
    this.status = options.status ?? 0;
    this.requestId = options.requestId;
    this.details = options.details ?? [];
  }

  /** True when the caller needs to sign in again. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

export type ApiRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** JSON body. Unknown fields are rejected by the API, so send exact shapes. */
  body?: unknown;
  /** Verified Supabase access token. Omit for public endpoints. */
  token?: string;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  /** Defaults to 15s. Long-running work should be a job, not a slow request. */
  timeoutMs?: number;
  /**
   * Retry a 502/503/504 or a dropped connection even though this is not a GET.
   * Only for writes the server deduplicates — sending the identical body twice
   * must be recorded once — such as a run's completion.
   */
  retryable?: boolean;
};

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * A gateway that is starting up (or briefly unreachable) answers 502/503/504.
 * Those are worth retrying for a read, because the same request a moment later
 * is served — a cold service is not a failure the visitor should have to undo
 * by hand. Mutations are not retried here unless the caller says the write is
 * idempotent (`retryable`): a duplicated write is worse than a visible error.
 */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
// The first retry is immediate: a gateway that was starting has usually finished
// by the time the response arrives. The second waits, but not so long that a real
// outage hides behind a spinner.
const RETRY_DELAYS_MS = [0, 400];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Builds the absolute request URL from the configured base. */
export function buildUrl(path: string, query?: ApiRequestOptions["query"]): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(
    `${publicConfig.apiBaseUrl}${normalized}`,
    globalThis.location?.origin ?? "http://localhost",
  );
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function requestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function timeoutSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal | undefined {
  const timeout =
    typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  if (!timeout) return signal;
  if (!signal) return timeout;
  // Prefer combining so either the caller's abort or the timeout wins.
  return "any" in AbortSignal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Calls the API and returns the typed payload.
 *
 * @throws ApiError for any non-2xx response, timeout or malformed payload.
 */
export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    body,
    token,
    query,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryable = false,
  } = options;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Request-ID": requestId(),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const idempotent = method === "GET" || retryable;
  const url = buildUrl(path, query);

  let response: Response | undefined;
  for (let attempt = 0; ; attempt++) {
    const lastAttempt = !idempotent || attempt === RETRY_DELAYS_MS.length;
    try {
      response = await fetch(url, {
        method,
        headers,
        // No cookies: authentication is a bearer token, which also removes
        // cross-site request forgery as an attack path for the API.
        credentials: "omit",
        cache: "no-store",
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: timeoutSignal(timeoutMs, signal),
      });
    } catch (cause) {
      // A caller that aborted, or a request that ran out of time, is the
      // answer already; retrying it would only delay the report.
      const aborted = cause instanceof Error && cause.name === "TimeoutError";
      if (signal?.aborted || aborted || lastAttempt) {
        throw new ApiError(
          aborted ? t("The request timed out. Try again.") : t("Could not reach the server."),
          {
            code: aborted ? "timeout" : "network_error",
          },
        );
      }
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }

    if (lastAttempt || !RETRYABLE_STATUSES.has(response.status)) break;
    await response.text().catch(() => undefined);
    await sleep(RETRY_DELAYS_MS[attempt]);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = parseJson(text);

  if (!response.ok) {
    // A gateway that stayed unavailable through every attempt keeps its own
    // status, so callers can still tell an outage (503) from a refusal (4xx).
    const envelope = (payload ?? {}) as ApiErrorEnvelope;
    // A bare 502/503/504 comes from the platform in front of the API, not from
    // the API, so it has no message of its own to pass through.
    const fallback = RETRYABLE_STATUSES.has(response.status)
      ? t("The server is busy right now. Try again in a moment.")
      : t("Request failed with status {status}.", { status: response.status });
    throw new ApiError(envelope.error?.message ?? fallback, {
      code: envelope.error?.code ?? "http_error",
      status: response.status,
      requestId:
        envelope.error?.request_id ??
        envelope.error?.requestId ??
        response.headers.get("X-Request-ID") ??
        undefined,
      details: envelope.error?.details ?? [],
    });
  }

  if (payload === undefined) {
    throw new ApiError(t("The server returned a response that could not be read."), {
      code: "invalid_response",
      status: response.status,
    });
  }

  return payload as T;
}

function parseJson(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
