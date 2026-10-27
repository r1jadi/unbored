#!/usr/bin/env node
/**
 * Generates public/sitemap.xml from the SEO allowlist in src/lib/seo.ts.
 *
 * The static paths are parsed out of `INDEXABLE_PATHS` so there is exactly one
 * source of truth for "is this route public?". Catalogue pages (/games/*,
 * /categories/*) are listed below until the catalogue is served from Postgres —
 * at that point this script should query the API instead.
 *
 *   node scripts/generate-sitemap.mjs           # write public/sitemap.xml
 *   node scripts/generate-sitemap.mjs --check   # fail if the file is stale (CI)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEO_SOURCE = resolve(root, "src/lib/seo.ts");
const OUTPUT = resolve(root, "public/sitemap.xml");
const DEFAULT_ORIGIN = "https://unbored.lol";

// Catalogue entries. Replace with a database/API query in the catalogue task.
const DYNAMIC_PATHS = [
  ...["puzzle", "arcade", "logic", "reaction", "memory", "daily", "word", "strategy"].map(
    (slug) => `/categories/${slug}`,
  ),
  ...[
    "stack-10",
    "color-merge",
    "dont-touch-the-black",
    "one-move",
    "dont-break-the-chain",
    "memory-flash",
    "7-second",
    "crowns",
    "trail",
    "8-puzzle",
    "sun-and-moon",
    "sudoku",
  ].map((id) => `/games/${id}`),
];

function siteOrigin() {
  const raw = (process.env.VITE_PUBLIC_SITE_URL ?? "").trim();
  if (!raw) return DEFAULT_ORIGIN;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : DEFAULT_ORIGIN;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

/** Reads the literal entries of `const INDEXABLE_PATHS = new Set([...])`. */
function staticPathsFromSource() {
  const source = readFileSync(SEO_SOURCE, "utf8");
  const block = /const INDEXABLE_PATHS = new Set\(\[(?<body>[^\]]*)\]\)/.exec(source);
  if (!block?.groups?.body) {
    throw new Error(
      `Could not find INDEXABLE_PATHS in ${SEO_SOURCE}. Update scripts/generate-sitemap.mjs to match src/lib/seo.ts.`,
    );
  }
  const paths = block.groups.body
    .match(/"(?:[^"\\]|\\.)*"/g)
    ?.map((literal) => JSON.parse(literal));
  if (!paths?.length) {
    throw new Error("INDEXABLE_PATHS is empty — refusing to write an empty sitemap.");
  }
  return paths;
}

function buildSitemap() {
  const origin = siteOrigin();
  const paths = [...staticPathsFromSource(), ...DYNAMIC_PATHS];
  const unique = [...new Set(paths)].sort((a, b) =>
    a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b),
  );

  const urls = unique
    .map((path) => `  <url><loc>${new URL(path, `${origin}/`).href}</loc></url>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated file — do not edit by hand.
  Source of truth: INDEXABLE_PATHS in src/lib/seo.ts
  Regenerate: node scripts/generate-sitemap.mjs
  Origin: VITE_PUBLIC_SITE_URL (see .env.example)
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function main() {
  const sitemap = buildSitemap();
  const check = process.argv.includes("--check");

  if (check) {
    let current = "";
    try {
      current = readFileSync(OUTPUT, "utf8");
    } catch {
      console.error("public/sitemap.xml is missing. Run: node scripts/generate-sitemap.mjs");
      process.exit(1);
    }
    if (current !== sitemap) {
      console.error(
        "public/sitemap.xml is out of date. Run: node scripts/generate-sitemap.mjs and commit the result.",
      );
      process.exit(1);
    }
    console.log("sitemap.xml is up to date.");
    return;
  }

  writeFileSync(OUTPUT, sitemap, "utf8");
  console.log(`Wrote ${OUTPUT}`);
}

main();
