import { describe, expect, it } from "vitest";

import {
  DECANT_DEPTH,
  DECANT_EXTRA_TUBE,
  DECANT_RESTART,
  DECANT_UNDO,
  apply,
  board,
  budgetMs,
  coloursFor,
  createRun,
  encodePour,
  finish,
  pour,
  pourAmount,
  restart,
  solve,
  submission,
  addTube,
  undo,
  type DecantRun,
} from "@/lib/games/decant";

/** Plays a board's solution from the solver, pour by pour. */
function solveBoard(run: DecantRun): DecantRun {
  const pours = solve(run.tubes);
  if (!pours) throw new Error(`board ${run.level} has no solution`);
  return pours.reduce((current, [from, to]) => pour(current, from, to), run);
}

const replay = (seed: string, actions: readonly number[]) =>
  actions.reduce((run, action) => apply(run, action), createRun(seed));

describe("Decant rules", () => {
  it("grows from three colours to nine, one every second board", () => {
    expect([1, 2, 3, 4, 5, 12, 13, 50].map(coloursFor)).toEqual([3, 3, 4, 4, 5, 8, 9, 9]);
  });

  it("deals seed 1's first boards — the vectors the verifier must reproduce", () => {
    const show = (level: number) =>
      board("1", level)
        .map((tube) => tube.join("") || "-")
        .join(" ");
    expect(show(1)).toMatchInlineSnapshot(`"2133 2223 3111 - -"`);
    expect(show(2)).toMatchInlineSnapshot(`"1213 1221 3233 - -"`);
    expect(show(13)).toMatchInlineSnapshot(`"2832 1943 8265 1364 5983 1587 7674 1469 5297 - -"`);
  });

  it("deals full tubes, every colour four times, and two empty tubes", () => {
    for (const seed of ["1", "42", "-7", "9223372036854775807"]) {
      for (const level of [1, 4, 9, 20]) {
        const tubes = board(seed, level);
        const colours = coloursFor(level);
        expect(tubes).toHaveLength(colours + 2);
        expect(tubes.slice(0, colours).every((tube) => tube.length === DECANT_DEPTH)).toBe(true);
        expect(tubes.slice(colours)).toEqual([[], []]);
        const counts = new Map<number, number>();
        tubes.flat().forEach((colour) => counts.set(colour, (counts.get(colour) ?? 0) + 1));
        expect([...counts.values()].every((count) => count === DECANT_DEPTH)).toBe(true);
      }
    }
  });

  it("deals boards that can be solved, from three colours to nine", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      for (const level of [1, 5, 13]) {
        expect(solve(board(String(seed), level))).not.toBeNull();
      }
    }
  });

  it("pours the whole top run, or as much as fits, and only onto its colour", () => {
    const tubes = [[1, 2, 2], [3, 2], [2, 2, 2], []];
    expect(pourAmount(tubes, 0, 1)).toBe(2); // two 2s onto a 2 with room for two
    expect(pourAmount(tubes, 0, 2)).toBe(1); // only one fits
    expect(pourAmount(tubes, 0, 3)).toBe(2);
    expect(pourAmount(tubes, 1, 0)).toBe(1);
    expect(pourAmount(tubes, 3, 0)).toBe(0); // nothing to pour
    expect(pourAmount([[1], [2]], 0, 1)).toBe(0); // the wrong colour
  });

  it("solves boards, scores ten per colour, and deals the next", () => {
    let run = createRun("1");
    run = solveBoard(run);
    expect(run.level).toBe(2);
    expect(run.score).toBe(3);
    run = solveBoard(solveBoard(run));
    expect(run.level).toBe(4);
    expect(run.score).toBe(3 + 3 + 4);
    expect(run.levelsCleared).toBe(3);
    // A replay of the submission lands on the same run.
    expect(replay("1", submission(run).actions)).toMatchObject({ score: 10, level: 4 });
  });

  it("undoes, restarts and adds a tube, and a replay follows all three", () => {
    let run = createRun("1");
    const [first, second] = solve(run.tubes)!;
    run = pour(pour(run, ...first), ...second);
    const afterTwo = run.tubes;
    run = undo(run);
    expect(run.pours).toBe(1);
    run = pour(run, ...second);
    expect(run.tubes).toEqual(afterTwo);
    run = restart(run);
    expect(run.tubes).toEqual(board("1", 1));
    expect(restart(run)).toBe(run); // nothing poured: nothing to restart

    run = addTube(run);
    expect(run.tubes).toHaveLength(6);
    expect(addTube(run)).toBe(run); // once per board
    run = pour(run, ...first);
    run = restart(run);
    expect(run.tubes).toHaveLength(6); // the bought tube stays

    expect(run.actions).toEqual([
      encodePour(...first),
      encodePour(...second),
      DECANT_UNDO,
      encodePour(...second),
      DECANT_RESTART,
      DECANT_EXTRA_TUBE,
      encodePour(...first),
      DECANT_RESTART,
    ]);
    expect(replay("1", run.actions)).toMatchObject({ tubes: run.tubes, extraTubes: 1 });
  });

  it("charges the clock for an extra tube and pays it for solved boards", () => {
    expect(budgetMs(0)).toBe(75_000);
    expect(budgetMs(2)).toBe(75_000 + 18_000 + 16_500);
    expect(budgetMs(3, 1)).toBe(75_000 + 18_000 + 16_500 + 20_000 - 15_000);
  });

  it("ignores impossible actions and anything after the end", () => {
    const run = createRun("1");
    expect(pour(run, 0, 0)).toBe(run);
    expect(undo(run)).toBe(run);
    const over = finish(run, "stopped");
    expect(addTube(over)).toBe(over);
    expect(finish(over, "time")).toBe(over);
  });
});
