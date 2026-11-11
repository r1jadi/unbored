import {
  Bomb,
  Flag,
  Heart,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Shovel,
  Trophy,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { ErrorState } from "@/components/common";
import { BestScore } from "@/components/game/BestScore";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { GameExits } from "@/components/game/GameExits";
import { LevelUpOverlay } from "@/components/game/LevelUp";
import { MineCellFace, mineCellClass } from "@/components/game/MinefieldCell";
import { RulesList } from "@/components/game/RulesList";
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
import { points } from "@/lib/format";
import { levelUpHold, useLevelUp } from "@/lib/games/level-up";
import {
  CLOSED,
  FLAGGED,
  HIT,
  MINEFIELD_FLAG_OFFSET,
  MINEFIELD_LIVES,
  minesLeft,
  sideFor,
  type MineCell,
  type MinefieldRun,
} from "@/lib/games/minefield";
import { offlineResultNote } from "@/lib/games/offline";
import { GAME_RULES } from "@/lib/games/rules";
import { endRunMessage, useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useMinefieldRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import { t } from "@/lib/settings/language";
import { useGameSounds } from "@/lib/sound";
import { cn } from "@/lib/utils";

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES.minefield;

/** How long a press has to last to flag a cell, on a touch screen. */
const LONG_PRESS_MS = 350;

/**
 * Minefield, playing for real.
 *
 * The board is a view onto `useMinefieldRun`, which owns the lifecycle: the rules
 * first, a session issued when the player presses Start, mines drawn from its seed,
 * and the score the server derived from the submitted actions. Nothing here decides a
 * number. Every cell is a real button, and arrow keys move between them.
 */
export function MinefieldRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useMinefieldRun(slug, autoStart);

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
        verifying={state.status === "submitting"}
        onAct={state.act}
        onFinish={state.finish}
      />
    );
  }

  if (state.status === "finished") {
    return <Finished slug={slug} result={state.result} run={state.run} onRestart={state.restart} />;
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
          <Bomb className="size-5 text-muted-foreground" />
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

/** What the next board brings that this one did not, when that is worth saying. */
function nextBoardNote(level: number): string | undefined {
  if (level > 1 && sideFor(level) > sideFor(level - 1)) {
    const side = sideFor(level);
    return t("Boards are {side}×{side2} from here.", { side, side2: side });
  }
  return undefined;
}

/** A cell's name for a screen reader. */
function cellLabel(state: MineCell, number: number | undefined, at: number, side: number): string {
  const where = { n: Math.floor(at / side) + 1, n2: (at % side) + 1 };
  if (state === CLOSED) return t("Row {n}, column {n2}: closed.", where);
  if (state === FLAGGED) return t("Row {n}, column {n2}: flagged.", where);
  if (state === HIT) return t("Row {n}, column {n2}: mine.", where);
  if (!number) return t("Row {n}, column {n2}: no mines nearby.", where);
  if (number === 1) return t("Row {n}, column {n2}: 1 mine nearby.", where);
  return t("Row {n}, column {n2}: {count} mines nearby.", { ...where, count: number });
}

/** The live run: one board at a time. */
function Board({
  run,
  session,
  verifying,
  onAct,
  onFinish,
}: {
  run: MinefieldRun;
  session: PlaySession;
  verifying: boolean;
  onAct: (action: number) => void;
  onFinish: () => void;
}) {
  useGameSounds({
    moves: run.actions.length,
    score: run.score,
    cleared: run.levelsCleared,
    mistakes: run.hits,
    over: run.outcome === "over",
    ending: run.ending === "mines" ? "lose" : "stop",
  });
  const [confirming, setConfirming] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A long press has just flagged a cell, so the click that follows it is not a tap.
  const longPressed = useRef(false);

  const note = nextBoardNote(run.level);
  const levelUp = useLevelUp(run.level, run.score, levelUpHold(note !== undefined));
  const live = !verifying && run.outcome === "playing" && !levelUp;
  const left = minesLeft(run);

  useReportRunProgress(live, onFinish, session);

  // A new board starts by opening a cell, so a flag left on would only get in the way.
  useEffect(() => setFlagging(false), [run.level]);
  useEffect(
    () => () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    },
    [],
  );

  const flag = (cell: number) => {
    if (live) onAct(cell + MINEFIELD_FLAG_OFFSET);
  };

  const press = (cell: number) => {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (!live) return;
    // In flag mode a closed cell takes a flag; a tap on a number still opens around it.
    const state = run.cells[cell];
    if (flagging && (state === CLOSED || state === FLAGGED)) flag(cell);
    else onAct(cell);
  };

  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const startPress = (event: PointerEvent, cell: number) => {
    longPressed.current = false;
    cancelPress();
    if (event.pointerType === "mouse") return;
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      longPressed.current = true;
      flag(cell);
    }, LONG_PRESS_MS);
  };

  const onKeyDown = (event: KeyboardEvent, cell: number) => {
    if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      flag(cell);
      return;
    }
    const side = run.side;
    const row = Math.floor(cell / side);
    const col = cell % side;
    const target =
      event.key === "ArrowUp" && row > 0
        ? cell - side
        : event.key === "ArrowDown" && row < side - 1
          ? cell + side
          : event.key === "ArrowLeft" && col > 0
            ? cell - 1
            : event.key === "ArrowRight" && col < side - 1
              ? cell + 1
              : null;
    if (target === null) return;
    event.preventDefault();
    grid.current?.querySelector<HTMLElement>(`[data-cell="${target}"]`)?.focus();
  };

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

      <p className="py-1 text-center text-sm text-muted-foreground" aria-live="polite">
        {statusLine(run, verifying, flagging)}
      </p>

      <div className="mx-auto flex w-full max-w-md items-center justify-between pb-1 text-xs text-muted-foreground">
        <span
          role="img"
          aria-label={t("{left} mines left", { left })}
          className="inline-flex items-center gap-1 text-base font-semibold tabular text-foreground"
        >
          <Bomb aria-hidden className="size-4" />
          {left}
        </span>
        <span
          role="img"
          aria-label={run.lives === 1 ? t("1 life left") : t("{n} lives left", { n: run.lives })}
          className="inline-flex items-center gap-1"
        >
          {Array.from({ length: MINEFIELD_LIVES }, (_, life) => (
            <Heart
              key={life}
              aria-hidden
              className={cn(
                "size-4",
                life < run.lives ? "fill-destructive text-destructive" : "text-muted-foreground/40",
              )}
            />
          ))}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center py-3">
        <div
          ref={grid}
          role="group"
          aria-label={t("Board {level}, {side} by {side2}, {left} mines left.", {
            level: run.level,
            side: run.side,
            side2: run.side,
            left,
          })}
          className="relative grid aspect-square w-full max-w-md select-none gap-1 rounded-2xl bg-surface p-2 sm:p-3"
          style={{
            gridTemplateColumns: `repeat(${run.side}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${run.side}, minmax(0, 1fr))`,
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {run.cells.map((state, at) => (
            <button
              // A new board gets new cells, so nothing animates from the old one.
              key={`${run.level}:${at}`}
              type="button"
              data-cell={at}
              aria-label={cellLabel(state, run.numbers?.[at], at, run.side)}
              aria-disabled={!live}
              onClick={() => press(at)}
              onContextMenu={() => {
                // A long press on a phone can also raise this, after it has flagged.
                if (longPressed.current) return;
                cancelPress();
                flag(at);
              }}
              onPointerDown={(event) => startPress(event, at)}
              onPointerUp={cancelPress}
              onPointerLeave={cancelPress}
              onPointerCancel={cancelPress}
              onKeyDown={(event) => onKeyDown(event, at)}
              className={cn(
                "flex touch-manipulation items-center justify-center rounded-md text-base transition-colors duration-100 sm:text-xl motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                state === CLOSED && live && "hover:bg-foreground/30",
                mineCellClass(state),
              )}
            >
              <MineCellFace state={state} number={run.numbers?.[at]} />
            </button>
          ))}
          {levelUp && run.last?.cleared && (
            <LevelUpOverlay
              levelUp={levelUp}
              unit={t("Board")}
              next={t("Board {level}", { level: run.level })}
              note={note}
            />
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-2 pt-2">
        <div
          role="group"
          aria-label={t("Tap mode")}
          className="inline-flex rounded-full bg-surface-2 p-1"
        >
          <Button
            variant={flagging ? "ghost" : "secondary"}
            size="sm"
            className="rounded-full"
            aria-pressed={!flagging}
            onClick={() => setFlagging(false)}
          >
            <Shovel aria-hidden />
            {t("Reveal")}
          </Button>
          <Button
            variant={flagging ? "secondary" : "ghost"}
            size="sm"
            className="rounded-full"
            aria-pressed={flagging}
            onClick={() => setFlagging(true)}
          >
            <Flag aria-hidden />
            {t("Flag")}
          </Button>
        </div>
        <Button variant="ghost" size="sm" disabled={!live} onClick={() => setConfirming(true)}>
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
function statusLine(run: MinefieldRun, verifying: boolean, flagging: boolean): string {
  if (verifying) return t("Verifying your run with the server…");
  if (run.outcome === "over") {
    return run.ending === "mines" ? t("Out of lives. The run is over.") : t("Run ended.");
  }
  const last = run.last;
  if (last?.cleared) {
    return last.lifeBack
      ? t("Board {n} cleared. A life comes back.", { n: last.level })
      : t("Board {n} cleared.", { n: last.level });
  }
  if (flagging) return t("Flag mode: tap a cell you think hides a mine.");
  if (!last) return t("Tap any cell. The first one is always safe.");
  if (last.hits > 0) {
    return run.lives === 1
      ? t("A mine! Last life.")
      : t("A mine! {n} lives left.", { n: run.lives });
  }
  if (last.kind === "flag") return t("Flagged.");
  if (last.kind === "unflag") return t("Flag removed.");
  return t("Read the numbers. Flag what you are sure of.");
}

/** The board a run ended on, with what it was hiding. */
function FinalBoard({ run }: { run: MinefieldRun }) {
  const numbers = run.numbers;
  if (!numbers) return null;
  return (
    <div
      role="img"
      aria-label={t("The board you ended on, with its mines shown.")}
      className="mx-auto grid aspect-square w-full max-w-[13rem] gap-0.5 rounded-xl bg-surface p-1.5 text-[0.65rem]"
      style={{ gridTemplateColumns: `repeat(${run.side}, minmax(0, 1fr))` }}
    >
      {run.cells.map((state, at) => (
        <span
          key={at}
          className={cn("flex items-center justify-center rounded-[3px]", mineCellClass(state))}
        >
          <MineCellFace state={state} number={numbers[at]} reveal />
        </span>
      ))}
    </div>
  );
}

/** The end of a run: the score the server verified, or a guest's unranked result. */
function Finished({
  slug,
  result,
  run,
  onRestart,
}: {
  slug: string;
  result: RunResult;
  run: MinefieldRun;
  onRestart: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center-safe gap-4 overflow-y-auto px-6 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] text-center">
      <div className="enter flex flex-col items-center gap-2">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
          {result.ranked ? (
            <Trophy className="size-5 text-muted-foreground" />
          ) : (
            <ShieldCheck className="size-5 text-muted-foreground" />
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {run.ending === "mines" ? t("Out of lives") : t("Run ended")}
        </p>
        <p className="text-5xl font-semibold tabular">{points(result.score)}</p>
        <p className="text-sm text-muted-foreground">
          {t("{tilesPlaced} {n} opened, {clearedColumns} {n2} cleared.", {
            tilesPlaced: result.tilesPlaced,
            n: result.tilesPlaced === 1 ? t("cell") : t("cells"),
            clearedColumns: result.clearedColumns,
            n2: result.clearedColumns === 1 ? t("board") : t("boards"),
          })}
        </p>
      </div>

      <FinalBoard run={run} />

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Boards cleared")}</dt>
          <dd className="font-semibold tabular">{result.clearedColumns}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Clean boards")}</dt>
          <dd className="font-semibold tabular">{run.cleanBoards}</dd>
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
