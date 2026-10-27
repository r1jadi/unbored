#!/usr/bin/env node
/**
 * Generates the Sudoku puzzle bank: graded puzzles, each with exactly one
 * solution, that `sudoku@2` disguises with a seeded shuffle at play time.
 *
 *   node scripts/generate-sudoku-bank.mjs           # print the bank as JSON
 *   node scripts/generate-sudoku-bank.mjs --write   # rewrite the bank's two copies
 *
 * --write rewrites `src/lib/games/sudoku-bank.ts` and the bank inside
 * `supabase/migrations/20261115120000_sudoku_bank.sql`. The two must always
 * match; the SQL suite and `sudoku.test.ts` assert the same boards. The bank is a
 * fixed asset, not something to regenerate casually: changing it changes every
 * board, so it needs a new rules version.
 *
 * ## Why a bank
 *
 * Relabelling digits and shuffling rows within a band, the bands, columns within
 * a stack and the stacks all keep a puzzle's solutions one-for-one, so a puzzle
 * with one solution stays one. The database can therefore serve unique boards by
 * picking a bank entry and shuffling it — cheap draws — instead of running a
 * uniqueness search inside a verifier.
 *
 * ## Grades
 *
 * A puzzle is graded by the hardest technique a logical solver needs:
 *   1 — the only place left for a digit in a box;
 *   2 — the only place in a row or column, or the only digit left for a cell;
 *   3 — candidate eliminations: a digit confined to one line of a box (or one box
 *       of a line), and naked or hidden pairs.
 * Puzzles that need more than grade 3 are left out, so every board can be
 * solved by reasoning, without guessing.
 *
 * Tiers, by the board's level: gentle (grade 1, at least 36 givens), easy
 * (grade 2), medium (grade 3) and hard (grade 3 with several eliminations and
 * few givens).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PER_TIER = 50;
const ALL = 0b1111111110;

// ── Geometry ────────────────────────────────────────────────────────────────

const ROWS = [];
const COLUMNS = [];
const BOXES = [];
for (let line = 0; line < 9; line += 1) {
  ROWS.push(Array.from({ length: 9 }, (_, index) => line * 9 + index));
  COLUMNS.push(Array.from({ length: 9 }, (_, index) => index * 9 + line));
  const top = Math.floor(line / 3) * 3;
  const left = (line % 3) * 3;
  BOXES.push(
    Array.from({ length: 9 }, (_, index) => (top + Math.floor(index / 3)) * 9 + left + (index % 3)),
  );
}
const UNITS = [...BOXES, ...ROWS, ...COLUMNS];
const PEERS = Array.from({ length: 81 }, (_, cell) => {
  const seen = new Set();
  for (const unit of UNITS) if (unit.includes(cell)) unit.forEach((other) => seen.add(other));
  seen.delete(cell);
  return [...seen];
});
const boxOf = (cell) => Math.floor(Math.floor(cell / 9) / 3) * 3 + Math.floor((cell % 9) / 3);
const bits = (mask) => {
  const out = [];
  for (let digit = 1; digit <= 9; digit += 1) if (mask & (1 << digit)) out.push(digit);
  return out;
};
const count = (mask) => bits(mask).length;

// ── A seeded random stream, so the bank is reproducible ─────────────────────

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(random, items) {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
}

// ── Solving ─────────────────────────────────────────────────────────────────

function candidatesOf(cells, cell) {
  let taken = 0;
  for (const other of PEERS[cell]) taken |= 1 << cells[other];
  return ALL & ~taken;
}

/** How many solutions the puzzle has, counting no further than `limit`. */
function countSolutions(puzzle, limit = 2) {
  const cells = [...puzzle];
  let found = 0;
  const search = () => {
    let best = -1;
    let options = 0;
    for (let cell = 0; cell < 81; cell += 1) {
      if (cells[cell]) continue;
      const fits = candidatesOf(cells, cell);
      if (!fits) return;
      if (best < 0 || count(fits) < count(options)) {
        best = cell;
        options = fits;
        if (count(fits) === 1) break;
      }
    }
    if (best < 0) {
      found += 1;
      return;
    }
    for (const digit of bits(options)) {
      cells[best] = digit;
      search();
      if (found >= limit) break;
    }
    cells[best] = 0;
  };
  search();
  return found;
}

/** A random full grid. */
function fullGrid(random) {
  const cells = new Array(81).fill(0);
  const fill = (cell) => {
    if (cell === 81) return true;
    for (const digit of shuffled(random, bits(candidatesOf(cells, cell)))) {
      cells[cell] = digit;
      if (fill(cell + 1)) return true;
    }
    cells[cell] = 0;
    return false;
  };
  fill(0);
  return cells;
}

// ── Grading: a logical solver that records the hardest step it took ───────

function grade(puzzle) {
  const cells = [...puzzle];
  const cand = cells.map((digit, cell) => (digit ? 0 : candidatesOf(cells, cell)));
  const place = (cell, digit) => {
    cells[cell] = digit;
    cand[cell] = 0;
    for (const other of PEERS[cell]) cand[other] &= ~(1 << digit);
  };
  const hiddenSingle = (units) => {
    for (const unit of units) {
      for (let digit = 1; digit <= 9; digit += 1) {
        if (unit.some((cell) => cells[cell] === digit)) continue;
        const spots = unit.filter((cell) => cand[cell] & (1 << digit));
        if (spots.length === 1) {
          place(spots[0], digit);
          return true;
        }
      }
    }
    return false;
  };
  const nakedSingle = () => {
    for (let cell = 0; cell < 81; cell += 1) {
      if (!cells[cell] && count(cand[cell]) === 1) {
        place(cell, bits(cand[cell])[0]);
        return true;
      }
    }
    return false;
  };
  const eliminate = () => {
    let changed = false;
    const remove = (cell, mask) => {
      if (cand[cell] & mask) {
        cand[cell] &= ~mask;
        changed = true;
      }
    };
    // A digit confined to one line of a box, or one box of a line.
    for (let digit = 1; digit <= 9; digit += 1) {
      const bit = 1 << digit;
      for (const box of BOXES) {
        const spots = box.filter((cell) => cand[cell] & bit);
        if (spots.length < 2) continue;
        for (const lines of [ROWS, COLUMNS]) {
          const line = lines.find((unit) => spots.every((cell) => unit.includes(cell)));
          if (line) line.filter((cell) => !box.includes(cell)).forEach((cell) => remove(cell, bit));
        }
      }
      for (const line of [...ROWS, ...COLUMNS]) {
        const spots = line.filter((cell) => cand[cell] & bit);
        if (spots.length < 2) continue;
        const box = BOXES[boxOf(spots[0])];
        if (spots.every((cell) => box.includes(cell))) {
          box.filter((cell) => !line.includes(cell)).forEach((cell) => remove(cell, bit));
        }
      }
    }
    // Naked and hidden pairs.
    for (const unit of UNITS) {
      const open = unit.filter((cell) => !cells[cell]);
      for (let a = 0; a < open.length; a += 1) {
        for (let b = a + 1; b < open.length; b += 1) {
          const mask = cand[open[a]];
          if (count(mask) === 2 && cand[open[b]] === mask) {
            open
              .filter((cell) => cell !== open[a] && cell !== open[b])
              .forEach((cell) => remove(cell, mask));
          }
        }
      }
      for (let x = 1; x <= 9; x += 1) {
        for (let y = x + 1; y <= 9; y += 1) {
          const withX = open.filter((cell) => cand[cell] & (1 << x));
          const withY = open.filter((cell) => cand[cell] & (1 << y));
          if (
            withX.length === 2 &&
            withY.length === 2 &&
            withX[0] === withY[0] &&
            withX[1] === withY[1]
          ) {
            const pair = (1 << x) | (1 << y);
            for (const cell of withX) remove(cell, ~pair & ALL);
          }
        }
      }
    }
    return changed;
  };

  let level = 0;
  let eliminations = 0;
  for (;;) {
    if (cells.every(Boolean)) return { level, eliminations };
    if (hiddenSingle(BOXES)) {
      level = Math.max(level, 1);
    } else if (hiddenSingle([...ROWS, ...COLUMNS]) || nakedSingle()) {
      level = Math.max(level, 2);
    } else if (eliminate()) {
      level = 3;
      eliminations += 1;
    } else {
      return null;
    }
  }
}

// ── Digging puzzles out of full grids ──────────────────────────────────────

/** Takes cells away, in a random order, while the puzzle stays unique and `keep` holds. */
function dig(random, grid, keep, floor) {
  const puzzle = [...grid];
  let givens = 81;
  for (const cell of shuffled(random, [...Array(81).keys()])) {
    if (givens <= floor) break;
    const held = puzzle[cell];
    puzzle[cell] = 0;
    const graded = countSolutions(puzzle) === 1 ? grade(puzzle) : null;
    if (graded && keep(graded)) {
      givens -= 1;
    } else {
      puzzle[cell] = held;
    }
  }
  return puzzle;
}

const TIERS = [
  {
    name: "gentle",
    make: (random) => dig(random, fullGrid(random), (g) => g.level <= 1, 36),
    accept: (g, givens) => g.level <= 1 && givens >= 36,
  },
  {
    name: "easy",
    make: (random) => dig(random, fullGrid(random), (g) => g.level <= 2, 30),
    accept: (g) => g.level === 2,
  },
  {
    name: "medium",
    make: (random) => dig(random, fullGrid(random), (g) => g.level <= 3, 26),
    accept: (g) => g.level === 3,
  },
  {
    name: "hard",
    make: (random) => dig(random, fullGrid(random), (g) => g.level <= 3, 0),
    accept: (g, givens) => g.level === 3 && g.eliminations >= 3 && givens <= 27,
  },
];

const random = mulberry32(20261115);
const bank = [];
for (const tier of TIERS) {
  const puzzles = [];
  let tries = 0;
  while (puzzles.length < PER_TIER) {
    tries += 1;
    const puzzle = tier.make(random);
    const graded = grade(puzzle);
    const givens = puzzle.filter(Boolean).length;
    if (graded && countSolutions(puzzle) === 1 && tier.accept(graded, givens)) {
      puzzles.push(puzzle.join(""));
    }
  }
  const givens = puzzles.map((puzzle) => puzzle.replace(/0/g, "").length);
  process.stderr.write(
    `${tier.name}: ${PER_TIER} puzzles in ${tries} tries, ${Math.min(...givens)}–${Math.max(...givens)} givens\n`,
  );
  bank.push(...puzzles);
}

if (!process.argv.includes("--write")) {
  process.stdout.write(`${JSON.stringify(bank, null, 2)}\n`);
} else {
  const lines = (indent, quote) =>
    bank
      .map(
        (puzzle, index) =>
          `${index % PER_TIER === 0 ? `${indent}// ${TIERS[index / PER_TIER].name}\n` : ""}${indent}${quote}${puzzle}${quote},`,
      )
      .join("\n");

  writeFileSync(
    resolve(ROOT, "src/lib/games/sudoku-bank.ts"),
    `/**
 * The Sudoku puzzle bank for \`sudoku@2\`: ${TIERS.length} tiers of ${PER_TIER} puzzles, each with exactly
 * one solution, in reading order with 0 for an empty cell. Generated by
 * \`scripts/generate-sudoku-bank.mjs\`, which explains the grades; the database
 * holds the same list (\`public.sudoku_bank()\`). Do not edit by hand.
 */
export const SUDOKU_TIERS = ${JSON.stringify(TIERS.map((tier) => tier.name))} as const;

/** Puzzles per tier: tier \`t\` is entries \`t × ${PER_TIER}\` to \`t × ${PER_TIER} + ${PER_TIER - 1}\`. */
export const SUDOKU_PER_TIER = ${PER_TIER};

export const SUDOKU_BANK: readonly string[] = [
${lines("  ", '"')}
];
`,
  );

  const sqlPath = resolve(ROOT, "supabase/migrations/20261115120000_sudoku_bank.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const start = sql.indexOf("-- bank:begin");
  const end = sql.indexOf("-- bank:end");
  if (start < 0 || end < 0) throw new Error("the migration has no bank markers");
  const body = bank
    .map(
      (puzzle, index) =>
        `${index % PER_TIER === 0 ? `    -- ${TIERS[index / PER_TIER].name}\n` : ""}    '${puzzle}'${index === bank.length - 1 ? "" : ","}`,
    )
    .join("\n");
  writeFileSync(sqlPath, `${sql.slice(0, start)}-- bank:begin\n${body}\n    ${sql.slice(end)}`);
}
