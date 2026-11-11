import {
  Eraser,
  Sigma,
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
import { BestScore } from "@/components/game/BestScore";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { GameExits } from "@/components/game/GameExits";
import { HintButton, HintNote } from "@/components/game/Hint";
import { LevelUpOverlay } from "@/components/game/LevelUp";
import { RulesList } from "@/components/game/RulesList";
import { SpeedBonusStat, SpeedMeter } from "@/components/game/SpeedMeter";
import { RunEndActions } from "@/components/game/RunEndActions";
import { SavedRunCard } from "@/components/game/SavedRunCard";
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
import { sumdokuHint, sumdokuRight } from "@/lib/games/sumdoku-hints";
import { levelUpHold, useLevelUp } from "@/lib/games/level-up";
import { GAME_RULES } from "@/lib/games/rules";
import { endRunMessage, useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useSumdokuRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import {
  board as drawBoard,
  cageSum,
  parMs,
  conflicts,
  EMPTY,
  SUMDOKU_BOX_COLS,
  SUMDOKU_BOX_ROWS,
  SUMDOKU_POINTS_PER_BOARD,
  SUMDOKU_SIDE,
  peers,
  tierOf,
  unitsOf,
  type SumdokuBoard,
  type SumdokuDigit,
  type SumdokuRun,
  type SumdokuTier,
} from "@/lib/games/sumdoku";
import {
  emptyNotesState,
  notedDigits,
  notesReducer,
  type MiniSudokuNotesState as SumdokuNotesState,
} from "@/lib/games/mini-sudoku-notes";
import { useHint } from "@/lib/games/use-hint";
import { useSettledClashes } from "@/lib/games/use-settled-clashes";
import { points } from "@/lib/format";
import { useGameSounds } from "@/lib/sound";
import { offlineResultNote } from "@/lib/games/offline";

import { t, msg } from "@/lib/settings/language";
/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES["sumdoku"];

const DIGITS = [1, 2, 3, 4, 5, 6] as const;

/** What a step up to a harder tier asks of the player, said once. */
const TIER_NOTES: Record<SumdokuTier, string | undefined> = {
  gentle: undefined,
  easy: msg("Fewer digits given from here: let the cage totals do the work."),
  medium: msg(
    "No digits given from here: only the sums. A cage of two adding to 3 can only be 1 and 2.",
  ),
  hard: msg("Hard boards from here: bigger cages. Pencil notes help."),
};

/**
 * Sumdoku, playing for real.
 *
 * The board is a view onto `useSumdokuRun`, which owns the lifecycle and the
 * clock: the rules first, a session issued when the player presses Start, boards
 * drawn from its seed, and the score the server derived from the submitted
 * moves. Nothing here decides a number.
 *
 * Pick a cell, then a digit — on the pad or the keyboard. Which cell is picked,
 * the highlights and the red marks on clashing digits are display: the moves are
 * the run.
 */
export function SumdokuRuntime({
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
  const state = useSumdokuRun(slug, autoStart);

  if (state.status === "saved") {
    return (
      <SavedRunCard
        score={state.run.score}
        where={t("Board {level}", { level: state.run.level })}
        onContinue={state.continueRun}
        onNewRun={state.newRun}
        slug={slug}
        title={title}
      />
    );
  }

  if (state.status === "intro") {
    return <Intro signedIn={state.signedIn} onBegin={state.begin} slug={slug} title={title} />;
  }

  if (state.status === "starting") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("Starting a run…")}</p>
      </div>
    );
  }

  if (state.status === "error" && state.stage === "start") {
    return (
      <div className="flex flex-1 flex-col justify-center px-6">
        <ErrorState
          title={t("Couldn't start a run")}
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
        <h2 className="text-xl font-semibold">{t("Your run was not verified")}</h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {t(
            "{error} Nothing was saved, and nothing needs to be — sending the same run again is safe.",
            { error: playErrorMessage(state.error) },
          )}
        </p>
        <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
          <Button variant="play" size="lg" onClick={state.retry}>
            {t("Try submitting again")}
          </Button>
          <Button variant="secondary" size="lg" onClick={state.restart}>
            <RotateCcw />
            {t("Start a new run")}
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
        startedAt={state.startedAt}
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
        played={state.run.score}
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
          <Sigma className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{t(RULES.heading)}</h1>
          <p className="text-sm text-muted-foreground">{t(RULES.summary)}</p>
        </div>

        <RulesList rules={RULES.rules} />

        <div className="flex w-full flex-col gap-2">
          <Button variant="play" size="lg" onClick={onBegin} autoFocus>
            {t("Start run")}
          </Button>
          <Button asChild variant="ghost" size="lg">
            <ExitGameLink slug={slug}>{t("Back to {title}", { title })}</ExitGameLink>
          </Button>
        </div>

        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          {signedIn
            ? t("Signed in: this run can be ranked")
            : t("Guest run: verified, but not ranked")}
        </p>
      </div>
    </div>
  );
}

const CELL_EDGE = "color-mix(in oklch, var(--foreground) 12%, transparent)";
const BOX_EDGE = "color-mix(in oklch, var(--foreground) 40%, transparent)";

const CAGE_EDGE = "color-mix(in oklch, var(--foreground) 62%, transparent)";
const CAGE_EDGE_ACTIVE = "var(--primary)";

/**
 * A cell's share of its cage: a dashed line along each side that borders another
 * cage, pulled in from the cell's edge so two cages side by side read as two, and
 * the cage's total in the corner of its first cell.
 */
function CageMarks({
  drawn,
  cell,
  active,
  small = false,
}: {
  drawn: SumdokuBoard;
  cell: number;
  active: boolean;
  small?: boolean;
}) {
  const row = Math.floor(cell / SUMDOKU_SIDE);
  const column = cell % SUMDOKU_SIDE;
  const cage = drawn.cageOf[cell];
  const same = (r: number, c: number) =>
    r >= 0 &&
    r < SUMDOKU_SIDE &&
    c >= 0 &&
    c < SUMDOKU_SIDE &&
    drawn.cageOf[r * SUMDOKU_SIDE + c] === cage;
  const top = !same(row - 1, column);
  const bottom = !same(row + 1, column);
  const left = !same(row, column - 1);
  const right = !same(row, column + 1);
  const inset = small ? "2px" : "3px";
  const colour = active ? CAGE_EDGE_ACTIVE : CAGE_EDGE;
  const line = `1.75px dashed ${colour}`;
  const first = drawn.cages[cage].cells[0] === cell;
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          top: top ? inset : "-1px",
          bottom: bottom ? inset : "-1px",
          left: left ? inset : "-1px",
          right: right ? inset : "-1px",
          borderTop: top ? line : undefined,
          borderBottom: bottom ? line : undefined,
          borderLeft: left ? line : undefined,
          borderRight: right ? line : undefined,
          borderTopLeftRadius: top && left ? "3px" : undefined,
          borderTopRightRadius: top && right ? "3px" : undefined,
          borderBottomLeftRadius: bottom && left ? "3px" : undefined,
          borderBottomRightRadius: bottom && right ? "3px" : undefined,
        }}
      />
      {first && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute z-[1] rounded-[2px] bg-inherit px-[1px] font-semibold leading-none tabular",
            small
              ? "top-[3px] left-[3px] text-[0.45rem]"
              : "top-[4px] left-[4px] text-[clamp(0.56rem,2.4vmin,0.75rem)]",
            active ? "text-primary" : "text-foreground/85",
          )}
        >
          {drawn.cages[cage].total}
        </span>
      )}
    </>
  );
}

/** The first empty cell of a board, or the first cell when none is empty. */
function firstEmpty(cells: readonly number[]): number {
  return Math.max(0, cells.indexOf(EMPTY));
}

/** The live run: one board at a time, with no clock to lose to. */
function Board({
  run,
  session,
  startedAt,
  verifying,
  onPlace,
  onFinish,
}: {
  run: SumdokuRun;
  session: PlaySession;
  /** When the run started, as a `Date.now()` timestamp. */
  startedAt: number;
  verifying: boolean;
  onPlace: (cell: number, digit: number) => void;
  onFinish: () => void;
}) {
  useGameSounds({
    moves: run.moves.length,
    score: run.score,
    cleared: run.levelsCleared,
    over: run.outcome === "over",
    ending: "stop",
  });
  const [confirming, setConfirming] = useState(false);
  const [selected, setSelected] = useState(() => firstEmpty(run.cells));
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Pencil notes, and whether the pad writes notes instead of digits. Both are
  // the player's working: nothing here is a move.
  const [{ notes, history }, dispatchNotes] = useReducer(notesReducer, undefined, emptyNotesState);
  // The latest notes state, for Undo to read the step it takes back even when
  // two presses land before a render.
  const latestNotes = useRef<SumdokuNotesState>({ notes, history });
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

  // A solved board gets a beat before the next one. It is short: the speed bonus is
  // still being timed, on the server as well as here. A step up to a harder tier is worth
  // saying once, and what it asks of the player.
  const steppedUp = run.level > 1 && tierOf(run.level) !== tierOf(run.level - 1);
  const levelUp = useLevelUp(run.level, run.score, levelUpHold(steppedUp));
  const accepting = !verifying && run.outcome === "playing" && !levelUp;

  useReportRunProgress(accepting, onFinish, session);

  // Focus lands on the board once, on mount: later focus follows the player.
  const firstFocus = useRef(selected);
  useEffect(() => {
    cellRefs.current[firstFocus.current]?.focus();
  }, []);

  // A right move is one more of the player's digits that clashes with nothing.
  const hints = useHint({
    progress: `${run.level}:${sumdokuRight(run)}`,
    active: accepting,
    compute: () => sumdokuHint(run),
  });

  const clashes = useSettledClashes(conflicts(drawn, run.cells));
  const empty = run.cells.filter((value) => value === EMPTY).length;
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
    const row = Math.floor(selected / SUMDOKU_SIDE);
    const column = selected % SUMDOKU_SIDE;
    const move: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (event.key in move) {
      event.preventDefault();
      const [dr, dc] = move[event.key];
      const nextRow = (row + dr + SUMDOKU_SIDE) % SUMDOKU_SIDE;
      const nextColumn = (column + dc + SUMDOKU_SIDE) % SUMDOKU_SIDE;
      select(nextRow * SUMDOKU_SIDE + nextColumn, true);
    } else if (/^[1-6]$/.test(event.key)) {
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
          <dt className="text-xs text-muted-foreground">{t("Score")}</dt>
          <dd className="text-2xl font-semibold tabular">{points(run.score)}</dd>
          <BestScore slug={session.gameSlug} score={run.score} />
        </dl>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular">{t("Board {level}", { level: run.level })}</span>
          {session.ranked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1">
              <ShieldCheck className="size-3.5" />
              {t("Ranked")}
            </span>
          ) : (
            <span className="rounded-full bg-surface-2 px-2 py-1">
              {session.offline ? t("Offline practice") : t("Guest run")}
            </span>
          )}
        </div>
      </div>

      {hints.hint ? (
        <HintNote reason={hints.hint.reason} className="my-0.5" />
      ) : (
        <p className="py-1 text-center text-sm text-muted-foreground" aria-live="polite">
          {statusLine(run, verifying, clashes.size > 0, selected)}
        </p>
      )}

      <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 pb-1 text-xs text-muted-foreground">
        <span className="tabular">
          {empty} {empty === 1 ? t("cell") : t("cells")} left
        </span>
        <SpeedMeter
          startedAt={startedAt}
          score={run.score}
          solvedParMs={parMs(run.levelsCleared)}
          boardParMs={parMs(run.levelsCleared + 1)}
          running={!verifying && run.outcome === "playing"}
        />
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
              gridTemplateColumns: `repeat(${SUMDOKU_SIDE}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${SUMDOKU_SIDE}, minmax(0, 1fr))`,
            }}
            role="group"
            aria-label={t("Board {level}, {SUMDOKU_SIDE} by {SUMDOKU_SIDE2}", {
              level: run.level,
              SUMDOKU_SIDE,
              SUMDOKU_SIDE2: SUMDOKU_SIDE,
            })}
            onKeyDown={onKeyDown}
          >
            {run.cells.map((value, index) => {
              const row = Math.floor(index / SUMDOKU_SIDE);
              const column = index % SUMDOKU_SIDE;
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
                  aria-label={cellLabel(
                    row,
                    column,
                    value,
                    given,
                    clash,
                    notes[index],
                    drawn,
                    index,
                  )}
                  style={{
                    borderRightWidth:
                      column < SUMDOKU_SIDE - 1
                        ? (column + 1) % SUMDOKU_BOX_COLS === 0
                          ? 2
                          : 1
                        : 0,
                    borderBottomWidth:
                      row < SUMDOKU_SIDE - 1 ? ((row + 1) % SUMDOKU_BOX_ROWS === 0 ? 2 : 1) : 0,
                    borderRightColor: (column + 1) % SUMDOKU_BOX_COLS === 0 ? BOX_EDGE : CELL_EDGE,
                    borderBottomColor: (row + 1) % SUMDOKU_BOX_ROWS === 0 ? BOX_EDGE : CELL_EDGE,
                  }}
                  className={cn(
                    "relative flex items-center justify-center border-solid text-[clamp(0.95rem,4.6vmin,1.6rem)] leading-none tabular transition-colors",
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
                  <CageMarks
                    drawn={drawn}
                    cell={index}
                    active={drawn.cageOf[index] === drawn.cageOf[selected]}
                  />
                  {value !== EMPTY ? (
                    value
                  ) : notes[index] ? (
                    <span
                      aria-hidden
                      className="grid size-full grid-cols-3 grid-rows-2 px-[10%] pt-[26%] pb-[8%] text-[clamp(0.45rem,1.6vmin,0.6rem)] font-medium leading-none text-muted-foreground"
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
                unit={t("Board")}
                next={`Board ${run.level} · ${tierOf(run.level)}`}
                note={
                  steppedUp && TIER_NOTES[tierOf(run.level)]
                    ? t(TIER_NOTES[tierOf(run.level)]!)
                    : undefined
                }
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
          {t("Undo")}
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
          {notesMode ? t("Notes on") : t("Notes")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!accepting || selectedGiven || (selectedDigit === EMPTY && !notes[selected])}
          onClick={() => put(EMPTY)}
        >
          <Eraser />
          {t("Erase")}
        </Button>
      </div>

      {/* The number pad: a digit goes in the selected cell, or into its notes. The
          small count is how many of that digit are still to place. */}
      <div
        className="mx-auto grid w-full max-w-md grid-cols-6 gap-1 pt-1"
        role="group"
        aria-label={t("Numbers")}
      >
        {DIGITS.map((digit, index) => {
          const left = SUMDOKU_SIDE - placed[index];
          return (
            <Button
              key={digit}
              type="button"
              variant="secondary"
              disabled={!accepting || selectedGiven}
              onClick={() => put(digit)}
              aria-label={
                notesMode
                  ? t("Note {digit}", { digit })
                  : t("Place {digit}, {left} left", { digit, left })
              }
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
          {t("End run")}
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("End this run?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {endRunMessage(session, points(run.score))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Keep playing")}</AlertDialogCancel>
            <AlertDialogAction onClick={onFinish}>{t("End run")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The line above the board: what just happened, or what to do. */
function statusLine(
  run: SumdokuRun,
  verifying: boolean,
  clashing: boolean,
  selected: number,
): string {
  if (verifying) return t("Verifying your run with the server…");
  if (run.outcome === "over") return t("Run ended.");
  if (clashing) {
    return t("Something's off: a red digit repeats, or a red cage misses its total.");
  }
  const drawn = drawBoard(run.seed, run.level);
  const start = drawn.start;
  if (run.levelsCleared > 0 && run.cells.every((value, cell) => value === start[cell])) {
    return t("Board {n} solved, +{SUMDOKU_POINTS_PER_BOARD}. Board {level} is {level2}.", {
      n: run.level - 1,
      SUMDOKU_POINTS_PER_BOARD: points(SUMDOKU_POINTS_PER_BOARD),
      level: run.level,
      level2: tierOf(run.level),
    });
  }
  const cage = drawn.cages[drawn.cageOf[selected]];
  const filled = cage.cells.filter((cell) => run.cells[cell] !== EMPTY).length;
  if (cage.cells.length === 1) {
    return t("This cell's cage is just itself: it's a {total}.", { total: cage.total });
  }
  return filled > 0
    ? t("This cage: {size} cells adding to {total}. {sum} so far.", {
        size: cage.cells.length,
        total: cage.total,
        sum: cageSum(cage, run.cells),
      })
    : t("This cage: {size} cells adding to {total}, no repeats.", {
        size: cage.cells.length,
        total: cage.total,
      });
}

/** The accessible name of a cell: where it is, what it holds, and its notes. */
function cellLabel(
  row: number,
  column: number,
  value: number,
  given: boolean,
  clash: boolean,
  noted: number,
  drawn: SumdokuBoard,
  cell: number,
): string {
  const cage = drawn.cages[drawn.cageOf[cell]];
  const cageText = t(", cage of {size} adding to {total}", {
    size: cage.cells.length,
    total: cage.total,
  });
  const notesText =
    value === EMPTY && noted ? t(", notes {join}", { join: notedDigits(noted).join(" ") }) : "";
  return t("Row {n} column {n2}, {n3}{n4}{n5}{notesText}", {
    n: row + 1,
    n2: column + 1,
    n3: value === EMPTY ? "empty" : value,
    n4: given ? ", fixed" : "",
    n5: clash ? ", repeats" : "",
    notesText: cageText + notesText,
  });
}

/** The end of a run: the score the server verified, or a guest's unranked result. */
function Finished({
  slug,
  run,
  result,
  played,
  onRestart,
}: {
  slug: string;
  run: SumdokuRun;
  result: RunResult;
  /** The points the run scored before the server added its speed bonus. */
  played: number;
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
        <p className="text-sm text-muted-foreground">{t("Run ended")}</p>
        <p className="text-5xl font-semibold tabular">{points(result.score)}</p>
        <p className="text-sm text-muted-foreground">
          {t("{tilesPlaced} {n}, {clearedColumns} {n2} solved.", {
            tilesPlaced: result.tilesPlaced,
            n: result.tilesPlaced === 1 ? t("move") : t("moves"),
            clearedColumns: result.clearedColumns,
            n2: result.clearedColumns === 1 ? t("board") : t("boards"),
          })}
        </p>
      </div>

      <BoardReview run={run} />

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <SpeedBonusStat verified={result.score} played={played} />
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Duration")}</dt>
          <dd className="font-semibold tabular">{formatSeconds(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Boards solved")}</dt>
          <dd className="font-semibold tabular">{result.clearedColumns}</dd>
        </div>
        {result.personalBest !== null && (
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs text-muted-foreground">{t("Your best")}</dt>
            <dd className="font-semibold tabular">{points(result.personalBest)}</dd>
          </div>
        )}
        {result.rank !== null && (
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs text-muted-foreground">{t("Rank")}</dt>
            <dd className="font-semibold tabular">#{result.rank}</dd>
          </div>
        )}
      </dl>

      <p className="mx-auto max-w-sm text-xs text-muted-foreground">
        {result.ranked
          ? t("Verified by replaying your moves on the server, then saved to the leaderboard.")
          : result.offline
            ? offlineResultNote()
            : t(
                "Verified by replaying your moves on the server. This was a guest run, so it is not on the leaderboard.",
              )}
        {result.duplicate && t(" This run was already recorded, so nothing was counted twice.")}
      </p>

      <RunEndActions
        slug={slug}
        ranked={result.ranked}
        score={result.score}
        onRestart={onRestart}
        autoFocus
      />
    </div>
  );
}

/** One wrong digit on the board the run ended on, and why it was wrong. */
type Mistake = { cell: number; placed: SumdokuDigit; answer: SumdokuDigit; reason: string };

function where(cell: number): string {
  return t("Row {n}, column {n2}", {
    n: Math.floor(cell / SUMDOKU_SIDE) + 1,
    n2: (cell % SUMDOKU_SIDE) + 1,
  });
}

/** The wrong digits on a board, each with the rule it broke or the digit it needed. */
function boardMistakes(drawn: SumdokuBoard, cells: readonly SumdokuDigit[]): Mistake[] {
  const { start, solution } = drawn;
  const mistakes: Mistake[] = [];
  cells.forEach((placed, cell) => {
    if (placed === EMPTY || start[cell] !== EMPTY || placed === solution[cell]) return;
    const answer = solution[cell];
    const units = { ...unitsOf(cell), cage: drawn.cages[drawn.cageOf[cell]].cells };
    const clash = (["row", "column", "box", "cage"] as const).find((name) =>
      units[name].some((other) => other !== cell && cells[other] === placed),
    );
    mistakes.push({
      cell,
      placed,
      answer,
      reason: clash
        ? t(
            "{cell}: your {placed} repeats the {placed2} already in that {clash}. It needed a {answer}.",
            { cell: where(cell), placed, placed2: placed, clash, answer },
          )
        : t(
            "{cell}: a {placed} fit for the moment, but the board's only solution has a {answer} there, so the {placed2} would have blocked it later.",
            { cell: where(cell), placed, answer, placed2: placed },
          ),
    });
  });
  return mistakes;
}

/**
 * The board the run ended on, checked against its one solution: the digits the
 * player got right, the ones they got wrong (struck through, with the right one
 * beside them, and why), and the rest of the board filled in faintly.
 */
function BoardReview({ run }: { run: SumdokuRun }) {
  const drawn = useMemo(() => drawBoard(run.seed, run.level), [run.seed, run.level]);
  const mistakes = useMemo(() => boardMistakes(drawn, run.cells), [run.cells, drawn]);
  const wrong = new Map(mistakes.map((mistake) => [mistake.cell, mistake]));
  const open = run.cells.filter((value) => value === EMPTY).length;
  const shown = mistakes.slice(0, 4);

  let summary: string;
  if (mistakes.length > 0) {
    const empties = open
      ? t(" and {open} {n} still empty", { open, n: open === 1 ? t("square") : t("squares") })
      : "";
    summary = t(
      "{length} wrong {n}{empties}. A wrong digit doesn't end the run, but it hides the right answer and costs you time.",
      { length: mistakes.length, n: mistakes.length === 1 ? t("digit") : t("digits"), empties },
    );
  } else if (open) {
    summary = t(
      "No mistakes: {open} {n} still empty when the run ended. Here is the rest of the board.",
      { open, n: open === 1 ? t("square was") : t("squares were") },
    );
  } else {
    summary = t("Everything you placed was right.");
  }

  return (
    <section
      className="enter mx-auto w-full max-w-sm space-y-3 text-left"
      aria-label={t("Your last board")}
    >
      <h2 className="text-center text-base font-semibold">
        {mistakes.length > 0
          ? t("Where board {level} went wrong", { level: run.level })
          : t("Board {level}, checked", { level: run.level })}
      </h2>
      <p className="text-center text-xs text-muted-foreground">{summary}</p>
      <div
        className="mx-auto grid aspect-square w-full max-w-[18rem] overflow-hidden rounded-lg border-2 bg-surface"
        style={{
          borderColor: BOX_EDGE,
          gridTemplateColumns: `repeat(${SUMDOKU_SIDE}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${SUMDOKU_SIDE}, minmax(0, 1fr))`,
        }}
        role="img"
        aria-label={t("Board {level} checked against its solution. {summary} {join}", {
          level: run.level,
          summary,
          join: mistakes.map((mistake) => mistake.reason).join(" "),
        })}
      >
        {run.cells.map((value, index) => {
          const row = Math.floor(index / SUMDOKU_SIDE);
          const column = index % SUMDOKU_SIDE;
          const given = drawn.start[index] !== EMPTY;
          const mistake = wrong.get(index);
          const missing = value === EMPTY;
          return (
            <div
              key={index}
              style={{
                borderRightWidth:
                  column < SUMDOKU_SIDE - 1 ? ((column + 1) % SUMDOKU_BOX_COLS === 0 ? 2 : 1) : 0,
                borderBottomWidth:
                  row < SUMDOKU_SIDE - 1 ? ((row + 1) % SUMDOKU_BOX_ROWS === 0 ? 2 : 1) : 0,
                borderRightColor: (column + 1) % SUMDOKU_BOX_COLS === 0 ? BOX_EDGE : CELL_EDGE,
                borderBottomColor: (row + 1) % SUMDOKU_BOX_ROWS === 0 ? BOX_EDGE : CELL_EDGE,
              }}
              className={cn(
                "relative flex items-center justify-center border-solid text-sm leading-none tabular",
                given && "font-semibold text-foreground",
                !given && !missing && !mistake && "font-medium text-primary",
                mistake && "bg-destructive/15 font-semibold text-destructive",
                missing && "text-muted-foreground/60",
              )}
            >
              <CageMarks drawn={drawn} cell={index} active={false} small />
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
        <span className="text-primary">{t("Yours, right")}</span>
        <span className="text-destructive">{t("Wrong (yours struck through)")}</span>
        <span>{t("Faint: not filled in")}</span>
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
              {t("…and {n} more, marked in red above.", { n: mistakes.length - shown.length })}
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
