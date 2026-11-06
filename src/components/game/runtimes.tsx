import type { ComponentType } from "react";

import { BoltedRuntime } from "@/components/game/BoltedRuntime";
import { CascadeRuntime } from "@/components/game/CascadeRuntime";
import { ChainRuntime } from "@/components/game/ChainRuntime";
import { CheckmateRuntime } from "@/components/game/CheckmateRuntime";
import { ColorMergeRuntime } from "@/components/game/ColorMergeRuntime";
import { CrosswordRuntime } from "@/components/game/CrosswordRuntime";
import { DecantRuntime } from "@/components/game/DecantRuntime";
import { DontTouchRuntime } from "@/components/game/DontTouchRuntime";
import { EightPuzzleRuntime } from "@/components/game/EightPuzzleRuntime";
import { FuseboxRuntime } from "@/components/game/FuseboxRuntime";
import { GridburstRuntime } from "@/components/game/GridburstRuntime";
import { HuediniRuntime } from "@/components/game/HuediniRuntime";
import { MemoryFlashRuntime } from "@/components/game/MemoryFlashRuntime";
import { MiniSudokuRuntime } from "@/components/game/MiniSudokuRuntime";
import { OneMoveRuntime } from "@/components/game/OneMoveRuntime";
import { QueensRuntime } from "@/components/game/QueensRuntime";
import { ScatterRuntime } from "@/components/game/ScatterRuntime";
import { SevenSecondRuntime } from "@/components/game/SevenSecondRuntime";
import { Stack10Runtime } from "@/components/game/Stack10Runtime";
import { SudokuRuntime } from "@/components/game/SudokuRuntime";
import { TangoRuntime } from "@/components/game/TangoRuntime";
import { UpdraftRuntime } from "@/components/game/UpdraftRuntime";
import { ZipRuntime } from "@/components/game/ZipRuntime";
import { BOLTED_RUNTIME } from "@/lib/games/bolted";
import { CASCADE_RUNTIME } from "@/lib/games/cascade";
import { CHAIN_RUNTIME } from "@/lib/games/chain";
import { CHECKMATE_RUNTIME } from "@/lib/games/checkmate";
import { COLOR_MERGE_RUNTIME } from "@/lib/games/color-merge";
import { CROSSWORD_RUNTIME } from "@/lib/games/crossword";
import { DECANT_RUNTIME } from "@/lib/games/decant";
import { DONT_TOUCH_RUNTIME } from "@/lib/games/dont-touch";
import { EIGHT_PUZZLE_RUNTIME } from "@/lib/games/eight-puzzle";
import { FUSEBOX_RUNTIME } from "@/lib/games/fusebox";
import { GRIDBURST_RUNTIME } from "@/lib/games/gridburst";
import { HUEDINI_RUNTIME } from "@/lib/games/huedini";
import { MEMORY_FLASH_RUNTIME } from "@/lib/games/memory-flash";
import { MINI_SUDOKU_RUNTIME } from "@/lib/games/mini-sudoku";
import { ONE_MOVE_RUNTIME } from "@/lib/games/one-move";
import { QUEENS_RUNTIME } from "@/lib/games/queens";
import { SCATTER_RUNTIME } from "@/lib/games/scatter";
import { SEVEN_SECOND_RUNTIME } from "@/lib/games/seven-second";
import { STACK10_RUNTIME } from "@/lib/games/stack10";
import { SUDOKU_RUNTIME } from "@/lib/games/sudoku";
import { TANGO_RUNTIME } from "@/lib/games/tango";
import { UPDRAFT_RUNTIME } from "@/lib/games/updraft";
import { ZIP_RUNTIME } from "@/lib/games/zip";

/** What the play screen hands every runtime. */
export type RuntimeProps = {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart: boolean;
};

/**
 * Every runtime this bundle ships, by the catalogue's `games.runtime` value.
 *
 * The play screen looks a game's runtime up here; one that is missing gets the
 * honest "no runtime yet" screen rather than a board with another game's rules.
 * Adding a game is one entry. Stack 10, Chain and Memory Flash predate Tap to
 * play's skip of the rules, so they take no `autoStart`.
 */
export const RUNTIMES: Readonly<Record<string, ComponentType<RuntimeProps>>> = {
  [STACK10_RUNTIME]: ({ slug, title }) => <Stack10Runtime slug={slug} title={title} />,
  [CHAIN_RUNTIME]: ({ slug, title }) => <ChainRuntime slug={slug} title={title} />,
  [MEMORY_FLASH_RUNTIME]: ({ slug, title }) => <MemoryFlashRuntime slug={slug} title={title} />,
  [ONE_MOVE_RUNTIME]: OneMoveRuntime,
  [COLOR_MERGE_RUNTIME]: ColorMergeRuntime,
  [DONT_TOUCH_RUNTIME]: DontTouchRuntime,
  [SEVEN_SECOND_RUNTIME]: SevenSecondRuntime,
  [QUEENS_RUNTIME]: QueensRuntime,
  [ZIP_RUNTIME]: ZipRuntime,
  [EIGHT_PUZZLE_RUNTIME]: EightPuzzleRuntime,
  [TANGO_RUNTIME]: TangoRuntime,
  [SUDOKU_RUNTIME]: SudokuRuntime,
  [CROSSWORD_RUNTIME]: CrosswordRuntime,
  [GRIDBURST_RUNTIME]: GridburstRuntime,
  [UPDRAFT_RUNTIME]: UpdraftRuntime,
  [DECANT_RUNTIME]: DecantRuntime,
  [MINI_SUDOKU_RUNTIME]: MiniSudokuRuntime,
  [SCATTER_RUNTIME]: ScatterRuntime,
  [HUEDINI_RUNTIME]: HuediniRuntime,
  [CASCADE_RUNTIME]: CascadeRuntime,
  [CHECKMATE_RUNTIME]: CheckmateRuntime,
  [BOLTED_RUNTIME]: BoltedRuntime,
  [FUSEBOX_RUNTIME]: FuseboxRuntime,
};
