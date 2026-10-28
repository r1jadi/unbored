import {
  Eraser,
  Grid3x3,
  Loader2,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Trophy,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";

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
  peers,
  SUDOKU_BOX,
  SUDOKU_POINTS_PER_BOARD,
  SUDOKU_SIDE,
  allowanceMs,
  tierOf,
  unitsOf,
  type SudokuDigit,
  type SudokuRun,
  type SudokuTier,
} from "@/lib/games/sudoku";
import {
  emptyNotesState,
  notedDigits,
  notesReducer,
  type SudokuNotesState,
} from "@/lib/games/sudoku-notes";
import { useHint } from "@/lib/games/use-hint";
import { useSettledClashes } from "@/lib/games/use-settled-clashes";

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES["sudoku"];

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** What a step up to a harder tier asks of the player, said once. */
const TIER_NOTES: Record<SudokuTier, string | undefined> = {
  gentle: undefined,
  easy: "From here, look along rows and columns too, not just boxes.",
  medium: "From here, boards need more than singles: pencil notes help.",
  hard: "Hard boards from here: fewer clues, and more pairs to find.",
};

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
        run={state.run}
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
  // Pencil notes, and whether the pad writes notes instead of digits. Both are
  // the player's working: nothing here is a move.
  const [{ notes, history }, dispatchNotes] = useReducer(notesReducer, undefined, emptyNotesState);
  // The latest notes state, for Undo to read the step it takes back even when
  // two presses land before a render.
  const latestNotes = useRef<SudokuNotesState>({ notes, history });
  useEffect(() => {
    latestNotes.current = { notes, history };
  });
  const [notesMode, setNotesMode] = useState(false);

  const drawn = useMemo(() => drawBoard(run.seed, run.level), [run.seed, run.level]);

  // A new board starts with the selection on its first empty cell, no notes and
  // nothing to undo.
  useEffect(() => {
    setSelected(firstEmpty(drawn.start));
    dispatchNotes({ type: "reset" });
    latestNotes.current = emptyNotesState();
  }, [drawn]);

  // A solved board gets a beat before the next one. It is short: the clock keeps
  // running, on the server as well as here. A step up to a harder tier is worth
  // saying once, and what it asks of the player.
  const steppedUp = run.level > 1 && tierOf(run.level) !== tierOf(run.level - 1);
  const levelUp = useLevelUp(run.level, run.score, levelUpHold(steppedUp));
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

  const clashes = useSettledClashes(conflicts(run.cells));
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

  /**
   * A digit from the pad or the keyboard, 0 for Erase. In notes mode a digit
   * notes or un-notes a candidate in an empty cell; otherwise it is placed, which
   * also tidies the notes it rules out. Erase on an empty cell clears its notes.
   */
  function put(digit: number) {
    if (!accepting || selectedGiven) return;
    if (notesMode && digit !== EMPTY) {
      if (selectedDigit !== EMPTY) return;
      dispatchNotes({ type: "toggle", cell: selected, digit });
      return;
    }
    if (digit === EMPTY && selectedDigit === EMPTY) {
      dispatchNotes({ type: "clear", cell: selected });
      return;
    }
    if (digit === selectedDigit) return;
    dispatchNotes({ type: "place", cell: selected, digit, previous: selectedDigit });
    onPlace(selected, digit);
  }

  /**
   * Steps back once: the notes return to what they were, and a placed digit is
   * replaced by what the cell held — which is itself a move, sent like any other.
   */
  function undo() {
    const current = latestNotes.current;
    const step = current.history[current.history.length - 1];
    if (!accepting || !step) return;
    latestNotes.current = notesReducer(current, { type: "undo" });
    dispatchNotes({ type: "undo" });
    if (step.cell !== undefined && run.cells[step.cell] !== step.previous) {
      onPlace(step.cell, step.previous ?? EMPTY);
      select(step.cell, true);
    }
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
    } else if (event.key === "n" || event.key === "N") {
      event.preventDefault();
      setNotesMode((on) => !on);
    } else if (event.key.toLowerCase() === "z" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      undo();
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
              maxWidth: `min(30rem, calc(100dvh - ${hints.hint ? 26 : 23.5}rem))`,
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
                  aria-label={cellLabel(row, column, value, given, clash, notes[index])}
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
                  {value !== EMPTY ? (
                    value
                  ) : notes[index] ? (
                    <span
                      aria-hidden
                      className="grid size-full grid-cols-3 grid-rows-3 p-[6%] text-[clamp(0.45rem,1.7vmin,0.65rem)] font-medium leading-none text-muted-foreground"
                    >
                      {DIGITS.map((digit) => (
                        <span key={digit} className="flex items-center justify-center">
                          {notes[index] & (1 << digit) ? digit : ""}
                        </span>
                      ))}
                    </span>
                  ) : (
                    ""
                  )}
                </button>
              );
            })}

            {levelUp && (
              <LevelUpOverlay
                levelUp={levelUp}
                unit="Board"
                next={`Board ${run.level} · ${tierOf(run.level)} · clock +${
                  allowanceMs(run.level) / 60_000
                } min`}
                note={steppedUp ? TIER_NOTES[tierOf(run.level)] : undefined}
              />
            )}
          </div>
        </div>
      </div>

      {/* The tools: Undo, Notes (the pad writes notes while it is on) and Erase. */}
      <div className="mx-auto grid w-full max-w-md grid-cols-3 gap-1 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!accepting || history.length === 0}
          onClick={undo}
        >
          <Undo2 />
          Undo
        </Button>
        <Button
          type="button"
          variant={notesMode ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={notesMode}
          disabled={!accepting}
          onClick={() => setNotesMode((on) => !on)}
          className={cn(notesMode && "text-primary")}
        >
          <Pencil />
          {notesMode ? "Notes on" : "Notes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!accepting || selectedGiven || (selectedDigit === EMPTY && !notes[selected])}
          onClick={() => put(EMPTY)}
        >
          <Eraser />
          Erase
        </Button>
      </div>

      {/* The number pad: a digit goes in the selected cell, or into its notes. The
          small count is how many of that digit are still to place. */}
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
              aria-label={notesMode ? `Note ${digit}` : `Place ${digit}, ${left} left`}
              className={cn(
                "flex h-12 flex-col gap-0 px-0 text-lg font-semibold tabular",
                notesMode && "text-primary",
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
    return `Board ${run.level - 1} solved, +${SUDOKU_POINTS_PER_BOARD}. Board ${run.level} is ${tierOf(run.level)}.`;
  }
  return `Board ${run.level}, ${tierOf(run.level)} — 1 to 9 in every row, column and box.`;
}

/** The accessible name of a cell: where it is, what it holds, and its notes. */
function cellLabel(
  row: number,
  column: number,
  value: number,
  given: boolean,
  clash: boolean,
  noted: number,
): string {
  const notesText = value === EMPTY && noted ? `, notes ${notedDigits(noted).join(" ")}` : "";
  return `Row ${row + 1} column ${column + 1}, ${value === EMPTY ? "empty" : value}${
    given ? ", fixed" : ""
  }${clash ? ", repeats" : ""}${notesText}`;
}

/** The end of a run: the score the server verified, or a guest's unranked result. */
function Finished({
  slug,
  run,
  result,
  outOfTime,
  onRestart,
}: {
  slug: string;
  run: SudokuRun;
  result: RunResult;
  outOfTime: boolean;
  onRestart: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] text-center">
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

      <BoardReview run={run} />

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

/** One wrong digit on the board the run ended on, and why it was wrong. */
type Mistake = { cell: number; placed: SudokuDigit; answer: SudokuDigit; reason: string };

function where(cell: number): string {
  return `Row ${Math.floor(cell / SUDOKU_SIDE) + 1}, column ${(cell % SUDOKU_SIDE) + 1}`;
}

/** The wrong digits on a board, each with the rule it broke or the digit it needed. */
function boardMistakes(
  cells: readonly SudokuDigit[],
  start: readonly SudokuDigit[],
  solution: readonly SudokuDigit[],
): Mistake[] {
  const mistakes: Mistake[] = [];
  cells.forEach((placed, cell) => {
    if (placed === EMPTY || start[cell] !== EMPTY || placed === solution[cell]) return;
    const answer = solution[cell];
    const units = unitsOf(cell);
    const clash = (["row", "column", "box"] as const).find((name) =>
      units[name].some((other) => other !== cell && cells[other] === placed),
    );
    mistakes.push({
      cell,
      placed,
      answer,
      reason: clash
        ? `${where(cell)}: your ${placed} repeats the ${placed} already in that ${clash}. It needed a ${answer}.`
        : `${where(cell)}: a ${placed} fit for the moment, but the board's only solution has a ${answer} there, so the ${placed} would have blocked it later.`,
    });
  });
  return mistakes;
}

/**
 * The board the run ended on, checked against its one solution: the digits the
 * player got right, the ones they got wrong (struck through, with the right one
 * beside them, and why), and the rest of the board filled in faintly.
 */
function BoardReview({ run }: { run: SudokuRun }) {
  const drawn = useMemo(() => drawBoard(run.seed, run.level), [run.seed, run.level]);
  const mistakes = useMemo(
    () => boardMistakes(run.cells, drawn.start, drawn.solution),
    [run.cells, drawn],
  );
  const wrong = new Map(mistakes.map((mistake) => [mistake.cell, mistake]));
  const open = run.cells.filter((value) => value === EMPTY).length;
  const shown = mistakes.slice(0, 4);

  let summary: string;
  if (mistakes.length > 0) {
    const empties = open ? ` and ${open} ${open === 1 ? "square" : "squares"} still empty` : "";
    summary = `${mistakes.length} wrong ${mistakes.length === 1 ? "digit" : "digits"}${empties}. A wrong digit doesn't end the run, but it hides the right answer and costs you time.`;
  } else if (open) {
    summary = `No mistakes: ${open} ${open === 1 ? "square was" : "squares were"} still empty when the run ended. Here is the rest of the board.`;
  } else {
    summary = "Everything you placed was right.";
  }

  return (
    <section
      className="enter mx-auto w-full max-w-sm space-y-3 text-left"
      aria-label="Your last board"
    >
      <h2 className="text-center text-base font-semibold">
        {mistakes.length > 0
          ? `Where board ${run.level} went wrong`
          : `Board ${run.level}, checked`}
      </h2>
      <p className="text-center text-xs text-muted-foreground">{summary}</p>
      <div
        className="mx-auto grid aspect-square w-full max-w-[18rem] overflow-hidden rounded-lg border-2 bg-surface"
        style={{
          borderColor: BOX_EDGE,
          gridTemplateColumns: `repeat(${SUDOKU_SIDE}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${SUDOKU_SIDE}, minmax(0, 1fr))`,
        }}
        role="img"
        aria-label={`Board ${run.level} checked against its solution. ${summary} ${mistakes
          .map((mistake) => mistake.reason)
          .join(" ")}`}
      >
        {run.cells.map((value, index) => {
          const row = Math.floor(index / SUDOKU_SIDE);
          const column = index % SUDOKU_SIDE;
          const given = drawn.start[index] !== EMPTY;
          const mistake = wrong.get(index);
          const missing = value === EMPTY;
          return (
            <div
              key={index}
              style={{
                borderRightWidth:
                  column < SUDOKU_SIDE - 1 ? ((column + 1) % SUDOKU_BOX === 0 ? 2 : 1) : 0,
                borderBottomWidth:
                  row < SUDOKU_SIDE - 1 ? ((row + 1) % SUDOKU_BOX === 0 ? 2 : 1) : 0,
                borderRightColor: (column + 1) % SUDOKU_BOX === 0 ? BOX_EDGE : CELL_EDGE,
                borderBottomColor: (row + 1) % SUDOKU_BOX === 0 ? BOX_EDGE : CELL_EDGE,
              }}
              className={cn(
                "relative flex items-center justify-center border-solid text-sm leading-none tabular",
                given && "font-semibold text-foreground",
                !given && !missing && !mistake && "font-medium text-primary",
                mistake && "bg-destructive/15 font-semibold text-destructive",
                missing && "text-muted-foreground/60",
              )}
            >
              {mistake ? mistake.answer : missing ? drawn.solution[index] : value}
              {mistake && (
                <span className="absolute top-[6%] right-[10%] text-[0.55rem] leading-none text-destructive/80 line-through">
                  {mistake.placed}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[0.7rem] text-muted-foreground">
        <span className="text-primary">Yours, right</span>
        <span className="text-destructive">Wrong (yours struck through)</span>
        <span>Faint: not filled in</span>
      </p>
      {shown.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {shown.map((mistake) => (
            <li key={mistake.cell} className="rounded-lg bg-surface px-3 py-2">
              {mistake.reason}
            </li>
          ))}
          {mistakes.length > shown.length && (
            <li className="text-center text-xs text-muted-foreground">
              {`…and ${mistakes.length - shown.length} more, marked in red above.`}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/** Milliseconds as `m:ss`, rounded up so the last second shows as 0:01. */
function formatSeconds(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
