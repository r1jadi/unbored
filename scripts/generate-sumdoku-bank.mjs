#!/usr/bin/env node
/**
 * Generates the Sumdoku puzzle bank: 6×6 cage puzzles (Sudoku rules plus cages
 * whose digits add up to a total and never repeat), each with exactly one
 * solution, that `sumdoku@1` turns with a seeded mirror at play time.
 *
 *   node scripts/generate-sumdoku-bank.mjs           # print the bank as JSON
 *   node scripts/generate-sumdoku-bank.mjs --write   # rewrite the bank's two copies
 *
 * --write rewrites `src/lib/games/sumdoku-bank.ts` and the bank inside
 * `supabase/migrations/20261221120000_sumdoku_sessions.sql`. The two must always
 * match; the SQL suite and `sumdoku.test.ts` assert the same boards. The bank is
 * a fixed asset: changing it changes every board, so it needs a new rules version.
 *
 * ## A puzzle
 *
 * 108 characters, three blocks of 36 cells in reading order:
 *
 *   1. the solution, digits 1–6;
 *   2. the cages: each cell's cage as one base-36 character (0–9, a–z), cages
 *      numbered in order of their first cell;
 *   3. the givens: 1 where the cell starts filled, 0 where it starts empty.
 *
 * A cage's total is the sum of its solution digits, so the bank never stores it.
 *
 * ## Why mirrors and not a full shuffle
 *
 * Mini Sudoku relabels digits and shuffles rows and columns. Neither works here:
 * relabelling changes cage totals, and moving a row can tear a cage apart. The
 * four mirrors of the grid (none, left–right, top–bottom, both) keep every cage
 * in one piece, keep the 2×3 boxes as boxes and keep the totals, so a puzzle
 * with one solution stays one.
 *
 * ## Tiers
 *
 * gentle: cages of 1–3 cells and 6 givens; easy: cages of 2–3 cells and 3 givens;
 * medium: cages of 2–4 cells, no givens; hard: cages of 2–5 cells, no givens.
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
  { name: "gentle", minCage: 1, maxCage: 3, givens: 6 },
  { name: "easy", minCage: 2, maxCage: 3, givens: 3 },
  { name: "medium", minCage: 2, maxCage: 4, givens: 0 },
  { name: "hard", minCage: 2, maxCage: 5, givens: 0 },
];
const MIGRATION = "supabase/migrations/20261221120000_sumdoku_sessions.sql";

let state = 20261216;
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
  const peers = [];
  for (let other = 0; other < CELLS; other += 1) {
    if (other === cell) continue;
    const r = Math.floor(other / SIDE);
    const c = other % SIDE;
    const sameBox =
      Math.floor(r / BOX_ROWS) === Math.floor(row / BOX_ROWS) &&
      Math.floor(c / BOX_COLS) === Math.floor(column / BOX_COLS);
    if (r === row || c === column || sameBox) peers.push(other);
  }
  return peers;
});

const NEIGHBOURS = Array.from({ length: CELLS }, (_, cell) => {
  const row = Math.floor(cell / SIDE);
  const column = cell % SIDE;
  const out = [];
  if (row > 0) out.push(cell - SIDE);
  if (row < SIDE - 1) out.push(cell + SIDE);
  if (column > 0) out.push(cell - 1);
  if (column < SIDE - 1) out.push(cell + 1);
  return out;
});

function sudokuOptions(grid, cell) {
  const taken = new Set(PEERS[cell].map((peer) => grid[peer]));
  return [1, 2, 3, 4, 5, 6].filter((digit) => !taken.has(digit));
}

/** A random full grid, by randomised backtracking. */
function fullGrid() {
  const grid = new Array(CELLS).fill(0);
  const fill = (cell) => {
    if (cell === CELLS) return true;
    for (const digit of shuffle(sudokuOptions(grid, cell))) {
      grid[cell] = digit;
      if (fill(cell + 1)) return true;
    }
    grid[cell] = 0;
    return false;
  };
  if (!fill(0)) throw new Error("no full grid");
  return grid;
}

/**
 * Splits the grid into cages of `minCage`–`maxCage` connected cells whose
 * solution digits are all different, or returns null when a try paints itself
 * into a corner (an orphan cell that cannot reach `minCage`).
 */
function cages(solution, minCage, maxCage) {
  const cage = new Array(CELLS).fill(-1);
  const groups = [];
  for (const seed of shuffle(Array.from({ length: CELLS }, (_, i) => i))) {
    if (cage[seed] >= 0) continue;
    const target = minCage + Math.floor(random() * (maxCage - minCage + 1));
    const group = [seed];
    const digits = new Set([solution[seed]]);
    cage[seed] = groups.length;
    while (group.length < target) {
      const frontier = [];
      for (const cell of group) {
        for (const next of NEIGHBOURS[cell]) {
          if (cage[next] < 0 && !digits.has(solution[next])) frontier.push(next);
        }
      }
      if (frontier.length === 0) break;
      const next = frontier[Math.floor(random() * frontier.length)];
      cage[next] = groups.length;
      group.push(next);
      digits.add(solution[next]);
    }
    groups.push(group);
  }
  // Fold any cage below the minimum into a neighbouring cage it fits into.
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (group.length === 0 || group.length >= minCage) continue;
    const digits = new Set(group.map((cell) => solution[cell]));
    const hosts = new Set();
    for (const cell of group) {
      for (const next of NEIGHBOURS[cell]) if (cage[next] !== index) hosts.add(cage[next]);
    }
    const host = [...hosts].find(
      (other) =>
        groups[other].length + group.length <= maxCage &&
        groups[other].every((cell) => !digits.has(solution[cell])),
    );
    if (host === undefined) return null;
    for (const cell of group) {
      cage[cell] = host;
      groups[host].push(cell);
    }
    groups[index] = [];
  }
  // Renumber in order of each cage's first cell, so the text is canonical.
  const renumber = new Map();
  return cage.map((id) => {
    if (!renumber.has(id)) renumber.set(id, renumber.size);
    return renumber.get(id);
  });
}

/** The cages as lists of cells, and their totals. */
function cageTable(solution, cage) {
  const cells = [];
  cage.forEach((id, cell) => (cells[id] ??= []).push(cell));
  return cells.map((list) => ({
    cells: list,
    total: list.reduce((sum, cell) => sum + solution[cell], 0),
  }));
}

/**
 * Counts the solutions of a cage puzzle, stopping at `limit`: Sudoku rules, no
 * repeat in a cage, and every cage reaching its total exactly.
 */
function countSolutions(start, cage, table, limit) {
  const grid = [...start];
  const options = (cell) => {
    const { cells, total } = table[cage[cell]];
    const used = new Set();
    let sum = 0;
    let open = 0;
    for (const other of cells) {
      if (grid[other]) {
        used.add(grid[other]);
        sum += grid[other];
      } else open += 1;
    }
    return sudokuOptions(grid, cell).filter((digit) => {
      if (used.has(digit)) return false;
      const left = total - sum - digit;
      const rest = open - 1;
      if (rest === 0) return left === 0;
      // The smallest and largest sums `rest` unused digits could still make.
      const free = [1, 2, 3, 4, 5, 6].filter((d) => d !== digit && !used.has(d));
      if (free.length < rest) return false;
      const low = free.slice(0, rest).reduce((a, b) => a + b, 0);
      const high = free.slice(-rest).reduce((a, b) => a + b, 0);
      return left >= low && left <= high;
    });
  };
  const search = () => {
    let best = -1;
    let bestOptions = null;
    for (let cell = 0; cell < CELLS; cell += 1) {
      if (grid[cell]) continue;
      const fits = options(cell);
      if (fits.length === 0) return 0;
      if (bestOptions === null || fits.length < bestOptions.length) {
        best = cell;
        bestOptions = fits;
        if (fits.length === 1) break;
      }
    }
    if (best < 0) return 1;
    let total = 0;
    for (const digit of bestOptions) {
      grid[best] = digit;
      total += search();
      grid[best] = 0;
      if (total >= limit) break;
    }
    return total;
  };
  return search();
}

/** Picks `count` givens, one at a time, preferring cells in the largest cages. */
function chooseGivens(solution, cage, table, count) {
  const start = new Array(CELLS).fill(0);
  const order = shuffle(Array.from({ length: CELLS }, (_, i) => i));
  order.sort((a, b) => table[cage[b]].cells.length - table[cage[a]].cells.length);
  const used = new Set();
  for (const cell of order) {
    if (used.size >= count) break;
    // At most one given per cage, so the cages still have work to do.
    if ([...used].some((other) => cage[other] === cage[cell])) continue;
    start[cell] = solution[cell];
    used.add(cell);
  }
  return start;
}

function attempt(tier) {
  const solution = fullGrid();
  const cage = cages(solution, tier.minCage, tier.maxCage);
  if (!cage) return null;
  const table = cageTable(solution, cage);
  if (table.length > 36) return null;
  const start = chooseGivens(solution, cage, table, tier.givens);
  if (countSolutions(start, cage, table, 2) !== 1) return null;
  return { solution, cage, start };
}

function encode({ solution, cage, start }) {
  return (
    solution.join("") +
    cage.map((id) => id.toString(36)).join("") +
    start.map((digit) => (digit ? 1 : 0)).join("")
  );
}

function buildBank() {
  const bank = [];
  const seen = new Set();
  for (const tier of TIERS) {
    let made = 0;
    while (made < PER_TIER) {
      const puzzle = attempt(tier);
      if (!puzzle) continue;
      const text = encode(puzzle);
      if (seen.has(text)) continue;
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
  resolve(ROOT, "src/lib/games/sumdoku-bank.ts"),
  `/**
 * The Sumdoku puzzle bank for \`sumdoku@1\`: ${TIERS.length} tiers of ${PER_TIER} cage puzzles, each with
 * exactly one solution. A puzzle is 108 characters: the solution (36 digits), each
 * cell's cage (36 base-36 characters) and the givens (36 of 0 or 1), all in reading
 * order. Generated by \`scripts/generate-sumdoku-bank.mjs\`, which explains the
 * tiers; the database holds the same list (\`public.sumdoku_bank()\`). Do not edit
 * by hand.
 */
export const SUMDOKU_TIERS = [${tierNames}] as const;

/** Puzzles per tier: tier \`t\` is entries \`t × ${PER_TIER}\` to \`t × ${PER_TIER} + ${PER_TIER - 1}\`. */
export const SUMDOKU_PER_TIER = ${PER_TIER};

export const SUMDOKU_BANK: readonly string[] = [
${lines.join("\n")}
];
`,
);

const migration = resolve(ROOT, MIGRATION);
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
