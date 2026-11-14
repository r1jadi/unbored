import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

/**
 * Emits `/offline-manifest.json`: every file of the client build, so the service
 * worker (`public/sw.js`) can cache all of the app's code up front — including the
 * chunks a game only loads once a run starts, such as its puzzle bank — and play
 * offline. `version` changes whenever the build does, which is how the worker
 * knows a deploy happened and drops the previous build's files.
 */
function offlineManifest(): Plugin {
  return {
    name: "unbored:offline-manifest",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((file) => !file.endsWith(".map") && !file.startsWith("."))
        .sort();
      const version = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 16);
      this.emitFile({
        type: "asset",
        fileName: "offline-manifest.json",
        source: JSON.stringify({ version, files: files.map((file) => `/${file}`) }),
      });
    },
  };
}

/**
 * Old game slugs → their current names, as 301s from the server (on Cloudflare
 * Workers in production, or a Node build locally).
 */
function renamedGameRedirects() {
  const renamed = { queens: "crowns", zip: "trail", tango: "sun-and-moon" };
  const rules: Record<string, { redirect: { to: string; status: 301 } }> = {};
  for (const section of ["games", "play", "leaderboards"]) {
    for (const [from, to] of Object.entries(renamed)) {
      rules[`/${section}/${from}`] = { redirect: { to: `/${section}/${to}`, status: 301 } };
    }
  }
  return rules;
}

/**
 * Headers for the static files, which Cloudflare serves without running the
 * Worker: Nitro writes these rules into the build's `_headers`. `nosniff`, and a
 * same-site `Access-Control-Allow-Origin` instead of a CDN's default `*` (what
 * vercel.json used to set at Vercel's edge).
 */
function staticFileHeaders() {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "https://unbored.lol",
  };
  const paths = [
    "/assets/**",
    "/og/**",
    "/favicon.ico",
    "/favicon.png",
    "/favicon.svg",
    "/apple-touch-icon.png",
    "/icon-192.png",
    "/icon-512.png",
    "/manifest.webmanifest",
    "/offline-manifest.json",
    "/sw.js",
    "/robots.txt",
    "/sitemap.xml",
    "/.well-known/security.txt",
  ];
  return Object.fromEntries(paths.map((path) => [path, { headers }]));
}

export default defineConfig(({ command, mode }) => {
  // The server entry and the client both read `import.meta.env.VITE_*`.
  const define = Object.fromEntries(
    Object.entries(loadEnv(mode, process.cwd(), "VITE_")).map(([key, value]) => [
      `import.meta.env.${key}`,
      JSON.stringify(value),
    ]),
  );

  return {
    define,
    server: { host: "::", port: 8080 },
    css: { transformer: "lightningcss" },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        // Redirects TanStack Start's server entry to src/server.ts (our SSR error wrapper).
        server: { entry: "server" },
        importProtection: {
          behavior: "error",
          client: { files: ["**/server/**"], specifiers: ["server-only"] },
        },
      }),
      // Only for a build. Cloudflare Workers is the default (production runs
      // there; docs/deployment/production.md), and `NITRO_PRESET` can still
      // override it, e.g. `NITRO_PRESET=node-server` for a local Node build.
      ...(command === "build"
        ? [
            nitro({
              defaultPreset: "cloudflare_module",
              routeRules: { ...staticFileHeaders(), ...renamedGameRedirects() },
              // Merged into the generated .output/server/wrangler.json. Wrangler
              // 4.162+ refuses `wrangler preview` (Cloudflare's preview deploys)
              // without a `previews` block; an empty one is all it needs.
              cloudflare: { wrangler: { previews: {} } },
            }),
          ]
        : []),
      viteReact(),
      offlineManifest(),
    ],
  };
});
