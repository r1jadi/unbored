/**
 * Only Once's puzzles: seven questions a day over one kind of thing, each a set of
 * right answers worked out from `only-once-data.ts`.
 *
 * The puzzles are generated here, once, by a seeded walk that is the same on every
 * machine: no question repeats inside a puzzle, the questions narrow as the day
 * goes (the first two have plenty of answers, the last few have only a handful),
 * and seven different answers always fit the seven questions.
 *
 * Only the answer sets reach the database: `public.only_once_bank` in
 * `supabase/migrations/20270104120200_only_once_sessions.sql` holds each puzzle's
 * seven sets as hex bitmasks over the kind's ids, and `only-once.test.ts` asserts
 * that it matches what this file builds. Rewrite it with
 * `bun scripts/generate-daily-banks.ts --write` after changing anything here or in
 * the data.
 */

import {
  CONTINENTS,
  COUNTRIES,
  COUNTRY_BORDERS,
  ELEMENT_SETS,
  ELEMENT_SYMBOLS,
  ELEMENTS,
  EUROPEAN_UNION,
  ISLAND_NATIONS,
  LANDLOCKED,
  MEDITERRANEAN,
  periodOf,
  PORTUGUESE_SPEAKING,
  SPANISH_SPEAKING,
  STATE_REGIONS,
  STATE_SETS,
  US_STATES,
  type Entity,
} from "@/lib/games/only-once-data";

export type Kind = {
  readonly id: "countries" | "states" | "elements";
  /** "a country", for the board. */
  readonly noun: string;
  readonly label: string;
  readonly entities: readonly Entity[];
};

export const KINDS: readonly Kind[] = [
  { id: "countries", noun: "country", label: "Countries", entities: COUNTRIES },
  { id: "states", noun: "US state", label: "US states", entities: US_STATES },
  { id: "elements", noun: "element", label: "Chemical elements", entities: ELEMENTS },
];

export type Question = {
  readonly text: string;
  /** The ids of every right answer, ascending. */
  readonly answers: readonly number[];
};

export type Puzzle = {
  /** The kind's index in `KINDS`. */
  readonly kind: number;
  readonly questions: readonly Question[];
};

export const QUESTIONS_PER_PUZZLE = 7;
/** How many puzzles the days walk through before starting again. */
export const PUZZLE_COUNT = 120;

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function idsOf(entities: readonly Entity[], names: readonly string[]): number[] {
  return names.map((name) => {
    const id = entities.findIndex((entity) => entity.name === name);
    if (id < 0) throw new Error(`Only Once: no entity named ${name}`);
    return id;
  });
}

function where(entities: readonly Entity[], test: (name: string, id: number) => boolean): number[] {
  const ids: number[] = [];
  entities.forEach((entity, id) => {
    if (test(entity.name, id)) ids.push(id);
  });
  return ids;
}

function sorted(ids: readonly number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

function letterQuestions(
  entities: readonly Entity[],
  noun: string,
  min: number,
  max: number,
): Question[] {
  const out: Question[] = [];
  for (const letter of LETTERS) {
    const answers = where(entities, (name) => name.toUpperCase().startsWith(letter));
    if (answers.length >= min && answers.length <= max) {
      out.push({ text: `Name ${articled(noun)} that starts with ${letter}`, answers });
    }
  }
  return out;
}

/** "a country", "an element", "a US state". */
export function articled(noun: string): string {
  return /^[aeiou]/i.test(noun) && !/^US/.test(noun) ? `an ${noun}` : `a ${noun}`;
}

function countryQuestions(): Question[] {
  const c = COUNTRIES;
  const has = (names: readonly string[]) => new Set(names);
  const landlocked = has(LANDLOCKED);
  const out: Question[] = [];
  for (const [continent, names] of Object.entries(CONTINENTS)) {
    const ids = idsOf(c, names);
    out.push({ text: `Name a country in ${continent}`, answers: sorted(ids) });
    const locked = ids.filter((id) => landlocked.has(c[id]!.name));
    if (locked.length >= 2) {
      out.push({ text: `Name a landlocked country in ${continent}`, answers: sorted(locked) });
    }
  }
  out.push({ text: "Name a landlocked country", answers: sorted(idsOf(c, LANDLOCKED)) });
  out.push({ text: "Name an island nation", answers: sorted(idsOf(c, ISLAND_NATIONS)) });
  out.push({
    text: "Name a country with a Mediterranean coast",
    answers: sorted(idsOf(c, MEDITERRANEAN)),
  });
  out.push({
    text: "Name a country where Spanish is an official language",
    answers: sorted(idsOf(c, SPANISH_SPEAKING)),
  });
  out.push({
    text: "Name a country where Portuguese is an official language",
    answers: sorted(idsOf(c, PORTUGUESE_SPEAKING)),
  });
  out.push({
    text: "Name a member of the European Union",
    answers: sorted(idsOf(c, EUROPEAN_UNION)),
  });
  for (const [country, neighbours] of Object.entries(COUNTRY_BORDERS)) {
    out.push({
      text: `Name a country that borders ${country}`,
      answers: sorted(idsOf(c, neighbours)),
    });
  }
  out.push({
    text: "Name a country whose name ends in -stan",
    answers: where(c, (name) => name.endsWith("stan")),
  });
  out.push({
    text: "Name a country whose name ends in -ia",
    answers: where(c, (name) => name.endsWith("ia")),
  });
  out.push({
    text: "Name a country whose name ends in -land",
    answers: where(c, (name) => name.endsWith("land")),
  });
  out.push({
    text: "Name a country whose name is more than one word",
    answers: where(c, (name) => name.includes(" ")),
  });
  out.push({
    text: "Name a country with a four-letter name",
    answers: where(c, (name) => /^[A-Za-z]{4}$/.test(name)),
  });
  out.push({
    text: "Name a country with a five-letter name",
    answers: where(c, (name) => /^[A-Za-z]{5}$/.test(name)),
  });
  out.push(...letterQuestions(c, "country", 4, 20));
  return out;
}

function stateQuestions(): Question[] {
  const s = US_STATES;
  const out: Question[] = [];
  for (const [region, names] of Object.entries(STATE_REGIONS)) {
    out.push({ text: `Name a US state in ${region}`, answers: sorted(idsOf(s, names)) });
  }
  for (const [text, names] of Object.entries(STATE_SETS)) {
    out.push({ text, answers: sorted(idsOf(s, names)) });
  }
  const coastal = new Set([
    ...STATE_SETS["Name a US state on the Pacific coast"]!,
    ...STATE_SETS["Name a US state on the Gulf of Mexico"]!,
    ...STATE_SETS["Name a US state on the Atlantic coast"]!,
  ]);
  out.push({
    text: "Name a US state with no ocean or Gulf coastline",
    answers: where(s, (name) => !coastal.has(name)),
  });
  out.push({
    text: "Name a US state whose name is two words",
    answers: where(s, (name) => name.includes(" ")),
  });
  out.push({
    text: "Name a US state whose name ends in A",
    answers: where(s, (name) => name.endsWith("a")),
  });
  out.push({
    text: "Name a US state whose name ends in O",
    answers: where(s, (name) => name.endsWith("o")),
  });
  out.push({
    text: "Name a US state whose name has four or five letters",
    answers: where(s, (name) => /^[A-Za-z]{4,5}$/.test(name)),
  });
  out.push({
    text: "Name a US state whose name starts with a vowel",
    answers: where(s, (name) => /^[AEIOU]/.test(name)),
  });
  out.push(...letterQuestions(s, "US state", 3, 10));
  return out;
}

function elementQuestions(): Question[] {
  const e = ELEMENTS;
  const bySymbol = (symbols: readonly string[]) =>
    sorted(symbols.map((symbol) => ELEMENT_SYMBOLS.indexOf(symbol)));
  const out: Question[] = [];
  out.push({
    text: "Name an element whose name ends in -ium",
    answers: where(e, (name) => name.endsWith("ium")),
  });
  out.push({
    text: "Name an element whose name doesn't end in -ium",
    answers: where(e, (name) => !name.endsWith("ium")),
  });
  for (const period of [2, 3, 4, 5, 6]) {
    out.push({
      text: `Name an element in period ${period} of the periodic table`,
      answers: where(e, (_, id) => periodOf(id + 1) === period),
    });
  }
  out.push({
    text: "Name an element among the first twenty",
    answers: where(e, (_, id) => id < 20),
  });
  out.push({
    text: "Name an element with atomic number 21 to 40",
    answers: where(e, (_, id) => id >= 20 && id < 40),
  });
  out.push({
    text: "Name a lanthanide (atomic number 57 to 71)",
    answers: where(e, (_, id) => id >= 56 && id <= 70),
  });
  out.push({
    text: "Name an element with a one-letter symbol",
    answers: where(e, (_, id) => ELEMENT_SYMBOLS[id]!.length === 1),
  });
  out.push({
    text: "Name an element whose symbol doesn't start with its first letter",
    answers: where(e, (name, id) => ELEMENT_SYMBOLS[id]![0] !== name[0]),
  });
  out.push({
    text: "Name an element whose name is four letters or fewer",
    answers: where(e, (name) => name.length <= 4),
  });
  for (const [text, symbols] of Object.entries(ELEMENT_SETS)) {
    out.push({ text, answers: bySymbol(symbols) });
  }
  out.push(...letterQuestions(e, "element", 4, 16));
  return out;
}

/** Every question each kind can ask, by kind. */
export const QUESTION_POOLS: readonly (readonly Question[])[] = [
  countryQuestions(),
  stateQuestions(),
  elementQuestions(),
];

/** MINSTD, the same in every engine: integers well inside 2⁵³. */
function minstd(seed: number) {
  let state = seed % 2147483647 || 1;
  return (n: number) => {
    state = (state * 48271) % 2147483647;
    return state % n;
  };
}

/** Whether seven questions can each get a different answer (a perfect matching). */
export function answerable(questions: readonly Question[]): boolean {
  const owner = new Map<number, number>();
  function place(q: number, seen: Set<number>): boolean {
    for (const answer of questions[q]!.answers) {
      if (seen.has(answer)) continue;
      seen.add(answer);
      const other = owner.get(answer);
      if (other === undefined || place(other, seen)) {
        owner.set(answer, q);
        return true;
      }
    }
    return false;
  }
  return questions.every((_, q) => place(q, new Set()));
}

function isLetter(question: Question): boolean {
  return question.text.includes(" that starts with ");
}

function buildPuzzle(index: number): Puzzle {
  const kind = index % KINDS.length;
  const pool = QUESTION_POOLS[kind]!;
  const rand = minstd(index * 7919 + 104729);
  const broad = pool.filter((q) => q.answers.length >= 18);
  const middle = pool.filter((q) => q.answers.length >= 8 && q.answers.length < 30);
  const narrow = pool.filter((q) => q.answers.length >= 3 && q.answers.length < 12);
  for (let attempt = 0; ; attempt += 1) {
    const picked: Question[] = [];
    const take = (from: readonly Question[]) => {
      for (let tries = 0; tries < 50; tries += 1) {
        const q = from[rand(from.length)]!;
        // At most one "starts with" question a day: a puzzle of letters is dull.
        const letterTwice = isLetter(q) && picked.some(isLetter);
        if (!letterTwice && !picked.some((p) => p.text === q.text)) {
          picked.push(q);
          return;
        }
      }
    };
    take(broad);
    take(broad);
    take(middle);
    take(middle);
    take(narrow);
    take(narrow);
    take(narrow);
    const ordered = picked.sort((a, b) => b.answers.length - a.answers.length);
    if (ordered.length === QUESTIONS_PER_PUZZLE && answerable(ordered)) {
      return { kind, questions: ordered };
    }
    if (attempt > 200) throw new Error(`Only Once: puzzle ${index} cannot be built`);
  }
}

export const ONLY_ONCE_PUZZLES: readonly Puzzle[] = Array.from({ length: PUZZLE_COUNT }, (_, i) =>
  buildPuzzle(i),
);

/** A set of ids as the database holds it: hex, four ids a digit, lowest id first. */
export function toHexMask(ids: readonly number[], size: number): string {
  const digits = new Array<number>(Math.ceil(size / 4)).fill(0);
  for (const id of ids) digits[id >> 2]! |= 1 << (id & 3);
  return digits.map((d) => d.toString(16)).join("");
}
