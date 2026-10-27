#!/usr/bin/env node
/**
 * Contract drift check.
 *
 * The Go gateway routes `/api/v1/<group>` by `services/internal/apiroutes/routes.go`,
 * and every group must be documented in `packages/api-contracts/openapi-v1.yaml`.
 * This script compares the two so a new service route cannot ship undocumented —
 * and a documented group cannot silently disappear from the router.
 *
 *   node scripts/check-api-contract.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES_SOURCE = resolve(root, "services/internal/apiroutes/routes.go");
const CONTRACT = resolve(root, "packages/api-contracts/openapi-v1.yaml");

function fail(message) {
  console.error(`api-contract: ${message}`);
  process.exit(1);
}

// Windows checkouts have CRLF line endings (core.autocrlf), which would make
// every anchored pattern below miss. Normalise before parsing.
function read(file) {
  return readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

/**
 * Groups from the Go table: { Prefix: BasePath + "/games", Service: "games" }.
 *
 * OpenAPI paths are relative to the server URL (`.../api/v1`), so the version
 * prefix is stripped here and re-checked in the contract's `servers` block.
 */
const API_BASE = "/api/v1";

function routedGroups() {
  const source = read(ROUTES_SOURCE);
  const version = /const Version = "([^"]+)"/.exec(source)?.[1];
  if (version !== "v1" || !source.includes('const BasePath = "/api/" + Version')) {
    fail(
      `services/internal/apiroutes/routes.go no longer composes BasePath as "/api/" + Version with Version = "v1"`,
    );
  }
  const groups = [...source.matchAll(/Prefix: BasePath \+ "([^"]+)", Service: "([^"]+)"/g)].map(
    (match) => ({ prefix: match[1], service: match[2] }),
  );
  if (groups.length === 0) {
    fail("could not read any group from services/internal/apiroutes/routes.go");
  }
  return groups;
}

/** Documented paths: the YAML block keys under `paths:`, two-space indented. */
function documentedPaths() {
  const source = read(CONTRACT);
  if (!source.includes(`url: https://unbored.lol${API_BASE}`)) {
    fail(`the contract does not declare a server at ...${API_BASE}`);
  }
  const pathsBlock = source.slice(source.indexOf("\npaths:"));
  const paths = [...pathsBlock.matchAll(/^ {2}(\/[A-Za-z0-9/{}._-]*):$/gm)].map(
    (match) => match[1],
  );
  if (paths.length === 0) {
    fail("could not read any path from the OpenAPI contract");
  }
  return paths;
}

const groups = routedGroups();
const paths = documentedPaths();

const undocumented = groups.filter(
  (group) => !paths.some((path) => path === group.prefix || path.startsWith(`${group.prefix}/`)),
);
if (undocumented.length > 0) {
  fail(
    `these routed groups have no documented endpoint: ${undocumented
      .map((group) => `${group.prefix} (${group.service})`)
      .join(", ")}`,
  );
}

// The reverse direction: a documented path the gateway cannot route would ship
// a contract that 503s for every caller.
// Paths the gateway answers itself rather than proxying to a service group: the
// version endpoint and the versioned liveness probe (httpx.HealthPath, which the
// gateway's own router serves — see services/gateway/internal/proxy).
const GATEWAY_OWNED_PATHS = ["/", "/health"];

const unroutable = paths.filter(
  (path) =>
    !GATEWAY_OWNED_PATHS.includes(path) &&
    !groups.some((group) => path === group.prefix || path.startsWith(`${group.prefix}/`)),
);
if (unroutable.length > 0) {
  fail(`these documented paths are not routed by the gateway: ${unroutable.join(", ")}`);
}

console.log(
  `api-contract: ${groups.length} routed groups are documented across ${paths.length} paths (base ${API_BASE}).`,
);
