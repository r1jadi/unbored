/**
 * The database's copies of the Ton Up, Ballpark, Only Once, Pixelock, Honeycomb and Meander banks, as the SQL
 * that sits between each sessions migration's `-- name:begin` and `-- name:end`
 * markers. `scripts/generate-daily-banks.ts` writes them there; the games' tests
 * read the migrations and compare, so the two can never drift apart silently.
 */

import { BALLPARK_PRODUCTS } from "@/lib/games/ballpark-bank";
import { KINDS, ONLY_ONCE_PUZZLES, toHexMask } from "@/lib/games/only-once-bank";
import { HONEYCOMB_PUZZLES } from "@/lib/games/honeycomb-bank";
import { MEANDER_PUZZLES } from "@/lib/games/meander-bank";
import { pointsList } from "@/lib/games/honeycomb";
import { PIXELOCK_PICTURES } from "@/lib/games/pixelock-bank";
import { TON_UP_CATEGORIES } from "@/lib/games/ton-up-bank";

export function tonUpBlocks(): Record<string, string> {
  return {
    "ton-up-count": `    ${TON_UP_CATEGORIES.length}`,
    "ton-up-values": TON_UP_CATEGORIES.map(
      (category, i) =>
        `    when ${i} then array[${category.answers.map((a) => a.value).join(", ")}]`,
    ).join("\n"),
  };
}

export function ballparkBlocks(): Record<string, string> {
  const prices = BALLPARK_PRODUCTS.map((p) => p.cents);
  const lines: string[] = [];
  for (let i = 0; i < prices.length; i += 12) {
    lines.push(`    ${prices.slice(i, i + 12).join(", ")}`);
  }
  return { "ballpark-prices": lines.join(",\n") };
}

export function onlyOnceBlocks(): Record<string, string> {
  const rows = ONLY_ONCE_PUZZLES.map((puzzle) => {
    const size = KINDS[puzzle.kind]!.entities.length;
    const masks = puzzle.questions.map((q) => `"${toHexMask(q.answers, size)}"`);
    return `[${puzzle.kind},${masks.join(",")}]`;
  });
  return { "only-once-bank": `    '[${rows.join(",\n     ")}]'` };
}

export function pixelockBlocks(): Record<string, string> {
  return {
    "pixelock-bank": PIXELOCK_PICTURES.map(
      (picture, i) =>
        `    '${picture.rows.join("")}'${i < PIXELOCK_PICTURES.length - 1 ? "," : ""} -- ${i}: ${picture.name}`,
    ).join("\n"),
  };
}

export function honeycombBlocks(): Record<string, string> {
  return {
    "honeycomb-count": `    ${HONEYCOMB_PUZZLES.length}`,
    "honeycomb-points": HONEYCOMB_PUZZLES.map(
      (puzzle, i) => `    when ${i} then array[${pointsList(puzzle).join(", ")}]`,
    ).join("\n"),
  };
}

export function meanderBlocks(): Record<string, string> {
  return {
    "meander-count": `    ${MEANDER_PUZZLES.length}`,
    "meander-bank": MEANDER_PUZZLES.map(
      (puzzle, i) =>
        `    when ${i} then array[${[puzzle.rows.join(""), ...puzzle.words].map((s) => `'${s}'`).join(", ")}]`,
    ).join("\n"),
  };
}

/** Every migration that holds a bank, and the blocks it should hold. */
export const BANK_TARGETS: readonly { file: string; blocks: () => Record<string, string> }[] = [
  { file: "supabase/migrations/20270104120000_ton_up_sessions.sql", blocks: tonUpBlocks },
  { file: "supabase/migrations/20270104120100_ballpark_sessions.sql", blocks: ballparkBlocks },
  { file: "supabase/migrations/20270104120200_only_once_sessions.sql", blocks: onlyOnceBlocks },
  { file: "supabase/migrations/20270105120100_pixelock_sessions.sql", blocks: pixelockBlocks },
  { file: "supabase/migrations/20270106120100_honeycomb_sessions.sql", blocks: honeycombBlocks },
  { file: "supabase/migrations/20270113120000_meander_sessions.sql", blocks: meanderBlocks },
];

/** The text between a block's markers in a migration, or null when it has none. */
export function readBlock(text: string, name: string): string | null {
  const match = new RegExp(String.raw`-- ${name}:begin\r?\n([\s\S]*?)\r?\n\s*-- ${name}:end`).exec(
    text,
  );
  return match ? match[1]!.replace(/\r\n/g, "\n") : null;
}

/** The migration with a block's body replaced. */
export function replaceBlock(text: string, name: string, body: string): string {
  const pattern = new RegExp(String.raw`(-- ${name}:begin\r?\n)[\s\S]*?(\r?\n\s*-- ${name}:end)`);
  if (!pattern.test(text)) throw new Error(`no ${name} block`);
  return text.replace(pattern, (_, begin: string, end: string) => `${begin}${body}${end}`);
}
