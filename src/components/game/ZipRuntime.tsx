import { Link } from "@tanstack/react-router";
import {
  Loader2,
  RotateCcw,
  Route as RouteIcon,
  ShieldCheck,
  Trophy,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { ErrorState } from "@/components/common";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { RulesList } from "@/components/game/RulesList";
import { LevelUpOverlay } from "@/components/game/LevelUp";
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
import { cn } from "@/lib/utils";
import { levelUpHold, useLevelUp } from "@/lib/games/level-up";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useZipRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import {
  board as drawBoard,
  boardSize,
  budgetMs,
  canMove,
  ZIP_BONUS_MS_PER_ROW,
  type ZipBoard,
  type ZipRun,
} from "@/lib/games/zip";

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES["zip"];

/**
 * Zip, playing for real.
 *
 * The board is a view onto `useZipRun`, which owns the lifecycle and the clock:
 * the rules first, a session issued when the player presses Start, boards drawn
 * against its seed, and the score the server derived from the submitted cells.
 * Nothing here decides a number.
 *
 * A path is drawn by dragging across the cells or by tapping them one at a
 * time; entering a cell already on the path cuts it back to that cell, which is
 * how a player undoes. Every cell is a real button, so the board also plays from
 * a keyboard.
 */
export function ZipRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useZipRun(slug);

  // Tap to play skips the rules: the session is asked for straight away, and
  // again when Play again brings the screen back to its start.
  const begin = state.begin;
  const atIntro = state.status === "intro";
  useEffect(() => {
    if (autoStart && atIntro) begin();
  }, [autoStart, atIntro, begin]);

  if (state.status === "intro") {
    return <Intro signedIn={state.signedIn} onBegin={state.begin} slug={slug} title={title} />;
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

  if (state.status === "error" && state.stage === "submit" && state.run && state.session) {
    return (
      <div className="flex flex-1 flex-col justify-center gap-4 px-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-2">
          <TriangleAlert className="size-5 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold">Your run was not verified</h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {playErrorMessage(state.error)} Nothing was saved. Sending the same run again is safe, but
          a Zip run has to reach the server soon after its clock runs out.
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
        key={state.session.id}
        run={state.run}
        session={state.session}
        deadline={state.deadline}
        verifying={state.status === "submitting"}
        onTap={state.tap}
        onFinish={state.finish}
      />
    );
  }

  if (state.status === "finished") {
    return (
      <Finished
        slug={slug}
        result={state.result}
        outOfTime={state.run.ending === "time"}
        onRestart={state.restart}
      />
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/** The rules, shown before any session exists. */
function Intro({
  signedIn,
  onBegin,
  slug,
  title,
}: {
  signedIn: boolean;
  onBegin: () => void;
  slug: string;
  title: string;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="enter mx-auto flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
          <RouteIcon className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{RULES.heading}</h1>
          <p className="text-sm text-muted-foreground">{RULES.summary}</p>
        </div>

        <RulesList rules={RULES.rules} />

        <div className="flex w-full flex-col gap-2">
          <Button variant="play" size="lg" onClick={onBegin} autoFocus>
            Start run
          </Button>
          <Button asChild variant="ghost" size="lg">
            <ExitGameLink slug={slug}>Back to {title}</ExitGameLink>
          </Button>
        </div>

        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          {signedIn ? "Signed in: this run can be ranked" : "Guest run: verified, but not ranked"}
        </p>
      </div>
    </div>
  );
}

const CELL_EDGE = "color-mix(in oklch, var(--foreground) 12%, transparent)";

/** The live run: one board at a time, against the clock. */
function Board({
  run,
  session,
  deadline,
  verifying,
  onTap,
  onFinish,
}: {
  run: ZipRun;
  session: PlaySession;
  deadline: number;
  verifying: boolean;
  onTap: (cell: number) => void;
  onFinish: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const firstCell = useRef<HTMLButtonElement>(null);
  const dragging = useRef(false);
  const lastCell = useRef<number | null>(null);

  const drawn = useMemo(() => drawBoard(run.seed, run.level), [run.seed, run.level]);
  // A solved board gets a beat before the next one, with a note when it grows.
  // It is short: the clock keeps running, on the server as well as here.
  const nextSide = boardSize(run.level);
  const grew = run.level > 1 && nextSide > boardSize(run.level - 1);
  const levelUp = useLevelUp(run.level, run.score, levelUpHold(grew));
  const accepting = !verifying && run.outcome === "playing" && !levelUp;

  useReportRunProgress(accepting, onFinish);

  useEffect(() => {
    firstCell.current?.focus();
  }, []);

  // The countdown's display. The hook ends the run; this only redraws the time.
  useEffect(() => {
    if (!accepting) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [accepting]);

  const remaining = Math.max(0, deadline - now);
  const earned = budgetMs(run.levelsCleared);
  const { size } = drawn;

  const cellAt = (event: PointerEvent): number | null => {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const button = target?.closest<HTMLElement>("[data-cell]");
    return button ? Number(button.dataset["cell"]) : null;
  };

  const press = (event: PointerEvent<HTMLDivElement>) => {
    if (!accepting) return;
    const cell = cellAt(event);
    if (cell === null) return;
    dragging.current = true;
    lastCell.current = cell;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onTap(cell);
  };

  const drag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !accepting) return;
    const cell = cellAt(event);
    if (cell === null || cell === lastCell.current) return;
    lastCell.current = cell;
    onTap(cell);
  };

  const release = () => {
    dragging.current = false;
    lastCell.current = null;
  };

  const onPath = new Set(run.path);
  const reached = Math.max(0, ...run.path.map((cell) => drawn.numbers[cell]));

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
        {statusLine(run, drawn, verifying)}
      </p>

      <div className="mx-auto flex w-full max-w-md items-center gap-3 pb-1 text-xs text-muted-foreground">
        <span className="tabular">
          {size}×{size}
        </span>
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-label="Time left"
          aria-valuemin={0}
          aria-valuemax={Math.round(earned / 1000)}
          aria-valuenow={Math.ceil(remaining / 1000)}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none",
              remaining < 10_000 ? "bg-destructive" : "bg-primary",
            )}
            style={{ width: `${Math.min(100, (remaining / earned) * 100)}%` }}
          />
        </div>
        <span className={cn("tabular", remaining < 10_000 && "text-destructive")}>
          {formatSeconds(remaining)}
        </span>
      </div>

      {/* A square board, centred in whatever space is left, sized like Queens':
          the smaller of the column and the viewport height minus the chrome. */}
      <div className="flex min-h-0 flex-1 items-center justify-center py-3">
        <div className="flex max-h-full w-full justify-center">
          <div
            className="relative grid aspect-square w-full touch-none select-none overflow-hidden rounded-lg border bg-surface"
            style={{
              borderColor: CELL_EDGE,
              maxWidth: "min(32rem, calc(100dvh - 16rem))",
              gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${size}, minmax(0, 1fr))`,
            }}
            role="group"
            aria-label={`Board ${run.level}, ${size} by ${size}`}
            onPointerDown={press}
            onPointerMove={drag}
            onPointerUp={release}
            onPointerCancel={release}
          >
            {drawn.numbers.map((number, index) => {
              const row = Math.floor(index / size);
              const column = index % size;
              const visited = onPath.has(index);
              return (
                <button
                  key={index}
                  ref={index === 0 ? firstCell : undefined}
                  type="button"
                  data-cell={index}
                  disabled={!accepting}
                  // A pointer press is handled on the board, so the click that
                  // follows it is ignored; a keyboard click (detail 0) taps.
                  onClick={(event) => {
                    if (event.detail === 0) onTap(index);
                  }}
                  aria-label={cellLabel(row, column, number, visited, run, drawn, verifying, index)}
                  style={{
                    borderRightWidth: column < size - 1 ? 1 : 0,
                    borderBottomWidth: row < size - 1 ? 1 : 0,
                    borderColor: CELL_EDGE,
                  }}
                  className={cn(
                    "flex items-center justify-center border-solid transition-colors",
                    "motion-reduce:transition-none",
                    "focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    visited ? "bg-primary/20" : "bg-transparent",
                    !accepting && "opacity-70",
                  )}
                />
              );
            })}

            <svg
              className="pointer-events-none absolute inset-0 size-full"
              viewBox={`0 0 ${size} ${size}`}
              aria-hidden
            >
              {run.path.length > 1 && (
                <polyline
                  points={run.path
                    .map((cell) => `${(cell % size) + 0.5},${Math.floor(cell / size) + 0.5}`)
                    .join(" ")}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={0.36}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {drawn.walls.map(([a, b]) => {
                const row = Math.floor(b / size);
                const column = b % size;
                const vertical = b - a === 1;
                return (
                  <line
                    key={`${a}-${b}`}
                    x1={column}
                    y1={row}
                    x2={vertical ? column : column + 1}
                    y2={vertical ? row + 1 : row}
                    stroke="var(--foreground)"
                    strokeWidth={0.1}
                    strokeLinecap="butt"
                  />
                );
              })}
            </svg>

            {/* The numbers sit in their own HTML layer over the path, centred by
                flexbox. As SVG text they relied on `dominant-baseline` and a
                fraction-of-a-unit font size, which mobile browsers round and
                place differently, so the digits drifted off the circles' centres.
                Sizes are in container units, so the badges scale with the board. */}
            <div
              className="pointer-events-none absolute inset-0 grid [container-type:inline-size]"
              style={{
                gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${size}, minmax(0, 1fr))`,
              }}
              aria-hidden
            >
              {drawn.numbers.map((number, index) =>
                number > 0 ? (
                  <span
                    key={index}
                    className="flex items-center justify-center"
                    style={{
                      gridColumn: (index % size) + 1,
                      gridRow: Math.floor(index / size) + 1,
                    }}
                  >
                    <span
                      className="flex aspect-square w-[60%] items-center justify-center rounded-full bg-foreground font-semibold leading-none text-background tabular"
                      style={{
                        fontSize: `${32 / size}cqw`,
                        // The ring marks a number the path has already reached.
                        boxShadow:
                          number <= reached ? `0 0 0 ${7 / size}cqw var(--primary)` : undefined,
                      }}
                    >
                      {number}
                    </span>
                  </span>
                ) : null,
              )}
            </div>
            {levelUp && (
              <LevelUpOverlay
                levelUp={levelUp}
                unit="Board"
                next={`Board ${run.level} · ${nextSide}×${nextSide} · clock +${
                  (ZIP_BONUS_MS_PER_ROW * boardSize(levelUp.solved)) / 1000
                } s`}
                note={grew ? `Boards are ${nextSide}×${nextSide} from here.` : undefined}
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 pt-1">
        <p className="text-center text-xs text-muted-foreground" aria-live="polite">
          {verifying
            ? "The path you drew is your score if the server agrees."
            : `A solved board adds ${(ZIP_BONUS_MS_PER_ROW * size) / 1000} seconds.`}
        </p>
        <Button variant="ghost" size="sm" disabled={!accepting} onClick={() => setConfirming(true)}>
          End run
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this run?</AlertDialogTitle>
            <AlertDialogDescription>
              {`Your score of ${run.score} is kept and sent for verification. The board you are on is not scored.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep playing</AlertDialogCancel>
            <AlertDialogAction onClick={onFinish}>End run</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The line above the board: what just happened, or what to do. */
function statusLine(run: ZipRun, drawn: ZipBoard, verifying: boolean): string {
  if (verifying) return "Verifying your run with the server…";
  if (run.outcome === "over") {
    return run.ending === "time" ? "Time's up." : "Run ended.";
  }
  if (run.levelsCleared > 0 && run.path.length === 0) {
    const solved = boardSize(run.level - 1);
    return `Board ${run.level - 1} solved, +${solved * 10}. Start on 1.`;
  }
  if (run.path.length === 0) return `Board ${run.level} — start on 1.`;
  return `Every cell, 1 to ${drawn.last} in order.`;
}

/** The accessible name of a cell: where it is, what it holds, and what a tap does. */
function cellLabel(
  row: number,
  column: number,
  number: number,
  visited: boolean,
  run: ZipRun,
  drawn: ZipBoard,
  verifying: boolean,
  index: number,
): string {
  const contents = `${number > 0 ? `number ${number}` : "blank"}, ${visited ? "on the path" : "empty"}`;
  const position = `Row ${row + 1} column ${column + 1}, ${contents}`;
  if (verifying) return `${position}. The run is being verified.`;
  if (run.outcome !== "playing") return `${position}. The run has ended.`;
  if (!canMove(run, drawn, index)) return `${position}.`;
  if (run.path.length === 0) return `${position}. Tap to start the path.`;
  return visited ? `${position}. Tap to go back to here.` : `${position}. Tap to extend the path.`;
}

/** The end of a run: the score the server verified, or a guest's unranked result. */
function Finished({
  slug,
  result,
  outOfTime,
  onRestart,
}: {
  slug: string;
  result: RunResult;
  outOfTime: boolean;
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
        <p className="text-sm text-muted-foreground">{outOfTime ? "Time's up" : "Run ended"}</p>
        <p className="text-5xl font-semibold tabular">{result.score}</p>
        <p className="text-sm text-muted-foreground">
          {`${result.clearedColumns} ${result.clearedColumns === 1 ? "board" : "boards"} solved.`}
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Duration</dt>
          <dd className="font-semibold tabular">{formatSeconds(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Boards solved</dt>
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
          ? "Verified by replaying your path on the server, then saved to the leaderboard."
          : "Verified by replaying your path on the server. This was a guest run, so it is not on the leaderboard."}
        {result.duplicate && " This run was already recorded, so nothing was counted twice."}
      </p>

      <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
        <Button variant="play" size="lg" onClick={onRestart} autoFocus>
          <RotateCcw />
          Play again
        </Button>
        <Button asChild variant="secondary" size="lg">
          <Link to="/leaderboards/$id" params={{ id: slug }}>
            See the leaderboard
          </Link>
        </Button>
        {!result.ranked && (
          <Button asChild variant="ghost" size="lg">
            <Link to="/login" search={{ redirect: `/games/${slug}` }}>
              Sign in to rank your scores
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

/** Milliseconds as `m:ss`, rounded up so the last second shows as 0:01. */
function formatSeconds(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
