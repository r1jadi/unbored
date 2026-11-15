/**
 * Builds Honeycomb's puzzles from an English word list.
 *
 *   bun scripts/generate-honeycomb-bank.ts <word-list>           # report
 *   bun scripts/generate-honeycomb-bank.ts <word-list> --write   # rewrite the bank
 *
 * The word list is Debian/Ubuntu's `wamerican` (`/usr/share/dict/american-english`,
 * from SCOWL; see docs/games/honeycomb-word-list.md for its notice). It is only
 * read here: the app ships the generated `src/lib/games/honeycomb-bank.ts`, and the
 * database gets each puzzle's word points from it through
 * `bun scripts/generate-daily-banks.ts --write`.
 *
 * A puzzle is seven different letters, never `s` (so plurals don't pad the list),
 * taken from a word that uses all seven, with a centre letter every word must hold.
 * A word is four or more lowercase letters a–z (no names, no apostrophes), made of
 * the puzzle's letters, and not on the blocklist below. A puzzle is kept when it has
 * 20 to 60 words. The choice is deterministic: the same list always gives the same
 * bank.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const BANK = resolve(ROOT, "src/lib/games/honeycomb-bank.ts");
const PUZZLES = 60;
const MIN_WORDS = 20;
const MAX_WORDS = 60;

/**
 * Words never accepted: the objectionable-text filter's terms
 * (`supabase/migrations/20261231120000_objectionable_text_filter.sql`), as whole words
 * or as prefixes, and English slurs and sexual terms besides.
 */
const BLOCK_PREFIX = [
  "fuck",
  "motherfuck",
  "shit",
  "bullshit",
  "cunt",
  "bitch",
  "whore",
  "slut",
  "asshole",
  "dickhead",
  "cocksuck",
  "bastard",
  "wanker",
  "porn",
  "blowjob",
  "rapist",
  "pedophil",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "tranny",
  "wetback",
  "pederast",
  "masturbat",
  "orgasm",
  "erotic",
  "penis",
  "vagin",
  "clitor",
  "testic",
  "scrot",
  "ejacul",
  "fellat",
  "sodom",
  "hooker",
  "pimp",
  "nazi",
  "negro",
];
const BLOCK_WORD = [
  "cock",
  "cocks",
  "pussy",
  "rape",
  "raped",
  "rapes",
  "raping",
  "pedo",
  "paedo",
  "kike",
  "kikes",
  "spic",
  "spics",
  "fag",
  "fags",
  "dick",
  "dicks",
  "anal",
  "anus",
  "boob",
  "boobs",
  "tits",
  "titty",
  "twat",
  "piss",
  "pissed",
  "cum",
  "jizz",
  "dildo",
  "dyke",
  "dykes",
  "homo",
  "homos",
  "coon",
  "coons",
  "gook",
  "gooks",
  "chink",
  "chinks",
  "jap",
  "japs",
  "wop",
  "wops",
  "dago",
  "dagos",
  "kraut",
  "honky",
  "lesbo",
  "queer",
  "queers",
  "nude",
  "nudes",
  "sexy",
  "horny",
  "kinky",
  "booty",
  "butt",
  "butts",
  "crap",
  "damn",
  "hell",
  "suck",
  "sucks",
  "sucker",
  "slag",
  "hoes",
  "bimbo",
  "skank",
  "gimp",
  "spaz",
  "tard",
  "nympho",
  "pervert",
  "perv",
  "incest",
  "bondage",
  "bugger",
  "buggers",
  "coolie",
  "coolies",
  "turd",
  "turds",
  "gayer",
  "niggle",
  "niggled",
  "niggles",
  "niggling",
];

function blocked(word: string): boolean {
  return BLOCK_WORD.includes(word) || BLOCK_PREFIX.some((term) => word.startsWith(term));
}

function maskOf(word: string): number {
  let mask = 0;
  for (const ch of word) mask |= 1 << (ch.charCodeAt(0) - 97);
  return mask;
}

function bits(mask: number): number {
  let n = 0;
  for (let m = mask; m; m &= m - 1) n += 1;
  return n;
}

/** FNV-1a, for a stable but scrambled order of candidate puzzles. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}

const [listPath] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (!listPath) {
  console.error("usage: bun scripts/generate-honeycomb-bank.ts <word-list> [--write]");
  process.exit(2);
}

const S = maskOf("s");
const words = [
  ...new Set(
    readFileSync(listPath, "utf8")
      .split(/\r?\n/)
      .map((w) => w.trim())
      .filter((w) => /^[a-z]{4,}$/.test(w) && !blocked(w)),
  ),
].filter((w) => (maskOf(w) & S) === 0);
const masks = new Map(words.map((w) => [w, maskOf(w)]));

/** Letter sets (as masks) that some word uses all seven of: the pangrams. */
const sets = [...new Set(words.map((w) => masks.get(w)!).filter((m) => bits(m) === 7))];

type Puzzle = { letters: string; words: string[] };
const candidates: Puzzle[] = [];
for (const set of sets) {
  const inSet = words.filter((w) => (masks.get(w)! & ~set) === 0);
  const letters = [...Array(26).keys()]
    .filter((i) => set & (1 << i))
    .map((i) => String.fromCharCode(97 + i));
  for (const centre of letters) {
    const c = 1 << (centre.charCodeAt(0) - 97);
    const accepted = inSet.filter((w) => masks.get(w)! & c).sort();
    if (accepted.length < MIN_WORDS || accepted.length > MAX_WORDS) continue;
    const outer = letters.filter((l) => l !== centre).join("");
    candidates.push({ letters: centre + outer, words: accepted });
  }
}

// One puzzle per letter set, picked in a scrambled but fixed order.
const chosen: Puzzle[] = [];
const usedSets = new Set<string>();
for (const puzzle of candidates.sort((a, b) => hash(a.letters) - hash(b.letters))) {
  const set = [...puzzle.letters].sort().join("");
  if (usedSets.has(set)) continue;
  usedSets.add(set);
  chosen.push(puzzle);
  if (chosen.length === PUZZLES) break;
}

const body = `/**
 * Honeycomb's puzzles. GENERATED by \`bun scripts/generate-honeycomb-bank.ts\` from
 * Debian/Ubuntu's \`wamerican\` word list — do not edit by hand; regenerate.
 *
 * Day \`d\` plays puzzle \`d mod n\`. \`letters\` is the centre letter, then the six
 * around it. \`words\` is every accepted word, sorted: a word's id is its place in
 * the list, and the database holds each word's points in the same order
 * (\`public.honeycomb_points\`, written by \`bun scripts/generate-daily-banks.ts --write\`).
 *
 * The words come from SCOWL, Copyright 2000-2011 by Kevin Atkinson, used under its
 * permission notice: "Permission to use, copy, modify, distribute and sell these word
 * lists, the associated scripts, the output created from the scripts, and its
 * documentation for any purpose is hereby granted without fee, provided that the
 * above copyright notice appears in all copies and that both that copyright notice
 * and this permission notice appear in supporting documentation. Kevin Atkinson
 * makes no representations about the suitability of this array for any purpose. It
 * is provided "as is" without express or implied warranty." The full notice is in
 * docs/games/honeycomb-word-list.md.
 */

export type HoneycombPuzzle = {
  /** The centre letter first, then the six around it. */
  readonly letters: string;
  readonly words: readonly string[];
};

// prettier-ignore
export const HONEYCOMB_PUZZLES: readonly HoneycombPuzzle[] = [
${chosen.map((p) => `  { letters: "${p.letters}", words: ${JSON.stringify(p.words)} },`).join("\n")}
];
`;

console.log(
  `${words.length} words, ${sets.length} pangram sets, ${candidates.length} candidates, ${chosen.length} chosen`,
);
for (const p of chosen.slice(0, 5))
  console.log(p.letters, p.words.length, p.words.slice(0, 8).join(" "));
if (process.argv.includes("--write")) {
  writeFileSync(BANK, body);
  console.log(`wrote ${BANK}`);
}
