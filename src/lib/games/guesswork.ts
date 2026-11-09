/**
 * Guesswork (runtime `guesswork`) — the daily word, as a pure deterministic state
 * machine.
 *
 * One hidden five-letter word a day, the same for everyone, and six guesses to find
 * it. Every guess must be a word from the list, and each of its letters comes back
 * marked: in the right place, in the word but elsewhere, or not in the word. Fewer
 * guesses score more. One ranked play a day, as the crossword.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_guesswork_run` and `public.complete_gjeje_run` in
 * `supabase/migrations/20261222120000_guesswork_sessions.sql` replay the guesses on
 * the day's word and decide the score. `guesswork.test.ts` pins the two together.
 *
 * ## The day
 *
 * A session's seed is the player's day number — days since 1970-01-01 on their own
 * date, as the crossword's — and day `d` is answer `d mod n` of the bank's answers,
 * which the generator shuffled once.
 *
 * ## A move
 *
 * A move is one whole guess: its five letters packed five bits each, first letter
 * lowest, `Σ codeᵢ × 32ⁱ`, with A–Z as 1–26, Ç 27 and Ë 28 (the crossword's codes).
 * A guess that is not in the list, or one after the run is over, is not a move. The
 * run is over when a guess is the answer, after the sixth guess, or when the player
 * gives up.
 *
 * ## The score
 *
 * Solved on guess `k`: `(7 − k) × 10` — sixty for a first-guess solve, ten on the
 * last (the screen shows ten times that, as for every game). Unsolved scores
 * nothing.
 *
 * ## Gjeje
 *
 * The same game in Albanian, played when the app is in Albanian: rules version
 * `gjeje@1` and its own words. Its alphabet is Albanian's single letters — A–Z
 * without W, plus Ç and Ë; a digraph such as SH takes two squares, as in
 * Fjalekryqi. Everything else is the same game, and both languages share one board
 * and one ranked play a day.
 *
 * Storage rule: nothing here is persisted. A score only exists once the server has
 * verified it.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const GUESSWORK_RUNTIME = "guesswork";

/** The English rules. Sent with every run and pinned to a session. */
export const GUESSWORK_RULES_VERSION = "guesswork@1";

/** Gjeje, the Albanian game: the same rules over Albanian words. */
export const GJEJE_RULES_VERSION = "gjeje@1";

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

/** Points per guess left unused, counting the solving guess as used: 60 down to 10. */
export const POINTS_PER_SPARE = 10;

/** Every letter by its code: code `c` is `LETTERS[c − 1]`. */
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZÇË";

/** 2: right place; 1: in the word, elsewhere; 0: not in the word (or no more of it). */
export type Mark = 0 | 1 | 2;

export type GuessworkEnding = "solved" | "out" | "stopped";

export type GuessworkRun = {
  /** The player's day: the session's seed. */
  readonly day: number;
  readonly rulesVersion: string;
  /** The day's word. */
  readonly answer: string;
  /** The guesses so far, in order. */
  readonly guesses: readonly string[];
  /** Every guess, packed. This *is* the submission. */
  readonly moves: readonly number[];
  readonly outcome: "playing" | "over";
  readonly ending: GuessworkEnding | null;
};

/** The on-screen keyboard's rows: the crossword's layouts. */
export function keyboardFor(rulesVersion: string): readonly string[] {
  return rulesVersion === GJEJE_RULES_VERSION
    ? ["QERTZUIOPÇ", "ASDFGHJKLË", "YXCVBNM"]
    : ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
}

/** Every letter a guess under these rules can use. */
export function alphabetFor(rulesVersion: string): string {
  return keyboardFor(rulesVersion).join("");
}

/** A word's letters, one per square: Ç and Ë are one letter each. */
export function lettersOf(word: string): string[] {
  return [...word.toLocaleUpperCase("sq")];
}

/** The day's word: answer `day mod n`. */
export function answerForDay(day: number, answers: readonly string[]): string {
  if (answers.length === 0) throw new Error("a Guesswork bank has no answers");
  const n = answers.length;
  return answers[((day % n) + n) % n]!;
}

/** A guess packed as a move. */
export function encodeGuess(word: string): number {
  return lettersOf(word).reduce((packed, letter, index) => {
    const code = LETTERS.indexOf(letter) + 1;
    if (code === 0) throw new RangeError(`not a Guesswork letter: ${letter}`);
    return packed + code * 32 ** index;
  }, 0);
}

/** A move unpacked, or null when a code is not a letter. */
export function decodeGuess(move: number): string | null {
  if (!Number.isInteger(move) || move < 0 || move >= 32 ** WORD_LENGTH) return null;
  let word = "";
  for (let index = 0; index < WORD_LENGTH; index += 1) {
    const code = Math.floor(move / 32 ** index) % 32;
    if (code < 1 || code > LETTERS.length) return null;
    word += LETTERS[code - 1];
  }
  return word;
}

/**
 * The marks a guess earns: first every letter in its right place, then — left to
 * right — a letter the answer still has spare somewhere else. A letter guessed more
 * often than the answer holds it is marked absent for the extras.
 */
export function marksFor(guess: string, answer: string): Mark[] {
  const g = lettersOf(guess);
  const a = lettersOf(answer);
  const marks: Mark[] = g.map((letter, index) => (letter === a[index] ? 2 : 0));
  const spare = new Map<string, number>();
  a.forEach((letter, index) => {
    if (marks[index] !== 2) spare.set(letter, (spare.get(letter) ?? 0) + 1);
  });
  g.forEach((letter, index) => {
    if (marks[index] === 2) return;
    const left = spare.get(letter) ?? 0;
    if (left > 0) {
      marks[index] = 1;
      spare.set(letter, left - 1);
    }
  });
  return marks;
}

/** The best a letter has been marked across every guess so far, for the keyboard. */
export function letterMarks(run: GuessworkRun): Map<string, Mark> {
  const best = new Map<string, Mark>();
  for (const guess of run.guesses) {
    const marks = marksFor(guess, run.answer);
    lettersOf(guess).forEach((letter, index) => {
      const mark = marks[index]!;
      if ((best.get(letter) ?? -1) < mark) best.set(letter, mark);
    });
  }
  return best;
}

/** A fresh run on the day's word. */
export function createRun(
  day: string | number,
  answer: string,
  rulesVersion: string = GUESSWORK_RULES_VERSION,
): GuessworkRun {
  return {
    day: Number(day),
    rulesVersion,
    answer: lettersOf(answer).join(""),
    guesses: [],
    moves: [],
    outcome: "playing",
    ending: null,
  };
}

/** Why a guess is refused, or null when it can be played. */
export function refusal(
  run: GuessworkRun,
  word: string,
  isWord: (word: string) => boolean,
): "over" | "short" | "unknown" | null {
  if (run.outcome !== "playing") return "over";
  const letters = lettersOf(word);
  const alphabet = alphabetFor(run.rulesVersion);
  if (letters.length !== WORD_LENGTH || letters.some((letter) => !alphabet.includes(letter))) {
    return "short";
  }
  return isWord(letters.join("")) ? null : "unknown";
}

/**
 * Plays a guess. A refused guess returns the same run object. The answer ends the
 * run solved; a sixth wrong guess ends it out of guesses.
 */
export function guess(
  run: GuessworkRun,
  word: string,
  isWord: (word: string) => boolean,
): GuessworkRun {
  if (refusal(run, word, isWord) !== null) return run;
  const played = lettersOf(word).join("");
  const guesses = [...run.guesses, played];
  const solved = played === run.answer;
  const out = !solved && guesses.length >= MAX_GUESSES;
  return {
    ...run,
    guesses,
    moves: [...run.moves, encodeGuess(played)],
    outcome: solved || out ? "over" : "playing",
    ending: solved ? "solved" : out ? "out" : null,
  };
}

/** Gives up: the run ends unsolved, and scores nothing. */
export function finish(run: GuessworkRun): GuessworkRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stopped" };
}

/** The run's score: `(7 − k) × 10` for a solve on guess `k`, else nothing. */
export function scoreOf(run: GuessworkRun): number {
  return run.ending === "solved" ? (MAX_GUESSES + 1 - run.guesses.length) * POINTS_PER_SPARE : 0;
}

export type GuessworkSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  readonly tapsPlaced: number;
  readonly levelsCleared: number;
};

export function submission(run: GuessworkRun): GuessworkSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.moves,
    score: scoreOf(run),
    tapsPlaced: run.moves.length,
    levelsCleared: run.ending === "solved" ? 1 : 0,
  };
}

/** The run these moves make on the day's word. */
export function replay(
  day: string | number,
  answer: string,
  rulesVersion: string,
  actions: readonly number[],
  isWord: (word: string) => boolean,
): GuessworkRun {
  return actions.reduce(
    (run: GuessworkRun, action) => {
      const word = decodeGuess(action);
      return word === null ? run : guess(run, word, isWord);
    },
    createRun(day, answer, rulesVersion),
  );
}

/** A word list as a lookup: the answers and the other accepted guesses. */
export function wordSet(
  answers: readonly string[],
  guesses: readonly string[],
): (word: string) => boolean {
  const all = new Set([...answers, ...guesses]);
  return (word) => all.has(word);
}
