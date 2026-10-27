import {
  Loader2,
  Moon,
  RotateCcw,
  ShieldCheck,
  Sun,
  SunMoon,
  Trophy,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ErrorState } from "@/components/common";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { GameExits } from "@/components/game/GameExits";
import { HintButton, HintNote } from "@/components/game/Hint";
import { LevelUpOverlay } from "@/components/game/LevelUp";
import { RulesList } from "@/components/game/RulesList";
import { RunEndActions } from "@/components/game/RunEndActions";
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
import { tangoHint, tangoRight } from "@/lib/games/hints";
import { levelUpHold, useLevelUp } from "@/lib/games/level-up";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useTangoRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import {
  board as drawBoard,
  budgetMs,
  conflicts,
  EMPTY,
  givenCount,
  MOON,
  SUN,
  TANGO_BONUS_MS,
  TANGO_SIDE,
  type TangoRun,
  type TangoValue,
} from "@/lib/games/tango";
import { useHint } from "@/lib/games/use-hint";
import { useSettledClashes } from "@/lib/games/use-settled-clashes";

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES["tango"];

/**
 * Sun & Moon, playing for real.
 *
 * The board is a view onto `useTangoRun`, which owns the lifecycle and the clock:
 * the rules first, a session issued when the player presses Start, boards drawn
 * from its seed, and the score the server derived from the submitted taps.
 * Nothing here decides a number.
 *
 * Tap a cell for a sun, again for a moon, once more to clear it. The signs and
 * the red marks on clashing cells are display: the taps are the run.
 */
export function TangoRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  // Tap to play skips the rules, on the first run and on Play again.
  const state = useTangoRun(slug, autoStart);

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
        <GameExits slug={slug} title={title} />
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
          a timed run has to reach the server soon after its clock runs out.
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
          <SunMoon className="size-5 text-muted-foreground" />
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
  run: TangoRun;
  session: PlaySession;
  deadline: number;
  verifying: boolean;
  onTap: (cell: number) => void;
  onFinish: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const firstCell = useRef<HTMLButtonElement>(null);

  const drawn = useMemo(() => drawBoard(run.seed, run.level), [run.seed, run.level]);

  // A solved board gets a beat before the next one. It is short: the clock keeps
  // running, on the server as well as here. The givens stop shrinking at three,
  // which is worth saying once.
  const fewest = run.level > 1 && givenCount(run.level) === 3 && givenCount(run.level - 1) > 3;
  const levelUp = useLevelUp(run.level, run.score, levelUpHold(fewest));
  const accepting = !verifying && run.outcome === "playing" && !levelUp;

  useReportRunProgress(accepting, onFinish);

  useEffect(() => {
    firstCell.current?.focus();
  }, []);

  useEffect(() => {
    if (!accepting) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [accepting]);

  // A right move is one more of the player's cells matching the solution.
  const hints = useHint({
    progress: `${run.level}:${tangoRight(run)}`,
    active: accepting,
    compute: () => tangoHint(run),
  });

  const clashes = useSettledClashes(conflicts(run.cells, drawn.signs));
  const empty = run.cells.filter((value) => value === EMPTY).length;
  const remaining = Math.max(0, deadline - now);
  const earned = budgetMs(run.levelsCleared);

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

      {hints.hint ? (
        <HintNote reason={hints.hint.reason} className="my-0.5" />
      ) : (
        <p className="py-1 text-center text-sm text-muted-foreground" aria-live="polite">
          {statusLine(run, verifying, clashes.size > 0)}
        </p>
      )}

      <div className="mx-auto flex w-full max-w-md items-center gap-3 pb-1 text-xs text-muted-foreground">
        <span className="tabular">
          {empty} {empty === 1 ? "cell" : "cells"} left
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

      {/* A square board, centred in whatever space is left, sized like the other
          grids: the smaller of the column and the viewport height minus the
          chrome. The grid has no gaps, so a sign can sit exactly on the edge
          between its two cells. */}
      <div className="flex min-h-0 flex-1 items-center justify-center py-3">
        <div className="flex max-h-full w-full justify-center">
          <div
            className="relative grid aspect-square w-full overflow-hidden rounded-lg border bg-surface"
            style={{
              borderColor: CELL_EDGE,
              maxWidth: `min(30rem, calc(100dvh - ${hints.hint ? 18.5 : 16}rem))`,
              gridTemplateColumns: `repeat(${TANGO_SIDE}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${TANGO_SIDE}, minmax(0, 1fr))`,
            }}
            role="group"
            aria-label={`Board ${run.level}, ${TANGO_SIDE} by ${TANGO_SIDE}`}
          >
            {run.cells.map((value, index) => {
              const row = Math.floor(index / TANGO_SIDE);
              const column = index % TANGO_SIDE;
              const given = drawn.start[index] !== EMPTY;
              const clash = clashes.has(index);
              const hinted = hints.hint?.cell === index ? hints.hint : null;
              return (
                <button
                  key={index}
                  ref={index === 0 ? firstCell : undefined}
                  type="button"
                  disabled={!accepting || given}
                  onClick={() => onTap(index)}
                  aria-label={`${cellLabel(row, column, value, given, clash, run, verifying)}${
                    hinted
                      ? ` Hint: ${hinted.fix ? "this should be" : "this is"} a ${
                          hinted.value === SUN ? "sun" : "moon"
                        }.`
                      : ""
                  }`}
                  style={{
                    borderRightWidth: column < TANGO_SIDE - 1 ? 1 : 0,
                    borderBottomWidth: row < TANGO_SIDE - 1 ? 1 : 0,
                    borderColor: CELL_EDGE,
                  }}
                  className={cn(
                    "flex items-center justify-center border-solid p-[8%] transition-colors",
                    "motion-reduce:transition-none",
                    "focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    given ? "bg-surface-2" : "bg-surface",
                    clash && "bg-destructive/15",
                    accepting && !given && "hover:bg-surface-2",
                    hinted && "animate-pulse ring-2 ring-inset ring-primary",
                  )}
                >
                  <Symbol value={value} given={given} />
                </button>
              );
            })}

            {/* The signs, on the edge between their two cells. */}
            {drawn.signs.map((sign) => {
              const across = sign.b === sign.a + 1;
              const row = Math.floor(sign.a / TANGO_SIDE);
              const column = sign.a % TANGO_SIDE;
              const x = ((across ? column + 1 : column + 0.5) / TANGO_SIDE) * 100;
              const y = ((across ? row + 0.5 : row + 1) / TANGO_SIDE) * 100;
              return (
                <span
                  key={`${sign.a}-${sign.b}`}
                  aria-hidden
                  className="pointer-events-none absolute z-10 flex size-[7%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-background text-[clamp(0.6rem,2.6vmin,0.9rem)] font-semibold leading-none text-muted-foreground"
                  style={{ left: `${x}%`, top: `${y}%`, borderColor: CELL_EDGE }}
                >
                  {sign.same ? "=" : "×"}
                </span>
              );
            })}

            {levelUp && (
              <LevelUpOverlay
                levelUp={levelUp}
                unit="Board"
                next={`Board ${run.level} · ${givenCount(run.level)} cells to start · clock +${
                  TANGO_BONUS_MS / 1000
                } s`}
                note={fewest ? "Boards start with three cells from here." : undefined}
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 pt-1">
        <HintButton offered={hints.offered} waitSeconds={hints.waitSeconds} onAsk={hints.ask} />
        <p className="text-center text-xs text-muted-foreground" aria-live="polite">
          {verifying
            ? "The taps you made are your score if the server agrees."
            : `Tap for a sun, again for a moon. A solved board adds ${TANGO_BONUS_MS / 1000} seconds.`}
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

/** A sun or a moon, drawn a little quieter when the cell started filled. */
function Symbol({ value, given }: { value: TangoValue; given: boolean }) {
  if (value === SUN) {
    return (
      <Sun
        className={cn("size-[62%] fill-current text-game-4", given && "opacity-80")}
        strokeWidth={2}
      />
    );
  }
  if (value === MOON) {
    return (
      <Moon
        className={cn("size-[56%] fill-current text-game-1", given && "opacity-80")}
        strokeWidth={2}
      />
    );
  }
  return null;
}

/** The line above the board: what just happened, or what to do. */
function statusLine(run: TangoRun, verifying: boolean, clashing: boolean): string {
  if (verifying) return "Verifying your run with the server…";
  if (run.outcome === "over") return run.ending === "time" ? "Time's up." : "Run ended.";
  if (clashing) return "Something clashes: the red cells break a rule.";
  const start = drawBoardStart(run);
  if (run.levelsCleared > 0 && run.cells.every((value, cell) => value === start[cell])) {
    return `Board ${run.level - 1} solved, +60. Board ${run.level} starts with ${givenCount(run.level)} cells.`;
  }
  return `Board ${run.level} — three suns and three moons in every line.`;
}

function drawBoardStart(run: TangoRun): readonly TangoValue[] {
  return drawBoard(run.seed, run.level).start;
}

/** The accessible name of a cell: where it is, what it holds, and what a tap does. */
function cellLabel(
  row: number,
  column: number,
  value: TangoValue,
  given: boolean,
  clash: boolean,
  run: TangoRun,
  verifying: boolean,
): string {
  const contents = value === SUN ? "sun" : value === MOON ? "moon" : "empty";
  const position = `Row ${row + 1} column ${column + 1}, ${contents}${given ? ", fixed" : ""}${
    clash ? ", breaks a rule" : ""
  }`;
  if (verifying) return `${position}. The run is being verified.`;
  if (run.outcome !== "playing" || given) return `${position}.`;
  const next = value === EMPTY ? "place a sun" : value === SUN ? "make it a moon" : "clear it";
  return `${position}. Tap to ${next}.`;
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
          {`${result.tilesPlaced} ${result.tilesPlaced === 1 ? "tap" : "taps"}, ${
            result.clearedColumns
          } ${result.clearedColumns === 1 ? "board" : "boards"} solved.`}
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
          ? "Verified by replaying your taps on the server, then saved to the leaderboard."
          : "Verified by replaying your taps on the server. This was a guest run, so it is not on the leaderboard."}
        {result.duplicate && " This run was already recorded, so nothing was counted twice."}
      </p>

      <RunEndActions slug={slug} ranked={result.ranked} onRestart={onRestart} autoFocus />
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
