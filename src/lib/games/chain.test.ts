import { describe, expect, it } from "vitest";

import {
  canTap,
  CHAIN_MAX_TAPS,
  CHAIN_PADS,
  CHAIN_RULES_VERSION,
  chainTempo,
  createRun,
  finish,
  progress,
  submission,
  symbolAt,
  tap,
  totalTapsThrough,
  type ChainRun,
} from "@/lib/games/chain";

/**
 * The engine's tests are pinned to the *database's* numbers.
 *
 * `public.complete_chain_run` is the authority: it replays the submitted tap
 * list against the sequence and derives the score. Every vector below is either
 * asserted by `tests/security/rls_test.sql` for the same seed and line, or
 * computed here from the rules independently of this module. That is what makes
 * a green suite worth something — it proves agreement with the verifier, not
 * self-consistency.
 *
 * The vectors are also written down in `docs/games/README.md`.
 */

/** Seed 1's sequence, as `tests/security/rls_test.sql` documents it. */
const SEED_ONE_SYMBOLS = [0, 0, 2, 3, 0, 0, 2, 2, 0, 1, 1, 0];

/** The perfect line through twelve rounds: 78 taps, one more round than the old cap. */
const SEED_ONE_TWELVE_ROUNDS = [
  0, 0, 0, 0, 0, 2, 0, 0, 2, 3, 0, 0, 2, 3, 0, 0, 0, 2, 3, 0, 0, 0, 0, 2, 3, 0, 0, 2, 0, 0, 2, 3, 0,
  0, 2, 2, 0, 0, 2, 3, 0, 0, 2, 2, 0, 0, 0, 2, 3, 0, 0, 2, 2, 0, 1, 0, 0, 2, 3, 0, 0, 2, 2, 0, 1, 1,
  0, 0, 2, 3, 0, 0, 2, 2, 0, 1, 1, 0,
];

/** Rounds one and two reproduced, then the tap that breaks the chain. */
const SEED_ONE_BROKEN = [0, 0, 0, 1];

/** Plays a whole line and returns the finished run. */
function playLine(seed: string, line: number[]): ChainRun {
  return line.reduce((run, pad) => tap(run, pad), createRun(seed));
}

/**
 * Plays `rounds` complete rounds, reading each symbol from the engine's own
 * generator. Used only for the high-progression case, where writing out
 * thousands of taps would hide the shape of the test rather than pin it.
 */
function playRounds(seed: string, rounds: number): ChainRun {
  let run = createRun(seed);
  for (let round = 1; round <= rounds; round += 1) {
    for (let index = 0; index < round; index += 1) {
      run = tap(run, symbolAt(seed, index));
    }
  }
  return run;
}

describe("the sequence is the verifier's sequence", () => {
  it("deals seed 1's symbols in the order the SQL suite documents", () => {
    SEED_ONE_SYMBOLS.forEach((symbol, index) => {
      expect(symbolAt("1", index)).toBe(symbol);
    });
  });

  it("reads the high bits, so the sequence does not cycle every four draws", () => {
    // The low two bits of this LCG advance by a constant: reading them would
    // deal every seed one of four rotations of the same pattern. The first ten
    // symbols of seed 1 already disprove that.
    expect(SEED_ONE_SYMBOLS.slice(0, 10)).not.toEqual([0, 3, 2, 1, 0, 3, 2, 1, 0, 3]);
    expect(new Set(SEED_ONE_SYMBOLS).size).toBeGreaterThan(2);
  });

  it("replays a seed larger than a JS safe integer exactly", () => {
    // `game_sessions.seed` is a bigint: the database's default draws from 2^63-1.
    // Rounding it to a double would draw a different sequence and the verifier
    // would reject every honest run, so the engine works in BigInt. These symbols
    // come from the generator directly, not from this module.
    const seed = "9223372036854775807";
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => symbolAt(seed, i))).toEqual([
      1, 3, 3, 3, 1, 0, 1, 0,
    ]);
  });

  it("a rounded seed would have drawn a different sequence, which is the bug this guards", () => {
    const exact = [0, 1, 2, 3, 4].map((i) => symbolAt("9223372036854775807", i));
    const rounded = [0, 1, 2, 3, 4].map((i) => symbolAt(Number("9223372036854775807"), i));
    expect(rounded).not.toEqual(exact);
  });

  it("treats a degenerate zero seed the way the verifier does", () => {
    // The verifier substitutes 0x9E3779B9 for a zero state; a seed of 0 and the seed
    // that is congruent to it must therefore play identically.
    expect([0, 1, 2, 3].map((i) => symbolAt(0, i))).toEqual([0, 2, 1, 0]);
    expect([0, 1, 2, 3].map((i) => symbolAt("4294967296", i))).toEqual([0, 2, 1, 0]);
  });

  it("reduces a negative seed the way the verifier does", () => {
    expect([0, 1, 2, 3].map((i) => symbolAt("-3", i))).toEqual([2, 3, 1, 3]);
  });

  it("refuses a seed that is not a whole number", () => {
    expect(() => symbolAt("1.5", 0)).toThrow(TypeError);
    expect(() => symbolAt("pad-1", 0)).toThrow(TypeError);
    expect(() => symbolAt(1.5, 0)).toThrow(TypeError);
    expect(() => symbolAt("1", -1)).toThrow(RangeError);
  });
});

describe("a run", () => {
  it("starts on round one with the pinned rules version", () => {
    const run = createRun("1");
    expect(run.seed).toBe("1");
    expect(run.rulesVersion).toBe(CHAIN_RULES_VERSION);
    expect(run.taps).toEqual([]);
    expect(run.score).toBe(0);
    expect(run.roundsCleared).toBe(0);
    expect(run.round).toBe(1);
    expect(run.outcome).toBe("playing");
  });

  it("advances one round at a time as each round is reproduced", () => {
    let run = createRun("1");
    run = tap(run, 0);
    expect(run.round).toBe(2);
    expect(run.roundsCleared).toBe(1);
    expect(run.score).toBe(1);
    run = tap(run, 0);
    expect(run.round).toBe(2);
    expect(run.roundsCleared).toBe(1);
    run = tap(run, 0);
    expect(run.round).toBe(3);
    expect(run.roundsCleared).toBe(2);
    expect(run.score).toBe(3);
  });

  it("checks every tap against its position within its round, from the round's start", () => {
    // Round three replays [0,0,2]: the first two taps are the sequence's first
    // two symbols again, not its fourth and fifth.
    let run = playLine("1", [0, 0, 0]);
    expect(run.outcome).toBe("playing");
    run = tap(run, 0);
    expect(run.outcome).toBe("playing");
    run = tap(run, 0);
    expect(run.outcome).toBe("playing");
    run = tap(run, 2);
    expect(run.outcome).toBe("playing");
    expect(run.round).toBe(4);
  });

  it("ends the run on the first wrong tap and keeps the losing tap in the run", () => {
    const run = playLine("1", SEED_ONE_BROKEN);
    expect(run.outcome).toBe("over");
    expect(run.taps).toEqual(SEED_ONE_BROKEN);
    expect(run.score).toBe(3);
    expect(run.roundsCleared).toBe(2);
    expect(run.taps.length).toBe(4);
  });

  it("keeps going past the old tenth round instead of clearing", () => {
    // The former endpoint: the run used to end at 55 taps with `cleared`.
    const tenRounds = playRounds("1", 10);
    expect(tenRounds.taps.length).toBe(55);
    expect(tenRounds.score).toBe(55);
    expect(tenRounds.roundsCleared).toBe(10);
    expect(tenRounds.round).toBe(11);
    expect(tenRounds.outcome).toBe("playing");

    // And the round that follows is the eleventh symbol, repeated elevent times.
    const twelfthSymbol = symbolAt("1", 10);
    const eleventhRound = Array.from({ length: 11 }, (_, index) => symbolAt("1", index));
    for (const pad of eleventhRound) {
      expect(canTap(tenRounds, pad)).toBe(true);
    }
    expect(twelfthSymbol).toBe(1);
  });

  it("plays twelve rounds from the pinned line, with a live thirteenth round", () => {
    expect(SEED_ONE_TWELVE_ROUNDS).toHaveLength(totalTapsThrough(12));
    const run = playLine("1", SEED_ONE_TWELVE_ROUNDS);
    expect(run.outcome).toBe("playing");
    expect(run.score).toBe(78);
    expect(run.roundsCleared).toBe(12);
    expect(run.round).toBe(13);
    expect(run.taps.length).toBe(78);
  });

  it("ends a run that had gone past ten rounds with its full score kept", () => {
    const run = tap(playLine("1", SEED_ONE_TWELVE_ROUNDS), 1);
    expect(run.outcome).toBe("over");
    expect(run.score).toBe(78);
    expect(run.roundsCleared).toBe(12);
    expect(run.round).toBe(13);
    expect(run.taps.length).toBe(79);
  });

  it("supports a hundred rounds without a cap, drift or overflow", () => {
    const run = playRounds("1", 100);
    expect(run.taps.length).toBe(totalTapsThrough(100));
    expect(run.taps.length).toBe(5050);
    expect(run.score).toBe(5050);
    expect(run.roundsCleared).toBe(100);
    expect(run.round).toBe(101);
    expect(run.outcome).toBe("playing");
    // The 101st round is still playable, and a wrong tap still ends the run.
    const wrong = (symbolAt("1", 0) + 1) % CHAIN_PADS;
    const ended = tap(run, wrong);
    expect(ended.outcome).toBe("over");
    expect(ended.score).toBe(5050);
    expect(ended.taps.length).toBe(5051);
  });

  it("has no submission cap in the engine, and documents the server's bound", () => {
    // 4096 is a replay bound, not a final round: a run that long would outlast
    // its session. The engine never refuses a tap because of it.
    expect(CHAIN_MAX_TAPS).toBe(4096);
    expect(canTap(createRun("1"), 0)).toBe(true);
  });

  it("offers no tap once the run has ended or on a missing pad", () => {
    const over = playLine("1", SEED_ONE_BROKEN);
    expect(canTap(over, 0)).toBe(false);
    expect(tap(over, 0)).toBe(over);

    const live = createRun("1");
    expect(canTap(live, -1)).toBe(false);
    expect(canTap(live, CHAIN_PADS)).toBe(false);
    expect(tap(live, 9)).toBe(live);
  });

  it("assembles the submission from the run, so the claim cannot be edited on the way out", () => {
    const run = playLine("1", SEED_ONE_BROKEN);
    expect(submission(run)).toEqual({
      rulesVersion: CHAIN_RULES_VERSION,
      actions: SEED_ONE_BROKEN,
      score: 3,
      tapsPlaced: 4,
      roundsCleared: 2,
    });
  });

  it("reports the endless progression without a total to be out of", () => {
    expect(progress(createRun("1"))).toEqual({ taps: 0, round: 1, roundsCleared: 0 });
    expect(progress(playRounds("1", 12))).toEqual({ taps: 78, round: 13, roundsCleared: 12 });
  });
});

describe("the tempo", () => {
  it("starts unhurried and tightens every round", () => {
    expect(chainTempo(1)).toEqual({ litMs: 440, gapMs: 200 });
    expect(chainTempo(2)).toEqual({ litMs: 422, gapMs: 190 });
    expect(chainTempo(10)).toEqual({ litMs: 278, gapMs: 110 });
  });

  it("never increases, and holds at a readable floor", () => {
    let previous = chainTempo(1);
    for (let round = 2; round <= 200; round += 1) {
      const tempo = chainTempo(round);
      expect(tempo.litMs).toBeLessThanOrEqual(previous.litMs);
      expect(tempo.gapMs).toBeLessThanOrEqual(previous.gapMs);
      previous = tempo;
    }
    expect(chainTempo(13)).toEqual({ litMs: 224, gapMs: 100 });
    expect(chainTempo(14)).toEqual({ litMs: 220, gapMs: 100 });
    // The floor is where readability ends, not where progression ends: the
    // sequence keeps growing by a tap every round.
    expect(chainTempo(10_000)).toEqual({ litMs: 220, gapMs: 100 });
  });

  it("is a function of the round alone, so two runs at round N play alike", () => {
    expect(chainTempo(37)).toEqual(chainTempo(37));
  });

  it("refuses a round that is not a whole number of one or more", () => {
    expect(() => chainTempo(0)).toThrow(RangeError);
    expect(() => chainTempo(1.5)).toThrow(RangeError);
    expect(() => chainTempo(-3)).toThrow(RangeError);
  });
});

describe("ending a run", () => {
  it("stops where the player ends it, keeping the score and the line as it stands", () => {
    const run = createRun("1");
    const stopped = finish(run);
    expect(stopped).toMatchObject({ outcome: "over", stopped: true, score: run.score });
    expect(submission(stopped)).toEqual(submission(run));
  });

  it("leaves a run that is already over exactly as it is", () => {
    const stopped = finish(createRun("1"));
    expect(finish(stopped)).toBe(stopped);
  });
});
