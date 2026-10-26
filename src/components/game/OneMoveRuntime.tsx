import { Grid2x2, Loader2, RotateCcw, ShieldCheck, Trophy, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ErrorState } from "@/components/common";
import { EndRunButton } from "@/components/game/EndRunButton";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { SavedRunCard } from "@/components/game/SavedRunCard";
import { RulesList } from "@/components/game/RulesList";
import { RunEndActions } from "@/components/game/RunEndActions";
import { LevelUpOverlay } from "@/components/game/LevelUp";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { boardPattern, boardSize, type OneMoveRun } from "@/lib/games/one-move";
import { levelUpHold, useLevelUp } from "@/lib/games/level-up";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useOneMoveRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES["one-move"];

/**
 * One Move, playing for real.
 *
 * The board is a view onto `useOneMoveRun`, which owns the whole lifecycle: a
 * session issued by the server, the boards played against its seed, and the score
 * the server derived from the submitted tap list. Nothing on this screen decides
 * a number — the score shown at the end is the one that came back from
 * verification, and until it does the screen says the run is being verified
 * rather than showing a provisional total.
 *
 * The screen starts with its rules, not with a live board: a player who has never
 * seen this game should not have to guess what a tap does. The intro is local to
 * the run, so restarting shows it again.
 */
export function OneMoveRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useOneMoveRun(slug);

  // A signed-in player's unfinished run is offered before a new one starts.
  if (state.status === "saved") {
    return (
      <SavedRunCard
        score={state.run.score}
        where={`Board ${state.run.level}`}
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
          <Button asChild variant="ghost" size="lg">
            <ExitGameLink slug={slug}>{title}</ExitGameLink>
          </Button>
        </div>
      </div>
    );
  }

  if (state.status === "playing" || state.status === "submitting") {
    return (
      <Board
        // A fresh board per run: the intro and the first board always start at
        // level one, even when the next session deals the same seed.
        key={state.session.id}
        run={state.run}
        session={state.session}
        verifying={state.status === "submitting"}
        onTap={state.tap}
        onFinish={state.finish}
        onBegin={state.begin}
        autoStart={autoStart}
        slug={slug}
        title={title}
      />
    );
  }

  if (state.status === "finished") {
    return (
      <Finished
        slug={slug}
        result={state.result}
        stopped={state.run.stopped === true}
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

/** The live run: the rules first, then one board per level. */
function Board({
  run,
  session,
  verifying,
  onTap,
  onFinish,
  onBegin,
  autoStart,
  slug,
  title,
}: {
  run: OneMoveRun;
  session: PlaySession;
  verifying: boolean;
  onTap: (cell: number) => void;
  /** Ends the run where it stands and submits it. */
  onFinish: () => void;
  /** Starts the run's clock; the time spent on the rules is not the run's. */
  onBegin: () => void;
  /** Start without the rules screen (Tap to play). */
  autoStart: boolean;
  slug: string;
  title: string;
}) {
  // A retry of a failed submission re-mounts this board with the run it already
  // has; a run with taps has started, so the intro must not reappear. A fresh run
  // has no taps and does see it.
  const [started, setStarted] = useState(autoStart || run.taps.length > 0);

  // Tap to play skips the rules: the run, and its clock, start at once.
  useEffect(() => {
    if (autoStart && run.taps.length === 0) onBegin();
    // Once, on the first board: a retried submission remounts with a started run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const firstCell = useRef<HTMLButtonElement>(null);

  // Pressing Start removes the button that had focus. Moving focus to the first
  // cell means a keyboard player lands on the board rather than at the top of the
  // page.
  useEffect(() => {
    if (started) firstCell.current?.focus();
  }, [started]);

  // A started, unverified run is progress the player would lose by leaving.
  useReportRunProgress(started && !verifying && run.outcome === "playing", onFinish);

  // A restored board gets a beat before the next one, with a note when it grows.
  const nextSide = boardSize(run.level);
  const grew = run.level > 1 && nextSide > boardSize(run.level - 1);
  const levelUp = useLevelUp(run.level, run.score, levelUpHold(grew));

  if (!started) {
    return (
      <div className="flex flex-1 flex-col justify-center px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="enter mx-auto flex w-full max-w-sm flex-col items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
            <Grid2x2 className="size-5 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">{RULES.heading}</h1>
            <p className="text-sm text-muted-foreground">{RULES.summary}</p>
          </div>

          <RulesList rules={RULES.rules} />

          <div className="flex w-full flex-col gap-2">
            <Button
              variant="play"
              size="lg"
              onClick={() => {
                onBegin();
                setStarted(true);
              }}
              autoFocus
            >
              Start run
            </Button>
            <Button asChild variant="ghost" size="lg">
              <ExitGameLink slug={slug}>Back to {title}</ExitGameLink>
            </Button>
          </div>

          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {session.ranked ? (
              <>
                <ShieldCheck className="size-3.5" />
                Signed in: this run can be ranked
              </>
            ) : (
              <>
                <ShieldCheck className="size-3.5" />
                Guest run: verified, but not ranked
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  const board = boardPattern(run.seed, run.level);
  const accepting = !verifying && run.outcome === "playing" && !levelUp;

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">Score</dt>
          <dd className="text-2xl font-semibold tabular">{run.score}</dd>
        </dl>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular">Board {run.level}</span>
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

      <p className="py-1 text-center text-sm text-muted-foreground" aria-live="polite">
        {verifying
          ? "Verifying your run with the server…"
          : run.outcome === "over"
            ? "One move missed."
            : `Board ${run.level} — one move restores the checkerboard.`}
      </p>

      {/* The difficulty of this board, read from the rules rather than guessed:
          the board grows a row and a column every four levels, without cap, so
          the space to search keeps growing and the readout keeps being true. */}
      <p className="pb-1 text-center text-xs text-muted-foreground">
        <span className="tabular">
          {board.size}×{board.size}
        </span>{" "}
        board · <span className="tabular">{board.size * board.size}</span> cells
      </p>

      {/* A square board, centred in whatever space is left. It always fits: the
          width is the smaller of the column and the viewport height minus the
          chrome above and below it, so neither a phone nor a landscape screen
          ever scrolls it. The board grows without cap, so the cells shrink to
          share that square instead; larger boards get a little more room on a
          wide screen and tighter gaps so each cell keeps as much of it as
          possible. */}
      <div className="flex min-h-0 flex-1 items-center justify-center py-3">
        <div className="flex max-h-full w-full justify-center">
          <div
            className={cn(
              "relative grid aspect-square w-full",
              board.size > 12
                ? "gap-0.5"
                : board.size > 9
                  ? "gap-1"
                  : board.size > 6
                    ? "gap-1.5"
                    : "gap-2",
            )}
            style={{
              maxWidth:
                board.size > 9
                  ? "min(36rem, calc(100dvh - 12rem))"
                  : "min(28rem, calc(100dvh - 12rem))",
              gridTemplateColumns: `repeat(${board.size}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${board.size}, minmax(0, 1fr))`,
            }}
            role="group"
            aria-label={`Board ${run.level}, ${board.size} by ${board.size}`}
          >
            {board.cells.map((dark, index) => (
              <button
                key={index}
                ref={index === 0 ? firstCell : undefined}
                type="button"
                disabled={!accepting}
                onClick={() => onTap(index)}
                aria-label={cellLabel(index, board.size, dark, run, verifying)}
                className={cn(
                  "press border transition-colors",
                  board.size > 12 ? "rounded-sm" : board.size > 9 ? "rounded-md" : "rounded-lg",
                  "motion-reduce:transition-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "active:scale-[0.97]",
                  dark ? "border-transparent bg-foreground" : "border-border bg-surface-2",
                  accepting ? "hover:opacity-90" : "opacity-60",
                )}
              >
                <span className="sr-only">{`Row ${Math.floor(index / board.size) + 1} column ${
                  (index % board.size) + 1
                }`}</span>
              </button>
            ))}
            {levelUp && (
              <LevelUpOverlay
                levelUp={levelUp}
                unit="Board"
                next={`Board ${run.level} · ${nextSide}×${nextSide}`}
                note={grew ? `Boards are ${nextSide}×${nextSide} from here.` : undefined}
              />
            )}
          </div>
        </div>
      </div>

      <p className="pt-1 text-center text-xs text-muted-foreground" aria-live="polite">
        {verifying
          ? "The taps you made are your score if the server agrees."
          : "A move flips a cross. Find the one that restores the pattern. Ten points a board, with no final board."}
      </p>
      <EndRunButton
        score={run.score}
        disabled={verifying || run.outcome !== "playing"}
        onEnd={onFinish}
      />
    </div>
  );
}

/** The accessible name of a cell, which states what a tap would do. */
function cellLabel(
  index: number,
  size: number,
  dark: boolean,
  run: OneMoveRun,
  verifying: boolean,
): string {
  const row = Math.floor(index / size) + 1;
  const column = (index % size) + 1;
  const position = `Row ${row} column ${column}, ${dark ? "dark" : "light"} cell`;
  if (verifying) return `${position}. The run is being verified.`;
  if (run.outcome !== "playing") return `${position}. The run has ended.`;
  return `${position}. Tap to flip this cell and its neighbours.`;
}

/** The end of a run: the score the server verified, or a guest's unranked result. */
function Finished({
  slug,
  result,
  stopped,
  onRestart,
}: {
  slug: string;
  result: RunResult;
  stopped: boolean;
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
        <p className="text-sm text-muted-foreground">{stopped ? "Run ended" : "One move missed"}</p>
        <p className="text-5xl font-semibold tabular">{result.score}</p>
        <p className="text-sm text-muted-foreground">
          {`${result.tilesPlaced} ${result.tilesPlaced === 1 ? "tap" : "taps"}, ${
            result.clearedColumns
          } ${result.clearedColumns === 1 ? "board" : "boards"} restored.`}
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Duration</dt>
          <dd className="font-semibold tabular">{formatDuration(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Boards restored</dt>
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
          ? "Verified by replaying your taps on the server, then saved to the leaderboard."
          : "Verified by replaying your taps on the server. This was a guest run, so it is not on the leaderboard."}
        {result.duplicate && " This run was already recorded, so nothing was counted twice."}
      </p>

      <RunEndActions slug={slug} ranked={result.ranked} onRestart={onRestart} autoFocus />
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
