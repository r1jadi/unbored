import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Clock, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { ChainRuntime } from "@/components/game/ChainRuntime";
import { ColorMergeRuntime } from "@/components/game/ColorMergeRuntime";
import { GridburstRuntime } from "@/components/game/GridburstRuntime";
import { EightPuzzleRuntime } from "@/components/game/EightPuzzleRuntime";
import { TangoRuntime } from "@/components/game/TangoRuntime";
import { SudokuRuntime } from "@/components/game/SudokuRuntime";
import { CrosswordRuntime } from "@/components/game/CrosswordRuntime";
import { DecantRuntime } from "@/components/game/DecantRuntime";
import { MiniSudokuRuntime } from "@/components/game/MiniSudokuRuntime";
import { ScatterRuntime } from "@/components/game/ScatterRuntime";
import { HuediniRuntime } from "@/components/game/HuediniRuntime";
import { CascadeRuntime } from "@/components/game/CascadeRuntime";
import { DontTouchRuntime } from "@/components/game/DontTouchRuntime";
import { GameExits } from "@/components/game/GameExits";
import { MemoryFlashRuntime } from "@/components/game/MemoryFlashRuntime";
import { OneMoveRuntime } from "@/components/game/OneMoveRuntime";
import { QueensRuntime } from "@/components/game/QueensRuntime";
import { ZipRuntime } from "@/components/game/ZipRuntime";
import { SevenSecondRuntime } from "@/components/game/SevenSecondRuntime";
import { Stack10Runtime } from "@/components/game/Stack10Runtime";
import { UpdraftRuntime } from "@/components/game/UpdraftRuntime";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { useDocumentTitle } from "@/lib/document-title";
import { useSoundEnabled } from "@/lib/sound";
import { titleFromSlug, useGame } from "@/lib/games/catalog";
import { CHAIN_RUNTIME } from "@/lib/games/chain";
import { COLOR_MERGE_RUNTIME } from "@/lib/games/color-merge";
import { DECANT_RUNTIME } from "@/lib/games/decant";
import { MINI_SUDOKU_RUNTIME } from "@/lib/games/mini-sudoku";
import { SCATTER_RUNTIME } from "@/lib/games/scatter";
import { HUEDINI_RUNTIME } from "@/lib/games/huedini";
import { CASCADE_RUNTIME } from "@/lib/games/cascade";
import { DONT_TOUCH_RUNTIME } from "@/lib/games/dont-touch";
import { MEMORY_FLASH_RUNTIME } from "@/lib/games/memory-flash";
import { ONE_MOVE_RUNTIME } from "@/lib/games/one-move";
import { RunLeaveContext, RunProgressContext } from "@/lib/games/run-progress";
import { prefetchPlay } from "@/lib/prefetch";
import { useOnline } from "@/lib/service-worker";
import { QUEENS_RUNTIME } from "@/lib/games/queens";
import { ZIP_RUNTIME } from "@/lib/games/zip";
import { EIGHT_PUZZLE_RUNTIME } from "@/lib/games/eight-puzzle";
import { TANGO_RUNTIME } from "@/lib/games/tango";
import { SUDOKU_RUNTIME } from "@/lib/games/sudoku";
import { CROSSWORD_RUNTIME } from "@/lib/games/crossword";
import { GRIDBURST_RUNTIME } from "@/lib/games/gridburst";
import { SEVEN_SECOND_RUNTIME } from "@/lib/games/seven-second";
import { STACK10_RUNTIME } from "@/lib/games/stack10";
import { UPDRAFT_RUNTIME } from "@/lib/games/updraft";

import { t } from "@/lib/settings/language";
/**
 * `?start=1` starts the run straight away instead of showing the game's rules
 * first: the feed's Tap to play sends it, because a player who tapped Play has
 * already chosen to play. A link without it shows the rules, as before.
 */
type PlaySearch = { start?: boolean };

export const Route = createFileRoute("/play/$id")({
  validateSearch: (search: Record<string, unknown>): PlaySearch =>
    search["start"] === 1 || search["start"] === "1" || search["start"] === true
      ? { start: true }
      : {},
  loader: ({ context, params }) => prefetchPlay(context.queryClient, params.id),
  head: ({ params }) => {
    const title = titleFromSlug(params.id);
    return {
      meta: [
        { title: t("{title} — Unbored", { title }) },
        { name: "description", content: `${title} on Unbored.` },
        { property: "og:title", content: `${title} — Unbored` },
      ],
    };
  },
  component: PlayScreen,
});

/**
 * The play screen.
 *
 * It used to be a working prototype that scored `10 + random(15)` points on every
 * tap and then reported a global rank and a personal best. None of that was real:
 * there was no game, and no score was ever stored. Presenting it as playable was the
 * most misleading thing in the app, so it now mounts a runtime only when the
 * catalogue says the game has one.
 *
 * The runtime is chosen by the game's `runtime` identifier — `stack-10` plays Stack
 * 10, `chain` plays Chain, `memory-flash` plays Memory Flash, `one-move` plays One
 * Move, `color-merge` plays Color Merge, `dont-touch` plays Don't Touch the Black,
 * `seven-second` plays 7 Second, `queens` plays Crowns, `zip` plays Trail,
 * `eight-puzzle` plays 8 Puzzle, `tango` plays Sun & Moon, `sudoku` plays Sudoku,
 * `crossword` plays the daily crossword, `gridburst` plays Gridburst,
 * `updraft` plays Flutter, `decant` plays Decant, `mini-sudoku` plays Mini Sudoku, `scatter` plays Scatter, `huedini` plays Huedini,
 * `cascade` plays Cascade,
 * and anything else gets the honest "no runtime
 * yet" screen rather than a board that does not follow that game's rules. Every
 * catalogue game now has a runtime, but the branch stays a feature rather than a
 * leftover: it is what stops a future catalogue entry from silently pretending.
 */
function PlayScreen() {
  const { id } = Route.useParams();
  const { start } = Route.useSearch();
  return <Play id={id} autoStart={start === true} />;
}

/**
 * The play screen for a slug, with the reporter that tells its quit control
 * whether leaving would cost the player a run. Exported so the navigation tests
 * can mount the real composition without the generated route tree.
 */
export function Play({ id, autoStart = false }: { id: string; autoStart?: boolean }) {
  // Whether a run is live, and how to end it, reported by the runtime below.
  const [progress, setProgress] = useState<{
    active: boolean;
    endRun?: () => void;
    resumable?: boolean;
  }>({
    active: false,
  });
  const report = useCallback(
    (active: boolean, endRun?: () => void, resumable?: boolean) =>
      setProgress({ active, endRun, resumable }),
    [],
  );

  return (
    <RunProgressContext.Provider value={report}>
      <PlaySurface
        id={id}
        progress={progress.active}
        endRun={progress.endRun}
        resumable={progress.resumable === true}
        autoStart={autoStart}
      />
    </RunProgressContext.Provider>
  );
}

/**
 * The screen itself, given the slug and whether a run is live. The quit control
 * and every exit from here are the navigation contract this file owns.
 *
 * Quitting a live run ends it rather than discarding it: when the runtime has
 * handed over `endRun`, confirming submits the run and the runtime shows its
 * verified score, from where leaving is a single tap. A runtime that offers no
 * way to end its run keeps the old choice, to leave without a score. A run that
 * is saved as it is played (`resumable`) can also be left as it is, to finish
 * later: opening the game again offers Continue run or New run.
 */
export function PlaySurface({
  id,
  progress,
  endRun,
  resumable = false,
  autoStart = false,
}: {
  id: string;
  progress: boolean;
  endRun?: () => void;
  /** The live run is saved to the player's account and can be continued later. */
  resumable?: boolean;
  /** Start the run without the rules screen (`?start=1`). */
  autoStart?: boolean;
}) {
  const state = useGame(id);
  const title = state.status === "ready" ? state.game.title : titleFromSlug(id);
  useDocumentTitle(
    state.status === "ready"
      ? state.game.title
      : state.status === "missing"
        ? t("Game not found")
        : undefined,
  );
  const playable = state.status === "ready" && state.game.playable && !!state.game.runtime;
  // A runtime this bundle ships: anything else renders the honest
  // "no runtime yet" screen below rather than a board with foreign rules.
  const hasShippedRuntime =
    state.status === "ready" &&
    (state.game.runtime === STACK10_RUNTIME ||
      state.game.runtime === CHAIN_RUNTIME ||
      state.game.runtime === MEMORY_FLASH_RUNTIME ||
      state.game.runtime === ONE_MOVE_RUNTIME ||
      state.game.runtime === COLOR_MERGE_RUNTIME ||
      state.game.runtime === DONT_TOUCH_RUNTIME ||
      state.game.runtime === SEVEN_SECOND_RUNTIME ||
      state.game.runtime === QUEENS_RUNTIME ||
      state.game.runtime === ZIP_RUNTIME ||
      state.game.runtime === EIGHT_PUZZLE_RUNTIME ||
      state.game.runtime === TANGO_RUNTIME ||
      state.game.runtime === SUDOKU_RUNTIME ||
      state.game.runtime === CROSSWORD_RUNTIME ||
      state.game.runtime === GRIDBURST_RUNTIME ||
      state.game.runtime === UPDRAFT_RUNTIME ||
      state.game.runtime === DECANT_RUNTIME ||
      state.game.runtime === MINI_SUDOKU_RUNTIME ||
      state.game.runtime === SCATTER_RUNTIME ||
      state.game.runtime === HUEDINI_RUNTIME ||
      state.game.runtime === CASCADE_RUNTIME);

  const nav = useNavigate();
  const online = useOnline();
  const [confirming, setConfirming] = useState(false);

  // Leaving replaces this screen instead of stacking on top of it: the feed is
  // where the player asked to be, and Back from it must not land back in the
  // game they just quit.
  function quit() {
    void nav({ to: "/", replace: true });
  }

  const leave = useMemo(() => ({ resumable, leave: quit }), [resumable]);

  return (
    <RunLeaveContext.Provider value={leave}>
      <div className="fixed inset-0 flex flex-col bg-background">
        <header className="flex items-center gap-3 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3">
          <Button
            variant="glass"
            size="icon"
            aria-label={t("Quit game")}
            onClick={() => (progress ? setConfirming(true) : quit())}
          >
            <X />
          </Button>
          <div className="flex-1 text-center">
            <p className="text-xs text-muted-foreground">{title}</p>
            {!online && (
              <p className="text-[11px] text-muted-foreground/80">{t("Offline · practice only")}</p>
            )}
          </div>
          <SoundToggle />
        </header>

        {state.status === "loading" && (
          <div className="flex flex-1 items-center justify-center">
            <Clock className="size-5 animate-pulse text-muted-foreground" />
          </div>
        )}

        {state.status === "ready" && state.game.runtime === STACK10_RUNTIME && playable && (
          <Stack10Runtime key={state.game.slug} slug={state.game.slug} title={state.game.title} />
        )}

        {state.status === "ready" && state.game.runtime === CHAIN_RUNTIME && playable && (
          <ChainRuntime key={state.game.slug} slug={state.game.slug} title={state.game.title} />
        )}

        {state.status === "ready" && state.game.runtime === MEMORY_FLASH_RUNTIME && playable && (
          <MemoryFlashRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
          />
        )}

        {state.status === "ready" && state.game.runtime === ONE_MOVE_RUNTIME && playable && (
          <OneMoveRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && state.game.runtime === COLOR_MERGE_RUNTIME && playable && (
          <ColorMergeRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && state.game.runtime === DONT_TOUCH_RUNTIME && playable && (
          <DontTouchRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && state.game.runtime === SEVEN_SECOND_RUNTIME && playable && (
          <SevenSecondRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && state.game.runtime === QUEENS_RUNTIME && playable && (
          <QueensRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && state.game.runtime === ZIP_RUNTIME && playable && (
          <ZipRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && state.game.runtime === EIGHT_PUZZLE_RUNTIME && playable && (
          <EightPuzzleRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && state.game.runtime === TANGO_RUNTIME && playable && (
          <TangoRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && state.game.runtime === SUDOKU_RUNTIME && playable && (
          <SudokuRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && state.game.runtime === CROSSWORD_RUNTIME && playable && (
          <CrosswordRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && state.game.runtime === GRIDBURST_RUNTIME && playable && (
          <GridburstRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && state.game.runtime === UPDRAFT_RUNTIME && playable && (
          <UpdraftRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && state.game.runtime === DECANT_RUNTIME && playable && (
          <DecantRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && state.game.runtime === MINI_SUDOKU_RUNTIME && playable && (
          <MiniSudokuRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && state.game.runtime === SCATTER_RUNTIME && playable && (
          <ScatterRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && state.game.runtime === HUEDINI_RUNTIME && playable && (
          <HuediniRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && state.game.runtime === CASCADE_RUNTIME && playable && (
          <CascadeRuntime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && !(hasShippedRuntime && playable) && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
              <Clock className="size-5 text-muted-foreground" />
            </div>
            <h1 className="text-xl font-semibold">{t("Not playable yet")}</h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              {t(
                "{title} has no runtime yet, so there is nothing to start. It is listed because it is part of the catalogue.",
                { title },
              )}
            </p>
            <div className="mt-2 w-full">
              <GameExits slug={id} title={title} />
            </div>
          </div>
        )}

        {state.status === "error" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <h1 className="text-xl font-semibold">{t("Couldn't load this game")}</h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              {online
                ? t("The catalogue is unavailable, so there is nothing to start.")
                : t(
                    "You're offline and this game isn't saved on this device yet. Open it once while online to play it offline.",
                  )}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={state.retry}>
                {t("Try again")}
              </Button>
              <Button asChild variant="ghost">
                <Link to="/explore">{t("Browse games")}</Link>
              </Button>
            </div>
            <div className="w-full">
              <GameExits />
            </div>
          </div>
        )}

        {state.status === "missing" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <h1 className="text-xl font-semibold">{t("No such game")}</h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              {t("That game is not in the catalogue.")}
            </p>
            <Button asChild variant="play" size="lg" className="mt-2">
              <Link to="/explore">{t("Browse games")}</Link>
            </Button>
            <div className="w-full">
              <GameExits />
            </div>
          </div>
        )}

        {/* A started run is real progress, so ending it is a decision the player
          makes deliberately rather than by a mis-tap on the way out. Ending it
          saves it: the score so far is submitted and verified. */}
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {endRun ? t("End this run?") : t("Leave this run?")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {endRun && resumable
                  ? t(
                      "Your run is still going. Finish it later and it is waiting for you next time you open this game — or end it now to save your score so far.",
                    )
                  : endRun && !online
                    ? t(
                        "Your run is still going. You're offline, so it is a practice run: ending it shows your score, but it is not verified or saved.",
                      )
                    : endRun
                      ? t(
                          "Your run is still going. Ending it now saves your score so far: it is sent for verification, and the board you are on is not scored.",
                        )
                      : t(
                          "Your run is still going. Leaving now discards it, and it will not be scored.",
                        )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Keep playing")}</AlertDialogCancel>
              {endRun && resumable && (
                <AlertDialogAction
                  className={buttonVariants({ variant: "secondary" })}
                  onClick={quit}
                >
                  {t("Finish later")}
                </AlertDialogAction>
              )}
              {endRun ? (
                <AlertDialogAction onClick={endRun}>{t("End run and save")}</AlertDialogAction>
              ) : (
                <AlertDialogAction onClick={quit}>{t("Leave run")}</AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </RunLeaveContext.Provider>
  );
}

/** Turns game sound effects on or off; the choice is remembered on this device. */
function SoundToggle() {
  const [on, setOn] = useSoundEnabled();
  return (
    <Button
      variant="glass"
      size="icon"
      aria-label={on ? t("Mute sound effects") : t("Unmute sound effects")}
      aria-pressed={!on}
      onClick={() => setOn(!on)}
    >
      {on ? <Volume2 /> : <VolumeX />}
    </Button>
  );
}
