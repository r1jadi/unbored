#!/usr/bin/env node
/**
 * Generates the Checkmate puzzle bank: positions with exactly one way to mate.
 *
 *   node --experimental-strip-types scripts/generate-checkmate-bank.mjs           # print stats
 *   node --experimental-strip-types scripts/generate-checkmate-bank.mjs --write   # rewrite both copies
 *
 * --write rewrites `src/lib/games/checkmate-bank.ts` and the bank inside
 * `supabase/migrations/20261203120000_checkmate_sessions.sql`, between its
 * `bank:begin` and `bank:end` markers. The two must always match; the bank is a
 * fixed asset, so changing it needs a new rules version.
 *
 * ## Where the positions come from
 *
 * Games the script plays itself, from the starting position, with a fixed seed:
 * each side takes the most valuable piece it can capture half the time and plays
 * a random legal move otherwise. That is crude chess, but it reaches real middle-
 * and endgames, and every position on the way is checked:
 *
 * - **Mate in one**: the side to move has exactly one move that mates.
 * - **Mate in two**: no mate in one, and exactly one first move (the key) after
 *   which every reply allows a mate. The bank also names one reply — the first,
 *   in move order, after which the mate is unique — and that mate.
 *
 * Promotion is always to a queen (`chess.ts`), so "exactly one" counts queen
 * promotions only. A game gives the bank at most one puzzle of each kind, so no
 * two are a move apart in the same game, and a position seen twice is kept once.
 *
 * An entry is `FEN;moves`, the moves in UCI: one for a mate in one, three
 * (key, reply, mate) for a mate in two.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chess = await import(pathToFileURL(join(root, "src/lib/games/chess.ts")).href);
const { legalMoves, matingMoves, parseFen, play, START_FEN, toFen, uci } = chess;

const MATE_IN_ONE = 240;
const MATE_IN_TWO = 160;
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// mulberry32: a small seeded generator, so the bank is reproducible.
let seed = 20261203;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function choose(position, moves) {
  if (random() < 0.5) {
    let best = null;
    for (const move of moves) {
      const value = move.captured ? VALUE[move.captured.toLowerCase()] : 0;
      if (value > 0 && (!best || value > best.value)) best = { move, value };
    }
    if (best) return best.move;
  }
  return moves[Math.floor(random() * moves.length)];
}

/** The unique key, a reply and its unique mate, or null. */
function mateInTwo(position) {
  let found = null;
  for (const key of legalMoves(position)) {
    const next = play(position, key);
    const replies = legalMoves(next);
    if (replies.length === 0) continue; // mate (a mate in one) or stalemate
    let forced = true;
    for (const reply of replies) {
      if (matingMoves(play(next, reply)).length === 0) {
        forced = false;
        break;
      }
    }
    if (!forced) continue;
    if (found) return null; // a second key: not unique
    found = { key, next, replies };
  }
  if (!found) return null;
  for (const reply of found.replies) {
    const after = play(found.next, reply);
    const mates = matingMoves(after);
    if (mates.length === 1) return [found.key, reply, mates[0]];
  }
  return null;
}

const pieces = (position) => position.board.filter((piece) => piece !== "").length;

const one = new Map();
const two = new Map();
let games = 0;
while ((one.size < MATE_IN_ONE || two.size < MATE_IN_TWO) && games < 20000) {
  games += 1;
  let position = parseFen(START_FEN);
  let tookOne = false;
  let tookTwo = false;
  for (let ply = 0; ply < 160; ply += 1) {
    const moves = legalMoves(position);
    if (moves.length === 0 || position.halfmove >= 100) break;
    if (ply >= 16 && pieces(position) >= 7) {
      const where = toFen(position).split(" ").slice(0, 4).join(" ");
      const mates = matingMoves(position);
      if (mates.length === 1 && !tookOne && one.size < MATE_IN_ONE && !one.has(where)) {
        one.set(where, `${toFen(position)};${uci(mates[0])}`);
        tookOne = true;
      } else if (mates.length === 0 && !tookTwo && two.size < MATE_IN_TWO && !two.has(where)) {
        const line = mateInTwo(position);
        if (line) {
          two.set(where, `${toFen(position)};${line.map(uci).join(" ")}`);
          tookTwo = true;
        }
      }
    }
    position = play(position, choose(position, moves));
  }
}

const bank = { mateInOne: [...one.values()], mateInTwo: [...two.values()] };
console.error(
  `${games} games: ${bank.mateInOne.length} mates in one, ${bank.mateInTwo.length} in two`,
);

if (!process.argv.includes("--write")) {
  console.log(JSON.stringify(bank, null, 2));
  process.exit(0);
}

const ts = `/**
 * The Checkmate puzzle bank for \`checkmate@1\`: ${bank.mateInOne.length} mates in one, then
 * ${bank.mateInTwo.length} mates in two, each with exactly one solution. An entry is
 * \`FEN;moves\` in UCI: the mate, or the key, the reply the bank plays and the mate.
 * Generated by \`scripts/generate-checkmate-bank.mjs\`; the database holds the same
 * list (\`public.checkmate_bank()\`). Do not edit by hand.
 */
export const CHECKMATE_MATE_IN_ONE = ${bank.mateInOne.length};
export const CHECKMATE_MATE_IN_TWO = ${bank.mateInTwo.length};

export const CHECKMATE_BANK: readonly string[] = [
  // mate in one
${bank.mateInOne.map((entry) => `  ${JSON.stringify(entry)},`).join("\n")}
  // mate in two
${bank.mateInTwo.map((entry) => `  ${JSON.stringify(entry)},`).join("\n")}
];
`;
writeFileSync(join(root, "src/lib/games/checkmate-bank.ts"), ts);

const sqlPath = join(root, "supabase/migrations/20261203120000_checkmate_sessions.sql");
const sql = readFileSync(sqlPath, "utf8");
const begin = sql.indexOf("    -- bank:begin\n");
const end = sql.indexOf("    -- bank:end\n");
if (begin < 0 || end < 0) throw new Error("the migration has no bank markers");
const entries = [...bank.mateInOne, ...bank.mateInTwo];
const lines = [
  "    -- mate in one",
  ...bank.mateInOne.map((entry) => `    '${entry}'`),
  "    -- mate in two",
  ...bank.mateInTwo.map((entry) => `    '${entry}'`),
];
// Commas after every entry but the last; the comments stay bare.
let left = entries.length;
const body = lines
  .map((line) => (line.trim().startsWith("--") ? line : (left -= 1) > 0 ? `${line},` : line))
  .join("\n");
writeFileSync(sqlPath, sql.slice(0, begin) + "    -- bank:begin\n" + body + "\n" + sql.slice(end));
console.error("wrote the bank to src/lib/games/checkmate-bank.ts and the migration");
