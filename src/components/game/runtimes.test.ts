import { describe, expect, it } from "vitest";

import { RUNTIME_IDS } from "@/components/game/runtimes";
import { BALLPARK_RUNTIME } from "@/lib/games/ballpark";
import { BOLTED_RUNTIME } from "@/lib/games/bolted";
import { CASCADE_RUNTIME } from "@/lib/games/cascade";
import { CHAIN_RUNTIME } from "@/lib/games/chain";
import { CHECKMATE_RUNTIME } from "@/lib/games/checkmate";
import { COLOR_MERGE_RUNTIME } from "@/lib/games/color-merge";
import { CROSSWORD_RUNTIME } from "@/lib/games/crossword";
import { DECANT_RUNTIME } from "@/lib/games/decant";
import { DEEP_CUT_RUNTIME } from "@/lib/games/deep-cut";
import { DONT_TOUCH_RUNTIME } from "@/lib/games/dont-touch";
import { EIGHT_PUZZLE_RUNTIME } from "@/lib/games/eight-puzzle";
import { FLIPSIDE_RUNTIME } from "@/lib/games/flipside";
import { FOURSORT_RUNTIME } from "@/lib/games/foursort";
import { FUSEBOX_RUNTIME } from "@/lib/games/fusebox";
import { GRIDBURST_RUNTIME } from "@/lib/games/gridburst";
import { GUESSWORK_RUNTIME } from "@/lib/games/guesswork";
import { HONEYCOMB_RUNTIME } from "@/lib/games/honeycomb";
import { MEANDER_RUNTIME } from "@/lib/games/meander";
import { HUEDINI_RUNTIME } from "@/lib/games/huedini";
import { MEMORY_FLASH_RUNTIME } from "@/lib/games/memory-flash";
import { MINEFIELD_RUNTIME } from "@/lib/games/minefield";
import { MINI_SUDOKU_RUNTIME } from "@/lib/games/mini-sudoku";
import { ONE_MOVE_RUNTIME } from "@/lib/games/one-move";
import { ONLY_ONCE_RUNTIME } from "@/lib/games/only-once";
import { PIXELOCK_RUNTIME } from "@/lib/games/pixelock";
import { QUEENS_RUNTIME } from "@/lib/games/queens";
import { SCATTER_RUNTIME } from "@/lib/games/scatter";
import { SEVEN_SECOND_RUNTIME } from "@/lib/games/seven-second";
import { STACK10_RUNTIME } from "@/lib/games/stack10";
import { SUDOKU_RUNTIME } from "@/lib/games/sudoku";
import { SUMDOKU_RUNTIME } from "@/lib/games/sumdoku";
import { TANGO_RUNTIME } from "@/lib/games/tango";
import { TEE_TIME_RUNTIME } from "@/lib/games/tee-time";
import { THEN_AND_NOW_RUNTIME } from "@/lib/games/then-and-now";
import { TON_UP_RUNTIME } from "@/lib/games/ton-up";
import { UPDRAFT_RUNTIME } from "@/lib/games/updraft";
import { WHITTLE_RUNTIME } from "@/lib/games/whittle";
import { ZIP_RUNTIME } from "@/lib/games/zip";

// The lazy runtime map is keyed by plain strings so it imports no game code;
// this keeps those strings equal to each game's own `*_RUNTIME` constant.
const CONSTANTS = [
  BALLPARK_RUNTIME,
  BOLTED_RUNTIME,
  CASCADE_RUNTIME,
  CHAIN_RUNTIME,
  CHECKMATE_RUNTIME,
  COLOR_MERGE_RUNTIME,
  CROSSWORD_RUNTIME,
  DECANT_RUNTIME,
  DEEP_CUT_RUNTIME,
  DONT_TOUCH_RUNTIME,
  EIGHT_PUZZLE_RUNTIME,
  FLIPSIDE_RUNTIME,
  FOURSORT_RUNTIME,
  FUSEBOX_RUNTIME,
  GRIDBURST_RUNTIME,
  GUESSWORK_RUNTIME,
  HONEYCOMB_RUNTIME,
  MEANDER_RUNTIME,
  HUEDINI_RUNTIME,
  MEMORY_FLASH_RUNTIME,
  MINEFIELD_RUNTIME,
  MINI_SUDOKU_RUNTIME,
  ONE_MOVE_RUNTIME,
  ONLY_ONCE_RUNTIME,
  PIXELOCK_RUNTIME,
  QUEENS_RUNTIME,
  SCATTER_RUNTIME,
  SEVEN_SECOND_RUNTIME,
  STACK10_RUNTIME,
  SUDOKU_RUNTIME,
  SUMDOKU_RUNTIME,
  TANGO_RUNTIME,
  TEE_TIME_RUNTIME,
  THEN_AND_NOW_RUNTIME,
  TON_UP_RUNTIME,
  UPDRAFT_RUNTIME,
  WHITTLE_RUNTIME,
  ZIP_RUNTIME,
];

describe("game runtimes", () => {
  it("ships exactly one lazy runtime per game runtime id", () => {
    expect([...RUNTIME_IDS].sort()).toEqual([...CONSTANTS].sort());
  });
});
