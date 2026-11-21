/**
 * The database's copies of the Ton Up, Ballpark, Only Once, Pixelock, Honeycomb, Meander, Dead Reckoning and Alibi banks, as the SQL
 * that sits between each sessions migration's `-- name:begin` and `-- name:end`
 * markers. `scripts/generate-daily-banks.ts` writes them there; the games' tests
 * read the migrations and compare, so the two can never drift apart silently.
 */

import { ALIBI_ANSWERS } from "@/lib/games/alibi-answers";
import { ALIBI_CASES } from "@/lib/games/alibi-bank";
import { BALLPARK_PRODUCTS } from "@/lib/games/ballpark-bank";
import { KINDS, ONLY_ONCE_PUZZLES, toHexMask } from "@/lib/games/only-once-bank";
import { HONEYCOMB_PUZZLES } from "@/lib/games/honeycomb-bank";
import { MEANDER_PUZZLES } from "@/lib/games/meander-bank";
import {
  CATEGORIES as DEAD_RECKONING_CATEGORIES,
  ESTIMATES as DEAD_RECKONING_ESTIMATES,
  PUZZLES as DEAD_RECKONING_PUZZLES,
} from "@/lib/games/dead-reckoning-bank";
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

/**
 * Dead Reckoning: each list's values in order, and each day's seven rounds as
 * (list, or -1 for an estimate; scale, 0 a quantity or 1 a year; target) triples,
 * then the golden round's place.
 */
export function deadReckoningBlocks(): Record<string, string> {
  return {
    "dead-reckoning-values": DEAD_RECKONING_CATEGORIES.map(
      (category, i) =>
        `    when ${i} then array[${category.entries.map((entry) => entry.value).join(", ")}]`,
    ).join("\n"),
    "dead-reckoning-count": `    ${DEAD_RECKONING_PUZZLES.length}`,
    "dead-reckoning-bank": DEAD_RECKONING_PUZZLES.map((puzzle, i) => {
      const triples = puzzle.rounds.flatMap((round) => {
        if (round.kind === "name") {
          const category = DEAD_RECKONING_CATEGORIES[round.category]!;
          return [round.category, category.scale === "year" ? 1 : 0, round.target];
        }
        const estimate = DEAD_RECKONING_ESTIMATES[round.estimate]!;
        return [-1, estimate.scale === "year" ? 1 : 0, estimate.answer];
      });
      return `    when ${i} then array[${[...triples, puzzle.golden].join(", ")}]`;
    }).join("\n"),
  };
}

/**
 * Alibi: each case's file count, then the suspect who is lying and the file that
 * proves it, by their places in the bank. The case text stays in the client.
 */
export function alibiBlocks(): Record<string, string> {
  return {
    "alibi-count": `    ${ALIBI_CASES.length}`,
    "alibi-bank": ALIBI_CASES.map((alibiCase, i) => {
      const answer = ALIBI_ANSWERS[i]!;
      return `    when ${i} then array[${alibiCase.cards.length}, ${answer.culprit}, ${answer.proof}] -- ${alibiCase.id}`;
    }).join("\n"),
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
  {
    file: "supabase/migrations/20270121120000_dead_reckoning_sessions.sql",
    blocks: deadReckoningBlocks,
  },
  { file: "supabase/migrations/20270122120000_alibi_sessions.sql", blocks: alibiBlocks },
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
