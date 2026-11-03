#!/usr/bin/env node
/**
 * Generates the daily crossword bank: a year of original puzzles — 5×5 minis for
 * weekdays and 7×7 midis for weekends — from `scripts/crossword/words.txt`.
 *
 *   node scripts/generate-crossword-bank.mjs           # report what it would make
 *   node scripts/generate-crossword-bank.mjs --write   # rewrite the bank's two copies
 *   node scripts/generate-crossword-bank.mjs --lang sq --write   # Fjalekryqi
 *
 * `--lang sq` makes Fjalekryqi, the Albanian crossword (`fjalekryqi@1`), from
 * `scripts/crossword/words-sq.txt` — the Albanian alphabet's single letters, A–Z
 * with Ç and Ë (a digraph such as SH takes two squares, as in Albanian
 * crosswords) — into `src/lib/games/fjalekryqi-bank.ts` and
 * `supabase/migrations/20261201120000_fjalekryqi_sessions.sql`. Its bank is
 * smaller than the English one, from a smaller word list, and repeats sooner.
 * Its grids may also leave a square checked one way only — a single white
 * square between blacks, as in British crosswords — because a few hundred
 * words cannot fill grids where every square is crossed. A run is then 1 or 3
 * to 7 squares, never 2, so the app numbers and clues exactly the entries it
 * would anyway.
 *
 * --write rewrites `src/lib/games/crossword-bank.ts` (the grids and every clue the
 * grids use) and the grids inside
 * `supabase/migrations/20261116120000_crossword_sessions.sql`. The database only
 * ever needs the solution letters — it verifies a solve, it never shows a clue —
 * so its copy holds the grids alone. The two copies must match; the SQL suite and
 * `crossword.test.ts` assert the same days. Regenerating changes every day's
 * puzzle, so it needs a new rules version.
 *
 * ## How a puzzle is made
 *
 * 1. **A pattern.** Black squares placed at random, symmetric under a half turn
 *    as newspaper grids are, kept only when every white cell is connected and
 *    every across and down entry is 3 to 7 letters long.
 * 2. **A fill.** Backtracking over the entries, most constrained first, from the
 *    word list; no word twice in one puzzle, and the words used least so far
 *    tried first, so the year does not lean on the same few.
 * 3. **A check.** The same set of answers never appears twice in the bank.
 *
 * The random stream is seeded, so the bank is reproducible.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ALBANIAN =
  process.argv.includes("--lang") && process.argv[process.argv.indexOf("--lang") + 1] === "sq";

/** Where each language's bank comes from and goes. */
const TARGET = ALBANIAN
  ? {
      words: "scripts/crossword/words-sq.txt",
      answer: /^[A-ZÇË]{3,7}$/u,
      minis: 130, // half a year of weekdays: the bank then starts over
      midis: 52,
      seed: 20261201,
      bank: "src/lib/games/fjalekryqi-bank.ts",
      prefix: "FJALEKRYQI",
      rules: "fjalekryqi@1",
      title: "Fjalekryqi, the Albanian daily crossword",
      unchecked: true,
      sql: "supabase/migrations/20261201120000_fjalekryqi_sessions.sql",
      sqlNames: "public.fjalekryqi_minis()",
      sqlNames2: "public.fjalekryqi_midis()",
    }
  : {
      words: "scripts/crossword/words.txt",
      answer: /^[A-Z]{3,7}$/,
      minis: 261, // a year of weekdays
      midis: 104, // a year of weekends: 52 Saturdays and 52 Sundays
      seed: 20261116,
      bank: "src/lib/games/crossword-bank.ts",
      prefix: "CROSSWORD",
      rules: "crossword@1",
      title: "The daily crossword bank",
      unchecked: false,
      sql: "supabase/migrations/20261116120000_crossword_sessions.sql",
      sqlNames: "public.crossword_minis()",
      sqlNames2: "public.crossword_midis()",
    };
const MINIS = TARGET.minis;
const MIDIS = TARGET.midis;

// ── The word list ───────────────────────────────────────────────────────────

const CLUES = new Map();
for (const line of readFileSync(resolve(ROOT, TARGET.words), "utf8").split("\n")) {
  const text = line.trim();
  if (!text || text.startsWith("#")) continue;
  const [answer, clue] = text.split("|");
  if (!TARGET.answer.test(answer) || !clue?.trim()) {
    throw new Error(`${TARGET.words}: not a 3–7 letter answer with a clue: ${text}`);
  }
  if (CLUES.has(answer)) throw new Error(`${TARGET.words}: ${answer} appears twice`);
  CLUES.set(answer, clue.trim());
}
const BY_LENGTH = new Map();
for (const word of CLUES.keys()) {
  if (!BY_LENGTH.has(word.length)) BY_LENGTH.set(word.length, []);
  BY_LENGTH.get(word.length).push(word);
}

// ── A seeded random stream ──────────────────────────────────────────────────

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
const random = mulberry32(TARGET.seed);

// ── Patterns ────────────────────────────────────────────────────────────────

/** The across and down entries of a pattern, as lists of cells. */
export function slotsOf(pattern, side) {
  const slots = [];
  for (const across of [true, false]) {
    for (let line = 0; line < side; line += 1) {
      let run = [];
      for (let step = 0; step <= side; step += 1) {
        const cell = across ? line * side + step : step * side + line;
        if (step < side && pattern[cell] !== "#") {
          run.push(cell);
        } else {
          if (run.length) slots.push({ across, cells: run });
          run = [];
        }
      }
    }
  }
  return slots;
}

/** The runs that are entries: three squares or more. A single square is unchecked. */
export function entriesOf(pattern, side) {
  return slotsOf(pattern, side).filter((slot) => slot.cells.length >= 3);
}

function connected(pattern, side) {
  const open = [...pattern].map((c, i) => (c === "#" ? -1 : i)).filter((i) => i >= 0);
  const seen = new Set([open[0]]);
  const queue = [open[0]];
  while (queue.length) {
    const cell = queue.pop();
    const row = Math.floor(cell / side);
    const column = cell % side;
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const r = row + dr;
      const c = column + dc;
      if (r < 0 || c < 0 || r >= side || c >= side) continue;
      const next = r * side + c;
      if (pattern[next] !== "#" && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size === open.length;
}

/**
 * Every grid shape worth filling: symmetric under a half turn, every white cell
 * connected, every entry 3 to 7 letters, and a black-square count in range. A
 * shape is built a row at a time from the rows whose white runs are all 3 or
 * longer; the bottom half mirrors the top, so only the top half is chosen.
 */
function allPatterns(side, minBlacks, maxBlacks) {
  const rows = [];
  for (let mask = 0; mask < 1 << side; mask += 1) {
    const row = Array.from({ length: side }, (_, i) => ((mask >> i) & 1 ? "#" : ".")).join("");
    const runOk = (run) =>
      run.length === 0 || run.length >= 3 || (TARGET.unchecked && run.length === 1);
    if (row.split("#").every(runOk)) rows.push(row);
  }
  const middle = Math.floor(side / 2);
  const mirror = (row) => [...row].reverse().join("");
  const found = [];
  const build = (top) => {
    if (top.length === middle) {
      for (const centre of rows.filter((row) => row === mirror(row))) {
        const grid = [...top, centre, ...top.slice().reverse().map(mirror)].join("");
        const blacks = [...grid].filter((cell) => cell === "#").length;
        if (blacks < minBlacks || blacks > maxBlacks) continue;
        const short = TARGET.unchecked ? (length) => length === 2 : (length) => length < 3;
        if (slotsOf(grid, side).some((slot) => short(slot.cells.length))) continue;
        if (TARGET.unchecked) {
          // Every square in an entry, and every entry crossed at least twice.
          const entries = entriesOf(grid, side);
          const covered = new Map();
          for (const entry of entries)
            for (const cell of entry.cells) covered.set(cell, (covered.get(cell) ?? 0) + 1);
          if ([...grid].some((cell, index) => cell !== "#" && !covered.has(index))) continue;
          if (
            entries.some(
              (entry) => entry.cells.filter((cell) => covered.get(cell) === 2).length < 2,
            )
          )
            continue;
        }
        if (!connected(grid, side)) continue;
        found.push(grid);
      }
      return;
    }
    for (const row of rows) build([...top, row]);
  };
  build([]);
  return found;
}

// ── Filling ─────────────────────────────────────────────────────────────────
//
// Words are indexed by length, then by position and letter, as bitsets: a slot's
// candidates are the AND of the bitsets of the letters already in it, so the
// search asks "what still fits here" in a handful of word operations.

const INDEX = new Map();
for (const [length, words] of BY_LENGTH) {
  const size = Math.ceil(words.length / 32);
  const all = new Uint32Array(size);
  const at = Array.from({ length }, () => new Map());
  words.forEach((word, index) => {
    all[index >>> 5] |= 1 << (index & 31);
    for (let i = 0; i < length; i += 1) {
      if (!at[i].has(word[i])) at[i].set(word[i], new Uint32Array(size));
      at[i].get(word[i])[index >>> 5] |= 1 << (index & 31);
    }
  });
  INDEX.set(length, { words, all, at });
}

function popcount(mask) {
  let total = 0;
  for (let x of mask) {
    x -= (x >>> 1) & 0x55555555;
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    total += (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return total;
}

const usage = new Map();

function fill(pattern, side, budget) {
  const slots = entriesOf(pattern, side);
  const grid = [...pattern];
  const used = new Set();
  let steps = 0;

  const maskOf = (slot) => {
    const index = INDEX.get(slot.cells.length);
    if (!index) return null;
    const mask = index.all.slice();
    slot.cells.forEach((cell, i) => {
      if (grid[cell] === ".") return;
      const letter = index.at[i].get(grid[cell]);
      if (!letter) mask.fill(0);
      else for (let w = 0; w < mask.length; w += 1) mask[w] &= letter[w];
    });
    return mask;
  };
  const wordsOf = (slot, mask) => {
    const { words } = INDEX.get(slot.cells.length);
    const out = [];
    for (let w = 0; w < mask.length; w += 1) {
      let bits = mask[w];
      while (bits) {
        const low = bits & -bits;
        const word = words[(w << 5) + (31 - Math.clz32(low))];
        if (!used.has(word)) out.push(word);
        bits ^= low;
      }
    }
    return out;
  };
  const open = (slot) => slot.cells.some((cell) => grid[cell] === ".");

  const search = () => {
    steps += 1;
    if (steps > budget) return false;
    let best = null;
    let bestMask = null;
    let bestCount = Infinity;
    for (const slot of slots) {
      const mask = maskOf(slot);
      if (!mask) return false;
      const count = popcount(mask);
      if (count === 0) return false;
      if (open(slot) && count < bestCount) {
        best = slot;
        bestMask = mask;
        bestCount = count;
      }
    }
    if (!best) {
      // Every cell is filled: each slot is a word (the masks said so), used once.
      const words = slots.map((slot) => slot.cells.map((cell) => grid[cell]).join(""));
      return new Set(words).size === words.length;
    }
    const ordered = wordsOf(best, bestMask)
      // Least-used first, gently: a word's use count weighs a little against a
      // random draw, so the year varies without starving the search of the scarce
      // long words.
      .map((word) => ({ word, key: (usage.get(word) ?? 0) * 0.25 + random() * 2 }))
      .sort((a, b) => a.key - b.key)
      .map(({ word }) => word);
    for (const word of ordered) {
      const before = best.cells.map((cell) => grid[cell]);
      best.cells.forEach((cell, i) => (grid[cell] = word[i]));
      used.add(word);
      if (search()) return true;
      used.delete(word);
      best.cells.forEach((cell, i) => (grid[cell] = before[i]));
    }
    return false;
  };

  return search() ? grid.join("") : null;
}

function make(count, side, patterns, budget) {
  const puzzles = [];
  const seen = new Set();
  let attempts = 0;
  while (puzzles.length < count) {
    attempts += 1;
    if (attempts > count * 800) throw new Error(`only ${puzzles.length} ${side}×${side} puzzles`);
    const pattern = patterns[Math.floor(random() * patterns.length)];
    const grid = fill(pattern, side, budget);
    if (!grid) continue;
    const answers = entriesOf(grid, side).map((slot) =>
      slot.cells.map((cell) => grid[cell]).join(""),
    );
    const key = [...answers].sort().join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    for (const word of answers) usage.set(word, (usage.get(word) ?? 0) + 1);
    puzzles.push(grid);
    if (puzzles.length % 25 === 0) {
      process.stderr.write(`  ${side}×${side}: ${puzzles.length} of ${count} (${attempts} attempts)
`);
    }
  }
  process.stderr.write(
    `${side}×${side}: ${count} puzzles from ${patterns.length} shapes in ${attempts} attempts
`,
  );
  return puzzles;
}

// Minis take every 5×5 shape. Midis take the 7×7 shapes with at most three entries
// of six or seven letters: long words are the scarce ones, and a few long entries
// crossing a grid of short ones is what fills well.
const longEntries = (grid, side) => entriesOf(grid, side).filter((slot) => slot.cells.length >= 6);
const minis = make(MINIS, 5, allPatterns(5, ...(TARGET.unchecked ? [4, 10] : [2, 8])), 3000);
const midis = make(
  MIDIS,
  7,
  allPatterns(7, ...(TARGET.unchecked ? [8, 20] : [6, 18])).filter(
    (grid) => longEntries(grid, 7).length <= 3,
  ),
  3000,
);

const usedWords = new Set();
for (const [grid, side] of [...minis.map((g) => [g, 5]), ...midis.map((g) => [g, 7])]) {
  for (const slot of entriesOf(grid, side))
    usedWords.add(slot.cells.map((cell) => grid[cell]).join(""));
}
const counts = [...usage.values()].sort((a, b) => b - a);
process.stderr.write(
  `${usedWords.size} distinct answers; the most used appears ${counts[0]} times\n`,
);

if (!process.argv.includes("--write")) {
  process.stdout.write(`${minis.slice(0, 3).join("\n")}\n${midis.slice(0, 2).join("\n")}\n`);
} else {
  const clues = [...usedWords]
    .sort()
    .map(
      (word) =>
        `  ${/^[A-Z]+$/.test(word) ? word : JSON.stringify(word)}: ${JSON.stringify(CLUES.get(word))},`,
    );
  writeFileSync(
    resolve(ROOT, TARGET.bank),
    `/**
 * ${TARGET.title} for \`${TARGET.rules}\`: ${MINIS} 5×5 minis (weekdays) and
 * ${MIDIS} 7×7 midis (weekends), each grid in reading order with # for a black
 * square, and the clue of every answer they use. Generated by
 * \`scripts/generate-crossword-bank.mjs\` from \`${TARGET.words}\`; the
 * database holds the same grids (\`${TARGET.sqlNames}\`,
 * \`${TARGET.sqlNames2}\`). Do not edit by hand.
 */
export const ${TARGET.prefix}_MINIS: readonly string[] = [
${minis.map((grid) => `  "${grid}",`).join("\n")}
];

export const ${TARGET.prefix}_MIDIS: readonly string[] = [
${midis.map((grid) => `  "${grid}",`).join("\n")}
];

export const ${TARGET.prefix}_CLUES: Readonly<Record<string, string>> = {
${clues.join("\n")}
};
`,
  );

  const sqlPath = resolve(ROOT, TARGET.sql);
  let sql = readFileSync(sqlPath, "utf8");
  for (const [name, grids] of [
    ["minis", minis],
    ["midis", midis],
  ]) {
    const start = sql.indexOf(`-- ${name}:begin`);
    const end = sql.indexOf(`-- ${name}:end`);
    if (start < 0 || end < 0) throw new Error(`the migration has no ${name} markers`);
    const body = grids
      .map((grid, index) => `    '${grid}'${index === grids.length - 1 ? "" : ","}`)
      .join("\n");
    sql = `${sql.slice(0, start)}-- ${name}:begin\n${body}\n    ${sql.slice(end)}`;
  }
  writeFileSync(sqlPath, sql);
}
