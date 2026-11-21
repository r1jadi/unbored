/**
 * Alibi (runtime `alibi`) — a small mystery a day, as a pure deterministic state
 * machine.
 *
 * Three suspects give a statement each, and four to six pieces of evidence wait in
 * closed files. One of the three is lying: the player opens files, finds the card
 * that contradicts a statement, and accuses that suspect *with* that card. Asking
 * for the proof means a 1-in-3 guess is not a solve. Two accusations at most.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_alibi_run` in
 * `supabase/migrations/20270122120000_alibi_sessions.sql` replays the moves and
 * decides the score. `alibi.test.ts` and `tests/security/verifier_vectors.sql` pin
 * the two together.
 *
 * ## The day
 *
 * A session's seed is the player's day number, and day `d` plays case `d mod n` of
 * `ALIBI_CASES`. The screen shows the suspects and the files in an order shuffled
 * from the day, so the liar and the proof are not always in the same place; the
 * moves address them by their place in the bank.
 *
 * ## A move
 *
 * Opening file `c` is the code `c` (0 to 5). Accusing suspect `s` with file `c` is
 * `6 + s × 6 + c` (6 to 23). A file can be opened once, an accusation needs its
 * file open, the same accusation cannot be made twice, and nothing can be played
 * once the case is solved or both accusations are spent.
 *
 * ## The score
 *
 * A solve is worth 100, less 8 for every file opened and 30 for a wrong
 * accusation: 92 (920 on screen) for the proof alone on the first try. An unsolved
 * case scores nothing. Stars: ★★★ solved on the first try with at most half the
 * files opened, ★★ on the first try, ★ on the second.
 */

import { ALIBI_CASES, type AlibiCase, type Text } from "@/lib/games/alibi-bank";
import type { AlibiAnswer } from "@/lib/games/alibi-answers";
import type { Language } from "@/lib/settings/language";

export const ALIBI_RUNTIME = "alibi";
export const ALIBI_RULES_VERSION = "alibi@1";

export const SUSPECTS = 3;
export const MAX_CARDS = 6;
export const MAX_ACCUSATIONS = 2;
export const SOLVE_POINTS = 100;
export const CARD_COST = 8;
export const MISS_COST = 30;
/** Every file opened and both accusations: the longest legal run. */
export const MAX_MOVES = MAX_CARDS + MAX_ACCUSATIONS;
/** Codes 0–5 open a file, 6–23 accuse. */
export const ACTION_CODES = MAX_CARDS + SUSPECTS * MAX_CARDS;

export type AlibiEnding = "solved" | "out" | "stopped";

export type Accusation = {
  readonly suspect: number;
  readonly card: number;
  readonly correct: boolean;
};

export type AlibiRun = {
  readonly day: number;
  readonly rulesVersion: string;
  readonly puzzle: number;
  /** Every move so far, as codes, in order. This *is* the submission. */
  readonly moves: readonly number[];
  /** The files opened, by their place in the bank. */
  readonly opened: readonly boolean[];
  readonly accusations: readonly Accusation[];
  readonly outcome: "playing" | "over";
  readonly ending: AlibiEnding | null;
  /** Today's answer: who is lying and which file proves it. */
  readonly answer: Pick<AlibiAnswer, "culprit" | "proof">;
  /** The reveal, shown once the run is over. */
  readonly solution: Text | null;
};

/** What a run needs from the answers module: the culprit and proof, and the reveal. */
export type AnswerKey = Pick<AlibiAnswer, "culprit" | "proof"> & { readonly solution?: Text };

export function puzzleIndexForDay(day: number, count = ALIBI_CASES.length): number {
  return ((day % count) + count) % count;
}

export function caseOf(run: Pick<AlibiRun, "puzzle">): AlibiCase {
  return ALIBI_CASES[run.puzzle]!;
}

/** A case's text in the player's language. */
export function say(text: Text, language: Language): string {
  return text[language];
}

export const openCode = (card: number): number => card;
export const accuseCode = (suspect: number, card: number): number =>
  MAX_CARDS + suspect * MAX_CARDS + card;

/** A code as the move it makes, or null when it is no code at all. */
export function decode(
  code: number,
): { kind: "open"; card: number } | { kind: "accuse"; suspect: number; card: number } | null {
  if (!Number.isInteger(code) || code < 0 || code >= ACTION_CODES) return null;
  if (code < MAX_CARDS) return { kind: "open", card: code };
  const rest = code - MAX_CARDS;
  return { kind: "accuse", suspect: Math.floor(rest / MAX_CARDS), card: rest % MAX_CARDS };
}

export function createRun(
  day: string | number,
  answers: readonly AnswerKey[],
  rulesVersion = ALIBI_RULES_VERSION,
): AlibiRun {
  const d = Number(day);
  const puzzle = puzzleIndexForDay(d);
  const answer = answers[puzzle]!;
  return {
    day: d,
    rulesVersion,
    puzzle,
    moves: [],
    opened: ALIBI_CASES[puzzle]!.cards.map(() => false),
    accusations: [],
    outcome: "playing",
    ending: null,
    answer: { culprit: answer.culprit, proof: answer.proof },
    solution: answer.solution ?? null,
  };
}

/** Why a move cannot be made, or null when it can. */
export function refusal(
  run: AlibiRun,
  code: number,
): "over" | "invalid" | "opened" | "closed" | "repeat" | null {
  if (run.outcome !== "playing") return "over";
  const move = decode(code);
  if (!move || move.card >= run.opened.length) return "invalid";
  if (move.kind === "open") return run.opened[move.card] ? "opened" : null;
  if (!run.opened[move.card]) return "closed";
  return run.moves.includes(code) ? "repeat" : null;
}

/** Plays a move. A refused move returns the same run object. */
export function play(run: AlibiRun, code: number): AlibiRun {
  if (refusal(run, code) !== null) return run;
  const move = decode(code)!;
  const moves = [...run.moves, code];
  if (move.kind === "open") {
    return { ...run, moves, opened: run.opened.map((on, i) => on || i === move.card) };
  }
  const correct = move.suspect === run.answer.culprit && move.card === run.answer.proof;
  const accusations = [...run.accusations, { suspect: move.suspect, card: move.card, correct }];
  const ending: AlibiEnding | null = correct
    ? "solved"
    : accusations.length >= MAX_ACCUSATIONS
      ? "out"
      : null;
  return { ...run, moves, accusations, outcome: ending ? "over" : "playing", ending };
}

/** Closes the case unsolved: the run ends with nothing. */
export function stop(run: AlibiRun): AlibiRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stopped" };
}

export function openedCount(run: AlibiRun): number {
  return run.opened.filter(Boolean).length;
}

export function missCount(run: AlibiRun): number {
  return run.accusations.filter((a) => !a.correct).length;
}

/** The points a solve would be worth now: what the board shows as you play. */
export function potential(run: AlibiRun): number {
  return SOLVE_POINTS - CARD_COST * openedCount(run) - MISS_COST * missCount(run);
}

export function scoreOf(run: AlibiRun): number {
  return run.ending === "solved" ? potential(run) : 0;
}

/** 0 to 3 stars. */
export function starsOf(run: AlibiRun): number {
  if (run.ending !== "solved") return 0;
  if (missCount(run) > 0) return 1;
  return openedCount(run) <= Math.ceil(run.opened.length / 2) ? 3 : 2;
}

export type AlibiSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: AlibiRun): AlibiSubmission {
  return { rulesVersion: run.rulesVersion, actions: run.moves, score: scoreOf(run) };
}

export function replay(
  day: string | number,
  actions: readonly number[],
  answers: readonly AnswerKey[],
): AlibiRun {
  return actions.reduce((run, code) => play(run, code), createRun(day, answers));
}

/** `count` places shuffled by a small LCG seeded with the day and a salt. */
export function shuffled(count: number, day: number, salt: number): number[] {
  let state = (Math.abs(Math.trunc(day)) * 2246822519 + salt * 374761393 + 7) >>> 0;
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    const j = state % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/** The order the screen shows the suspects in: bank places. */
export const suspectOrder = (day: number): number[] => shuffled(SUSPECTS, day, 1);

/** The order the screen shows the files in: bank places. */
export const cardOrder = (day: number, count: number): number[] => shuffled(count, day, 2);
