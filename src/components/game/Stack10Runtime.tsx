import { Loader2, RotateCcw, ShieldCheck, Trophy, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { ErrorState } from "@/components/common";
import { GameExits } from "@/components/game/GameExits";
import { EndRunButton } from "@/components/game/EndRunButton";
import { HintButton, HintNote } from "@/components/game/Hint";
import { stack10Hint } from "@/lib/games/hints";
import { useHint } from "@/lib/games/use-hint";
import { RunEndActions } from "@/components/game/RunEndActions";
import { SavedRunCard } from "@/components/game/SavedRunCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useStack10Run,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import {
  canPlace,
  progress,
  STACK10_COLUMNS,
  STACK10_TILES,
  type Stack10Run,
} from "@/lib/games/stack10";

/**
 * Stack 10, playing for real.
 *
 * The board is a view onto `useStack10Run`, which owns the whole lifecycle: a
 * session issued by the server, the run played against its seed, and the score the
 * server derived from the submitted action list. Nothing on this screen decides a
 * number — the score shown at the end is the one that came back from verification,
 * and until it does the screen says the run is being verified rather than showing a
 * provisional total.
 *
 * Two things the component refuses to do, because both would be lies:
 *
 *   - **it never offers an impossible move.** A column that the next tile would
 *     push past ten is disabled and its reason is in the accessible name, so a
 *     run cannot end by mis-tap and the board cannot be walked into a state the
 *     rules cannot produce.
 *   - **it never claims a score was saved.** A failed submission is an error with
 *     the server's own message and a retry that re-sends the identical run, not a
 *     local "saved" that a reload would disprove.
 */
export function Stack10Runtime({ slug, title }: { slug: string; title: string }) {
  const state = useStack10Run(slug);

  // Number keys play a column, which is how the board is usable without a pointer.
  // Only while a run is live: during verification a keypress must do nothing.
  const live = state.status === "playing";

  // A live run is progress the player would lose by leaving.
  useReportRunProgress(live, state.finish, live ? state.session : undefined);
  useEffect(() => {
    if (!live) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const column = Number.parseInt(event.key, 10);
      if (!Number.isInteger(column) || column < 1 || column > STACK10_COLUMNS) return;
      event.preventDefault();
      state.place(column - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, state]);

  // A signed-in player's unfinished run is offered before a new one starts.
  if (state.status === "saved") {
    return (
      <SavedRunCard
        score={state.run.score}
        where={`${state.run.actions.length} ${state.run.actions.length === 1 ? "tile" : "tiles"} placed`}
        onContinue={state.continueRun}
        onNewRun={state.newRun}
        slug={slug}
        title={title}
      />
    );
  }

  if (state.status === "starting") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Starting a run…</p>
      </div>
    );
  }

  if (state.status === "error" && state.stage === "start") {
    return (
      <div className="flex flex-1 flex-col justify-center px-6">
        <ErrorState
          title="Couldn't start a run"
          body={playErrorMessage(state.error)}
          onRetry={state.retry}
        />
        <GameExits slug={slug} title={title} />
      </div>
    );
  }

  // A submission failure keeps the board: the run exists, it is just not verified,
  // and offering to throw it away would be the one thing the player cannot undo.
  if (state.status === "error" && state.stage === "submit" && state.run && state.session) {
    return (
      <div className="flex flex-1 flex-col justify-center gap-4 px-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-2">
          <TriangleAlert className="size-5 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold">Your run was not verified</h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {playErrorMessage(state.error)} Nothing was saved, and nothing needs to be — sending the
          same run again is safe.
        </p>
        <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
          <Button variant="play" size="lg" onClick={state.retry}>
            Try submitting again
          </Button>
          <Button variant="secondary" size="lg" onClick={state.restart}>
            <RotateCcw />
            Start a new run
          </Button>
          <GameExits slug={slug} title={title} />
        </div>
      </div>
    );
  }

  if (state.status === "playing" || state.status === "submitting") {
    return (
      <Board
        run={state.run}
        session={state.session}
        verifying={state.status === "submitting"}
        onPlace={state.place}
        onFinish={state.finish}
      />
    );
  }

  if (state.status === "finished") {
    return (
      <Finished
        slug={slug}
        title={title}
        run={state.run}
        result={state.result}
        onRestart={state.restart}
      />
    );
  }

  // The only remaining shape is an error with no run to show, which the branches
  // above have already handled; a spinner is a truthful fallback rather than a
  // screen that invents a state.
  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/** The live board. */
function Board({
  run,
  session,
  verifying,
  onPlace,
  onFinish,
}: {
  run: Stack10Run;
  session: PlaySession;
  verifying: boolean;
  onPlace: (column: number) => void;
  /** Ends the run where it stands and submits it. */
  onFinish: () => void;
}) {
  const tile = run.nextTile;
  const readout = progress(run);
  const placed = readout.placed;
  // Every tile placed is a move made; the hint is for a player still deciding.
  const hints = useHint({
    progress: run.actions.length,
    active: !verifying && run.outcome === "playing",
    compute: () => stack10Hint(run),
  });

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">Score</dt>
          <dd className="text-2xl font-semibold tabular">{run.score}</dd>
        </dl>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular">Tile {placed + 1}</span>
          {session.ranked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1">
              <ShieldCheck className="size-3.5" />
              Ranked
            </span>
          ) : (
            <span className="rounded-full bg-surface-2 px-2 py-1">Guest run</span>
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 py-3">
        <div className="flex items-center justify-center gap-3">
          <span className="text-xs text-muted-foreground">Next tile</span>
          <span
            aria-live="polite"
            className="flex size-12 items-center justify-center rounded-xl bg-foreground text-xl font-semibold tabular text-background"
          >
            {tile ?? "—"}
          </span>
        </div>
        {hints.hint ? (
          <HintNote reason={hints.hint.reason} />
        ) : (
          <p className="text-center text-xs text-muted-foreground tabular" aria-live="polite">
            {readout.pressurePercent === 0
              ? placed < STACK10_TILES
                ? `Warm-up: heavier tiles start after tile ${STACK10_TILES}`
                : "Heavier tiles can start arriving now"
              : `Heavier tile chance ${readout.pressurePercent}% · up to +${readout.heavyBonus}`}
          </p>
        )}
      </div>

      <div className="flex flex-1 items-stretch justify-center gap-2">
        {run.columns.map((column, index) => {
          const playable = canPlace(run, index) && !verifying;
          const clears = tile !== null && column.sum + tile === 10;
          const over = tile !== null && column.sum + tile > 10;
          const hinted = hints.hint?.column === index;
          return (
            <button
              key={index}
              type="button"
              disabled={!playable}
              onClick={() => onPlace(index)}
              aria-label={`${columnLabel(index, column, tile, playable)}${
                hinted ? " Hint: place the tile here." : ""
              }`}
              className={cn(
                "flex flex-1 flex-col items-center justify-end gap-1 rounded-xl border p-2 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                playable
                  ? "border-border bg-surface hover:bg-surface-2"
                  : "border-transparent bg-surface/40 opacity-50",
                playable && clears && "border-primary/60 bg-primary/10",
                playable && over && "border-destructive/60 bg-destructive/10",
                hinted && "animate-pulse ring-2 ring-primary",
              )}
            >
              <div className="flex w-full flex-1 flex-col-reverse items-center justify-start gap-1">
                {column.tiles.map((value, tileIndex) => (
                  <span
                    key={tileIndex}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-lg text-sm font-semibold tabular",
                      tileIndex === column.tiles.length - 1
                        ? "bg-foreground text-background"
                        : "bg-surface-2 text-foreground",
                    )}
                  >
                    {value}
                  </span>
                ))}
              </div>
              <span
                className={cn(
                  "text-xs tabular",
                  clears && playable ? "font-semibold text-primary" : "text-muted-foreground",
                )}
              >
                {column.sum}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex justify-center pt-3">
        <HintButton offered={hints.offered} waitSeconds={hints.waitSeconds} onAsk={hints.ask} />
      </div>
      <p className="pt-3 text-center text-xs text-muted-foreground" aria-live="polite">
        {verifying
          ? "Verifying your run with the server…"
          : "Add up to exactly ten to clear a column. Past ten ends the run. There is no final tile."}
      </p>
      <EndRunButton
        score={run.score}
        disabled={verifying || run.outcome !== "playing"}
        onEnd={onFinish}
      />
    </div>
  );
}

/** The accessible name of a column, which states why a move is or is not playable. */
function columnLabel(
  index: number,
  column: { tiles: readonly number[]; sum: number },
  tile: number | null,
  playable: boolean,
): string {
  const position = `Column ${index + 1}, total ${column.sum}`;
  if (tile === null) return `${position}. No tile to place.`;
  if (!playable) return `${position}. The run has ended.`;
  if (column.sum + tile > 10) {
    // Going past ten is a real move: it is the move that ends the run, and when
    // every column would go over it is the only move there is. It is offered with
    // a warning rather than hidden, because a board that silently refuses the only
    // legal move is a board the player cannot finish.
    return `${position}. Place ${tile} to make ${column.sum + tile}, which ends the run.`;
  }
  if (column.sum + tile === 10) {
    // The same arithmetic the verifier scores with: 10, plus five for every tile
    // the column was stacked with beyond the first.
    const stacks = column.tiles.length + 1;
    return `${position}. Place ${tile} to clear it for ${10 + 5 * (stacks - 1)} points.`;
  }
  return `${position}. Place ${tile} to make ${column.sum + tile}.`;
}

/** The end of a run: the score the server verified, or a guest's unranked result. */
function Finished({
  slug,
  title,
  run,
  result,
  onRestart,
}: {
  slug: string;
  title: string;
  run: Stack10Run;
  result: RunResult;
  onRestart: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 px-6 pb-[max(1rem,env(safe-area-inset-bottom))] text-center">
      <div className="enter flex flex-col items-center gap-2">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
          {result.ranked ? (
            <Trophy className="size-5 text-muted-foreground" />
          ) : (
            <ShieldCheck className="size-5 text-muted-foreground" />
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {run.stopped
            ? "Run ended"
            : run.endReason === "limit"
              ? "Submission limit reached"
              : "Run over"}
        </p>
        <p className="text-5xl font-semibold tabular">{result.score}</p>
        <p className="text-sm text-muted-foreground">
          {run.stopped || run.endReason === "limit"
            ? `${result.tilesPlaced} tiles placed, ${result.clearedColumns} columns cleared.`
            : `A column passed ten after ${result.tilesPlaced} tiles; ${result.clearedColumns} columns cleared.`}
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Duration</dt>
          <dd className="font-semibold tabular">{formatDuration(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Columns cleared</dt>
          <dd className="font-semibold tabular">{result.clearedColumns}</dd>
        </div>
        {result.personalBest !== null && (
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs text-muted-foreground">Your best</dt>
            <dd className="font-semibold tabular">{result.personalBest}</dd>
          </div>
        )}
        {result.rank !== null && (
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs text-muted-foreground">Rank</dt>
            <dd className="font-semibold tabular">#{result.rank}</dd>
          </div>
        )}
      </dl>

      <p className="mx-auto max-w-sm text-xs text-muted-foreground">
        {result.ranked
          ? "Verified by replaying your moves on the server, then saved to the leaderboard."
          : "Verified by replaying your moves on the server. This was a guest run, so it is not on the leaderboard."}
        {result.duplicate && " This run was already recorded, so nothing was counted twice."}
      </p>

      <RunEndActions slug={slug} ranked={result.ranked} onRestart={onRestart} />
    </div>
  );
}

/** Milliseconds as `m:ss`. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
