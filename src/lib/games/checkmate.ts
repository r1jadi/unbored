/**
 * Checkmate — the game, as a pure deterministic state machine.
 *
 * Chess puzzles against the clock: every position has exactly one way to
 * checkmate. The first six are mates in one; from the seventh on they are mates
 * in two, where the bank plays the defender's reply after the key move. Solve a
 * puzzle for points and time, and the next one is dealt.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_checkmate_run` in
 * `supabase/migrations/20261203120000_checkmate_sessions.sql` replays the submitted
 * moves against the same bank, from the session's seed, and derives the score
 * itself. The server never needs chess: a puzzle's answer is fixed, so a move
 * either is the bank's next move or it is a mistake. See `docs/games/README.md`.
 *
 * ## The run
 *
 * Ninety seconds to start. A mate in one scores 10 (100 on screen) and adds 15
 * seconds, a mate in two 30 (300) and 40 seconds, both tapered by `clock.ts` as
 * the run goes. A wrong move costs ten seconds and the puzzle stays; skipping
 * one costs twenty and scores nothing. The run ends when the clock does.
 */

import { CHECKMATE_BANK, CHECKMATE_MATE_IN_ONE } from "@/lib/games/checkmate-bank";
import {
  encodeMove,
  findMove,
  parseFen,
  play,
  san,
  squareFrom,
  type Move,
  type Position,
} from "@/lib/games/chess";
import { taperedBonusMs } from "@/lib/games/clock";

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const CHECKMATE_RUNTIME = "checkmate";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const CHECKMATE_RULES_VERSION = "checkmate@1";

/** The most actions one submission may carry: a request ceiling, not a last puzzle. */
export const CHECKMATE_MAX_ACTIONS = 2048;

/** A skip's action; every other action is a move, `from × 64 + to`. */
export const CHECKMATE_SKIP = 4096;

/** Puzzles 1 to this are mates in one; every later one a mate in two. */
export const CHECKMATE_MATE_IN_ONE_LEVELS = 6;

export const CHECKMATE_START_MS = 90_000;
export const CHECKMATE_MISTAKE_MS = 10_000;
export const CHECKMATE_SKIP_MS = 20_000;
/** How late after its clock ran out the server still accepts a run. */
export const CHECKMATE_SLACK_MS = 20_000;

/** What a solved puzzle scores and adds to the clock, before the taper, by its moves to mate. */
export const CHECKMATE_POINTS = { 1: 10, 2: 30 } as const;
export const CHECKMATE_BONUS_MS = { 1: 15_000, 2: 40_000 } as const;

const SEED_MODULUS = 4294967296n;
const ZERO_STATE_FALLBACK = 2654435769;
const MULTIPLIER = 1664525;
const INCREMENT = 1013904223;

/** A puzzle: the position, and the line the bank holds. */
export type Puzzle = {
  /** Which bank entry, 0-based across the whole bank. */
  readonly index: number;
  readonly fen: string;
  /** Moves to mate: 1 or 2. */
  readonly depth: 1 | 2;
  /** The player's moves, as action numbers: the mate, or the key and the mate. */
  readonly answers: readonly number[];
  /** In a mate in two, the defender's reply the bank plays after the key. */
  readonly reply: { from: number; to: number } | null;
};

export type CheckmateEnding = "time" | "stopped" | "bound";
export type CheckmateOutcome = "playing" | "over";

/** What the last action did, for the screen. Not part of the submission. */
export type CheckmateEvent =
  | { kind: "key"; move: Move; reply: Move; replySan: string }
  | { kind: "solved"; move: Move; points: number; depth: 1 | 2 }
  | { kind: "wrong"; move: Move }
  | { kind: "skip" };

export type CheckmateRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /** Every move and skip, in order. This *is* the submission. */
  readonly actions: readonly number[];
  /** The puzzle being played, 1-based. */
  readonly level: number;
  readonly puzzle: Puzzle;
  /** How many of the puzzle's moves are made: 0, or 1 after a mate in two's key. */
  readonly step: number;
  /** The position the player is to move in. */
  readonly position: Position;
  readonly solved: number;
  readonly mistakes: number;
  readonly skips: number;
  /** The clock the solved puzzles have added, tapered. */
  readonly bonusMs: number;
  readonly score: number;
  readonly last: CheckmateEvent | null;
  readonly outcome: CheckmateOutcome;
  readonly ending: CheckmateEnding | null;
};

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new TypeError("a Checkmate seed must be a whole number");
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Checkmate seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

function initialState(seed: string | number | bigint): number {
  const reduced = Number(((toBigInt(seed) % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS);
  return reduced === 0 ? ZERO_STATE_FALLBACK : reduced;
}

/** A move's action number from its UCI text. */
export function actionOf(text: string): number {
  return encodeMove(squareFrom(text.slice(0, 2)), squareFrom(text.slice(2, 4)));
}

/** A bank entry, parsed. */
export function entry(index: number): Puzzle {
  const [fen, line] = CHECKMATE_BANK[index].split(";");
  const moves = line.split(" ");
  if (moves.length === 1) {
    return { index, fen, depth: 1, answers: [actionOf(moves[0])], reply: null };
  }
  return {
    index,
    fen,
    depth: 2,
    answers: [actionOf(moves[0]), actionOf(moves[2])],
    reply: { from: squareFrom(moves[1].slice(0, 2)), to: squareFrom(moves[1].slice(2, 4)) },
  };
}

/**
 * The puzzle a level deals. One LCG state per level — the seed's, advanced once
 * per level — picks an entry from the level's half of the bank:
 * `(state >> 16) mod size`.
 */
export function puzzleFor(seed: string | number | bigint, level: number): Puzzle {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError("a Checkmate level must be a whole number from 1");
  }
  let state = initialState(seed);
  for (let current = 1; current <= level; current += 1) {
    state = (Math.imul(state, MULTIPLIER) + INCREMENT) >>> 0;
  }
  const mateInOne = level <= CHECKMATE_MATE_IN_ONE_LEVELS;
  const size = mateInOne ? CHECKMATE_MATE_IN_ONE : CHECKMATE_BANK.length - CHECKMATE_MATE_IN_ONE;
  const offset = mateInOne ? 0 : CHECKMATE_MATE_IN_ONE;
  return entry(offset + ((state >>> 16) % size));
}

/** The clock a run has earned, in ms. */
export function budgetMs(run: Pick<CheckmateRun, "bonusMs" | "mistakes" | "skips">): number {
  return (
    CHECKMATE_START_MS +
    run.bonusMs -
    CHECKMATE_MISTAKE_MS * run.mistakes -
    CHECKMATE_SKIP_MS * run.skips
  );
}

/** What solving the next puzzle would add to the clock, tapered. */
export function nextBonusMs(run: CheckmateRun): number {
  return taperedBonusMs(CHECKMATE_BONUS_MS[run.puzzle.depth], run.solved + 1);
}

function deal(run: CheckmateRun, level: number): Partial<CheckmateRun> {
  const puzzle = puzzleFor(run.seed, level);
  return { level, puzzle, step: 0, position: parseFen(puzzle.fen) };
}

/** A fresh run on puzzle one. */
export function createRun(seed: string | number | bigint): CheckmateRun {
  const normalised = toBigInt(seed).toString();
  const puzzle = puzzleFor(normalised, 1);
  return {
    seed: normalised,
    rulesVersion: CHECKMATE_RULES_VERSION,
    actions: [],
    level: 1,
    puzzle,
    step: 0,
    position: parseFen(puzzle.fen),
    solved: 0,
    mistakes: 0,
    skips: 0,
    bonusMs: 0,
    score: 0,
    last: null,
    outcome: "playing",
    ending: null,
  };
}

function withAction(
  run: CheckmateRun,
  action: number,
  changes: Partial<CheckmateRun>,
): CheckmateRun {
  const actions = [...run.actions, action];
  const atBound = actions.length >= CHECKMATE_MAX_ACTIONS;
  return {
    ...run,
    ...changes,
    actions,
    outcome: atBound ? "over" : "playing",
    ending: atBound ? "bound" : null,
  };
}

/**
 * Plays a move. The bank's next move goes on: a mate solves the puzzle, and a
 * mate in two's key brings the bank's reply. Any other legal move is a mistake,
 * and the position stays. A move that is not legal returns the same run object.
 */
export function move(run: CheckmateRun, from: number, to: number): CheckmateRun {
  if (run.outcome !== "playing") return run;
  const made = findMove(run.position, from, to);
  if (!made) return run;
  const action = encodeMove(from, to);
  if (action !== run.puzzle.answers[run.step]) {
    return withAction(run, action, {
      mistakes: run.mistakes + 1,
      last: { kind: "wrong", move: made },
    });
  }
  if (run.step + 1 < run.puzzle.answers.length) {
    const after = play(run.position, made);
    const reply = findMove(after, run.puzzle.reply!.from, run.puzzle.reply!.to)!;
    return withAction(run, action, {
      step: run.step + 1,
      position: play(after, reply),
      last: { kind: "key", move: made, reply, replySan: san(after, reply) },
    });
  }
  const depth = run.puzzle.depth;
  const solved = run.solved + 1;
  return withAction(run, action, {
    ...deal(run, run.level + 1),
    solved,
    score: run.score + CHECKMATE_POINTS[depth],
    bonusMs: run.bonusMs + taperedBonusMs(CHECKMATE_BONUS_MS[depth], solved),
    last: { kind: "solved", move: made, points: CHECKMATE_POINTS[depth], depth },
  });
}

/** Gives up on this puzzle for the next one, at twenty seconds of clock. */
export function skip(run: CheckmateRun): CheckmateRun {
  if (run.outcome !== "playing") return run;
  return withAction(run, CHECKMATE_SKIP, {
    ...deal(run, run.level + 1),
    skips: run.skips + 1,
    last: { kind: "skip" },
  });
}

/** Applies one submitted action: how a run is replayed. */
export function apply(run: CheckmateRun, action: number): CheckmateRun {
  if (action === CHECKMATE_SKIP) return skip(run);
  return move(run, Math.floor(action / 64), action % 64);
}

/** Ends the run where it stands: the clock ran out, or the player stopped. */
export function finish(run: CheckmateRun, ending: "time" | "stopped"): CheckmateRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending };
}

export type CheckmateSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: CheckmateRun): CheckmateSubmission {
  return { rulesVersion: run.rulesVersion, actions: run.actions, score: run.score };
}

/** The run these moves make, from the seed: how a saved run comes back. */
export function replay(seed: string | number | bigint, actions: readonly number[]): CheckmateRun {
  return actions.reduce((run: CheckmateRun, action) => apply(run, action), createRun(seed));
}
