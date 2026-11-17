/**
 * Lays out Meander's daily grids and writes `src/lib/games/meander-bank.ts`.
 *
 *   bun scripts/generate-meander-bank.ts           # print the bank
 *   bun scripts/generate-meander-bank.ts --write   # rewrite meander-bank.ts
 *
 * Every theme below is four or five words whose letters add up to 25. Each is
 * wound into a 5 × 5 grid: the grid is split into one path per word, every path a
 * chain of side-by-side cells that turns at least once, and the word is written
 * along it. The layout is searched with a small seeded generator, so the same list
 * always gives the same grids. A theme's place in the list is its day: only add at
 * the end, and only under a new rules version.
 *
 * Then run `bun scripts/generate-daily-banks.ts --write`, which copies the letters
 * and words into the sessions migration.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const THEMES: readonly (readonly [string, readonly string[]])[] = [
  ["Fruit bowl", ["BANANA", "CHERRY", "MANGO", "PLUM", "LIME"]],
  ["Weather", ["THUNDER", "RAINBOW", "CLOUDY", "FROST"]],
  ["Under the sea", ["WHALE", "SHARK", "CORAL", "OYSTER", "TIDE"]],
  ["In the kitchen", ["SPOON", "KNIFE", "FORK", "TOASTER", "OVEN"]],
  ["Planets", ["MERCURY", "JUPITER", "SATURN", "VENUS"]],
  ["Colours", ["SCARLET", "PURPLE", "ORANGE", "YELLOW"]],
  ["The orchestra", ["CLARINET", "GUITAR", "VIOLIN", "PIANO"]],
  ["On the farm", ["ROOSTER", "CHICKEN", "DONKEY", "HORSE"]],
  ["Sports", ["CRICKET", "BASEBALL", "TENNIS", "GOLF"]],
  ["The body", ["SHOULDER", "STOMACH", "ELBOW", "ANKLE"]],
  ["Trees", ["WILLOW", "MAPLE", "BIRCH", "CEDAR", "PINE"]],
  ["Breakfast", ["PANCAKE", "PORRIDGE", "BACON", "TOAST"]],
  ["Creepy crawlies", ["MOSQUITO", "CRICKET", "BEETLE", "MOTH"]],
  ["Vegetables", ["CABBAGE", "CARROT", "POTATO", "CELERY"]],
  ["Birds", ["PENGUIN", "PARROT", "PIGEON", "FALCON"]],
  ["Desserts", ["BROWNIE", "COOKIE", "MUFFIN", "SUNDAE"]],
  ["The toolbox", ["SPANNER", "HAMMER", "CHISEL", "PLIERS"]],
  ["Wrap up warm", ["SWEATER", "TROUSERS", "SCARF", "GLOVE"]],
  ["Outer space", ["ASTEROID", "GALAXY", "COMET", "ROCKET"]],
  ["Countries", ["PORTUGAL", "FRANCE", "BRAZIL", "EGYPT"]],
  ["Jobs", ["PLUMBER", "TEACHER", "DOCTOR", "PILOT"]],
  ["Gems", ["DIAMOND", "EMERALD", "CRYSTAL", "RUBY"]],
  ["Shapes", ["TRIANGLE", "CIRCLE", "SQUARE", "HEART"]],
  ["Camping", ["LANTERN", "COMPASS", "BLANKET", "TENT"]],
  ["Small pets", ["HAMSTER", "RABBIT", "KITTEN", "GERBIL"]],
  ["The bathroom", ["SHOWER", "MIRROR", "TOWEL", "SOAP", "SINK"]],
  ["Getting about", ["BICYCLE", "SCOOTER", "TRACTOR", "TAXI"]],
  ["Landscapes", ["GLACIER", "CANYON", "VALLEY", "DESERT"]],
  ["Italian food", ["LASAGNA", "RISOTTO", "PANINI", "PIZZA"]],
  ["The office", ["STAPLER", "PENCIL", "FOLDER", "ERASER"]],
  ["The spice rack", ["OREGANO", "GINGER", "PEPPER", "GARLIC"]],
  ["Dances", ["BALLET", "TANGO", "SALSA", "WALTZ", "JIVE"]],
  ["Chess", ["KNIGHT", "BISHOP", "QUEEN", "KING", "PAWN"]],
  ["Flowers", ["ORCHID", "TULIP", "DAISY", "PANSY", "LILY"]],
  ["At the beach", ["BUCKET", "WAVES", "SHELL", "SPADE", "SAND"]],
  ["Winter", ["SNOWMAN", "SLEDGE", "ICICLE", "MITTEN"]],
  ["Pirates", ["TREASURE", "PARROT", "ANCHOR", "SWORD"]],
  ["The circus", ["TRAPEZE", "JUGGLER", "ACROBAT", "LION"]],
  ["Coffee shop", ["ESPRESSO", "BARISTA", "LATTE", "MOCHA"]],
  ["Fairy tales", ["UNICORN", "CASTLE", "DRAGON", "WIZARD"]],
];

const SIZE = 5;
const CELLS = SIZE * SIZE;

/** mulberry32: a small seeded generator, so a layout is the same every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function neighbours(cell: number): number[] {
  const r = Math.floor(cell / SIZE);
  const c = cell % SIZE;
  const out: number[] = [];
  if (r > 0) out.push(cell - SIZE);
  if (c < SIZE - 1) out.push(cell + 1);
  if (r < SIZE - 1) out.push(cell + SIZE);
  if (c > 0) out.push(cell - 1);
  return out;
}

/**
 * Whether a path winds: it never runs straight for four cells, so no word can be
 * read off a row or a column.
 */
function turns(path: readonly number[]): boolean {
  for (let i = 3; i < path.length; i += 1) {
    const step = path[i]! - path[i - 1]!;
    if (path[i - 1]! - path[i - 2]! === step && path[i - 2]! - path[i - 3]! === step) {
      return false;
    }
  }
  return true;
}

/** Whether every empty region can be filled exactly by some of the lengths left. */
function regionsFit(owner: readonly number[], lengths: readonly number[]): boolean {
  const seen = new Set<number>();
  const sizes: number[] = [];
  for (let start = 0; start < CELLS; start += 1) {
    if (owner[start] !== -1 || seen.has(start)) continue;
    let size = 0;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cell = stack.pop()!;
      size += 1;
      for (const next of neighbours(cell)) {
        if (owner[next] === -1 && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    sizes.push(size);
  }
  // Every region must be a sum of a subset of the lengths, and all of them disjoint.
  function assign(i: number, left: readonly number[]): boolean {
    if (i === sizes.length) return left.length === 0;
    function pick(need: number, from: number, rest: number[]): boolean {
      if (need === 0) return assign(i + 1, rest);
      for (let k = from; k < rest.length; k += 1) {
        if (rest[k]! <= need) {
          const next = [...rest.slice(0, k), ...rest.slice(k + 1)];
          if (pick(need - rest[k]!, k, next)) return true;
        }
      }
      return false;
    }
    return pick(sizes[i]!, 0, [...left]);
  }
  return assign(0, lengths);
}

type Layout = { owner: number[]; paths: number[][] };

function layOut(words: readonly string[], random: () => number): Layout | null {
  const owner: number[] = Array(CELLS).fill(-1);
  const paths: number[][] = words.map(() => []);
  let budget = 20000;

  function fill(left: readonly number[]): boolean {
    if (left.length === 0) return true;
    if (budget-- <= 0) return false;
    const start = owner.indexOf(-1);
    for (const id of shuffled(left, random)) {
      const length = words[id]!.length;
      const rest = left.filter((other) => other !== id);
      // Grow paths from the first empty cell; the word may run either way along it.
      const tried = new Set<string>();
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const path = grow(start, length);
        if (!path || !turns(path)) continue;
        const key = path.join(",");
        if (tried.has(key)) continue;
        tried.add(key);
        for (const cell of path) owner[cell] = id;
        if (
          regionsFit(
            owner,
            rest.map((other) => words[other]!.length),
          )
        ) {
          paths[id] = random() < 0.5 ? path : [...path].reverse();
          if (fill(rest)) return true;
        }
        for (const cell of path) owner[cell] = -1;
      }
    }
    return false;
  }

  function grow(start: number, length: number): number[] | null {
    const path = [start];
    const used = new Set(path);
    function step(): boolean {
      if (path.length === length) return true;
      for (const next of shuffled(neighbours(path[path.length - 1]!), random)) {
        if (owner[next] !== -1 || used.has(next)) continue;
        path.push(next);
        used.add(next);
        if (step()) return true;
        path.pop();
        used.delete(next);
      }
      return false;
    }
    return step() ? path : null;
  }

  return fill(words.map((_, id) => id)) ? { owner, paths } : null;
}

function build() {
  return THEMES.map(([theme, words], index) => {
    const total = words.reduce((sum, word) => sum + word.length, 0);
    if (total !== CELLS) throw new Error(`${theme} has ${total} letters, not ${CELLS}`);
    if (words.some((word) => !/^[A-Z]{4,8}$/.test(word))) {
      throw new Error(`${theme} has a word outside A–Z, four to eight letters`);
    }
    for (let seed = 1; seed < 500; seed += 1) {
      const layout = layOut(words, rng(index * 7919 + seed));
      if (!layout) continue;
      const letters: string[] = Array(CELLS).fill("?");
      layout.paths.forEach((path, id) => {
        path.forEach((cell, k) => {
          letters[cell] = words[id]![k]!;
        });
      });
      const rows = Array.from({ length: SIZE }, (_, r) =>
        letters.slice(r * SIZE, r * SIZE + SIZE).join(""),
      );
      return { theme, words, rows, paths: layout.paths };
    }
    throw new Error(`${theme} could not be laid out`);
  });
}

function render(puzzles: ReturnType<typeof build>): string {
  const body = puzzles
    .map(
      (p) =>
        `  {\n    theme: ${JSON.stringify(p.theme)},\n    words: [${p.words.map((w) => JSON.stringify(w)).join(", ")}],\n    rows: [${p.rows.map((r) => JSON.stringify(r)).join(", ")}],\n    paths: [\n${p.paths.map((path) => `      [${path.join(", ")}],`).join("\n")}\n    ],\n  },`,
    )
    .join("\n");
  return `/**
 * Meander's grids: one theme a day, its words wound through a 5 × 5 grid so that
 * together they use every letter once.
 *
 * Generated by \`bun scripts/generate-meander-bank.ts --write\`; edit the themes
 * there, not here. Day \`d\` plays puzzle \`d mod n\`. \`paths[i]\` is the cells word
 * \`i\` is written along, first letter first (cell = row × 5 + column). The database
 * holds each puzzle's letters and words — \`public.meander_puzzle\` in
 * \`supabase/migrations/20270113120000_meander_sessions.sql\`, written by
 * \`bun scripts/generate-daily-banks.ts --write\` — and \`meander.test.ts\` fails if
 * the two copies drift, or if a grid does not hold its words.
 *
 * A puzzle's place in the list is its day: only add at the end (and only under a
 * new rules version, since old runs were played on the old list).
 */

export type MeanderPuzzle = {
  readonly theme: string;
  readonly words: readonly string[];
  readonly rows: readonly string[];
  readonly paths: readonly (readonly number[])[];
};

export const MEANDER_PUZZLES: readonly MeanderPuzzle[] = [
${body}
];
`;
}

const text = render(build());
if (process.argv.includes("--write")) {
  const path = resolve(import.meta.dir, "../src/lib/games/meander-bank.ts");
  writeFileSync(path, text);
  console.log(`wrote ${THEMES.length} puzzles to ${path}`);
} else {
  process.stdout.write(text);
}
