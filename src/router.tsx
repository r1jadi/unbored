import { createRouter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

import { CSP_NONCE_HEADER } from "./lib/csp";
import { getQueryClient } from "./lib/query";
import { routeTree } from "./routeTree.gen";

// The Content-Security-Policy nonce for this response. The server reads the one
// src/server.ts generated; the browser reads it back from the `csp-nonce` meta
// tag the router renders, so scripts it adds after hydration carry it too.
const getCspNonce = createIsomorphicFn()
  .server(() => getRequestHeader(CSP_NONCE_HEADER))
  .client(
    () =>
      document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.content || undefined,
  );

export const getRouter = () => {
  const queryClient = getQueryClient();

  const router = createRouter({
    routeTree,
    ssr: { nonce: getCspNonce() },
    context: { queryClient },
    scrollRestoration: true,
    // Hovering or touching a link starts loading that page's code and data, so
    // most taps land on a screen that is already filled in.
    defaultPreload: "intent",
    // The query cache decides freshness; the router always asks it.
    defaultPreloadStaleTime: 0,
  });

  return router;
};
