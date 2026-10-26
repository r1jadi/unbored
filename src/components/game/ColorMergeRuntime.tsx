import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Layers,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Trophy,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorState } from "@/components/common";
import { EndRunButton } from "@/components/game/EndRunButton";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { RunEndActions } from "@/components/game/RunEndActions";
import { SavedRunCard } from "@/components/game/SavedRunCard";
import { RulesList } from "@/components/game/RulesList";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  COLOR_MERGE_SIZE,
  DOWN,
  LEFT,
  RIGHT,
  UP,
  bestShade,
  canSlide,
  progress,
  tileValue,
  type ColorMergeDirection,
  type ColorMergeRun,
} from "@/lib/games/color-merge";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useColorMergeRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES["color-merge"];

/**
 * Color Merge, playing for real.
 *
 * The board is a view onto `useColorMergeRun`, which owns the whole lifecycle: a
 * session issued by the server, the run played against its seed, and the score
 * the server derived from the submitted slide list. Nothing on this screen
 * decides a number — the score shown at the end is the one that came back from
 * verification, and until it does the screen says the run is being verified
 * rather than showing a provisional total.
 *
 * Three things the component refuses to do, because each would be a lie:
 *
 *   - **it never offers a direction that would not move the board.** A disabled
 *     d-pad is the honest answer to a locked board, not a button that silently
 *     does nothing.
 *   - **it never records a slide the rules would not.** The engine ignores a
 *     no-op, so what is submitted is exactly what moved.
 *   - **it never claims a score was saved.** A failed submission is an error with
 *     the server's own message and a retry that re-sends the identical run, not a
 *     local "saved" that a reload would disprove.
 */
export function ColorMergeRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useColorMergeRun(slug);

  // A signed-in player's unfinished run is offered before a new one starts.
  if (state.status === "saved") {
    return (
      <SavedRunCard
        score={state.run.score}
        where={`${state.run.moves.length} ${state.run.moves.length === 1 ? "slide" : "slides"}`}
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
        // A fresh board per run: the rules and the opening board always start at
        // slide zero, even when the next session deals the same seed.
        key={state.session.id}
        run={state.run}
        session={state.session}
        verifying={state.status === "submitting"}
        onSlide={state.slide}
        onFinish={state.finish}
        onBegin={state.begin}
        autoStart={autoStart}
        slug={slug}
        title={title}
      />
    );
  }

  if (state.status === "finished") {
    return <Finished slug={slug} run={state.run} result={state.result} onRestart={state.restart} />;
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

/** The live run: the rules first, then the board and its d-pad. */
function Board({
  run,
  session,
  verifying,
  onSlide,
  onFinish,
  onBegin,
  autoStart,
  slug,
  title,
}: {
  run: ColorMergeRun;
  session: PlaySession;
  verifying: boolean;
  onSlide: (direction: ColorMergeDirection) => void;
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
  // has; a run with slides has started, so the rules must not reappear. A fresh
  // run has no slides and does see them.
  const [started, setStarted] = useState(autoStart || run.moves.length > 0);

  // Tap to play skips the rules: the run, and its clock, start at once.
  useEffect(() => {
    if (autoStart && run.moves.length === 0) onBegin();
    // Once, on the first board: a retried submission remounts with a started run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const boardRef = useRef<HTMLDivElement>(null);
  const pressed = useRef<{ x: number; y: number; pointer: number } | null>(null);

  // Pressing Start removes the button that had focus. Moving focus to the board
  // means a keyboard player lands on the arrows rather than at the top of the
  // page.
  useEffect(() => {
    if (started) boardRef.current?.focus();
  }, [started]);

  const accepting = !verifying && run.outcome === "playing";

  // A started, unverified run is progress the player would lose by leaving.
  useReportRunProgress(started && accepting, onFinish);

  const slide = useCallback(
    (direction: ColorMergeDirection) => {
      if (!accepting) return;
      onSlide(direction);
      // A d-pad press leaves focus on a button that the slide may have just
      // disabled, and a disabled element drops focus to the body — outside this
      // wrapper, where the key handler does not hear it. Returning focus to the
      // board keeps the arrow keys working after every press.
      boardRef.current?.focus({ preventScroll: true });
    },
    [accepting, onSlide],
  );

  // Arrow keys and WASD move the board. They are handled by the wrapper so a
  // player can keep their focus on the d-pad (or on the board itself) and never
  // has to tab back between moves.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const direction = keyDirection(event.key);
      if (direction === null) return;
      // An arrow key would otherwise scroll the page under the board.
      event.preventDefault();
      slide(direction);
    },
    [slide],
  );

  if (!started) {
    return (
      <div className="flex flex-1 flex-col justify-center px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="enter mx-auto flex w-full max-w-sm flex-col items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
            <Layers className="size-5 text-muted-foreground" />
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

  const readout = progress(run);
  const muted = "text-muted-foreground";

  return (
    <div
      ref={boardRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      aria-label="Color Merge board. Use the arrow keys to slide."
    >
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">Score</dt>
          <dd className="text-2xl font-semibold tabular">{run.score}</dd>
        </dl>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular">Slide {readout.slides}</span>
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
            ? run.endReason === "locked"
              ? "The board locked."
              : "Submission limit reached."
            : `Slide to merge — best tile ${readout.best}.`}
      </p>

      {/* A square board, capped against the viewport height as well as the
          column, so a landscape phone still shows the d-pad and the whole grid. */}
      <div className="flex min-h-0 flex-1 items-center justify-center py-2">
        <div
          className="grid aspect-square w-full gap-1.5 rounded-2xl bg-surface p-1.5 sm:gap-2"
          style={{
            maxWidth: "min(26rem, calc(100dvh - 17rem))",
            gridTemplateColumns: `repeat(${COLOR_MERGE_SIZE}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${COLOR_MERGE_SIZE}, minmax(0, 1fr))`,
            // A finger swipe is a move, not a scroll: without this the browser
            // claims the drag for panning, cancels the pointer, and the gesture
            // never reaches the board.
            touchAction: "none",
          }}
          role="grid"
          aria-label={`Board — ${readout.slides} slides played`}
          onPointerDown={(event) => {
            if (!accepting) return;
            // Some pointer events carry no coordinates (a synthetic event, or a
            // device that reports position only on release). A swipe needs both
            // ends, so a press without one is not recorded.
            if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
            // Capture the pointer so the release is delivered here even when a
            // finger travels off the grid before lifting: a swipe that ends
            // outside the board is still a swipe. Released implicitly on up.
            // A capture that is refused (a pointer released mid-gesture, or a
            // synthetic event) must not cost the player the press: the swipe
            // still works, it just has to end over the board.
            try {
              event.currentTarget.setPointerCapture?.(event.pointerId);
            } catch {
              /* no active pointer to capture */
            }
            pressed.current = {
              x: event.clientX,
              y: event.clientY,
              pointer: event.pointerId,
            };
          }}
          onPointerUp={(event) => {
            const start = pressed.current;
            pressed.current = null;
            if (!start || start.pointer !== event.pointerId) return;
            if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            // A tap (or a scroll gesture) is not a slide. The threshold keeps a
            // shaky finger from firing a move nobody meant.
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
            if (Math.abs(dx) > Math.abs(dy)) {
              slide(dx > 0 ? RIGHT : LEFT);
            } else {
              slide(dy > 0 ? DOWN : UP);
            }
          }}
          onPointerCancel={() => {
            pressed.current = null;
          }}
        >
          {Array.from({ length: COLOR_MERGE_SIZE * COLOR_MERGE_SIZE }, (_, cell) => {
            const shade = run.board[cell];
            const row = Math.floor(cell / COLOR_MERGE_SIZE) + 1;
            const column = (cell % COLOR_MERGE_SIZE) + 1;
            return (
              <div
                key={cell}
                role="gridcell"
                aria-label={
                  shade === 0
                    ? `Row ${row} column ${column}, empty`
                    : `Row ${row} column ${column}, ${tileValue(shade)}`
                }
                className={cn(
                  "flex select-none items-center justify-center rounded-lg text-xl font-semibold tabular sm:text-2xl",
                  "transition-colors motion-reduce:transition-none",
                  shade === 0 ? "bg-surface-2/40" : "shadow-sm",
                )}
                style={shade === 0 ? undefined : shadePaint(shade)}
              >
                {shade === 0 ? "" : tileValue(shade)}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mx-auto grid w-44 grid-cols-3 grid-rows-2 gap-1.5 pt-1">
        <DirectionButton
          direction={UP}
          label="Slide up"
          icon={<ArrowUp />}
          run={run}
          accepting={accepting}
          onSlide={slide}
          className="col-start-2 row-start-1"
        />
        <DirectionButton
          direction={LEFT}
          label="Slide left"
          icon={<ArrowLeft />}
          run={run}
          accepting={accepting}
          onSlide={slide}
          className="col-start-1 row-start-2"
        />
        <DirectionButton
          direction={DOWN}
          label="Slide down"
          icon={<ArrowDown />}
          run={run}
          accepting={accepting}
          onSlide={slide}
          className="col-start-2 row-start-2"
        />
        <DirectionButton
          direction={RIGHT}
          label="Slide right"
          icon={<ArrowRight />}
          run={run}
          accepting={accepting}
          onSlide={slide}
          className="col-start-3 row-start-2"
        />
      </div>

      <p className={cn("pt-2 text-center text-xs", muted)} aria-live="polite">
        {verifying
          ? "The slides you made are your score if the server agrees."
          : run.outcome === "over"
            ? "The run is over. Your result is on its way."
            : `Next tile: ${readout.promotionPercent}% chance it arrives as a ${readout.promotedValue}. Each tile merges once per slide.`}
      </p>
      <EndRunButton score={run.score} disabled={!accepting} onEnd={onFinish} />
    </div>
  );
}

/** One d-pad button: disabled when the slide would not change the board. */
function DirectionButton({
  direction,
  label,
  icon,
  run,
  accepting,
  onSlide,
  className,
}: {
  direction: ColorMergeDirection;
  label: string;
  icon: React.ReactNode;
  run: ColorMergeRun;
  accepting: boolean;
  onSlide: (direction: ColorMergeDirection) => void;
  className?: string;
}) {
  const enabled = accepting && canSlide(run, direction);
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-label={label}
      disabled={!enabled}
      onClick={() => onSlide(direction)}
      className={cn("size-12 rounded-xl", className)}
    >
      {icon}
    </Button>
  );
}

/**
 * A tile's paint, as a shade colour.
 *
 * The hue walks around the wheel as the shade rises, so a board reads at a glance
 * without a legend, and the lightness is fixed at a value dark text sits on at
 * contrast — the number on the tile is the thing being read, not the colour.
 */
function shadePaint(shade: number): React.CSSProperties {
  const hue = (shade * 47 + 190) % 360;
  return {
    backgroundColor: `oklch(0.62 0.15 ${hue})`,
    color: "oklch(0.16 0 0)",
    border: `1px solid oklch(0.52 0.15 ${hue})`,
  };
}

/** The direction a key names, or null when the key is not a move. */
function keyDirection(key: string): ColorMergeDirection | null {
  switch (key) {
    case "ArrowUp":
    case "w":
    case "W":
      return UP;
    case "ArrowRight":
    case "d":
    case "D":
      return RIGHT;
    case "ArrowDown":
    case "s":
    case "S":
      return DOWN;
    case "ArrowLeft":
    case "a":
    case "A":
      return LEFT;
    default:
      return null;
  }
}

/** The end of a run: the score the server verified, or a guest's unranked result. */
function Finished({
  slug,
  run,
  result,
  onRestart,
}: {
  slug: string;
  run: ColorMergeRun;
  result: RunResult;
  onRestart: () => void;
}) {
  const best = tileValue(bestShade(run.board));
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
            : run.endReason === "locked"
              ? "The board locked"
              : "Submission limit reached"}
        </p>
        <p className="text-5xl font-semibold tabular">{result.score}</p>
        <p className="text-sm text-muted-foreground">
          {result.tilesPlaced} {result.tilesPlaced === 1 ? "slide" : "slides"}, best tile {best}.
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Duration</dt>
          <dd className="font-semibold tabular">{formatDuration(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Slides</dt>
          <dd className="font-semibold tabular">{result.tilesPlaced}</dd>
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
          ? "Verified by replaying your slides on the server, then saved to the leaderboard."
          : "Verified by replaying your slides on the server. This was a guest run, so it is not on the leaderboard."}
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
