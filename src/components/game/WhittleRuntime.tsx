import { Loader2, RotateCcw, ShieldCheck, Trophy, TriangleAlert, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

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
import { whittleHint, whittleProgress } from "@/lib/games/whittle-hints";
import { levelUpHold, useLevelUp } from "@/lib/games/level-up";
import { GAME_RULES } from "@/lib/games/rules";
import { endRunMessage, useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useWhittleRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import {
  board as drawBoard,
  CIRCLED,
  columnSum,
  CROSSED,
  WHITTLE_POINTS_PER_BOARD,
  WHITTLE_SIDE,
  nextMark,
  parMs,
  rowSum,
  solutions,
  tierOf,
  UNMARKED,
  type WhittleBoard,
  type WhittleMark,
  type WhittleRun,
  type WhittleTier,
} from "@/lib/games/whittle";
import { useHint } from "@/lib/games/use-hint";
import { points } from "@/lib/format";
import { useGameSounds } from "@/lib/sound";
import { offlineResultNote } from "@/lib/games/offline";

import { t, msg } from "@/lib/settings/language";
/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES["whittle"];

const LINES = Array.from({ length: WHITTLE_SIDE }, (_, i) => i);

/** What a step up to a harder tier asks of the player, said once. */
const TIER_NOTES: Record<WhittleTier, string | undefined> = {
  easy: undefined,
  medium: msg("Bigger numbers from here: up to 14."),
  hard: msg("Hard boards from here: numbers up to 19."),
};

/**
 * Whittle, playing for real.
 *
 * The board is a view onto `useWhittleRun`, which owns the lifecycle and the
 * clock: the rules first, a session issued when the player presses Start, boards
 * drawn from its seed, and the score the server derived from the submitted
 * moves. Nothing here decides a number.
 *
 * Tap a number to cross it out, again to circle it as one to keep, and once more
 * to clear it. The sums beside the targets and the lit targets are display: the
 * moves are the run.
 */
export function WhittleRuntime({
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
  const state = useWhittleRun(slug, autoStart);

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
        onMark={state.mark}
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
          <X className="size-5 text-muted-foreground" />
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

/** A number as its mark draws it: plain, struck through with a cross, or ringed. */
function MarkedNumber({
  number,
  mark,
  wrong = false,
}: {
  number: number;
  mark: WhittleMark;
  /** A review's wrong cross: drawn in red. */
  wrong?: boolean;
}) {
  return (
    <>
      {mark === CIRCLED && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-[12%] rounded-full border-2 border-primary"
        />
      )}
      <span className={cn(mark === CROSSED && "opacity-60")}>{number}</span>
      {mark === CROSSED && (
        <X
          aria-hidden
          strokeWidth={1.5}
          className={cn(
            "pointer-events-none absolute size-[88%]",
            wrong ? "text-destructive" : "text-destructive/70",
          )}
        />
      )}
    </>
  );
}

/** A row's or column's target: lit once the line adds up to it, with the sum so far below. */
function Target({
  target,
  sum,
  label,
  showSum = true,
}: {
  target: number;
  sum: number;
  label: string;
  showSum?: boolean;
}) {
  const met = sum === target;
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "flex flex-col items-center justify-center rounded-lg leading-none tabular transition-colors motion-reduce:transition-none",
        met ? "bg-primary text-primary-foreground" : "bg-surface-2 text-foreground",
      )}
    >
      <span className="text-[clamp(0.9rem,4.2vmin,1.4rem)] font-semibold">{target}</span>
      {showSum && !met && (
        <span
          className={cn(
            "mt-[0.2em] text-[clamp(0.55rem,2.1vmin,0.7rem)]",
            sum < target ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {sum}
        </span>
      )}
    </div>
  );
}

/** The live run: one board at a time, with no clock to lose to. */
function Board({
  run,
  session,
  startedAt,
  verifying,
  onMark,
  onFinish,
}: {
  run: WhittleRun;
  session: PlaySession;
  /** When the run started, as a `Date.now()` timestamp. */
  startedAt: number;
  verifying: boolean;
  onMark: (cell: number, mark: number) => void;
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
  const [selected, setSelected] = useState(0);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // What Undo steps back through: each move's cell and the mark it replaced. It
  // is this board's only — a new board starts with nothing to undo.
  const [history, setHistory] = useState<{ cell: number; previous: WhittleMark }[]>([]);

  const drawn = useMemo(() => drawBoard(run.seed, run.level), [run.seed, run.level]);

  useEffect(() => {
    setSelected(0);
    setHistory([]);
  }, [drawn]);

  // A solved board gets a beat before the next one. It is short: the speed bonus is
  // still being timed, on the server as well as here.
  const steppedUp = run.level > 1 && tierOf(run.level) !== tierOf(run.level - 1);
  const levelUp = useLevelUp(run.level, run.score, levelUpHold(steppedUp));
  const accepting = !verifying && run.outcome === "playing" && !levelUp;

  useReportRunProgress(accepting, onFinish, session);

  // Focus lands on the board once, on mount: later focus follows the player.
  useEffect(() => {
    cellRefs.current[0]?.focus();
  }, []);

  const hints = useHint({
    progress: whittleProgress(run),
    active: accepting,
    compute: () => whittleHint(run),
  });

  const rowSums = LINES.map((row) => rowSum(drawn, run.marks, row));
  const columnSums = LINES.map((column) => columnSum(drawn, run.marks, column));
  const met =
    rowSums.filter((sum, row) => sum === drawn.rowTargets[row]).length +
    columnSums.filter((sum, column) => sum === drawn.columnTargets[column]).length;

  function set(cell: number, to: WhittleMark) {
    const previous = run.marks[cell];
    if (!accepting || previous === to) return;
    setHistory((steps) => [...steps, { cell, previous }]);
    onMark(cell, to);
  }

  /** A tap: none, then crossed out, then circled, then none again. */
  function tap(cell: number) {
    setSelected(cell);
    set(cell, nextMark(run.marks[cell]));
  }

  /** Steps back once: the cell gets its old mark back, which is itself a move. */
  function undo() {
    const step = history[history.length - 1];
    if (!accepting || !step) return;
    setHistory((steps) => steps.slice(0, -1));
    if (run.marks[step.cell] !== step.previous) onMark(step.cell, step.previous);
    setSelected(step.cell);
    cellRefs.current[step.cell]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const row = Math.floor(selected / WHITTLE_SIDE);
    const column = selected % WHITTLE_SIDE;
    const move: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const key = event.key.toLowerCase();
    if (event.key in move) {
      event.preventDefault();
      const [dr, dc] = move[event.key];
      const next =
        ((row + dr + WHITTLE_SIDE) % WHITTLE_SIDE) * WHITTLE_SIDE +
        ((column + dc + WHITTLE_SIDE) % WHITTLE_SIDE);
      setSelected(next);
      cellRefs.current[next]?.focus();
    } else if (key === "z" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      undo();
    } else if (key === "x") {
      event.preventDefault();
      set(selected, CROSSED);
    } else if (key === "c" || key === "o") {
      event.preventDefault();
      set(selected, CIRCLED);
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      set(selected, UNMARKED);
    }
  }

  const track = `repeat(${WHITTLE_SIDE}, minmax(0, 1fr)) minmax(0, 0.8fr)`;

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
          {statusLine(run, verifying)}
        </p>
      )}

      <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 pb-1 text-xs text-muted-foreground">
        <span className="tabular">
          {t("{met} of {total} targets met", { met, total: 2 * WHITTLE_SIDE })}
        </span>
        <SpeedMeter
          startedAt={startedAt}
          score={run.score}
          solvedParMs={parMs(run.levelsCleared)}
          boardParMs={parMs(run.levelsCleared + 1)}
          running={!verifying && run.outcome === "playing"}
        />
      </div>

      {/* A square board, centred in whatever space is left: five rows of numbers
          with their targets down the right, and the column targets underneath. */}
      <div className="flex min-h-0 flex-1 items-center justify-center py-2">
        <div className="flex max-h-full w-full justify-center">
          <div
            className="relative grid aspect-square w-full gap-1.5"
            style={{
              maxWidth: `min(28rem, calc(100dvh - ${hints.hint ? 19.5 : 17}rem))`,
              gridTemplateColumns: track,
              gridTemplateRows: track,
            }}
            role="group"
            aria-label={t("Board {level}, {side} by {side2}", {
              level: run.level,
              side: WHITTLE_SIDE,
              side2: WHITTLE_SIDE,
            })}
            onKeyDown={onKeyDown}
          >
            {LINES.flatMap((row) => [
              ...LINES.map((column) => {
                const index = row * WHITTLE_SIDE + column;
                const mark = run.marks[index];
                const hinted = hints.hint?.cell === index;
                return (
                  <button
                    key={index}
                    ref={(element) => {
                      cellRefs.current[index] = element;
                    }}
                    type="button"
                    tabIndex={index === selected ? 0 : -1}
                    disabled={!accepting}
                    onClick={() => tap(index)}
                    onFocus={() => setSelected(index)}
                    aria-label={cellLabel(row, column, drawn.numbers[index], mark)}
                    className={cn(
                      "relative flex items-center justify-center rounded-lg bg-surface text-[clamp(1rem,5vmin,1.7rem)] font-semibold leading-none tabular transition-colors",
                      "motion-reduce:transition-none",
                      "focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      mark === CROSSED && "bg-surface/50",
                      mark === CIRCLED && "text-primary",
                      hinted && "animate-pulse ring-2 ring-inset ring-primary",
                    )}
                  >
                    <MarkedNumber number={drawn.numbers[index]} mark={mark} />
                  </button>
                );
              }),
              <Target
                key={`row-${row}`}
                target={drawn.rowTargets[row]}
                sum={rowSums[row]}
                label={targetLabel(t("Row"), row, drawn.rowTargets[row], rowSums[row])}
              />,
            ])}
            {LINES.map((column) => (
              <Target
                key={`column-${column}`}
                target={drawn.columnTargets[column]}
                sum={columnSums[column]}
                label={targetLabel(
                  t("Column"),
                  column,
                  drawn.columnTargets[column],
                  columnSums[column],
                )}
              />
            ))}

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

      <div className="flex items-center justify-center gap-2 pt-2">
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
function statusLine(run: WhittleRun, verifying: boolean): string {
  if (verifying) return t("Verifying your run with the server…");
  if (run.outcome === "over") return t("Run ended.");
  const untouched = run.marks.every((mark) => mark === UNMARKED);
  if (run.levelsCleared > 0 && untouched) {
    return t("Board {n} solved, +{gain}. Board {level} is {tier}.", {
      n: run.level - 1,
      gain: points(WHITTLE_POINTS_PER_BOARD),
      level: run.level,
      tier: tierOf(run.level),
    });
  }
  return untouched
    ? t("Tap a number to cross it out. Each row and column must add up to its target.")
    : t("Tap again to circle a number you're keeping, and once more to clear it.");
}

/** The accessible name of a cell: where it is, its number, and its mark. */
function cellLabel(row: number, column: number, number: number, mark: WhittleMark): string {
  return t("Row {row} column {column}, {number}{mark}", {
    row: row + 1,
    column: column + 1,
    number,
    mark: mark === CROSSED ? t(", crossed out") : mark === CIRCLED ? t(", circled") : "",
  });
}

/** The accessible name of a target: its line, what it needs, and what it has. */
function targetLabel(line: string, index: number, target: number, sum: number): string {
  return sum === target
    ? t("{line} {n} target {target}, met", { line, n: index + 1, target })
    : t("{line} {n} target {target}, now {sum}", { line, n: index + 1, target, sum });
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
  run: WhittleRun;
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

      <RunEndActions slug={slug} ranked={result.ranked} onRestart={onRestart} autoFocus />
    </div>
  );
}

/** The answer nearest the player's crosses: the one their board is shown against. */
function nearestAnswer(drawn: WhittleBoard, marks: readonly WhittleMark[]): readonly boolean[] {
  let best: readonly boolean[] = drawn.crossed;
  let fewest = Infinity;
  for (const answer of solutions(drawn)) {
    const off = marks.filter((mark, cell) => (mark === CROSSED) !== answer[cell]).length;
    if (off < fewest) {
      best = answer;
      fewest = off;
    }
  }
  return best;
}

/**
 * The board the run ended on, solved: every number that goes is crossed out, the
 * player's own right crosses in the usual colour, the ones they had wrong in red,
 * and the ones they had not found yet faint.
 */
function BoardReview({ run }: { run: WhittleRun }) {
  const drawn = useMemo(() => drawBoard(run.seed, run.level), [run.seed, run.level]);
  const answer = useMemo(() => nearestAnswer(drawn, run.marks), [drawn, run.marks]);
  const wrong = run.marks.filter((mark, cell) => mark === CROSSED && !answer[cell]).length;
  const missed = run.marks.filter((mark, cell) => mark !== CROSSED && answer[cell]).length;

  const summary =
    wrong > 0
      ? t("{wrong} {n} crossed out that had to stay, and {missed} still to cross out.", {
          wrong,
          n: wrong === 1 ? t("number") : t("numbers"),
          missed,
        })
      : t("No wrong crosses: {missed} {n} still to cross out when the run ended.", {
          missed,
          n: missed === 1 ? t("number was") : t("numbers were"),
        });
  const track = `repeat(${WHITTLE_SIDE}, minmax(0, 1fr)) minmax(0, 0.8fr)`;

  return (
    <section
      className="enter mx-auto w-full max-w-sm space-y-3 text-left"
      aria-label={t("Your last board")}
    >
      <h2 className="text-center text-base font-semibold">
        {t("The answer to board {level}", { level: run.level })}
      </h2>
      <p className="text-center text-xs text-muted-foreground">{summary}</p>
      <div
        className="mx-auto grid aspect-square w-full max-w-[16rem] gap-1"
        style={{ gridTemplateColumns: track, gridTemplateRows: track }}
        role="img"
        aria-label={t("Board {level} with its answer. {summary}", { level: run.level, summary })}
      >
        {LINES.flatMap((row) => [
          ...LINES.map((column) => {
            const index = row * WHITTLE_SIDE + column;
            const crossedByPlayer = run.marks[index] === CROSSED;
            const isWrong = crossedByPlayer && !answer[index];
            const isMissed = !crossedByPlayer && answer[index];
            return (
              <div
                key={index}
                className={cn(
                  "relative flex items-center justify-center rounded-md bg-surface text-sm font-semibold leading-none tabular",
                  isWrong && "bg-destructive/15 text-destructive",
                  isMissed && "text-muted-foreground",
                )}
              >
                <MarkedNumber
                  number={drawn.numbers[index]}
                  mark={answer[index] || isWrong ? CROSSED : UNMARKED}
                  wrong={isWrong}
                />
              </div>
            );
          }),
          <Target
            key={`row-${row}`}
            target={drawn.rowTargets[row]}
            sum={drawn.rowTargets[row]}
            showSum={false}
            label={String(drawn.rowTargets[row])}
          />,
        ])}
        {LINES.map((column) => (
          <Target
            key={`column-${column}`}
            target={drawn.columnTargets[column]}
            sum={drawn.columnTargets[column]}
            showSum={false}
            label={String(drawn.columnTargets[column])}
          />
        ))}
      </div>
      <p className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[0.7rem] text-muted-foreground">
        <span className="text-foreground">{t("Crossed: has to go")}</span>
        <span className="text-destructive">{t("Red: you crossed it, it stays")}</span>
        <span>{t("Faint: not found yet")}</span>
      </p>
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
