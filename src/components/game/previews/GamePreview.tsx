import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from "react";

import { GameArt, GameStage } from "@/components/game/GameArt";
import { motionIsReduced } from "@/lib/settings/accessibility";

type PreviewProps = { playing: boolean };
type Loader = () => Promise<{ default: ComponentType<PreviewProps> }>;

/**
 * Each game's preview, loaded when its card comes near. A preview plays through
 * its game's real rules, so loading them all up front would put every game's
 * rules and puzzle banks in the feed's first download.
 */
const LOADERS: Record<string, Loader> = {
  "7-second": () => import("./SevenSecondPreview").then((m) => ({ default: m.SevenSecondPreview })),
  "8-puzzle": () => import("./EightPuzzlePreview").then((m) => ({ default: m.EightPuzzlePreview })),
  bolted: () => import("./BoltedPreview").then((m) => ({ default: m.BoltedPreview })),
  cascade: () => import("./CascadePreview").then((m) => ({ default: m.CascadePreview })),
  checkmate: () => import("./CheckmatePreview").then((m) => ({ default: m.CheckmatePreview })),
  "color-merge": () =>
    import("./ColorMergePreview").then((m) => ({ default: m.ColorMergePreview })),
  crossword: () => import("./CrosswordPreview").then((m) => ({ default: m.CrosswordPreview })),
  crowns: () => import("./QueensPreview").then((m) => ({ default: m.QueensPreview })),
  decant: () => import("./DecantPreview").then((m) => ({ default: m.DecantPreview })),
  "dont-break-the-chain": () => import("./ChainPreview").then((m) => ({ default: m.ChainPreview })),
  "dont-touch-the-black": () =>
    import("./DontTouchPreview").then((m) => ({ default: m.DontTouchPreview })),
  fusebox: () => import("./FuseboxPreview").then((m) => ({ default: m.FuseboxPreview })),
  gridburst: () => import("./GridburstPreview").then((m) => ({ default: m.GridburstPreview })),
  huedini: () => import("./HuediniPreview").then((m) => ({ default: m.HuediniPreview })),
  "memory-flash": () =>
    import("./MemoryFlashPreview").then((m) => ({ default: m.MemoryFlashPreview })),
  minefield: () => import("./MinefieldPreview").then((m) => ({ default: m.MinefieldPreview })),
  "mini-sudoku": () =>
    import("./MiniSudokuPreview").then((m) => ({ default: m.MiniSudokuPreview })),
  "one-move": () => import("./OneMovePreview").then((m) => ({ default: m.OneMovePreview })),
  scatter: () => import("./ScatterPreview").then((m) => ({ default: m.ScatterPreview })),
  "stack-10": () => import("./Stack10Preview").then((m) => ({ default: m.Stack10Preview })),
  sudoku: () => import("./SudokuPreview").then((m) => ({ default: m.SudokuPreview })),
  "sun-and-moon": () => import("./TangoPreview").then((m) => ({ default: m.TangoPreview })),
  trail: () => import("./ZipPreview").then((m) => ({ default: m.ZipPreview })),
  updraft: () => import("./UpdraftPreview").then((m) => ({ default: m.UpdraftPreview })),
};

/** One lazy component per game, made once. A failed download shows the still art. */
const PREVIEWS = Object.fromEntries(
  Object.entries(LOADERS).map(([id, load]) => [
    id,
    lazy(() =>
      load().catch(() => ({
        default: () => <GameArt id={id} className="size-full" />,
      })),
    ),
  ]),
);

/** The share of the stage that must be showing: only the card in view plays. */
const ON_SCREEN_SHARE = 0.6;

/** How far ahead of the screen a preview starts loading: one card's height. */
const LOAD_AHEAD = "100% 0px";

/**
 * A game's picture in the feed: a few seconds of the game on a loop.
 *
 * The feed mounts every card at once, so a preview loads as its card comes near,
 * plays only while it is in view and the page is showing, and waits on its first
 * frame otherwise. Until it has loaded the card shows the still art, and so does
 * the card of a player who has asked for less motion.
 */
export function GamePreview({ id, className }: { id: string; className?: string }) {
  const Preview = Object.hasOwn(PREVIEWS, id) ? PREVIEWS[id] : null;
  const stage = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageShowing, setPageShowing] = useState(true);
  const [reduced, setReduced] = useState(false);

  // Read after mounting, so the server's markup and the first client render agree.
  useEffect(() => {
    setReduced(motionIsReduced());
  }, []);

  const animated = Preview !== null && !reduced;

  useEffect(() => {
    const element = stage.current;
    if (!animated || !element || typeof IntersectionObserver === "undefined") return;
    // Measured against the feed's own scroller, the only place a margin applies.
    const root = element.closest("[data-feed-scroller]");
    const nearby = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setNear(true);
      },
      { root, rootMargin: LOAD_AHEAD },
    );
    const visible = new IntersectionObserver(
      ([entry]) => setInView(entry.intersectionRatio >= ON_SCREEN_SHARE),
      { root, threshold: [ON_SCREEN_SHARE] },
    );
    nearby.observe(element);
    visible.observe(element);
    return () => {
      nearby.disconnect();
      visible.disconnect();
      setInView(false);
    };
  }, [animated]);

  useEffect(() => {
    const update = () => setPageShowing(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  if (!animated) return <GameArt id={id} className={className} />;
  return (
    <GameStage large={near} rootRef={stage} className={className}>
      {near ? (
        <Suspense fallback={<GameArt id={id} className="size-full" />}>
          <Preview playing={inView && pageShowing} />
        </Suspense>
      ) : (
        <GameArt id={id} className="size-full" />
      )}
    </GameStage>
  );
}
