import "./lib/error-capture";

import { CSP_NONCE_HEADER, contentSecurityPolicy, createCspNonce } from "./lib/csp";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// Hands the router this request's CSP nonce (see src/lib/csp.ts). Only GET and
// HEAD render documents; rebuilding a request that has a body would mean
// re-streaming it, for a nonce nothing would use. Any client-sent value is
// overwritten, never trusted.
function withCspNonce(request: Request, nonce: string): Request {
  if (request.method !== "GET" && request.method !== "HEAD") return request;
  const headers = new Headers(request.headers);
  headers.set(CSP_NONCE_HEADER, nonce);
  // Built from the URL, not `new Request(request, ...)`: the server runtime's
  // request object is not always one undici accepts as an input.
  return new Request(request.url, { method: request.method, headers, signal: request.signal });
}

// Security headers for rendered documents. Applied here rather than in a
// platform-specific config file so every deployment target gets the same
// response: the SSR handler is the only path that returns HTML.
//
// The CSP is production-only: Vite's dev server injects its own inline scripts
// (HMR, the React refresh preamble) that carry no nonce.
function withSecurityHeaders(response: Response, nonce: string): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  const headers = new Headers(response.headers);
  if (import.meta.env.PROD) {
    headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  }
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  // HSTS is ignored over plain HTTP, so this is safe in development too.
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const nonce = createCspNonce();
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(withCspNonce(request, nonce), env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response), nonce);
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
        nonce,
      );
    }
  },
};
