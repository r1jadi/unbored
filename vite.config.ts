// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { createHash } from "node:crypto";

import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

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

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  plugins: [offlineManifest()],
});
