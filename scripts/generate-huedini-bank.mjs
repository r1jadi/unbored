#!/usr/bin/env node
/**
 * Generates the Huedini puzzle bank: boards of coloured blocks and gates, each
 * proved solvable by a breadth-first solver and graded by how many set-up moves
 * its shortest solution needs.
 *
 *   node scripts/generate-huedini-bank.mjs           # print a summary
 *   node scripts/generate-huedini-bank.mjs --write   # rewrite the bank's two copies
 *
 * --write rewrites `src/lib/games/huedini-bank.ts` and the bank inside
 * `supabase/migrations/20261129120000_huedini_sessions.sql`. The two must always
 * match; `huedini.test.ts` proves every board solvable with the game's own rules.
 * The bank is a fixed asset, not something to regenerate casually: changing it
 * changes every board, so it needs a new rules version.
 *
 * ## The rules this solver plays
 *
 * Mirrors `src/lib/games/huedini.ts`. A block slides cell by cell until the next
 * step would hit a wall, another block or the edge. At the edge it leaves the
 * board if that side has a gate of its colour covering its whole width (gates are
 * two cells wide); otherwise it stops there. A move must shift the block.
 *
 * ## Why a bank
 *
 * Whether a board can be cleared — and how hard it is — takes a search. A
 * verifier must not run one, so the boards are searched once, here, and the
 * database picks a bank entry and relabels its colours.
 *
 * ## The encoding
 *
 * `side|cells|colours|gates`: `cells` is the board row by row — `.` empty, `#` a
 * wall, a letter for each block's cells (`a` the first block, in reading order of
 * their top-left cells); `colours` is one digit (1–6) per block, in letter order;
 * `gates` is three digits per gate — edge (0 top, 1 right, 2 bottom, 3 left), the
 * first of its two cells along that edge, and its colour.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PER_TIER = 40;

/** The tiers, by board level: boards 1–2, 3–5, 6–9, then the rest. */
const TIERS = [
  {
    name: "gentle",
    side: 5,
    blocks: [3, 4],
    colours: 3,
    walls: [0, 1],
    extra: [1, 3],
    big: false,
    limit: 20_000,
  },
  {
    name: "easy",
    side: 6,
    blocks: [5, 5],
    colours: 4,
    walls: [1, 2],
    extra: [2, 5],
    big: false,
    limit: 40_000,
  },
  {
    name: "tricky",
    side: 6,
    blocks: [6, 6],
    colours: 4,
    walls: [1, 3],
    extra: [4, 8],
    big: true,
    limit: 60_000,
  },
  {
    name: "hard",
    side: 7,
    blocks: [7, 8],
    colours: 5,
    walls: [2, 3],
    extra: [5, 10],
    big: true,
    limit: 100_000,
  },
];

// A small seeded generator, so the bank is reproducible.
let state = 0x2545f491;
function rand() {
  state ^= state << 13;
  state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return state / 4294967296;
}
const pick = (n) => Math.floor(rand() * n);
const between = ([lo, hi]) => lo + pick(hi - lo + 1);

const STEPS = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
];

/** The board's cells: -1 a wall, 0 empty, `i + 1` block `i`. */
function grid(board, blocks) {
  const { side, walls } = board;
  const cells = new Int8Array(side * side);
  for (const cell of walls) cells[cell] = -1;
  blocks.forEach((b, i) => {
    if (!b) return;
    for (let r = 0; r < b.h; r += 1)
      for (let c = 0; c < b.w; c += 1) cells[(b.r + r) * side + b.c + c] = i + 1;
  });
  return cells;
}

/**
 * One move: block `index` slides `dir` on `cells` (see `grid`). Returns the new
 * blocks, or null when it cannot move. A block that leaves is set to null.
 */
function slide(board, blocks, index, dir, cells = grid(board, blocks)) {
  const { side, gates } = board;
  const block = blocks[index];
  const [dr, dc] = STEPS[dir];
  const taken = { has: (cell) => cells[cell] !== 0 && cells[cell] !== index + 1 };
  let { r, c } = block;
  let moved = false;
  for (;;) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nc < 0 || nr + block.h > side || nc + block.w > side) {
      const lo = dir === 0 || dir === 2 ? c : r;
      const hi = lo + (dir === 0 || dir === 2 ? block.w : block.h) - 1;
      const out = gates.some(
        (g) => g.edge === dir && g.colour === block.colour && g.start <= lo && hi <= g.start + 1,
      );
      if (out) return blocks.map((b, i) => (i === index ? null : b));
      break;
    }
    let free = true;
    for (let y = 0; y < block.h && free; y += 1)
      for (let x = 0; x < block.w && free; x += 1)
        if (taken.has((nr + y) * side + nc + x)) free = false;
    if (!free) break;
    r = nr;
    c = nc;
    moved = true;
  }
  if (!moved) return null;
  return blocks.map((b, i) => (i === index ? { ...b, r, c } : b));
}

const key = (blocks) => blocks.map((b) => (b ? `${b.r},${b.c}` : "x")).join(";");

/**
 * A lower bound on the moves left: every block needs one move to leave, and a
 * block not lined up with any gate of its colour needs one more to line up.
 * A move changes it by at most one, so A* with it finds a shortest solution.
 */
function estimate(board, blocks) {
  let total = 0;
  for (const b of blocks) {
    if (!b) continue;
    const lined = board.gates.some((g) => {
      if (g.colour !== b.colour) return false;
      const lo = g.edge === 0 || g.edge === 2 ? b.c : b.r;
      const hi = lo + (g.edge === 0 || g.edge === 2 ? b.w : b.h) - 1;
      return g.start <= lo && hi <= g.start + 1;
    });
    total += lined ? 1 : 2;
  }
  return total;
}

/** The fewest moves that clear the board, or null (unsolvable, or past the limit). */
function solve(board, limit = 150_000) {
  const start = board.blocks;
  const best = new Map([[key(start), 0]]);
  // A bucket queue by f = g + h; deeper entries first within a bucket.
  const buckets = [];
  const push = (blocks, g) => {
    const f = g + estimate(board, blocks);
    (buckets[f] ??= []).push([blocks, g]);
  };
  push(start, 0);
  for (let f = 0; f < buckets.length; f += 1) {
    const bucket = buckets[f];
    while (bucket?.length) {
      const [blocks, g] = bucket.pop();
      if (best.get(key(blocks)) < g) continue;
      if (blocks.every((b) => b === null)) return g;
      const cells = grid(board, blocks);
      for (let i = 0; i < blocks.length; i += 1) {
        if (!blocks[i]) continue;
        for (let dir = 0; dir < 4; dir += 1) {
          const after = slide(board, blocks, i, dir, cells);
          if (!after) continue;
          const k = key(after);
          const known = best.get(k);
          if (known !== undefined && known <= g + 1) continue;
          best.set(k, g + 1);
          if (best.size > limit) return null;
          push(after, g + 1);
        }
      }
    }
  }
  return null;
}

/**
 * A board for a tier, built backwards from the empty board so it is always
 * clearable, or null when the pieces would not fit.
 *
 * Walls and one gate a colour come first. Then a random walk of reverse steps:
 * an *un-exit* puts a new block, in its gate's colour, at the edge in front of
 * the gate and pulls it inward along free cells (forwards, it slides out through
 * the gate); an *un-slide* takes a block resting against something — a wall,
 * another block, or an edge with no gate it fits — and pulls it back the other
 * way (forwards, it slides to that resting place). Played forwards, the walk is a
 * solution. The solver then grades the board by its shortest one.
 */
function candidate(tier) {
  const { side } = tier;
  const colours = tier.colours;
  const walls = [];
  const wallCount = between(tier.walls);
  while (walls.length < wallCount) {
    // Walls stay off the outer ring, so no gate is ever walled in.
    const cell = (1 + pick(side - 2)) * side + 1 + pick(side - 2);
    if (!walls.includes(cell)) walls.push(cell);
  }
  const gates = [];
  for (let colour = 1; colour <= colours; colour += 1) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const edge = pick(4);
      const start = pick(side - 1);
      if (gates.some((g) => g.edge === edge && Math.abs(g.start - start) < 2)) continue;
      gates.push({ edge, start, colour });
      break;
    }
  }
  if (gates.length < colours) return null;
  const board = { side, walls, gates, blocks: [] };
  const shapes = tier.big
    ? [
        [1, 1],
        [1, 2],
        [2, 1],
        [2, 2],
        [1, 2],
        [2, 1],
      ]
    : [
        [1, 1],
        [1, 2],
        [2, 1],
        [1, 2],
        [2, 1],
      ];
  const target = between(tier.blocks);
  let blocks = [];
  // Each colour must appear: the first un-exits walk the gates in turn.
  let placed = 0;

  const fits = (cells, r, c, h, w, self) => {
    if (r < 0 || c < 0 || r + h > side || c + w > side) return false;
    for (let y = 0; y < h; y += 1)
      for (let x = 0; x < w; x += 1) {
        const v = cells[(r + y) * side + c + x];
        if (v !== 0 && v !== self) return false;
      }
    return true;
  };

  const unExit = () => {
    const gate = placed < colours ? gates[placed] : gates[pick(gates.length)];
    const [h, w] = shapes[pick(shapes.length)];
    const along = gate.edge === 0 || gate.edge === 2 ? w : h;
    const offset = along === 2 ? 0 : pick(2);
    const pos = gate.start + offset;
    let r;
    let c;
    if (gate.edge === 0) [r, c] = [0, pos];
    else if (gate.edge === 2) [r, c] = [side - h, pos];
    else if (gate.edge === 1) [r, c] = [pos, side - w];
    else [r, c] = [pos, 0];
    const cells = grid(board, blocks);
    if (!fits(cells, r, c, h, w, 0)) return false;
    // Inward is the opposite of the way out.
    const [dr, dc] = STEPS[(gate.edge + 2) % 4];
    let steps = 0;
    const most = pick(side);
    while (steps < most && fits(cells, r + dr, c + dc, h, w, 0)) {
      r += dr;
      c += dc;
      steps += 1;
    }
    blocks = [...blocks, { r, c, h, w, colour: gate.colour }];
    placed += 1;
    return true;
  };

  const unSlide = () => {
    if (!blocks.length) return false;
    const index = pick(blocks.length);
    const block = blocks[index];
    const dir = pick(4);
    const cells = grid(board, blocks);
    const [dr, dc] = STEPS[dir];
    // Forwards it slides `dir` and must stop here: the next step is blocked.
    const nr = block.r + dr;
    const nc = block.c + dc;
    if (nr < 0 || nc < 0 || nr + block.h > side || nc + block.w > side) {
      const lo = dir === 0 || dir === 2 ? block.c : block.r;
      const hi = lo + (dir === 0 || dir === 2 ? block.w : block.h) - 1;
      if (
        gates.some(
          (g) => g.edge === dir && g.colour === block.colour && g.start <= lo && hi <= g.start + 1,
        )
      ) {
        return false;
      }
    } else if (fits(cells, nr, nc, block.h, block.w, index + 1)) {
      return false;
    }
    let r = block.r;
    let c = block.c;
    let steps = 0;
    const most = 1 + pick(side - 1);
    while (steps < most && fits(cells, r - dr, c - dc, block.h, block.w, index + 1)) {
      r -= dr;
      c -= dc;
      steps += 1;
    }
    if (!steps) return false;
    blocks = blocks.map((b, i) => (i === index ? { ...b, r, c } : b));
    return true;
  };

  const length = target * (2 + between(tier.extra));
  for (let step = 0, tries = 0; step < length && tries < length * 20; tries += 1) {
    const wantMore = placed < target && (placed < colours || rand() < 0.35 || blocks.length === 0);
    if (wantMore ? unExit() : unSlide()) step += 1;
  }
  if (placed < target) return null;
  blocks.sort((a, b) => a.r * side + a.c - (b.r * side + b.c));
  return { side, walls: walls.sort((a, b) => a - b), blocks, gates };
}

function encode(board) {
  const { side, walls, blocks, gates } = board;
  const cells = Array.from({ length: side * side }, () => ".");
  walls.forEach((cell) => (cells[cell] = "#"));
  blocks.forEach((b, i) => {
    for (let y = 0; y < b.h; y += 1)
      for (let x = 0; x < b.w; x += 1)
        cells[(b.r + y) * side + b.c + x] = String.fromCharCode(97 + i);
  });
  const sorted = [...gates].sort((a, b) => a.edge - b.edge || a.start - b.start);
  return `${side}|${cells.join("")}|${blocks.map((b) => b.colour).join("")}|${sorted
    .map((g) => `${g.edge}${g.start}${g.colour}`)
    .join("")}`;
}

function build() {
  const bank = [];
  const report = [];
  for (const tier of TIERS) {
    const found = new Map();
    let tried = 0;
    const began = Date.now();
    while (found.size < PER_TIER) {
      tried += 1;
      if (tried % 200 === 0) {
        process.stderr
          .write(`  ${tier.name}: ${found.size}/${PER_TIER} after ${tried} tries, ${Math.round((Date.now() - began) / 1000)} s
`);
      }
      const board = candidate(tier);
      if (!board) continue;
      const moves = solve(board, tier.limit);
      if (moves === null) continue;
      const extra = moves - board.blocks.length;
      if (extra < tier.extra[0] || extra > tier.extra[1]) continue;
      const code = encode(board);
      if (!found.has(code)) found.set(code, moves);
    }
    // Easiest first within a tier: a draw picks any of them.
    const entries = [...found.entries()].sort((a, b) => a[1] - b[1]);
    bank.push({ name: tier.name, entries });
    const lengths = entries.map(([, moves]) => moves);
    report.push(
      `${tier.name}: ${entries.length} boards from ${tried} tries, shortest solutions ${Math.min(...lengths)}–${Math.max(...lengths)} moves`,
    );
  }
  return { bank, report };
}

function tsFile(bank) {
  const lines = bank.flatMap(({ name, entries }) => [
    `  // ${name}`,
    ...entries.map(([code, moves]) => `  "${code}", // ${moves} moves`),
  ]);
  return `/**
 * The Huedini puzzle bank for \`huedini@1\`: ${bank.length} tiers of ${PER_TIER} boards, each
 * proved solvable, easiest first within a tier. Generated by
 * \`scripts/generate-huedini-bank.mjs\`, which explains the encoding and the tiers;
 * the database holds the same list (\`public.huedini_bank()\`). Do not edit by hand.
 */
export const HUEDINI_TIERS = [${bank.map(({ name }) => `"${name}"`).join(", ")}] as const;

/** Boards per tier: tier \`t\` is entries \`t × ${PER_TIER}\` to \`t × ${PER_TIER} + ${PER_TIER - 1}\`. */
export const HUEDINI_PER_TIER = ${PER_TIER};

export const HUEDINI_BANK: readonly string[] = [
${lines.join("\n")}
];
`;
}

function sqlBank(bank) {
  const lines = bank.flatMap(({ name, entries }, t) => [
    `    -- ${name}`,
    ...entries.map(
      ([code], i) => `    '${code}'${t === bank.length - 1 && i === entries.length - 1 ? "" : ","}`,
    ),
  ]);
  return lines.join("\n");
}

const { bank, report } = build();
console.log(report.join("\n"));

if (process.argv.includes("--write")) {
  writeFileSync(resolve(ROOT, "src/lib/games/huedini-bank.ts"), tsFile(bank));
  const migration = resolve(ROOT, "supabase/migrations/20261129120000_huedini_sessions.sql");
  const sql = readFileSync(migration, "utf8");
  const begin = sql.indexOf("-- bank:begin\n");
  const end = sql.indexOf("    -- bank:end");
  if (begin < 0 || end < 0) throw new Error("bank markers not found in the migration");
  writeFileSync(
    migration,
    sql.slice(0, begin + "-- bank:begin\n".length) + sqlBank(bank) + "\n" + sql.slice(end),
  );
  console.log("wrote src/lib/games/huedini-bank.ts and the migration's bank");
}
