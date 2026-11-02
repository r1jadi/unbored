#!/usr/bin/env node
/**
 * Generates the Mini Sudoku puzzle bank: 6×6 puzzles, each with exactly one
 * solution, that `mini-sudoku@1` disguises with a seeded shuffle at play time.
 *
 *   node scripts/generate-mini-sudoku-bank.mjs           # print the bank as JSON
 *   node scripts/generate-mini-sudoku-bank.mjs --write   # rewrite the bank's two copies
 *
 * --write rewrites `src/lib/games/mini-sudoku-bank.ts` and the bank inside
 * `supabase/migrations/20261126120000_mini_sudoku_sessions.sql`. The two must
 * always match; the SQL suite and `mini-sudoku.test.ts` assert the same boards.
 * The bank is a fixed asset, not something to regenerate casually: changing it
 * changes every board, so it needs a new rules version.
 *
 * ## Why a bank
 *
 * Relabelling digits and shuffling rows within a band, the bands, columns within
 * a stack and the stacks all keep a puzzle's solutions one-for-one, so a puzzle
 * with one solution stays one. The database can therefore serve unique boards by
 * picking a bank entry and shuffling it, instead of searching inside a verifier.
 *
 * ## The grid
 *
 * 6×6 in boxes two rows tall and three columns wide: three bands of two rows and
 * two stacks of three columns. A puzzle is a string of 36 digits in reading
 * order, 0 for an empty cell.
 *
 * ## Tiers
 *
 * By the number of givens, fewest last: gentle 19, easy 16, medium 14, hard 12.
 * Every puzzle is checked to have exactly one solution. Generation is
 * deterministic (a fixed-seed LCG), so a re-run reproduces the bank.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIDE = 6;
const CELLS = 36;
const BOX_ROWS = 2;
const BOX_COLS = 3;
const PER_TIER = 30;
const TIERS = [
  { name: "gentle", givens: 19 },
  { name: "easy", givens: 16 },
  { name: "medium", givens: 14 },
  { name: "hard", givens: 12 },
];

let state = 20261124;
function random() {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 4294967296;
}
function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

const PEERS = Array.from({ length: CELLS }, (_, cell) => {
  const row = Math.floor(cell / SIDE);
  const column = cell % SIDE;
  const peers = new Set();
  for (let other = 0; other < CELLS; other += 1) {
    if (other === cell) continue;
    const r = Math.floor(other / SIDE);
    const c = other % SIDE;
    const sameBox =
      Math.floor(r / BOX_ROWS) === Math.floor(row / BOX_ROWS) &&
      Math.floor(c / BOX_COLS) === Math.floor(column / BOX_COLS);
    if (r === row || c === column || sameBox) peers.add(other);
  }
  return [...peers];
});

function options(grid, cell) {
  const taken = new Set(PEERS[cell].map((peer) => grid[peer]));
  return [1, 2, 3, 4, 5, 6].filter((digit) => !taken.has(digit));
}

/** Counts solutions of a grid, stopping at `limit`. */
function countSolutions(grid, limit) {
  let best = -1;
  let bestOptions = null;
  for (let cell = 0; cell < CELLS; cell += 1) {
    if (grid[cell] !== 0) continue;
    const fits = options(grid, cell);
    if (fits.length === 0) return 0;
    if (bestOptions === null || fits.length < bestOptions.length) {
      best = cell;
      bestOptions = fits;
    }
  }
  if (best < 0) return 1;
  let total = 0;
  for (const digit of bestOptions) {
    grid[best] = digit;
    total += countSolutions(grid, limit - total);
    grid[best] = 0;
    if (total >= limit) break;
  }
  return total;
}

/** A random full grid, by randomised backtracking. */
function fullGrid() {
  const grid = new Array(CELLS).fill(0);
  const fill = (cell) => {
    if (cell === CELLS) return true;
    for (const digit of shuffle(options(grid, cell))) {
      grid[cell] = digit;
      if (fill(cell + 1)) return true;
    }
    grid[cell] = 0;
    return false;
  };
  if (!fill(0)) throw new Error("no full grid");
  return grid;
}

/** Removes cells in random order while the puzzle keeps one solution, down to `givens`. */
function carve(solution, givens) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const puzzle = [...solution];
    let filled = CELLS;
    for (const cell of shuffle(Array.from({ length: CELLS }, (_, i) => i))) {
      if (filled <= givens) break;
      const held = puzzle[cell];
      puzzle[cell] = 0;
      if (countSolutions([...puzzle], 2) === 1) filled -= 1;
      else puzzle[cell] = held;
    }
    if (filled === givens) return puzzle;
  }
  return null;
}

function buildBank() {
  const bank = [];
  const seen = new Set();
  for (const tier of TIERS) {
    let made = 0;
    while (made < PER_TIER) {
      const puzzle = carve(fullGrid(), tier.givens);
      if (!puzzle) continue;
      const text = puzzle.join("");
      if (seen.has(text)) continue;
      if (countSolutions([...puzzle], 2) !== 1) throw new Error("a bank puzzle is not unique");
      seen.add(text);
      bank.push({ tier: tier.name, text });
      made += 1;
    }
  }
  return bank;
}

const bank = buildBank();

if (!process.argv.includes("--write")) {
  console.log(JSON.stringify(bank, null, 2));
  process.exit(0);
}

const tierNames = TIERS.map((tier) => `"${tier.name}"`).join(", ");
const lines = [];
for (const tier of TIERS) {
  lines.push(`  // ${tier.name}`);
  for (const entry of bank.filter((e) => e.tier === tier.name)) lines.push(`  "${entry.text}",`);
}
writeFileSync(
  resolve(ROOT, "src/lib/games/mini-sudoku-bank.ts"),
  `/**
 * The Mini Sudoku puzzle bank for \`mini-sudoku@1\`: ${TIERS.length} tiers of ${PER_TIER} puzzles, each with
 * exactly one solution, in reading order with 0 for an empty cell. Generated by
 * \`scripts/generate-mini-sudoku-bank.mjs\`, which explains the tiers; the database
 * holds the same list (\`public.mini_sudoku_bank()\`). Do not edit by hand.
 */
export const MINI_SUDOKU_TIERS = [${tierNames}] as const;

/** Puzzles per tier: tier \`t\` is entries \`t × ${PER_TIER}\` to \`t × ${PER_TIER} + ${PER_TIER - 1}\`. */
export const MINI_SUDOKU_PER_TIER = ${PER_TIER};

export const MINI_SUDOKU_BANK: readonly string[] = [
${lines.join("\n")}
];
`,
);

const migration = resolve(ROOT, "supabase/migrations/20261126120000_mini_sudoku_sessions.sql");
const sqlLines = [];
for (const tier of TIERS) {
  sqlLines.push(`    -- ${tier.name}`);
  const entries = bank.filter((e) => e.tier === tier.name);
  entries.forEach((entry, index) => {
    const last = tier === TIERS[TIERS.length - 1] && index === entries.length - 1;
    sqlLines.push(`    '${entry.text}'${last ? "" : ","}`);
  });
}
const sql = readFileSync(migration, "utf8");
const begin = sql.indexOf("    -- bank:begin\n");
const end = sql.indexOf("    -- bank:end");
if (begin < 0 || end < 0) throw new Error("the migration has no bank markers");
writeFileSync(
  migration,
  `${sql.slice(0, begin)}    -- bank:begin\n${sqlLines.join("\n")}\n${sql.slice(end)}`,
);
console.log(`wrote ${bank.length} puzzles`);
