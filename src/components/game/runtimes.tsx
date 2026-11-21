import { lazy, type ComponentType } from "react";

import { t } from "@/lib/settings/language";

/** What the play screen hands every runtime. */
export type RuntimeProps = {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart: boolean;
};

type Loader = () => Promise<{ default: ComponentType<RuntimeProps> }>;

/**
 * How to load each runtime, by the catalogue's `games.runtime` value.
 *
 * Every game is its own chunk: opening one downloads that game, not all of
 * them. The keys are plain strings (each game's `*_RUNTIME` constant, checked
 * by `runtimes.test.ts`) so that importing this map pulls in no game's code.
 * Stack 10, Chain, Memory Flash and Deep Cut predate Tap to play's skip of the
 * rules, so they take no `autoStart`.
 */
const LOADERS: Readonly<Record<string, Loader>> = {
  "stack-10": () =>
    import("./Stack10Runtime").then(({ Stack10Runtime }) => ({
      default: ({ slug, title }: RuntimeProps) => <Stack10Runtime slug={slug} title={title} />,
    })),
  chain: () =>
    import("./ChainRuntime").then(({ ChainRuntime }) => ({
      default: ({ slug, title }: RuntimeProps) => <ChainRuntime slug={slug} title={title} />,
    })),
  "memory-flash": () =>
    import("./MemoryFlashRuntime").then(({ MemoryFlashRuntime }) => ({
      default: ({ slug, title }: RuntimeProps) => <MemoryFlashRuntime slug={slug} title={title} />,
    })),
  "deep-cut": () =>
    import("./DeepCutRuntime").then(({ DeepCutRuntime }) => ({
      default: ({ slug, title }: RuntimeProps) => <DeepCutRuntime slug={slug} title={title} />,
    })),
  "one-move": () => import("./OneMoveRuntime").then((m) => ({ default: m.OneMoveRuntime })),
  "color-merge": () =>
    import("./ColorMergeRuntime").then((m) => ({ default: m.ColorMergeRuntime })),
  "dont-touch": () => import("./DontTouchRuntime").then((m) => ({ default: m.DontTouchRuntime })),
  "seven-second": () =>
    import("./SevenSecondRuntime").then((m) => ({ default: m.SevenSecondRuntime })),
  queens: () => import("./QueensRuntime").then((m) => ({ default: m.QueensRuntime })),
  zip: () => import("./ZipRuntime").then((m) => ({ default: m.ZipRuntime })),
  "eight-puzzle": () =>
    import("./EightPuzzleRuntime").then((m) => ({ default: m.EightPuzzleRuntime })),
  tango: () => import("./TangoRuntime").then((m) => ({ default: m.TangoRuntime })),
  sudoku: () => import("./SudokuRuntime").then((m) => ({ default: m.SudokuRuntime })),
  crossword: () => import("./CrosswordRuntime").then((m) => ({ default: m.CrosswordRuntime })),
  gridburst: () => import("./GridburstRuntime").then((m) => ({ default: m.GridburstRuntime })),
  updraft: () => import("./UpdraftRuntime").then((m) => ({ default: m.UpdraftRuntime })),
  flipside: () => import("./FlipsideRuntime").then((m) => ({ default: m.FlipsideRuntime })),
  decant: () => import("./DecantRuntime").then((m) => ({ default: m.DecantRuntime })),
  "mini-sudoku": () =>
    import("./MiniSudokuRuntime").then((m) => ({ default: m.MiniSudokuRuntime })),
  scatter: () => import("./ScatterRuntime").then((m) => ({ default: m.ScatterRuntime })),
  huedini: () => import("./HuediniRuntime").then((m) => ({ default: m.HuediniRuntime })),
  cascade: () => import("./CascadeRuntime").then((m) => ({ default: m.CascadeRuntime })),
  checkmate: () => import("./CheckmateRuntime").then((m) => ({ default: m.CheckmateRuntime })),
  bolted: () => import("./BoltedRuntime").then((m) => ({ default: m.BoltedRuntime })),
  fusebox: () => import("./FuseboxRuntime").then((m) => ({ default: m.FuseboxRuntime })),
  minefield: () => import("./MinefieldRuntime").then((m) => ({ default: m.MinefieldRuntime })),
  sumdoku: () => import("./SumdokuRuntime").then((m) => ({ default: m.SumdokuRuntime })),
  whittle: () => import("./WhittleRuntime").then((m) => ({ default: m.WhittleRuntime })),
  guesswork: () => import("./GuessworkRuntime").then((m) => ({ default: m.GuessworkRuntime })),
  "ton-up": () => import("./TonUpRuntime").then((m) => ({ default: m.TonUpRuntime })),
  ballpark: () => import("./BallparkRuntime").then((m) => ({ default: m.BallparkRuntime })),
  "only-once": () => import("./OnlyOnceRuntime").then((m) => ({ default: m.OnlyOnceRuntime })),
  "tee-time": () => import("./TeeTimeRuntime").then((m) => ({ default: m.TeeTimeRuntime })),
  foursort: () => import("./FoursortRuntime").then((m) => ({ default: m.FoursortRuntime })),
  pixelock: () => import("./PixelockRuntime").then((m) => ({ default: m.PixelockRuntime })),
  "then-and-now": () =>
    import("./ThenAndNowRuntime").then((m) => ({ default: m.ThenAndNowRuntime })),
  honeycomb: () => import("./HoneycombRuntime").then((m) => ({ default: m.HoneycombRuntime })),
  meander: () => import("./MeanderRuntime").then((m) => ({ default: m.MeanderRuntime })),
  "dead-reckoning": () =>
    import("./DeadReckoningRuntime").then((m) => ({ default: m.DeadReckoningRuntime })),
  alibi: () => import("./AlibiRuntime").then((m) => ({ default: m.AlibiRuntime })),
};

/** Shown when a game's code could not be downloaded (offline, or a stale deploy). */
function LoadFailed() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="text-xl font-semibold">{t("Couldn't load this game")}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {t("Check your connection and try again.")}
      </p>
    </div>
  );
}

/** The runtime ids this bundle ships. */
export const RUNTIME_IDS: readonly string[] = Object.keys(LOADERS);

/**
 * Every runtime this bundle ships, as lazy components made once, by the
 * catalogue's `games.runtime` value. The play screen renders one inside
 * `Suspense`; a runtime that is missing gets the honest "no runtime yet" screen
 * rather than a board with another game's rules. Adding a game is one entry.
 */
export const RUNTIMES: Readonly<Record<string, ComponentType<RuntimeProps>>> = Object.fromEntries(
  Object.entries(LOADERS).map(([id, load]) => [
    id,
    lazy(() => load().catch(() => ({ default: LoadFailed }))),
  ]),
);
