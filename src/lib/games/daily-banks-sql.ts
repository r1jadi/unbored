/**
 * The database's copies of the Ton Up, Ballpark and Only Once banks, as the SQL
 * that sits between each sessions migration's `-- name:begin` and `-- name:end`
 * markers. `scripts/generate-daily-banks.ts` writes them there; the games' tests
 * read the migrations and compare, so the two can never drift apart silently.
 */

import { BALLPARK_PRODUCTS } from "@/lib/games/ballpark-bank";
import { KINDS, ONLY_ONCE_PUZZLES, toHexMask } from "@/lib/games/only-once-bank";
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

/** Every migration that holds a bank, and the blocks it should hold. */
export const BANK_TARGETS: readonly { file: string; blocks: () => Record<string, string> }[] = [
  { file: "supabase/migrations/20270104120000_ton_up_sessions.sql", blocks: tonUpBlocks },
  { file: "supabase/migrations/20270104120100_ballpark_sessions.sql", blocks: ballparkBlocks },
  { file: "supabase/migrations/20270104120200_only_once_sessions.sql", blocks: onlyOnceBlocks },
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
