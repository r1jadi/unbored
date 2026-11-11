#!/usr/bin/env node
/**
 * Runs the whole app locally, the way production is wired, in one command:
 *
 *   web      http://localhost:8081   Vite dev server (the TanStack app)
 *   gateway  http://localhost:8080   the Go API gateway the web app calls
 *   auth     http://localhost:8091   ┐
 *   users    http://localhost:8092   ├ the services behind the gateway
 *   games    http://localhost:8093   ┘ catalogue, play sessions, admin, digests
 *
 * The four API processes are the four the deployment runs (see vercel.json and
 * docs/deployment/vercel.md); every other route group answers 503 locally, as it
 * does in production. Supabase is whichever project `.env.local` names.
 *
 * The Go services read their configuration from the environment only, so this
 * script reads `.env.local` and hands it to every process, then points the
 * gateway's UPSTREAM_*_URL at the local services. Values are never printed.
 *
 *   node scripts/dev-stack.mjs            # everything
 *   node scripts/dev-stack.mjs --api      # the API only, no web server
 *   node scripts/dev-stack.mjs --gateway-port 8090   # when 8080 is taken
 *
 * Ctrl+C stops every process; if one exits, the rest are stopped too.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const servicesDir = join(root, "services");
const apiOnly = process.argv.includes("--api");

// `--gateway-port 8090` moves the gateway when something else already holds 8080.
const gatewayFlag = process.argv.indexOf("--gateway-port");
const gatewayPort = gatewayFlag === -1 ? 8080 : Number(process.argv[gatewayFlag + 1]);
if (!Number.isInteger(gatewayPort) || gatewayPort <= 0) {
  console.error("--gateway-port needs a port number, e.g. --gateway-port 8090");
  process.exit(1);
}

const PORTS = { web: 8081, gateway: gatewayPort, auth: 8091, users: 8092, games: 8093 };

/** `.env.local` as an object: KEY=VALUE lines, quotes and `export` allowed. */
function readEnvFile(path) {
  if (!existsSync(path)) {
    console.error(`Missing ${path}. Copy .env.example to .env.local and fill it in.`);
    process.exit(1);
  }
  const values = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    values[match[1]] = value;
  }
  return values;
}

const fileEnv = readEnvFile(join(root, ".env.local"));
const local = (port) => `http://localhost:${port}`;

const shared = {
  ...process.env,
  ...fileEnv,
  ENVIRONMENT: fileEnv.ENVIRONMENT || "development",
  // Readable logs in a terminal; production keeps JSON.
  LOG_FORMAT: "text",
  // The browser calls the gateway from the web port, so it must be allowed.
  CORS_ALLOWED_ORIGINS: [
    ...new Set([
      ...(fileEnv.CORS_ALLOWED_ORIGINS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      local(PORTS.web),
    ]),
  ].join(","),
};

const COLOURS = { web: 36, gateway: 35, auth: 33, users: 32, games: 34 };

const processes = [
  {
    name: "auth",
    command: "go",
    args: ["run", "./auth/cmd/auth"],
    cwd: servicesDir,
    env: { HTTP_ADDR: `:${PORTS.auth}` },
  },
  {
    name: "users",
    command: "go",
    args: ["run", "./users/cmd/users"],
    cwd: servicesDir,
    env: { HTTP_ADDR: `:${PORTS.users}` },
  },
  {
    // services/main.go: the catalogue, play sessions, admin and digests in one
    // process, exactly as deployed.
    name: "games",
    command: "go",
    args: ["run", "."],
    cwd: servicesDir,
    env: { HTTP_ADDR: `:${PORTS.games}` },
  },
  {
    name: "gateway",
    command: "go",
    args: ["run", "./gateway/cmd/gateway"],
    cwd: servicesDir,
    env: {
      HTTP_ADDR: `:${PORTS.gateway}`,
      UPSTREAM_AUTH_URL: local(PORTS.auth),
      UPSTREAM_USERS_URL: local(PORTS.users),
      UPSTREAM_GAMES_URL: local(PORTS.games),
    },
  },
];
if (!apiOnly) {
  processes.push({
    name: "web",
    command: "npm",
    args: ["run", "dev", "--", "--port", String(PORTS.web), "--strictPort"],
    cwd: root,
    env: { VITE_API_BASE_URL: `${local(PORTS.gateway)}/api/v1` },
  });
}

const children = [];
let stopping = false;

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    // `go run` and `npm` start a child of their own; on Windows only taskkill
    // takes the whole tree down.
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      child.kill("SIGINT");
    }
  }
  setTimeout(() => process.exit(code), 1500);
}

function prefixLines(name, stream, target) {
  const tag = `\x1b[${COLOURS[name]}m${name.padEnd(7)}\x1b[0m│ `;
  let pending = "";
  stream.on("data", (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) target.write(tag + line + "\n");
  });
}

for (const spec of processes) {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...shared, ...spec.env },
    // npm is a .cmd script on Windows, which needs a shell to start.
    shell: process.platform === "win32",
  });
  children.push(child);
  prefixLines(spec.name, child.stdout, process.stdout);
  prefixLines(spec.name, child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (stopping) return;
    console.error(`\n${spec.name} exited (${code}); stopping the rest.`);
    stopAll(code ?? 1);
  });
}

console.log(
  [
    "",
    "Unbored, locally:",
    apiOnly ? null : `  web      ${local(PORTS.web)}`,
    `  api      ${local(PORTS.gateway)}/api/v1`,
    `  services auth :${PORTS.auth}, users :${PORTS.users}, games :${PORTS.games}`,
    "  (the first start compiles the Go services and takes a minute)",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n"),
);

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
