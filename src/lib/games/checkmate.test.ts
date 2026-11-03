import { describe, expect, it } from "vitest";

import { CHECKMATE_BANK, CHECKMATE_MATE_IN_ONE } from "@/lib/games/checkmate-bank";
import {
  actionOf,
  budgetMs,
  CHECKMATE_RULES_VERSION,
  CHECKMATE_SKIP,
  createRun,
  entry,
  finish,
  move,
  puzzleFor,
  skip,
  submission,
  type CheckmateRun,
} from "@/lib/games/checkmate";
import {
  findMove,
  isCheckmate,
  legalMoves,
  matingMoves,
  parseFen,
  play,
  squareFrom,
} from "@/lib/games/chess";

const answer = (run: CheckmateRun, step = run.step) => {
  const code = run.puzzle.answers[step];
  return [Math.floor(code / 64), code % 64] as const;
};

/** Solves whatever puzzle the run is on: the mate, or the key and then the mate. */
function solve(run: CheckmateRun): CheckmateRun {
  let next = move(run, ...answer(run));
  if (next.step === 1) next = move(next, ...answer(next));
  return next;
}

/** A legal move that is not the puzzle's answer. */
function wrongMove(run: CheckmateRun): [number, number] {
  const right = run.puzzle.answers[run.step];
  const other = legalMoves(run.position).find((m) => m.from * 64 + m.to !== right)!;
  return [other.from, other.to];
}

describe("the bank", () => {
  it("holds 240 mates in one, then 160 mates in two", () => {
    expect(CHECKMATE_MATE_IN_ONE).toBe(240);
    expect(CHECKMATE_BANK).toHaveLength(400);
    expect(new Set(CHECKMATE_BANK.map((e) => e.split(";")[0])).size).toBe(400);
  });

  it("has exactly one mate in every mate in one", () => {
    for (let index = 0; index < CHECKMATE_MATE_IN_ONE; index += 1) {
      const puzzle = entry(index);
      const position = parseFen(puzzle.fen);
      const mates = matingMoves(position);
      expect(mates).toHaveLength(1);
      expect(mates[0].from * 64 + mates[0].to).toBe(puzzle.answers[0]);
    }
  });

  it("has exactly one key in every mate in two, and a unique mate after the bank's reply", () => {
    for (let index = CHECKMATE_MATE_IN_ONE; index < CHECKMATE_BANK.length; index += 1) {
      const puzzle = entry(index);
      const position = parseFen(puzzle.fen);
      expect(matingMoves(position)).toHaveLength(0);

      const keys = legalMoves(position).filter((key) => {
        const next = play(position, key);
        const replies = legalMoves(next);
        return (
          replies.length > 0 && replies.every((reply) => matingMoves(play(next, reply)).length > 0)
        );
      });
      expect(keys.map((k) => k.from * 64 + k.to)).toEqual([puzzle.answers[0]]);

      const afterKey = play(position, keys[0]);
      const reply = findMove(afterKey, puzzle.reply!.from, puzzle.reply!.to)!;
      expect(reply).not.toBeNull();
      const mates = matingMoves(play(afterKey, reply));
      expect(mates.map((m) => m.from * 64 + m.to)).toEqual([puzzle.answers[1]]);
    }
  }, 120_000);
});

describe("the draw", () => {
  it("deals seed 1's puzzles: six mates in one, then mates in two", () => {
    const indexes = Array.from({ length: 8 }, (_, i) => puzzleFor("1", i + 1).index);
    expect(indexes).toEqual(SEED_1_INDEXES);
    expect(indexes.slice(0, 6).every((i) => i < CHECKMATE_MATE_IN_ONE)).toBe(true);
    expect(indexes.slice(6).every((i) => i >= CHECKMATE_MATE_IN_ONE)).toBe(true);
  });

  it("reads an answer as from × 64 + to", () => {
    expect(actionOf("e2e4")).toBe(squareFrom("e2") * 64 + squareFrom("e4"));
  });
});

describe("a run", () => {
  it("scores a mate in one, deals the next puzzle and adds its time", () => {
    const run = solve(createRun("1"));
    expect(run.solved).toBe(1);
    expect(run.level).toBe(2);
    expect(run.score).toBe(10);
    expect(run.last?.kind).toBe("solved");
    expect(budgetMs(run)).toBe(90_000 + 18_000);
    expect(run.rulesVersion).toBe(CHECKMATE_RULES_VERSION);
  });

  it("keeps the puzzle after a wrong move, at ten seconds", () => {
    const start = createRun("1");
    const run = move(start, ...wrongMove(start));
    expect(run.mistakes).toBe(1);
    expect(run.level).toBe(1);
    expect(run.position).toBe(start.position);
    expect(budgetMs(run)).toBe(80_000);
  });

  it("ignores a move that is not legal", () => {
    const run = createRun("1");
    expect(move(run, 0, 0)).toBe(run);
  });

  it("plays the bank's reply after a mate in two's key, then takes the mate", () => {
    let run = createRun("1");
    for (let i = 0; i < 6; i += 1) run = solve(run);
    expect(run.puzzle.depth).toBe(2);

    const keyed = move(run, ...answer(run));
    expect(keyed.step).toBe(1);
    expect(keyed.last?.kind).toBe("key");
    expect(keyed.position.turn).toBe(run.position.turn);

    const done = move(keyed, ...answer(keyed));
    expect(isCheckmate(play(keyed.position, findMove(keyed.position, ...answer(keyed))!))).toBe(
      true,
    );
    expect(done.solved).toBe(7);
    expect(done.score).toBe(6 * 10 + 30);
  });

  it("skips a puzzle for twenty seconds and no points", () => {
    const run = skip(createRun("1"));
    expect(run.level).toBe(2);
    expect(run.score).toBe(0);
    expect(run.actions).toEqual([CHECKMATE_SKIP]);
    expect(budgetMs(run)).toBe(70_000);
  });

  it("submits every move and skip, and stops once it is over", () => {
    let run = createRun("7");
    run = move(run, ...wrongMove(run));
    run = solve(run);
    run = skip(run);
    expect(submission(run).actions).toHaveLength(3);
    const over = finish(run, "time");
    expect(skip(over)).toBe(over);
  });

  it("plays seed 1's line to the score the verifier must agree with", () => {
    let run = createRun("1");
    run = move(run, ...wrongMove(run));
    for (let i = 0; i < 7; i += 1) run = solve(run);
    run = skip(run);
    expect(submission(run)).toMatchObject({ score: 90 });
    expect(run.actions.join(",")).toBe(SEED_1_LINE);
  });
});

/** Seed 1's first eight puzzles, by bank index. */
const SEED_1_INDEXES = [136, 200, 166, 115, 192, 216, 294, 370];
/** Seed 1: one wrong move, seven puzzles solved, one skip. */
const SEED_1_LINE = "2397,3222,334,4093,1726,578,2637,3828,3332,4096";
