import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Loader2,
  Move,
  RotateCcw,
  RotateCw,
  ShieldCheck,
  Trophy,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import { ErrorState } from "@/components/common";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { GameExits } from "@/components/game/GameExits";
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
import { points } from "@/lib/format";
import { levelUpHold, useLevelUp } from "@/lib/games/level-up";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  canExit,
  SCATTER_CLEAR_BONUS,
  SCATTER_MAX_JAMS,
  sideFor,
  tilesFor,
  type ScatterCell,
  type ScatterRun,
} from "@/lib/games/scatter";
import {
  playErrorMessage,
  useScatterRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import { useGameSounds } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { offlineResultNote } from "@/lib/games/offline";

import { t } from "@/lib/settings/language";
/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES.scatter;

const ARROWS = [ArrowUp, ArrowRight, ArrowDown, ArrowLeft] as const;
const DIRECTION_NAMES = ["up", "right", "down", "left"] as const;

/**
 * Scatter, playing for real.
 *
 * The board is a view onto `useScatterRun`, which owns the lifecycle: the rules
 * first, a session issued when the player presses Start, boards dealt from its
 * seed, and the score the server derived from the submitted taps. Nothing here
 * decides a number. Every tile is a real button.
 */
export function ScatterRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useScatterRun(slug, autoStart);

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
        onTap={state.tap}
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
          <Move className="size-5 text-muted-foreground" />
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

/** The live run: one board at a time. */
function Board({
  run,
  session,
  verifying,
  onTap,
  onFinish,
}: {
  run: ScatterRun;
  session: PlaySession;
  verifying: boolean;
  onTap: (cell: number) => void;
  onFinish: () => void;
}) {
  useGameSounds({
    moves: run.actions.length,
    score: run.score,
    cleared: run.levelsCleared,
    mistakes: run.jams,
    over: run.outcome === "over",
    ending: run.ending === "jams" ? "lose" : "stop",
  });
  const [confirming, setConfirming] = useState(false);
  const grew = sideFor(run.level) > sideFor(Math.max(1, run.level - 1));
  const levelUp = useLevelUp(run.level, run.score, levelUpHold(grew));
  const accepting = !verifying && run.outcome === "playing" && !levelUp;

  useReportRunProgress(accepting, onFinish);

  const turnstiles = run.cells.filter((tile) => tile?.turnstile).length;
  const tiles = run.cells.filter(Boolean).length;
  // The jammed tile shakes: keyed by the tap, so a second jam shakes again.
  const jammed = run.last?.event === "jam" ? run.last.cell : null;

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">{t("Score")}</dt>
          <dd className="text-2xl font-semibold tabular">{points(run.score)}</dd>
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
        {statusLine(run, verifying)}
      </p>

      <div className="mx-auto flex w-full max-w-md items-center justify-between pb-1 text-xs text-muted-foreground">
        <span className="tabular">
          {tiles} {tiles === 1 ? t("tile") : t("tiles")} left
          {turnstiles > 0 && ` · ${turnstiles} ⟳`}
        </span>
        <span
          className="flex items-center gap-1"
          aria-label={t("{jams} of {SCATTER_MAX_JAMS} jams", { jams: run.jams, SCATTER_MAX_JAMS })}
          role="img"
        >
          {Array.from({ length: SCATTER_MAX_JAMS }, (_, index) => (
            <span
              key={index}
              className={cn(
                "size-2.5 rounded-full",
                index < run.jams ? "bg-destructive" : "bg-surface-2",
              )}
            />
          ))}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center py-3">
        <div
          className="relative grid aspect-square w-full max-w-md gap-1.5 rounded-2xl bg-surface p-2 sm:gap-2 sm:p-3"
          style={{
            gridTemplateColumns: `repeat(${run.side}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${run.side}, minmax(0, 1fr))`,
          }}
          role="group"
          aria-label={t("Board {level}, {side} by {side2}, {tiles} tiles.", {
            level: run.level,
            side: run.side,
            side2: run.side,
            tiles,
          })}
        >
          {run.cells.map((tile, cell) => (
            <Cell
              // A new board gets new cells; a jam re-keys its tile so it shakes again.
              key={`${run.level}:${cell}:${jammed === cell ? run.actions.length : 0}`}
              tile={tile}
              cell={cell}
              side={run.side}
              free={tile !== null && canExit(run.cells, run.side, cell)}
              jammed={jammed === cell}
              disabled={!accepting}
              onTap={() => onTap(cell)}
            />
          ))}
          {levelUp && run.last?.event === "clear" && (
            <LevelUpOverlay
              levelUp={levelUp}
              unit={t("Board")}
              next={`Board ${run.level} · ${run.side}×${run.side} · ${tilesFor(run.level)} tiles`}
              note={
                grew
                  ? t("Boards are {side}×{side2} from here.", { side: run.side, side2: run.side })
                  : undefined
              }
            />
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 pt-2">
        <p className="text-center text-xs text-muted-foreground" aria-live="polite">
          {verifying
            ? t("The taps you made are your score if the server agrees.")
            : t("Clearing the board adds {SCATTER_CLEAR_BONUS}.", {
                SCATTER_CLEAR_BONUS: points(SCATTER_CLEAR_BONUS),
              })}
        </p>
        <Button variant="ghost" size="sm" disabled={!accepting} onClick={() => setConfirming(true)}>
          {t("End run")}
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("End this run?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {session.offline
                ? t(
                    "Your score of {score} is kept as practice: offline runs are not verified or saved.",
                    { score: points(run.score) },
                  )
                : t("Your score of {score} is kept and sent for verification.", {
                    score: points(run.score),
                  })}
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

/** One cell: empty floor, or a tile with its arrow. */
function Cell({
  tile,
  cell,
  side,
  free,
  jammed,
  disabled,
  onTap,
}: {
  tile: ScatterCell;
  cell: number;
  side: number;
  free: boolean;
  jammed: boolean;
  disabled: boolean;
  onTap: () => void;
}) {
  if (!tile) return <span aria-hidden className="rounded-lg bg-surface-2/40" />;
  const Arrow = ARROWS[tile.dir];
  const label = t("Row {n}, column {n2}: {n3}tile pointing {n4}{n5}.", {
    n: Math.floor(cell / side) + 1,
    n2: (cell % side) + 1,
    n3: tile.turnstile ? "turnstile " : "",
    n4: DIRECTION_NAMES[tile.dir],
    n5: free ? ", lane clear" : ", blocked",
  });
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled}
      onClick={() => !disabled && onTap()}
      className={cn(
        "relative flex items-center justify-center rounded-lg border-2 transition-colors duration-150 motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tile.turnstile
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-foreground/10 bg-foreground text-background",
        jammed && "scatter-jam border-destructive",
      )}
    >
      <Arrow className="size-[55%]" strokeWidth={2.75} />
      {tile.turnstile && (
        <RotateCw
          aria-hidden
          className="absolute right-0.5 top-0.5 size-[28%] text-primary"
          strokeWidth={3}
        />
      )}
    </button>
  );
}

/** The line above the board: what just happened, or what to do. */
function statusLine(run: ScatterRun, verifying: boolean): string {
  if (verifying) return t("Verifying your run with the server…");
  if (run.outcome === "over")
    return run.ending === "jams" ? t("Three jams. The run is over.") : t("Run ended.");
  switch (run.last?.event) {
    case "jam":
      return t("Jammed — something is in the way. {n} left.", { n: SCATTER_MAX_JAMS - run.jams });
    case "stuck":
      return t("No tile could leave, so that board is lost. {n} jams left.", {
        n: SCATTER_MAX_JAMS - run.jams,
      });
    case "clear":
      return t("Board {n} cleared, +{SCATTER_CLEAR_BONUS}.", {
        n: run.level - 1,
        SCATTER_CLEAR_BONUS: points(SCATTER_CLEAR_BONUS),
      });
    default:
      return t("Tap a tile with a clear lane to send it off the board.");
  }
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
  run: ScatterRun;
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
        <p className="text-sm text-muted-foreground">
          {run.ending === "jams" ? t("Out of jams") : t("Run ended")}
        </p>
        <p className="text-5xl font-semibold tabular">{points(result.score)}</p>
        <p className="text-sm text-muted-foreground">
          {t("{tilesPlaced} {n} sent off, {clearedColumns} {n2} cleared.", {
            tilesPlaced: result.tilesPlaced,
            n: result.tilesPlaced === 1 ? t("tile") : t("tiles"),
            clearedColumns: result.clearedColumns,
            n2: result.clearedColumns === 1 ? t("board") : t("boards"),
          })}
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Duration")}</dt>
          <dd className="font-semibold tabular">{formatDuration(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Boards cleared")}</dt>
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
          ? t("Verified by replaying your taps on the server, then saved to the leaderboard.")
          : result.offline
            ? offlineResultNote()
            : t(
                "Verified by replaying your taps on the server. This was a guest run, so it is not on the leaderboard.",
              )}
        {result.duplicate && t(" This run was already recorded, so nothing was counted twice.")}
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
