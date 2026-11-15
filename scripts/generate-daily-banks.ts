/**
 * Writes the banks of Ton Up, Ballpark, Only Once, Pixelock and Honeycomb into their migrations.
 *
 *   bun scripts/generate-daily-banks.ts           # report whether they match
 *   bun scripts/generate-daily-banks.ts --write   # rewrite the migrations' blocks
 *
 * The client's banks (`src/lib/games/ton-up-bank.ts`, `ballpark-bank.ts` and
 * `only-once-bank.ts`, `pixelock-bank.ts`, `honeycomb-bank.ts`) are the source. The database only needs the numbers — each
 * category's values, each product's price, each puzzle's answer sets — and holds
 * them between `-- name:begin` and `-- name:end` markers in the sessions
 * migrations (`src/lib/games/daily-banks-sql.ts` builds them). The games' tests
 * fail when the two drift, which is when to run this with --write. Tee Time has no
 * bank: both sides build its course from the day.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { BANK_TARGETS, replaceBlock } from "../src/lib/games/daily-banks-sql";

const ROOT = resolve(import.meta.dir, "..");
const write = process.argv.includes("--write");
let stale = 0;

for (const target of BANK_TARGETS) {
  const path = resolve(ROOT, target.file);
  const before = readFileSync(path, "utf8");
  let after = before;
  for (const [name, body] of Object.entries(target.blocks())) {
    after = replaceBlock(after, name, body);
  }
  if (after !== before) {
    stale += 1;
    if (write) writeFileSync(path, after);
    console.log(`${write ? "rewrote" : "stale:"} ${target.file}`);
  } else {
    console.log(`up to date: ${target.file}`);
  }
}
if (stale && !write) process.exitCode = 1;
