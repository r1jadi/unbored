import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { board as boltedBoard } from "@/lib/games/bolted";
import { createRun, findSwap, swap } from "@/lib/games/cascade";
import { puzzleFor } from "@/lib/games/checkmate";
import {
  cellsCode as minefieldCells,
  minesOn,
  replay as minefieldReplay,
} from "@/lib/games/minefield";
import { replay as queensReplay } from "@/lib/games/queens";
import { speedBonus } from "@/lib/games/speed";
import { board as fuseboxBoard, boardCode, replay as fuseboxReplay } from "@/lib/games/fusebox";

/**
 * The other half of tests/security/verifier_vectors.sql.
 *
 * That file asserts that the database's verifiers reproduce a set of vectors;
 * this one asserts that the vectors are what the engines compute today. CI runs
 * both, so a change to an engine or a verifier that the other does not follow
 * fails one of them.
 */

const SQL = readFileSync(join(process.cwd(), "tests/security/verifier_vectors.sql"), "utf8");

/** The rows between a game's `vectors:<game>:begin` and `:end` markers, as string fields. */
function vectors(game: string): string[][] {
  const begin = SQL.indexOf(`-- vectors:${game}:begin`);
  const end = SQL.indexOf(`-- vectors:${game}:end`);
  if (begin < 0 || end < 0) throw new Error(`no ${game} vectors`);
  return SQL.slice(begin, end)
    .split("\n")
    .filter((line) => line.trim().startsWith("("))
    .map((line) => [...line.matchAll(/'([^']*)'|(\d+)/g)].map((m) => m[1] ?? m[2]!));
}

const rows = (board: readonly number[]) =>
  Array.from({ length: 8 }, (_, r) => board.slice(r * 8, r * 8 + 8).join("")).join(" ");

describe("the verifier vectors", () => {
  it("are Cascade's lines as the engine plays them", () => {
    const cases = vectors("cascade");
    expect(cases.length).toBeGreaterThanOrEqual(3);
    for (const [seed, actions, score, board] of cases) {
      let run = createRun(seed!);
      for (const action of actions!.split(",").map(Number)) run = swap(run, action);
      expect(run.actions.join(","), `seed ${seed}`).toBe(actions);
      expect(String(run.score), `seed ${seed}`).toBe(score);
      expect(rows(run.board), `seed ${seed}`).toBe(board);
    }
  });

  it("follow each Cascade line with legal swaps only", () => {
    // The lines are first-legal-swap play, so each must be what findSwap picks.
    for (const [seed, actions] of vectors("cascade")) {
      let run = createRun(seed!);
      for (const action of actions!.split(",").map(Number)) {
        expect(findSwap(run.board)).toBe(action);
        run = swap(run, action);
      }
    }
  });

  it("are Bolted's boards as the engine deals them", () => {
    const cases = vectors("bolted");
    expect(cases.length).toBeGreaterThanOrEqual(3);
    for (const [seed, level, nuts] of cases) {
      expect(
        boltedBoard(seed!, Number(level)).flat().join(""),
        `seed ${seed}, board ${level}`,
      ).toBe(nuts);
    }
  });

  it("are Crowns' lines as the engine plays them", () => {
    const cases = vectors("queens-speed");
    expect(cases.length).toBeGreaterThanOrEqual(3);
    for (const [seed, actions, score, level, cleared, cells] of cases) {
      const run = queensReplay(seed!, actions!.split(",").map(Number));
      expect(run.taps.join(","), `seed ${seed}: every action is legal`).toBe(actions);
      expect(String(run.score), `seed ${seed}`).toBe(score);
      expect(String(run.level), `seed ${seed}`).toBe(level);
      expect(String(run.levelsCleared), `seed ${seed}`).toBe(cleared);
      expect(
        run.cells.map((cell) => ["empty", "mark", "queen"].indexOf(cell)).join(""),
        `seed ${seed}`,
      ).toBe(cells);
    }
  });

  it("are the speed bonus as the client works it out", () => {
    const cases = vectors("speed-bonus");
    expect(cases.length).toBeGreaterThanOrEqual(3);
    for (const [base, par, elapsed, bonus] of cases) {
      expect(String(speedBonus(Number(base), Number(par), Number(elapsed)))).toBe(bonus);
    }
  });

  it("are Fusebox's boards as the engine deals them", () => {
    const cases = vectors("fusebox-boards");
    expect(cases.length).toBeGreaterThanOrEqual(3);
    for (const [seed, level, cells] of cases) {
      expect(boardCode(fuseboxBoard(seed!, Number(level))), `seed ${seed}, board ${level}`).toBe(
        cells,
      );
    }
  });

  it("are Fusebox's lines as the engine plays them", () => {
    const cases = vectors("fusebox-lines");
    expect(cases.length).toBeGreaterThanOrEqual(3);
    const reached = new Set<number>();
    for (const [seed, actions, score, sparks, level, boards, pops, cells] of cases) {
      const run = fuseboxReplay(seed!, actions!.split(",").map(Number));
      expect(run.actions.join(","), `seed ${seed}: every tap is legal`).toBe(actions);
      expect(String(run.score), `seed ${seed}`).toBe(score);
      expect(String(run.sparks), `seed ${seed}`).toBe(sparks);
      expect(String(run.level), `seed ${seed}`).toBe(level);
      expect(String(run.levelsCleared), `seed ${seed}`).toBe(boards);
      expect(String(run.pops), `seed ${seed}`).toBe(pops);
      // A run that ended has dealt nothing since its last board, and the verifier stops there too.
      expect(boardCode(run.cells), `seed ${seed}`).toBe(cells);
      reached.add(run.level);
    }
    // The lines have to reach the boards with surge and shielded cells, or they prove little.
    expect(Math.max(...reached)).toBeGreaterThanOrEqual(5);
  });

  it("are Minefield's mines as the engine draws them", () => {
    const cases = vectors("minefield-mines");
    expect(cases.length).toBeGreaterThanOrEqual(3);
    for (const [seed, level, first, mines] of cases) {
      expect(
        minesOn(seed!, Number(level), Number(first)).join(","),
        `seed ${seed}, board ${level}`,
      ).toBe(mines);
    }
  });

  it("are Minefield's lines as the engine plays them", () => {
    const cases = vectors("minefield-lines");
    expect(cases.length).toBeGreaterThanOrEqual(3);
    for (const [seed, actions, score, lives, level, boards, opened, hits, cells] of cases) {
      const run = minefieldReplay(seed!, actions!.split(",").map(Number));
      expect(run.actions.join(","), `seed ${seed}: every action is legal`).toBe(actions);
      expect(String(run.score), `seed ${seed}`).toBe(score);
      expect(String(run.lives), `seed ${seed}`).toBe(lives);
      expect(String(run.level), `seed ${seed}`).toBe(level);
      expect(String(run.levelsCleared), `seed ${seed}`).toBe(boards);
      expect(String(run.opened), `seed ${seed}`).toBe(opened);
      expect(String(run.hits), `seed ${seed}`).toBe(hits);
      expect(minefieldCells(run.cells), `seed ${seed}`).toBe(cells);
    }
  });

  it("are Checkmate's first ten puzzles as the engine deals them", () => {
    const cases = vectors("checkmate");
    expect(cases.length).toBeGreaterThanOrEqual(3);
    for (const [seed, answers] of cases) {
      const dealt = Array.from({ length: 10 }, (_, level) =>
        puzzleFor(seed!, level + 1).answers.join(" "),
      ).join(" | ");
      expect(dealt, `seed ${seed}`).toBe(answers);
    }
  });
});
