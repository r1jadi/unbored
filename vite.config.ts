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
      // Only for a build. Vercel is the default, and `NITRO_PRESET` can still override it.
      ...(command === "build" ? [nitro({ defaultPreset: "vercel" })] : []),
      viteReact(),
      offlineManifest(),
    ],
  };
});
