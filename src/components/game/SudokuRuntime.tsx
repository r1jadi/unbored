import {
  Eraser,
  Grid3x3,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Trophy,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { ErrorState } from "@/components/common";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { GameExits } from "@/components/game/GameExits";
import { HintButton } from "@/components/game/Hint";
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
import { sudokuHint, sudokuRight } from "@/lib/games/hints";
import { levelUpHold, useLevelUp } from "@/lib/games/level-up";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useSudokuRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import {
  board as drawBoard,
  budgetMs,
  conflicts,
  EMPTY,
  givenCount,
  peers,
  SUDOKU_BONUS_MS,
  SUDOKU_BOX,
  SUDOKU_POINTS_PER_BOARD,
  SUDOKU_SIDE,
  type SudokuRun,
} from "@/lib/games/sudoku";
import { useHint } from "@/lib/games/use-hint";

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES["sudoku"];

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/**
 * Sudoku, playing for real.
 *
 * The board is a view onto `useSudokuRun`, which owns the lifecycle and the
 * clock: the rules first, a session issued when the player presses Start, boards
 * drawn from its seed, and the score the server derived from the submitted
 * moves. Nothing here decides a number.
 *
 * Pick a cell, then a digit — on the pad or the keyboard. Which cell is picked,
 * the highlights and the red marks on clashing digits are display: the moves are
 * the run.
 */
export function SudokuRuntime({
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
  const state = useSudokuRun(slug, autoStart);

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
        onPlace={state.place}
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
          <Grid3x3 className="size-5 text-muted-foreground" />
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
const BOX_EDGE = "color-mix(in oklch, var(--foreground) 40%, transparent)";

/** The first empty cell of a board, or the first cell when none is empty. */
function firstEmpty(cells: readonly number[]): number {
  return Math.max(0, cells.indexOf(EMPTY));
}

/** The live run: one board at a time, against the clock. */
function Board({
  run,
  session,
  deadline,
  verifying,
  onPlace,
  onFinish,
}: {
  run: SudokuRun;
  session: PlaySession;
  deadline: number;
  verifying: boolean;
  onPlace: (cell: number, digit: number) => void;
  onFinish: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState(() => firstEmpty(run.cells));
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const drawn = useMemo(() => drawBoard(run.seed, run.level), [run.seed, run.level]);

  // A new board starts with the selection on its first empty cell.
  useEffect(() => {
    setSelected(firstEmpty(drawn.start));
  }, [drawn]);

  // A solved board gets a beat before the next one. It is short: the clock keeps
  // running, on the server as well as here. The givens stop shrinking at thirty,
  // which is worth saying once.
  const fewest = run.level > 1 && givenCount(run.level) === 30 && givenCount(run.level - 1) > 30;
  const levelUp = useLevelUp(run.level, run.score, levelUpHold(fewest));
  const accepting = !verifying && run.outcome === "playing" && !levelUp;

  useReportRunProgress(accepting, onFinish);

  // Focus lands on the board once, on mount: later focus follows the player.
  const firstFocus = useRef(selected);
  useEffect(() => {
    cellRefs.current[firstFocus.current]?.focus();
  }, []);

  useEffect(() => {
    if (!accepting) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [accepting]);

  // A right move is one more of the player's digits that clashes with nothing.
  const hints = useHint({
    progress: `${run.level}:${sudokuRight(run)}`,
    active: accepting,
    compute: () => sudokuHint(run),
  });

  const clashes = conflicts(run.cells);
  const empty = run.cells.filter((value) => value === EMPTY).length;
  const remaining = Math.max(0, deadline - now);
  const earned = budgetMs(run.levelsCleared);
  const selectedGiven = drawn.start[selected] !== EMPTY;
  const selectedDigit = run.cells[selected];
  const related = useMemo(() => new Set(peers(selected)), [selected]);
  const placed = DIGITS.map((digit) => run.cells.filter((value) => value === digit).length);

  function select(cell: number, focus = false) {
    setSelected(cell);
    if (focus) cellRefs.current[cell]?.focus();
  }

  function put(digit: number) {
    if (!accepting || selectedGiven) return;
    onPlace(selected, digit);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const row = Math.floor(selected / SUDOKU_SIDE);
    const column = selected % SUDOKU_SIDE;
    const move: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (event.key in move) {
      event.preventDefault();
      const [dr, dc] = move[event.key];
      const nextRow = (row + dr + SUDOKU_SIDE) % SUDOKU_SIDE;
      const nextColumn = (column + dc + SUDOKU_SIDE) % SUDOKU_SIDE;
      select(nextRow * SUDOKU_SIDE + nextColumn, true);
    } else if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      put(Number(event.key));
    } else if (event.key === "0" || event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      put(EMPTY);
    }
  }

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
        {hints.hint
          ? `Hint: row ${Math.floor(hints.hint.cell / SUDOKU_SIDE) + 1}, column ${
              (hints.hint.cell % SUDOKU_SIDE) + 1
            } ${hints.hint.fix ? "should be" : "takes"} a ${hints.hint.digit}.`
          : statusLine(run, verifying, clashes.size > 0)}
      </p>

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
              remaining < 30_000 ? "bg-destructive" : "bg-primary",
            )}
            style={{ width: `${Math.min(100, (remaining / earned) * 100)}%` }}
          />
        </div>
        <span className={cn("tabular", remaining < 30_000 && "text-destructive")}>
          {formatSeconds(remaining)}
        </span>
      </div>

      {/* A square board, centred in whatever space is left: the smaller of the
          column and the viewport height minus the chrome and the number pad. */}
      <div className="flex min-h-0 flex-1 items-center justify-center py-2">
        <div className="flex max-h-full w-full justify-center">
          <div
            className="relative grid aspect-square w-full overflow-hidden rounded-lg border-2 bg-surface"
            style={{
              borderColor: BOX_EDGE,
              maxWidth: "min(30rem, calc(100dvh - 21rem))",
              gridTemplateColumns: `repeat(${SUDOKU_SIDE}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${SUDOKU_SIDE}, minmax(0, 1fr))`,
            }}
            role="group"
            aria-label={`Board ${run.level}, ${SUDOKU_SIDE} by ${SUDOKU_SIDE}`}
            onKeyDown={onKeyDown}
          >
            {run.cells.map((value, index) => {
              const row = Math.floor(index / SUDOKU_SIDE);
              const column = index % SUDOKU_SIDE;
              const given = drawn.start[index] !== EMPTY;
              const clash = clashes.has(index);
              const isSelected = index === selected;
              const hinted = hints.hint?.cell === index;
              const sameDigit = value !== EMPTY && value === selectedDigit && !isSelected;
              return (
                <button
                  key={index}
                  ref={(element) => {
                    cellRefs.current[index] = element;
                  }}
                  type="button"
                  tabIndex={isSelected ? 0 : -1}
                  disabled={!accepting}
                  aria-pressed={isSelected}
                  onClick={() => select(index)}
                  aria-label={cellLabel(row, column, value, given, clash)}
                  style={{
                    borderRightWidth:
                      column < SUDOKU_SIDE - 1 ? ((column + 1) % SUDOKU_BOX === 0 ? 2 : 1) : 0,
                    borderBottomWidth:
                      row < SUDOKU_SIDE - 1 ? ((row + 1) % SUDOKU_BOX === 0 ? 2 : 1) : 0,
                    borderRightColor: (column + 1) % SUDOKU_BOX === 0 ? BOX_EDGE : CELL_EDGE,
                    borderBottomColor: (row + 1) % SUDOKU_BOX === 0 ? BOX_EDGE : CELL_EDGE,
                  }}
                  className={cn(
                    "flex items-center justify-center border-solid text-[clamp(0.95rem,4.6vmin,1.6rem)] leading-none tabular transition-colors",
                    "motion-reduce:transition-none",
                    "focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    given ? "font-semibold text-foreground" : "font-medium text-primary",
                    related.has(index) ? "bg-surface-2" : "bg-surface",
                    sameDigit && "bg-primary/15",
                    isSelected && "bg-primary/25",
                    clash && "bg-destructive/15 text-destructive",
                    hinted && "animate-pulse ring-2 ring-inset ring-primary",
                  )}
                >
                  {value !== EMPTY ? value : ""}
                </button>
              );
            })}

            {levelUp && (
              <LevelUpOverlay
                levelUp={levelUp}
                unit="Board"
                next={`Board ${run.level} · ${givenCount(run.level)} cells to start · clock +${
                  SUDOKU_BONUS_MS / 60_000
                } min`}
                note={fewest ? "Boards start with thirty cells from here." : undefined}
              />
            )}
          </div>
        </div>
      </div>

      {/* The number pad: a digit goes in the selected cell. The small count is how
          many of that digit are still to place. */}
      <div
        className="mx-auto grid w-full max-w-md grid-cols-9 gap-1 pt-1"
        role="group"
        aria-label="Numbers"
      >
        {DIGITS.map((digit, index) => {
          const left = SUDOKU_SIDE - placed[index];
          return (
            <Button
              key={digit}
              type="button"
              variant="secondary"
              disabled={!accepting || selectedGiven}
              onClick={() => put(digit)}
              aria-label={`Place ${digit}, ${left} left`}
              className={cn(
                "flex h-12 flex-col gap-0 px-0 text-lg font-semibold tabular",
                left <= 0 && "opacity-50",
              )}
            >
              {digit}
              <span aria-hidden className="text-[0.6rem] font-normal text-muted-foreground">
                {Math.max(0, left)}
              </span>
            </Button>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-2 pt-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={!accepting || selectedGiven || selectedDigit === EMPTY}
          onClick={() => put(EMPTY)}
        >
          <Eraser />
          Erase
        </Button>
        <HintButton offered={hints.offered} waitSeconds={hints.waitSeconds} onAsk={hints.ask} />
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
function statusLine(run: SudokuRun, verifying: boolean, clashing: boolean): string {
  if (verifying) return "Verifying your run with the server…";
  if (run.outcome === "over") return run.ending === "time" ? "Time's up." : "Run ended.";
  if (clashing) return "Something clashes: a red digit repeats in its row, column or box.";
  const start = drawBoard(run.seed, run.level).start;
  if (run.levelsCleared > 0 && run.cells.every((value, cell) => value === start[cell])) {
    return `Board ${run.level - 1} solved, +${SUDOKU_POINTS_PER_BOARD}. Board ${run.level} starts with ${givenCount(run.level)} cells.`;
  }
  return `Board ${run.level} — 1 to 9 in every row, column and box.`;
}

/** The accessible name of a cell: where it is, and what it holds. */
function cellLabel(
  row: number,
  column: number,
  value: number,
  given: boolean,
  clash: boolean,
): string {
  return `Row ${row + 1} column ${column + 1}, ${value === EMPTY ? "empty" : value}${
    given ? ", fixed" : ""
  }${clash ? ", repeats" : ""}`;
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
          {`${result.tilesPlaced} ${result.tilesPlaced === 1 ? "move" : "moves"}, ${
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
          ? "Verified by replaying your moves on the server, then saved to the leaderboard."
          : "Verified by replaying your moves on the server. This was a guest run, so it is not on the leaderboard."}
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
