import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Clock, X } from "lucide-react";
import { useCallback, useState } from "react";

import { ChainRuntime } from "@/components/game/ChainRuntime";
import { ColorMergeRuntime } from "@/components/game/ColorMergeRuntime";
import { EightPuzzleRuntime } from "@/components/game/EightPuzzleRuntime";
import { DontTouchRuntime } from "@/components/game/DontTouchRuntime";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { MemoryFlashRuntime } from "@/components/game/MemoryFlashRuntime";
import { OneMoveRuntime } from "@/components/game/OneMoveRuntime";
import { QueensRuntime } from "@/components/game/QueensRuntime";
import { ZipRuntime } from "@/components/game/ZipRuntime";
import { SevenSecondRuntime } from "@/components/game/SevenSecondRuntime";
import { Stack10Runtime } from "@/components/game/Stack10Runtime";
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
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/lib/document-title";
import { titleFromSlug, useGame } from "@/lib/games/catalog";
import { CHAIN_RUNTIME } from "@/lib/games/chain";
import { COLOR_MERGE_RUNTIME } from "@/lib/games/color-merge";
import { DONT_TOUCH_RUNTIME } from "@/lib/games/dont-touch";
import { MEMORY_FLASH_RUNTIME } from "@/lib/games/memory-flash";
import { ONE_MOVE_RUNTIME } from "@/lib/games/one-move";
import { RunProgressContext } from "@/lib/games/run-progress";
import { prefetchPlay } from "@/lib/prefetch";
import { QUEENS_RUNTIME } from "@/lib/games/queens";
import { ZIP_RUNTIME } from "@/lib/games/zip";
import { EIGHT_PUZZLE_RUNTIME } from "@/lib/games/eight-puzzle";
import { SEVEN_SECOND_RUNTIME } from "@/lib/games/seven-second";
import { STACK10_RUNTIME } from "@/lib/games/stack10";

export const Route = createFileRoute("/play/$id")({
  loader: ({ context, params }) => prefetchPlay(context.queryClient, params.id),
  head: ({ params }) => {
    const title = titleFromSlug(params.id);
    return {
      meta: [
        { title: `${title} — Unbored` },
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
 * `seven-second` plays 7 Second, `queens` plays Queens, `zip` plays Zip,
 * `eight-puzzle` plays 8 Puzzle, and anything else gets the honest "no runtime
 * yet" screen rather than a board that does not follow that game's rules. Every
 * catalogue game now has a runtime, but the branch stays a feature rather than a
 * leftover: it is what stops a future catalogue entry from silently pretending.
 */
function PlayScreen() {
  const { id } = Route.useParams();
  return <Play id={id} />;
}

/**
 * The play screen for a slug, with the reporter that tells its quit control
 * whether leaving would cost the player a run. Exported so the navigation tests
 * can mount the real composition without the generated route tree.
 */
export function Play({ id }: { id: string }) {
  // Whether a run is live, and how to end it, reported by the runtime below.
  const [progress, setProgress] = useState<{ active: boolean; endRun?: () => void }>({
    active: false,
  });
  const report = useCallback(
    (active: boolean, endRun?: () => void) => setProgress({ active, endRun }),
    [],
  );

  return (
    <RunProgressContext.Provider value={report}>
      <PlaySurface id={id} progress={progress.active} endRun={progress.endRun} />
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
 * way to end its run keeps the old choice, to leave without a score.
 */
export function PlaySurface({
  id,
  progress,
  endRun,
}: {
  id: string;
  progress: boolean;
  endRun?: () => void;
}) {
  const state = useGame(id);
  const title = state.status === "ready" ? state.game.title : titleFromSlug(id);
  useDocumentTitle(
    state.status === "ready"
      ? state.game.title
      : state.status === "missing"
        ? "Game not found"
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
      state.game.runtime === EIGHT_PUZZLE_RUNTIME);

  const nav = useNavigate();
  const [confirming, setConfirming] = useState(false);

  // Leaving replaces this screen instead of stacking on top of it: the feed is
  // where the player asked to be, and Back from it must not land back in the
  // game they just quit.
  function quit() {
    void nav({ to: "/", replace: true });
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <header className="flex items-center gap-3 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3">
        <Button
          variant="glass"
          size="icon"
          aria-label="Quit game"
          onClick={() => (progress ? setConfirming(true) : quit())}
        >
          <X />
        </Button>
        <div className="flex-1 text-center">
          <p className="text-xs text-muted-foreground">{title}</p>
        </div>
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
        <MemoryFlashRuntime key={state.game.slug} slug={state.game.slug} title={state.game.title} />
      )}

      {state.status === "ready" && state.game.runtime === ONE_MOVE_RUNTIME && playable && (
        <OneMoveRuntime key={state.game.slug} slug={state.game.slug} title={state.game.title} />
      )}

      {state.status === "ready" && state.game.runtime === COLOR_MERGE_RUNTIME && playable && (
        <ColorMergeRuntime key={state.game.slug} slug={state.game.slug} title={state.game.title} />
      )}

      {state.status === "ready" && state.game.runtime === DONT_TOUCH_RUNTIME && playable && (
        <DontTouchRuntime key={state.game.slug} slug={state.game.slug} title={state.game.title} />
      )}

      {state.status === "ready" && state.game.runtime === SEVEN_SECOND_RUNTIME && playable && (
        <SevenSecondRuntime key={state.game.slug} slug={state.game.slug} title={state.game.title} />
      )}

      {state.status === "ready" && state.game.runtime === QUEENS_RUNTIME && playable && (
        <QueensRuntime key={state.game.slug} slug={state.game.slug} title={state.game.title} />
      )}

      {state.status === "ready" && state.game.runtime === ZIP_RUNTIME && playable && (
        <ZipRuntime key={state.game.slug} slug={state.game.slug} title={state.game.title} />
      )}

      {state.status === "ready" && state.game.runtime === EIGHT_PUZZLE_RUNTIME && playable && (
        <EightPuzzleRuntime key={state.game.slug} slug={state.game.slug} title={state.game.title} />
      )}

      {state.status === "ready" && !(hasShippedRuntime && playable) && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
            <Clock className="size-5 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-semibold">Not playable yet</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            {title} has no runtime yet, so there is nothing to start. It is listed because it is
            part of the catalogue.
          </p>
          <Button asChild variant="play" size="lg" className="mt-2">
            <ExitGameLink slug={id}>Back to the game</ExitGameLink>
          </Button>
        </div>
      )}

      {state.status === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-xl font-semibold">Couldn't load this game</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            The catalogue is unavailable, so there is nothing to start.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={state.retry}>
              Try again
            </Button>
            <Button asChild variant="ghost">
              <Link to="/explore">Browse games</Link>
            </Button>
          </div>
        </div>
      )}

      {state.status === "missing" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-xl font-semibold">No such game</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            That game is not in the catalogue.
          </p>
          <Button asChild variant="play" size="lg" className="mt-2">
            <Link to="/explore">Browse games</Link>
          </Button>
        </div>
      )}

      {/* A started run is real progress, so ending it is a decision the player
          makes deliberately rather than by a mis-tap on the way out. Ending it
          saves it: the score so far is submitted and verified. */}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{endRun ? "End this run?" : "Leave this run?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {endRun
                ? "Your run is still going. Ending it now saves your score so far: it is sent for verification, and the board you are on is not scored."
                : "Your run is still going. Leaving now discards it, and it will not be scored."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep playing</AlertDialogCancel>
            {endRun ? (
              <AlertDialogAction onClick={endRun}>End run and save</AlertDialogAction>
            ) : (
              <AlertDialogAction onClick={quit}>Leave run</AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
