/**
 * Chain — the game, as a pure deterministic state machine.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_chain_run` in
 * `supabase/migrations/20261026130000_endless_chain.sql` replays the submitted
 * tap list against the session's sequence and derives the score itself. Two copies
 * of one ruleset is a real risk, so the copy is pinned in three ways:
 *
 *   - **The rules version is data.** A session carries the version it was started
 *     under (`chain@2`), the server refuses to verify a version it does not
 *     implement, and this module declares the same string. A change to the rules
 *     is a change to the version, not an edit in place. The server still verifies
 *     the finite `chain@1` runs that sessions were pinned to before endless play.
 *   - **The state machine is total and pure.** `tap` takes a run and a pad and
 *     returns a run — no clock, no randomness, no I/O — so the same inputs
 *     produce the same run on both sides. The tempo lives in `chainTempo`, which
 *     is also pure: time decides how long a symbol is shown, never what a tap is
 *     worth.
 *   - **It is tested against the database's own numbers.** The vectors in
 *     `chain.test.ts` are the ones `tests/security/rls_test.sql` asserts (seed 1,
 *     the rounds before the old tenth, the broken chain, the run that continues
 *     past ten). See `docs/games/README.md`.
 *
 * The client cannot invent a score even if this file is wrong: a wrong replay
 * produces a number the server's replay disagrees with, and the submission is
 * refused with `score_mismatch`. What the module must get right is *agreement*, and
 * the failure mode of disagreement is a rejected run rather than a wrong one.
 *
 * Endless rule: there is no final round. Round r shows the sequence's first r
 * symbols and the player repeats all r of them; a correct tap scores one point and
 * a wrong tap ends the run. The sequence is infinite, so the game is: the only
 * ceiling is the player's memory, and every round the beat gets a little tighter
 * until it reaches a fair floor — after which the growing sequence is the whole of
 * the difficulty.
 *
 * Storage rule: nothing here is persisted. A run lives in React state for as long
 * as the screen is open; losing it costs the player one run and never a score,
 * because a score only exists once the server has verified it.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const CHAIN_RUNTIME = "chain";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const CHAIN_RULES_VERSION = "chain@2";

/** The board: four pads. There is no round count — the sequence never ends. */
export const CHAIN_PADS = 4;

/**
 * The most taps a submission may carry. This is a transport and replay bound, not
 * a game rule: a run that reached it would have been played for hours, far past
 * the point where a session is still open. The server enforces the same number.
 */
export const CHAIN_MAX_TAPS = 4096;

// The generator, state for state as `complete_chain_run` advances it: the same
// 32-bit LCG Stack 10's deck uses (see `src/lib/games/stack10.ts`), with the
// same zero-state fallback and the same decimal-string seed handling, because a
// seed that differs by one bit deals a different sequence. Only the digit read
// out of each state differs: Stack 10 reads the low bits (`state % 9`), while
// Chain reads two higher bits (`(state >> 16) % 4`). The low two bits advance
// by a constant, so they cycle with period four — every seed would deal one of
// four rotations of the same pattern, and round five would teach nothing round
// one had not. The higher bits have the full period, so each seed deals its
// own sequence.
const SEED_MODULUS = 4294967296n;
const LCG_MULTIPLIER = 1664525n;
const LCG_INCREMENT = 1013904223n;
// 0x9E3779B9. The verifier substitutes it for a zero state, which would otherwise
// produce a constant sequence; mirrored so both sides treat a degenerate seed the
// same way.
const ZERO_STATE_FALLBACK = 2654435769n;
const SYMBOL_SHIFT = 16n;

// The tempo curve. Round one is unhurried; each round shortens both the lit step
// and the gap, until each reaches its floor. The floors are where a step stops
// being readable — tightening further would make a round unfair rather than
// harder — and they are deliberately *not* the end of progression: the sequence
// keeps growing by one every round, so difficulty never becomes static.
const TEMPO_START_LIT_MS = 440;
const TEMPO_LIT_STEP_MS = 18;
const TEMPO_MIN_LIT_MS = 220;
const TEMPO_START_GAP_MS = 200;
const TEMPO_GAP_STEP_MS = 10;
const TEMPO_MIN_GAP_MS = 100;

/** The beat a round is shown at: how long each symbol lights, and the gap between. */
export type ChainTempo = {
  readonly litMs: number;
  readonly gapMs: number;
};

/**
 * The tempo for a round, 1-based.
 *
 * Both values decrease linearly and then hold at a floor, so the curve is
 * deterministic, measurable, and testable without a clock. `litMs` reaches its
 * floor at round 13 and `gapMs` at round 11; from there the growing sequence is
 * the challenge. The result is a plain object so a caller cannot mutate the curve.
 */
export function chainTempo(round: number): ChainTempo {
  if (!Number.isInteger(round) || round < 1) {
    throw new RangeError("a Chain round must be a whole number of one or more");
  }
  const steps = round - 1;
  return {
    litMs: Math.max(TEMPO_MIN_LIT_MS, TEMPO_START_LIT_MS - steps * TEMPO_LIT_STEP_MS),
    gapMs: Math.max(TEMPO_MIN_GAP_MS, TEMPO_START_GAP_MS - steps * TEMPO_GAP_STEP_MS),
  };
}

/**
 * How a run ended.
 *
 * `over` — a tap broke the chain, which is the only ending. A run never "clears":
 * there is always another round, so the score is how far the player got.
 */
export type ChainOutcome = "playing" | "over";

/** One run, as this module knows it. */
export type ChainRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /**
   * Every pad tapped, in order, including the tap that broke the chain. This
   * *is* the submission: the server replays this list and nothing else, so a
   * run is verifiable exactly when this is the list that produced it.
   */
  readonly taps: readonly number[];
  /**
   * The score this run earns under the rules, as the server computes it too:
   * one point per correct tap.
   */
  readonly score: number;
  /** Rounds fully reproduced so far. Unbounded. */
  readonly roundsCleared: number;
  /** The round being played, 1-based. Unbounded. */
  readonly round: number;
  readonly outcome: ChainOutcome;
  /** True when the player ended the run, rather than the game ending it. */
  readonly stopped?: true;
};

/**
 * Normalises a seed to the 32-bit state the generator starts from.
 *
 * It mirrors the verifier's own expression — including its handling of a negative
 * or zero seed — because a state that differs by one bit produces a different
 * sequence, and the run would be rejected as a run the rules cannot produce.
 */
function initialState(seed: string | number | bigint): bigint {
  const value = toBigInt(seed);
  const reduced = ((value % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS;
  return reduced === 0n ? ZERO_STATE_FALLBACK : reduced;
}

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) {
      throw new TypeError("a Chain seed must be a whole number");
    }
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Chain seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

/** Advances the generator once and returns the symbol it produced. */
function draw(state: bigint): { state: bigint; symbol: number } {
  const next = (state * LCG_MULTIPLIER + LCG_INCREMENT) % SEED_MODULUS;
  return { state: next, symbol: Number((next >> SYMBOL_SHIFT) % 4n) };
}

/**
 * The `index`-th symbol of a run's sequence (0-based).
 *
 * The generator is advanced from the seed on each call rather than cached, so
 * this stays a pure function of its inputs; the screen asks for the symbols of
 * one round at a time, and round r is at most r draws.
 */
export function symbolAt(seed: string | number | bigint, index: number): number {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError("a symbol index must be a whole number of zero or more");
  }
  let state = initialState(seed);
  let symbol = 0;
  for (let i = 0; i <= index; i += 1) {
    const next = draw(state);
    state = next.state;
    symbol = next.symbol;
  }
  return symbol;
}

/** Taps a round holds: round r shows the run's first r symbols. */
export function tapsInRound(round: number): number {
  return round;
}

/**
 * Taps a run holds through `round` (1-based): 1 + 2 + … + round.
 *
 * This is what lets a tap be checked against its position *within* its round in
 * constant time, however many rounds have been played.
 */
export function totalTapsThrough(round: number): number {
  return (round * (round + 1)) / 2;
}

/** A fresh run at the start of the first round. */
export function createRun(seed: string | number | bigint): ChainRun {
  const normalized = toBigInt(seed).toString();
  return {
    seed: normalized,
    rulesVersion: CHAIN_RULES_VERSION,
    taps: [],
    score: 0,
    roundsCleared: 0,
    round: 1,
    outcome: "playing",
  };
}

/**
 * Whether a tap is playable: the run is live and the pad exists.
 *
 * The board calls this to decide whether a pad is pressable, so an impossible
 * tap is never offered in the first place — and `tap` checks it again, because
 * a keyboard or programmatic path must not be able to make one either. There is
 * no round limit to check: a live run always has a next round.
 */
export function canTap(run: ChainRun, pad: number): boolean {
  if (run.outcome !== "playing") return false;
  return Number.isInteger(pad) && pad >= 0 && pad < CHAIN_PADS;
}

/**
 * Taps a pad and returns the resulting run.
 *
 * Every round replays the sequence from its start, so a tap is checked against
 * the symbol at its position *within its round*, not at its absolute position:
 * the third tap of round three must equal the sequence's third symbol, the way
 * the verifier replays it. A wrong tap ends the run with a loss and is still
 * part of it — a loss is submitted, not hidden. A correct tap that completes a
 * round starts the next one, one symbol longer, for as long as the player lasts.
 *
 * An impossible tap is not a tap: the run comes back unchanged. That is
 * deliberate rather than an exception — a tap that arrives one frame after the
 * run ended must not throw inside a render — and it keeps this function total,
 * which is what makes it testable against every state.
 */
export function tap(run: ChainRun, pad: number): ChainRun {
  if (!canTap(run, pad)) return run;

  const taps = [...run.taps, pad];
  // Taps taken in the current round so far: the round replays the sequence
  // from symbol zero, so this is the index the tap is checked against.
  const taken = run.taps.length - totalTapsThrough(run.round - 1);
  if (pad !== symbolAt(run.seed, taken)) {
    return { ...run, taps, outcome: "over" };
  }

  const roundDone = taken + 1 >= run.round;
  return {
    ...run,
    taps,
    score: run.score + 1,
    roundsCleared: roundDone ? run.roundsCleared + 1 : run.roundsCleared,
    round: roundDone ? run.round + 1 : run.round,
    outcome: "playing",
  };
}

/**
 * Ends the run where it stands: the player stopped. The score is kept, and the
 * verifier accepts the line as it is, because the score only ever grows, so
 * stopping early can never earn a point. A run that is already over is returned
 * unchanged.
 */
export function finish(run: ChainRun): ChainRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", stopped: true };
}

/**
 * The body of a completion submission.
 *
 * It is assembled from the run rather than accepted from a caller, so the number
 * submitted is the one this engine computed and cannot be edited on the way out.
 */
export type ChainSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  readonly tapsPlaced: number;
  readonly roundsCleared: number;
};

export function submission(run: ChainRun): ChainSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.taps,
    score: run.score,
    tapsPlaced: run.taps.length,
    roundsCleared: run.roundsCleared,
  };
}

/**
 * The progression readout. There is no `total` because there is no final round:
 * the meaningful numbers are how far the player got and how many taps it took.
 */
export function progress(run: ChainRun): {
  taps: number;
  round: number;
  roundsCleared: number;
} {
  return { taps: run.taps.length, round: run.round, roundsCleared: run.roundsCleared };
}
