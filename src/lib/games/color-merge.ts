/**
 * Color Merge — the game, as a pure deterministic state machine.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_color_merge_run` in
 * `supabase/migrations/20261028120000_endless_color_merge.sql` replays the
 * submitted slide list from the session's seed and derives the score itself. Two
 * copies of one ruleset is a real risk, so the copy is pinned in three ways:
 *
 *   - **The rules version is data.** A session carries the version it was started
 *     under (`color-merge@2`), the server refuses to verify a version it does not
 *     implement, and this module declares the same string. The server still
 *     verifies the retired finite `color-merge@1` runs a session may have pinned.
 *     A change to the rules is a change to the version, not an edit in place.
 *   - **The state machine is total and pure.** `slide` takes a run and a
 *     direction and returns a run — no clock, no randomness, no I/O — so the same
 *     inputs produce the same run on both sides.
 *   - **It is tested against the database's own numbers.** The vectors in
 *     `color-merge.test.ts` are the ones `tests/security/rls_test.sql` asserts
 *     (seed 1's opening board, its 48-slide line and the score it earns). See
 *     `docs/games/README.md`.
 *
 * The client cannot invent a score even if this file is wrong: a wrong replay
 * produces a number the server's replay disagrees with, and the submission is
 * refused with `score_mismatch`. What the module must get right is *agreement*,
 * and the failure mode of disagreement is a rejected run rather than a wrong one.
 *
 * Storage rule: nothing here is persisted. A run lives in React state for as long
 * as the screen is open; losing it costs the player one run and never a score,
 * because a score only exists once the server has verified it.
 *
 * Endless rule: there is no deck. A run ends only when the board locks — every
 * cell full and no two neighbours equal — or at the representable submission
 * bound. Difficulty is the spawn ramp: as slides go on, a dealt tile is likelier
 * to arrive already promoted, and the shade it arrives at grows without cap, so
 * the board fills with tiles that are harder to pair and the next lock comes
 * closer. The ramp is a pure function of the spawn index, mirrored by the
 * verifier.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const COLOR_MERGE_RUNTIME = "color-merge";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const COLOR_MERGE_RULES_VERSION = "color-merge@2";

/** The board: a 4×4 grid, like the game it borrows its slide from. */
export const COLOR_MERGE_SIZE = 4;
export const COLOR_MERGE_CELLS = COLOR_MERGE_SIZE * COLOR_MERGE_SIZE;

/**
 * The retired deck: `color-merge@1` ended after forty-eight slides.
 *
 * The constant is kept because the legacy verifier still counts it and the
 * pinned vectors still measure it; a new run has no deck and never consults it.
 */
export const COLOR_MERGE_SLIDES = 48;

/**
 * The most slides one submission may carry. This bounds a request, not a run:
 * an endless board has no complete length, and this is far past the point where
 * a session is still open.
 */
export const COLOR_MERGE_MAX_SLIDES = 4096;

/** The board opens with two tiles, drawn from the seed like every later one. */
export const COLOR_MERGE_OPENING_TILES = 2;

/**
 * Moves, as board directions. The numbers are the submission: they travel in the
 * action list and the verifier replays them in order.
 */
export const UP = 0;
export const RIGHT = 1;
export const DOWN = 2;
export const LEFT = 3;

export type ColorMergeDirection = 0 | 1 | 2 | 3;

/** Every direction, in the order a keyboard or a d-pad usually offers them. */
export const COLOR_MERGE_DIRECTIONS: readonly ColorMergeDirection[] = [
  UP,
  RIGHT,
  DOWN,
  LEFT,
] as const;

/**
 * Why a run is over.
 *
 * `locked` — the board has no empty cell and no two neighbours that match, so no
 * slide can change it. `limit` — the submission bound was reached; a request
 * ceiling, not a final slide. `null` while the run is live.
 *
 * `deck` belonged to `color-merge@1` and is never produced by these rules.
 */
export type ColorMergeEndReason = "locked" | "limit" | "deck" | null;

export type ColorMergeOutcome = "playing" | "over";

/** One run, as this module knows it. */
export type ColorMergeRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /**
   * Sixteen shades, in board order. `0` is an empty cell; a shade `s` is worth
   * `2 ** s`, and two equal shades merge into `s + 1`.
   */
  readonly board: readonly number[];
  /**
   * Every slide played, in order. This *is* the submission: the server replays
   * this list and nothing else, so a run is verifiable exactly when this is the
   * list that produced it. A direction that would not change the board is not a
   * slide and is never appended.
   */
  readonly moves: readonly ColorMergeDirection[];
  /** The score this run earns under the rules, as the server computes it too. */
  readonly score: number;
  readonly outcome: ColorMergeOutcome;
  /** True when the player ended the run, rather than the game ending it. */
  readonly stopped?: true;
  readonly endReason: ColorMergeEndReason;
};

// The generator, state for state as `complete_color_merge_run` advances it: the
// same 32-bit LCG Stack 10's deck uses (see `src/lib/games/stack10.ts`), with the
// same zero-state fallback and the same decimal-string seed handling, because a
// seed that differs by one bit deals a different board.
const SEED_MODULUS = 4294967296n;
const LCG_MULTIPLIER = 1664525n;
const LCG_INCREMENT = 1013904223n;
// 0x9E3779B9. The verifier substitutes it for a zero state, which would otherwise
// produce a constant sequence; mirrored so both sides treat a degenerate seed the
// same way.
const ZERO_STATE_FALLBACK = 2654435769n;
// The spawn ramp. Spawn `k` promotes a tile with a growing chance, and the shade
// it arrives at climbs without cap: the first hundred and twenty spawns can only
// promote to shade two, the next hundred and twenty to shade three, and so on.
// The chance rises one point every five spawns from ten to sixty. The board is
// what the ramp tightens: a promoted tile is harder to pair, so the space a run
// can keep free shrinks as the slides go on.
const PROMOTION_BASE = 10;
const PROMOTION_PER_SPAWN = 5;
const PROMOTION_MAX = 60;
const PROMOTED_SHADE_SPAN = 120;

function initialState(seed: string | number | bigint): bigint {
  const value = toBigInt(seed);
  const reduced = ((value % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS;
  return reduced === 0n ? ZERO_STATE_FALLBACK : reduced;
}

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) {
      throw new TypeError("a Color Merge seed must be a whole number");
    }
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Color Merge seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

function advance(state: bigint): bigint {
  return (state * LCG_MULTIPLIER + LCG_INCREMENT) % SEED_MODULUS;
}

/**
 * The shade a tile shows, as the number on its face.
 *
 * The board stores shades because they are what merges: two `2`s become a `3`,
 * which is the `4` tile. Scores are the values, because that is what a player
 * reads.
 */
export function tileValue(shade: number): number {
  return 2 ** shade;
}

/** The value of the highest tile on a board, or 0 for an empty one. */
export function bestShade(board: readonly number[]): number {
  return board.reduce((best, shade) => (shade > best ? shade : best), 0);
}

/** The cells a line of the board occupies, ordered in the direction of travel. */
function lineIndices(direction: ColorMergeDirection, line: number): number[] {
  const indices: number[] = [];
  for (let step = 0; step < COLOR_MERGE_SIZE; step += 1) {
    switch (direction) {
      case UP:
        // Column `line`, from the top down.
        indices.push(step * COLOR_MERGE_SIZE + line);
        break;
      case DOWN:
        // Column `line`, from the bottom up.
        indices.push((COLOR_MERGE_SIZE - 1 - step) * COLOR_MERGE_SIZE + line);
        break;
      case LEFT:
        // Row `line`, from the left.
        indices.push(line * COLOR_MERGE_SIZE + step);
        break;
      case RIGHT:
        // Row `line`, from the right.
        indices.push(line * COLOR_MERGE_SIZE + (COLOR_MERGE_SIZE - 1 - step));
        break;
    }
  }
  return indices;
}

/**
 * Slides one line toward its leading edge: the tiles compact, then each pair of
 * equal neighbours merges into the next shade, then the line is padded with empty
 * cells.
 *
 * A tile merges at most once per slide — four shade-1 tiles become two shade-2
 * tiles, not one shade-3 — which is the rule that makes a 2048 board a puzzle
 * rather than a cascade.
 *
 * The score is the value of the tiles the merges created, not the difference in
 * the board's total: merging preserves value (two 2s are worth the 4 they become),
 * so a difference would score a slide at zero and quietly pay out for the tile
 * that is dealt instead. The merged value is the conventional 2048 score and the
 * number the verifier computes.
 */
function mergeLine(values: readonly number[]): { values: number[]; gain: number } {
  const compact = values.filter((shade) => shade !== 0);
  const merged: number[] = [];
  let gain = 0;
  for (let index = 0; index < compact.length; index += 1) {
    if (index + 1 < compact.length && compact[index] === compact[index + 1]) {
      const shade = compact[index] + 1;
      merged.push(shade);
      gain += tileValue(shade);
      index += 1;
    } else {
      merged.push(compact[index]);
    }
  }
  while (merged.length < values.length) merged.push(0);
  return { values: merged, gain };
}

/**
 * The board after sliding in one direction.
 *
 * It is exported because two things need it and neither may grow a second copy:
 * `slide` applies it, and the screen asks it whether a direction would do
 * anything at all before offering the move as playable.
 */
export function slideBoard(board: readonly number[], direction: ColorMergeDirection): number[] {
  if (board.length !== COLOR_MERGE_CELLS) {
    throw new RangeError(`a Color Merge board has ${COLOR_MERGE_CELLS} cells`);
  }
  const next = [...board];
  for (let line = 0; line < COLOR_MERGE_SIZE; line += 1) {
    const indices = lineIndices(direction, line);
    const merged = mergeLine(indices.map((index) => board[index])).values;
    indices.forEach((index, position) => {
      next[index] = merged[position];
    });
  }
  return next;
}

/**
 * The points a slide earns: one merged tile's value for every pair that met.
 *
 * It is a separate read of the same line rule because the board and the score are
 * two answers to one slide, and the screen needs both — the board to draw, the
 * score to count.
 */
export function slideGain(board: readonly number[], direction: ColorMergeDirection): number {
  if (board.length !== COLOR_MERGE_CELLS) {
    throw new RangeError(`a Color Merge board has ${COLOR_MERGE_CELLS} cells`);
  }
  let gain = 0;
  for (let line = 0; line < COLOR_MERGE_SIZE; line += 1) {
    const indices = lineIndices(direction, line);
    gain += mergeLine(indices.map((index) => board[index])).gain;
  }
  return gain;
}

/** Whether a direction would change the board at all. */
export function canSlide(run: ColorMergeRun, direction: ColorMergeDirection): boolean {
  if (run.outcome !== "playing") return false;
  if (run.moves.length >= COLOR_MERGE_MAX_SLIDES) return false;
  if (!isDirection(direction)) return false;
  return !sameBoard(slideBoard(run.board, direction), run.board);
}

/**
 * Whether the board still has a move: an empty cell, or two equal neighbours.
 *
 * This is the game's own "board locked" test, and the verifier applies the same
 * one. It is exported so the screen can say the board is full rather than
 * offering a d-pad that does nothing.
 */
export function canMove(board: readonly number[]): boolean {
  if (board.length !== COLOR_MERGE_CELLS) {
    throw new RangeError(`a Color Merge board has ${COLOR_MERGE_CELLS} cells`);
  }
  if (board.some((shade) => shade === 0)) return true;
  for (let row = 0; row < COLOR_MERGE_SIZE; row += 1) {
    for (let column = 0; column < COLOR_MERGE_SIZE; column += 1) {
      const shade = board[row * COLOR_MERGE_SIZE + column];
      const right =
        column + 1 < COLOR_MERGE_SIZE && board[row * COLOR_MERGE_SIZE + column + 1] === shade;
      const below =
        row + 1 < COLOR_MERGE_SIZE && board[(row + 1) * COLOR_MERGE_SIZE + column] === shade;
      if (right || below) return true;
    }
  }
  return false;
}

function sameBoard(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((shade, index) => shade === right[index]);
}

/** Whether a number is one of the four directions this game plays. */
export function isDirection(value: number): value is ColorMergeDirection {
  return value === UP || value === RIGHT || value === DOWN || value === LEFT;
}

/**
 * How likely a spawn is to arrive promoted, as a whole percentage.
 *
 * Spawn one is 10%, matching the retired rules' opening feel, and the chance
 * rises one point every five spawns to a 60% ceiling. The ceiling is what makes
 * the ramp readable; it is not where difficulty stops, because the promoted
 * shade keeps climbing.
 */
export function spawnPromotionPercent(index: number): number {
  requireSpawnIndex(index);
  return Math.min(PROMOTION_MAX, PROMOTION_BASE + Math.floor(index / PROMOTION_PER_SPAWN));
}

/**
 * The shade a promoted spawn arrives at. It climbs by one every 120 spawns and
 * has no cap, so the board keeps receiving larger tiles for as long as a run can
 * last; a tile that cannot pair is space the player never gets back.
 */
export function spawnPromotedShade(index: number): number {
  requireSpawnIndex(index);
  return 2 + Math.floor(index / PROMOTED_SHADE_SPAN);
}

function requireSpawnIndex(index: number): void {
  if (!Number.isInteger(index) || index < 1) {
    throw new RangeError("a Color Merge spawn index starts at one");
  }
}

/**
 * The board after spawn number `index` (1-based).
 *
 * Spawn `k` is a pure function of the seed and `k`: the generator is advanced `k`
 * times to pick a cell among the empty ones (in board order, so the choice is
 * reproducible) and once more to decide the shade. Keying the draw to `k` rather
 * than to a mutable generator means the verifier can reach spawn 20 without
 * replaying nineteen spawns, and the client cannot drift by one draw.
 *
 * The shade is the ramp: a spawn is promoted when the draw falls inside the
 * spawn's promotion percentage, and the promoted shade grows with the index.
 *
 * A board with no empty cell comes back unchanged: a full board has nowhere to
 * put a tile, and that is a fact about the board rather than an error.
 */
export function spawnBoard(
  seed: string | number | bigint,
  index: number,
  board: readonly number[],
): number[] {
  requireSpawnIndex(index);
  const empties = board.flatMap((shade, cell) => (shade === 0 ? [cell] : []));
  if (empties.length === 0) return [...board];

  let state = initialState(seed);
  for (let draw = 0; draw < index; draw += 1) state = advance(state);

  const cell = empties[Number(state % BigInt(empties.length))];
  const next = [...board];
  const draw = advance(state) % 100n;
  next[cell] = draw < BigInt(spawnPromotionPercent(index)) ? spawnPromotedShade(index) : 1;
  return next;
}

/**
 * The board a run opens with: two tiles, drawn from the seed.
 *
 * Two rather than one because a single tile has no neighbour and no slide, and a
 * board that cannot be played yet is a confusing first frame.
 */
export function openingBoard(seed: string | number | bigint): number[] {
  let board = Array.from({ length: COLOR_MERGE_CELLS }, () => 0);
  for (let index = 1; index <= COLOR_MERGE_OPENING_TILES; index += 1) {
    board = spawnBoard(seed, index, board);
  }
  return board;
}

/** A fresh run at the start of the board. */
export function createRun(seed: string | number | bigint): ColorMergeRun {
  return {
    seed: toBigInt(seed).toString(),
    rulesVersion: COLOR_MERGE_RULES_VERSION,
    board: openingBoard(seed),
    moves: [],
    score: 0,
    outcome: "playing",
    endReason: null,
  };
}

/**
 * Slides the whole board and returns the resulting run.
 *
 * The score is not a running tally of moves: it is the value of the tiles the
 * merges created, which the verifier derives from the same replay. A tile that is
 * dealt is worth nothing until it merges — paying for it would reward pressing a
 * direction over playing the board.
 *
 * A direction that changes nothing is not a slide: the run comes back unchanged,
 * with no move recorded and no tile spawned. That keeps the submission equal to
 * the play — a player pressing into a wall has not made a move — and it is why
 * the verifier refuses an action list containing one.
 *
 * An impossible direction, or any slide after the run ended, is likewise not a
 * slide. That is deliberate rather than an exception: a key press that arrives
 * one frame after the run ended must not throw inside a render, and it keeps this
 * function total.
 */
export function slide(run: ColorMergeRun, direction: ColorMergeDirection): ColorMergeRun {
  if (!canSlide(run, direction)) return run;

  const moved = slideBoard(run.board, direction);
  const moves = [...run.moves, direction];
  const score = run.score + slideGain(run.board, direction);

  // The submission bound ends the run before it would spawn: there is no next
  // move to make with the tile, so dealing one would only change the board that
  // gets displayed after the run is over. This is a request ceiling, not a level.
  if (moves.length >= COLOR_MERGE_MAX_SLIDES) {
    return {
      ...run,
      board: moved,
      moves,
      score,
      outcome: "over",
      endReason: "limit",
    };
  }

  const board = spawnBoard(run.seed, COLOR_MERGE_OPENING_TILES + moves.length, moved);
  const locked = !canMove(board);
  return {
    ...run,
    board,
    moves,
    score,
    outcome: locked ? "over" : "playing",
    endReason: locked ? "locked" : null,
  };
}

/**
 * Ends the run where it stands: the player stopped. The score is kept, and the
 * verifier accepts the line as it is, because the score only ever grows, so
 * stopping early can never earn a point. A run that is already over is returned
 * unchanged.
 */
export function finish(run: ColorMergeRun): ColorMergeRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", stopped: true };
}

/**
 * The body of a completion submission.
 *
 * It is assembled from the run rather than accepted from a caller, so the number
 * submitted is the one this engine computed and cannot be edited on the way out.
 */
export type ColorMergeSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: ColorMergeRun): ColorMergeSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.moves,
    score: run.score,
  };
}

/**
 * How far through the run the player is, for the progress readout.
 *
 * There is no total because there is no deck. The last two fields are the ramp as
 * it applies to the next tile: how likely it is to be promoted, and what it
 * becomes when it is.
 */
export function progress(run: ColorMergeRun): {
  slides: number;
  best: number;
  promotionPercent: number;
  promotedValue: number;
} {
  const nextSpawn = run.moves.length + COLOR_MERGE_OPENING_TILES + 1;
  return {
    slides: run.moves.length,
    best: tileValue(bestShade(run.board)),
    promotionPercent: spawnPromotionPercent(nextSpawn),
    promotedValue: tileValue(spawnPromotedShade(nextSpawn)),
  };
}
