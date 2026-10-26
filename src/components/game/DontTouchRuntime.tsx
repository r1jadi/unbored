import { Eye, Hand, Loader2, RotateCcw, ShieldCheck, Trophy, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorState } from "@/components/common";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { RunEndActions } from "@/components/game/RunEndActions";
import { RulesList } from "@/components/game/RulesList";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DONT_TOUCH_LANES,
  DONT_TOUCH_MAX_ROWS,
  blackPercent,
  cellAt,
  hasUnclearedWhite,
  progress,
  rowAt,
  rowWindow,
  type DontTouchRun,
} from "@/lib/games/dont-touch";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useDontTouchRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES["dont-touch"];

/**
 * Don't Touch the Black, playing for real.
 *
 * The conveyor is a view onto `useDontTouchRun`, which owns the whole lifecycle: a
 * session issued by the server, the deck dealt from its seed, and the score the
 * server derived from the submitted taps. The screen owns only the part the rules
 * cannot see — time. It decides which row is at the line; it never decides what a
 * tap is worth.
 *
 * Three things the component refuses to do, because each would be a lie:
 *
 *   - **it never lets a tile be tapped out of reach.** Only the row at the line is
 *     pressable; the rows above it are visible so the player can plan, not tap.
 *   - **it never records a tap the rules would not.** The engine ignores a tile
 *     that is already cleared or off the deck, so what is submitted is exactly
 *     what was touched.
 *   - **it never claims a score was saved.** A failed submission is an error with
 *     the server's own message and a retry that re-sends the identical run, not a
 *     local "saved" that a reload would disprove.
 */

export function DontTouchRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useDontTouchRun(slug);

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

  // A submission failure keeps the run: the run exists, it is just not verified,
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
      <Conveyor
        // A fresh conveyor per run: it always starts at row one, even when the
        // next session deals the same seed.
        key={state.session.id}
        run={state.run}
        session={state.session}
        verifying={state.status === "submitting"}
        onTap={state.tap}
        onFinish={state.finish}
        onMiss={state.miss}
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

/** The live run: the rules first, then the conveyor and its line. */
function Conveyor({
  run,
  session,
  verifying,
  onTap,
  onFinish,
  onMiss,
  onBegin,
  autoStart,
  slug,
  title,
}: {
  run: DontTouchRun;
  session: PlaySession;
  verifying: boolean;
  onTap: (cell: number) => void;
  onFinish: () => void;
  /** Ends the run because a white tile in this row passed the line uncleared. */
  onMiss: (row: number) => void;
  /** Starts the run's clock; the time spent on the rules is not the run's. */
  onBegin: () => void;
  /** Start without the rules screen (Tap to play). */
  autoStart: boolean;
  slug: string;
  title: string;
}) {
  // A retry of a failed submission re-mounts this conveyor with the run it
  // already has; a run with taps has started, so the rules must not reappear.
  const [started, setStarted] = useState(autoStart || run.taps.length > 0);

  // Tap to play skips the rules: the run, and its clock, start at once.
  useEffect(() => {
    if (autoStart && run.taps.length === 0) onBegin();
    // Once, on the first board: a retried submission remounts with a started run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [step, setStep] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);

  // Pressing Start removes the button that had focus. Moving focus to the board
  // means a keyboard player lands on the lanes rather than at the top of the page.
  useEffect(() => {
    if (started) boardRef.current?.focus({ preventScroll: true });
  }, [started]);

  const accepting = !verifying && run.outcome === "playing";

  // A started, unverified run is progress the player would lose by leaving.
  useReportRunProgress(started && accepting, onFinish);

  const tap = useCallback(
    (cell: number) => {
      if (!accepting) return;
      onTap(cell);
      // A lane press leaves focus on a button that may be gone a tick later;
      // keeping focus on the board is what keeps the number keys working.
      boardRef.current?.focus({ preventScroll: true });
    },
    [accepting, onTap],
  );

  // The latest run, read when a row's window closes. Keeping it out of the
  // clock's dependencies means a tap does not restart the row's window.
  const runRef = useRef(run);
  runRef.current = run;

  // The clock. Each row gets its own window at the line. When the window closes,
  // a row that still has an uncleared white tile ends the run — letting a white
  // pass is a loss, not just a missed point. Otherwise the conveyor moves on. The
  // representable ceiling — a submission bound, not a level — ends the run
  // rather than running past the cells the server can name.
  useEffect(() => {
    if (!started || !accepting) return;
    const timer = window.setTimeout(() => {
      if (hasUnclearedWhite(runRef.current, step)) onMiss(step);
      else if (step + 1 >= DONT_TOUCH_MAX_ROWS) onFinish();
      else setStep((current) => current + 1);
    }, rowWindow(step));
    return () => window.clearTimeout(timer);
  }, [started, accepting, step, onFinish, onMiss]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!accepting) return;
      const lane = keyLane(event.key);
      if (lane === null) return;
      event.preventDefault();
      tap(cellAt(step, lane));
    },
    [accepting, step, tap],
  );

  if (!started) {
    return (
      <div className="flex flex-1 flex-col justify-center px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="enter mx-auto flex w-full max-w-sm flex-col items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
            <Hand className="size-5 text-muted-foreground" />
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

  const cleared = new Set(run.taps);
  const readout = progress(run);
  const activeRow = step;
  const blackShare = blackPercent(activeRow);

  return (
    <div
      ref={boardRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      aria-label="Don't Touch the Black conveyor. Tap the white tiles in the row at the line."
    >
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">Score</dt>
          <dd className="text-2xl font-semibold tabular">{run.score}</dd>
        </dl>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular">Row {activeRow + 1}</span>
          <span className="tabular">{readout.cleared} cleared</span>
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
            ? run.endReason === "black"
              ? "You touched the black."
              : run.endReason === "miss"
                ? "A white tile got past the line."
                : "Run ended."
            : "Tap the white tiles in the row at the line."}
      </p>

      {/* The conveyor. Five rows are visible at a time; the bottom one is at the
          line and is the only one that can be touched. Percentages rather than
          pixels keep the field square-ish on any viewport, and the rows move by
          one fifth per tick, which is what makes the slowdown visible. */}
      <div className="relative flex min-h-0 flex-1 justify-center py-2">
        <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface">
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1/5 border-t-2 border-dashed border-primary/60 bg-primary/5"
            aria-hidden="true"
          />

          {Array.from({ length: 5 }, (_, offset) => {
            const row = step + offset;
            // At the representable ceiling there is no next row to name; the run
            // ends on this tick, so the empty slots above the line are honest.
            if (row >= DONT_TOUCH_MAX_ROWS) return null;
            const atLine = offset === 0;
            const colours = rowAt(run.seed, row);
            return (
              <div
                key={row}
                className="absolute inset-x-0 grid grid-cols-3 gap-1.5 px-1.5 transition-[top] duration-300 ease-linear motion-reduce:transition-none"
                style={{ top: `${(4 - offset) * 20}%`, height: "20%" }}
              >
                {Array.from({ length: DONT_TOUCH_LANES }, (_, lane) => {
                  const cell = cellAt(row, lane);
                  // `colours` is this row's three lanes, not the whole conveyor.
                  const black = colours[lane];
                  const alreadyCleared = cleared.has(cell);
                  return (
                    <button
                      key={cell}
                      type="button"
                      disabled={!atLine || !accepting || alreadyCleared}
                      aria-label={`Row ${row + 1}, lane ${lane + 1}, ${
                        black ? "black — do not touch" : "white"
                      }${alreadyCleared ? ", cleared" : ""}`}
                      onClick={atLine && accepting && !alreadyCleared ? () => tap(cell) : undefined}
                      className={cn(
                        "h-full rounded-lg transition-colors duration-150 motion-reduce:transition-none",
                        black
                          ? "border border-zinc-700 bg-zinc-950"
                          : "bg-zinc-100 shadow-sm dark:bg-zinc-100",
                        alreadyCleared && "opacity-20",
                        atLine && accepting
                          ? "cursor-pointer ring-1 ring-zinc-900/20 active:scale-[0.98] dark:ring-white/30"
                          : "cursor-default opacity-80",
                        !atLine && "opacity-50",
                      )}
                    >
                      <span className="sr-only">{black ? "Black" : "White"}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-md grid-cols-3 gap-1.5 pt-2">
        {Array.from({ length: DONT_TOUCH_LANES }, (_, lane) => (
          <Button
            key={lane}
            type="button"
            variant="secondary"
            size="lg"
            aria-label={`Tap lane ${lane + 1}`}
            disabled={!accepting}
            onClick={() => tap(cellAt(activeRow, lane))}
            className="tabular"
          >
            {lane + 1}
          </Button>
        ))}
      </div>

      <div className="mx-auto flex w-full max-w-md justify-center pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onFinish} disabled={!accepting}>
          End run
        </Button>
      </div>

      <p className="pt-1 text-center text-xs text-muted-foreground" aria-live="polite">
        {verifying
          ? "The taps you made are your score if the server agrees."
          : run.outcome === "over"
            ? "The run is over. Your result is on its way."
            : `Black tiles: ${blackShare}% of this row. Clear every white; never touch black.`}
      </p>
    </div>
  );
}

/** The lane a key names, or null when the key is not a lane. */
function keyLane(key: string): number | null {
  switch (key) {
    case "1":
    case "a":
    case "A":
      return 0;
    case "2":
    case "s":
    case "S":
      return 1;
    case "3":
    case "d":
    case "D":
      return 2;
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
  run: DontTouchRun;
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
            <Eye className="size-5 text-muted-foreground" />
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {run.endReason === "black"
            ? "You touched the black"
            : run.endReason === "miss"
              ? "A white tile got past"
              : "Run ended"}
        </p>
        <p className="text-5xl font-semibold tabular">{result.score}</p>
        <p className="text-sm text-muted-foreground">
          {run.cleared} {run.cleared === 1 ? "white tile" : "white tiles"} cleared
          {run.endReason === "black"
            ? " before the black one."
            : run.endReason === "miss"
              ? " before one slipped past."
              : "."}
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Duration</dt>
          <dd className="font-semibold tabular">{formatDuration(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Taps</dt>
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
