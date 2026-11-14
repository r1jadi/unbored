#!/usr/bin/env node
/**
 * Generates the Deep Cut answer bank migration from scripts/deep-cut/bank.txt.
 *
 *   node scripts/generate-deep-cut-bank.mjs           # check the bank, print a summary
 *   node scripts/generate-deep-cut-bank.mjs --write   # rewrite the bank migration
 *
 * --write rewrites `MIGRATION` (below): one `deep_cut_load_question` call per
 * question. Loading is an upsert, so each bank migration carries the whole bank.
 * Once a bank migration has been deployed it is never rewritten — point
 * `MIGRATION` at a new file instead (the first was
 * `20270102120100_deep_cut_bank.sql`). The bank never ships to the browser —
 * the answers are the score — so there is no client copy to keep in step.
 *
 * The check refuses a bank where, within one question:
 *   - two spellings of different answers normalise to the same key (`answerKey`,
 *     the twin of SQL `deep_cut_key`) — one key would name two answers. Spellings
 *     of the same answer that fold together (an alias without its accents) are
 *     simply redundant and skipped;
 *   - an answer has no letters or digits, or is longer than 60 characters;
 *   - a tier is not 1–6.
 * It also refuses a duplicate slug, and a bank of fewer than 21 questions (three
 * days' worth, so practice always has questions that aren't live).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "scripts/deep-cut/bank.txt";
const MIGRATION = "supabase/migrations/20270103120100_deep_cut_bank_more.sql";

const FOLD = [
  "áàâäãåāăąçćčďéèêëēėęěíìîïīįłñńňóòôöõōőřśšşťúùûüūůűųýÿžźżğı",
  "aaaaaaaaacccdeeeeeeeeiiiiiilnnnooooooorsssstuuuuuuuuyyzzzgi",
];

/** The matching key of a spelling. Mirrors `deep_cut_key` in the sessions migration. */
export function answerKey(text) {
  let value = text.toLowerCase();
  value = value
    .replaceAll("ß", "ss")
    .replaceAll("æ", "ae")
    .replaceAll("œ", "oe")
    .replaceAll("ø", "o");
  value = value.replaceAll("&", " and ").replaceAll("+", "plus").replaceAll("#", "sharp");
  value = [...value]
    .map((ch) => {
      const at = FOLD[0].indexOf(ch);
      return at === -1 ? ch : FOLD[1][at];
    })
    .join("");
  value = value.replace(/[^a-z0-9]+/g, " ").trim();
  value = value.replace(/^(the|a|an) /, "");
  return value.replaceAll(" ", "");
}

export function parseBank(text) {
  const questions = [];
  let current = null;
  const problems = [];
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    const where = `${SOURCE}:${index + 1}`;
    if (line === "" || (line.startsWith("#") && !line.startsWith("##"))) return;
    if (line.startsWith("##")) {
      const parts = line
        .slice(2)
        .split("|")
        .map((part) => part.trim());
      if (parts.length !== 3) {
        problems.push(`${where}: a question header needs slug | category | prompt`);
        return;
      }
      const [slug, category, prompt] = parts;
      if (!/^[a-z0-9-]{2,48}$/.test(slug)) problems.push(`${where}: bad slug ${slug}`);
      current = { slug, category, prompt, answers: [], keys: new Map() };
      questions.push(current);
      return;
    }
    const match = /^([1-6]):\s*(.*)$/.exec(line);
    if (!match || !current) {
      problems.push(`${where}: expected "## header" or "tier: answers"`);
      return;
    }
    const tier = Number(match[1]);
    for (const entry of match[2].split(";")) {
      const spellings = entry
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean);
      if (spellings.length === 0) continue;
      const [name, ...aliases] = spellings;
      if (current.answers.some((answer) => answerKey(answer.name) === answerKey(name))) {
        problems.push(`${where}: ${current.slug}: "${name}" is listed twice`);
        continue;
      }
      for (const spelling of spellings) {
        const key = answerKey(spelling);
        if (key === "" || spelling.length > 60) {
          problems.push(`${where}: "${spelling}" is not a usable spelling`);
          continue;
        }
        const owner = current.keys.get(key);
        // Another spelling of the same answer folding to its key is just redundant.
        if (owner === name) continue;
        if (owner !== undefined) {
          problems.push(
            `${where}: ${current.slug}: "${spelling}" is the same key (${key}) as "${owner}"`,
          );
          continue;
        }
        current.keys.set(key, name);
      }
      current.answers.push({ name, tier, aliases });
    }
  });

  const slugs = new Set();
  for (const question of questions) {
    if (slugs.has(question.slug)) problems.push(`duplicate slug ${question.slug}`);
    slugs.add(question.slug);
    if (question.answers.length < 6) problems.push(`${question.slug}: fewer than six answers`);
  }
  if (questions.length < 21)
    problems.push(`only ${questions.length} questions; at least 21 needed`);
  return { questions, problems };
}

const sqlText = (value) => `'${value.replaceAll("'", "''")}'`;

function migration(questions) {
  const lines = [
    "-- The Deep Cut answer bank. Generated by scripts/generate-deep-cut-bank.mjs from",
    "-- scripts/deep-cut/bank.txt — edit that file and regenerate; never edit this one.",
    "--",
    "-- Each call upserts a question and its curated answers (with every spelling's",
    "-- key). Answers a reviewer added are kept. Re-running it is safe.",
    "",
  ];
  for (const question of questions) {
    const answers = question.answers.map((answer) =>
      answer.aliases.length > 0
        ? { name: answer.name, tier: answer.tier, aliases: answer.aliases }
        : { name: answer.name, tier: answer.tier },
    );
    lines.push(
      `select public.deep_cut_load_question(${sqlText(question.slug)}, ${sqlText(question.category)}, ${sqlText(question.prompt)},`,
      `  ${sqlText(JSON.stringify(answers))}::jsonb);`,
      "",
    );
  }
  lines.push(
    "do $$",
    "begin",
    `  if (select count(*) from public.deep_cut_questions where active) < ${questions.length} then`,
    "    raise exception 'the Deep Cut bank did not load every question';",
    "  end if;",
    "end",
    "$$;",
    "",
  );
  return lines.join("\n");
}

// `pathToFileURL`, not "file://" + the path: on Windows the two differ, and the
// check would silently do nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { questions, problems } = parseBank(readFileSync(resolve(ROOT, SOURCE), "utf8"));
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  const answers = questions.reduce((sum, question) => sum + question.answers.length, 0);
  const byTier = [1, 2, 3, 4, 5, 6].map(
    (tier) =>
      questions.flatMap((question) => question.answers).filter((answer) => answer.tier === tier)
        .length,
  );
  console.log(`${questions.length} questions, ${answers} answers; by tier ${byTier.join(" / ")}`);
  if (process.argv.includes("--write")) {
    writeFileSync(resolve(ROOT, MIGRATION), migration(questions));
    console.log(`wrote ${MIGRATION}`);
  }
}
