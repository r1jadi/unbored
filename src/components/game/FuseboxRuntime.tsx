import { Loader2, RotateCcw, ShieldCheck, Trophy, TriangleAlert, Zap } from "lucide-react";
import { useEffect, useState } from "react";

import { ErrorState } from "@/components/common";
import { BestScore } from "@/components/game/BestScore";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { FuseBolts, FuseCellFace, fuseCellClass } from "@/components/game/FuseboxCell";
import { GameExits } from "@/components/game/GameExits";
import { LevelUpOverlay } from "@/components/game/LevelUp";
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
import {
  chargedCells,
  FUSEBOX_CLEAR_SPARKS,
  FUSEBOX_SIDE,
  missedTap,
  refundSteps,
  SHIELDED,
  shieldsFor,
  SURGE,
  surgesFor,
  type FuseCell,
  type FuseboxMissedTap,
  type FuseboxRun,
} from "@/lib/games/fusebox";
import { fuseboxTiming, useChainPlayback } from "@/lib/games/fusebox-waves";
import { levelUpHold, useLevelUp } from "@/lib/games/level-up";
import { offlineResultNote } from "@/lib/games/offline";
import { GAME_RULES } from "@/lib/games/rules";
import { endRunMessage, useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useFuseboxRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import { t } from "@/lib/settings/language";
import { useGameSounds } from "@/lib/sound";
import { cn } from "@/lib/utils";

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES.fusebox;

/** The sparks at which the meter starts to warn. */
const LOW_SPARKS = 2;

/**
 * Fusebox, playing for real.
 *
 * The board is a view onto `useFuseboxRun`, which owns the lifecycle: the rules
 * first, a session issued when the player presses Start, boards dealt from its
 * seed, and the score the server derived from the submitted taps. Nothing here
 * decides a number. Every cell is a real button.
 */
export function FuseboxRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useFuseboxRun(slug, autoStart);

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
          <Zap className="size-5 text-muted-foreground" />
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
  if (level > 1 && surgesFor(level) > 0 && surgesFor(level - 1) === 0) {
    return t("Surge cells appear: they fire diagonally too.");
  }
  if (level > 1 && shieldsFor(level) > 0 && shieldsFor(level - 1) === 0) {
    return t("Shielded cells appear: the first hit only breaks the shield.");
  }
  return undefined;
}

/** A cell's name for a screen reader. */
function cellLabel(cell: FuseCell, at: number): string {
  const where = { n: Math.floor(at / FUSEBOX_SIDE) + 1, n2: (at % FUSEBOX_SIDE) + 1 };
  if (cell.kind === SURGE) {
    return t("Row {n}, column {n2}: surge cell, charge {charge}.", {
      ...where,
      charge: cell.charge,
    });
  }
  if (cell.kind === SHIELDED) {
    return t("Row {n}, column {n2}: shielded cell, charge {charge}.", {
      ...where,
      charge: cell.charge,
    });
  }
  return t("Row {n}, column {n2}: charge {charge}.", { ...where, charge: cell.charge });
}

/** The live run: one board at a time. */
function Board({
  run,
  session,
  verifying,
  onTap,
  onFinish,
}: {
  run: FuseboxRun;
  session: PlaySession;
  verifying: boolean;
  onTap: (cell: number) => void;
  onFinish: () => void;
}) {
  // The chain's rising notes are the scoring sound, so this hook is not told the score.
  useGameSounds({
    moves: run.actions.length,
    score: 0,
    cleared: run.levelsCleared,
    over: run.outcome === "over",
    ending: run.ending === "sparks" ? "lose" : "stop",
  });
  const [confirming, setConfirming] = useState(false);
  const playback = useChainPlayback(run);
  const last = run.last;

  // A cleared board stays on screen until its chain has finished, so the level-up
  // beat follows the chain that earned it instead of covering it.
  const shownLevel = playback.wave && last ? last.level : run.level;
  const note = nextBoardNote(run.level);
  const levelUp = useLevelUp(shownLevel, run.score, levelUpHold(note !== undefined));
  const live = !verifying && run.outcome === "playing" && !levelUp;

  useReportRunProgress(live && !playback.wave, onFinish, session);

  const cells = playback.wave ? playback.wave.cells : run.cells;
  const fired = playback.wave?.fired ?? [];
  const charged = chargedCells(cells);
  const [one, two, three] = refundSteps(shownLevel);
  const score = run.score - playback.pending;

  const press = (cell: number) => {
    // A tap during a chain only hurries it along: the board on screen is not yet the
    // board the tap would land on.
    if (playback.wave) playback.skip();
    else if (live) onTap(cell);
  };

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">{t("Score")}</dt>
          <dd className="text-2xl font-semibold tabular">{points(score)}</dd>
          <BestScore slug={session.gameSlug} score={score} />
        </dl>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular">{t("Board {level}", { level: shownLevel })}</span>
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
        <span className="tabular">{t("{charged} charged cells", { charged })}</span>
        <span
          role="img"
          aria-label={
            run.sparks === 1 ? t("1 spark left") : t("{n} sparks left", { n: run.sparks })
          }
          className={cn(
            "inline-flex items-center gap-1 text-base font-semibold tabular text-foreground",
            run.sparks <= LOW_SPARKS && "text-destructive",
          )}
        >
          <Zap aria-hidden className="size-4 fill-current" />
          {run.sparks}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center py-3">
        <div
          role="group"
          aria-label={t("Board {level}, {charged} charged cells.", {
            level: shownLevel,
            charged,
          })}
          className="relative grid aspect-square w-full max-w-md gap-1.5 rounded-2xl bg-surface p-2 [--fusebox-inset:0.5rem] sm:gap-2 sm:p-3 sm:[--fusebox-inset:0.75rem]"
          style={{
            gridTemplateColumns: `repeat(${FUSEBOX_SIDE}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${FUSEBOX_SIDE}, minmax(0, 1fr))`,
          }}
        >
          {cells.map((cell, at) => (
            <button
              // A new board gets new cells, so nothing animates from the old one.
              key={`${shownLevel}:${at}`}
              type="button"
              aria-label={cellLabel(cell, at)}
              aria-disabled={!live}
              onClick={() => press(at)}
              className={cn(
                "relative flex items-center justify-center rounded-lg transition-colors duration-100 motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                fuseCellClass(cell),
              )}
            >
              <FuseCellFace cell={cell} popping={fired.includes(at)} />
            </button>
          ))}
          {playback.wave && (
            <>
              <FuseBolts
                key={playback.number}
                bolts={playback.wave.bolts}
                durationMs={fuseboxTiming.waveMs}
              />
              <div
                key={`chain-${playback.number}`}
                aria-hidden
                className="fusebox-chain pointer-events-none absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 text-center"
              >
                <p className="text-4xl font-bold tabular text-foreground drop-shadow-[0_2px_6px_oklch(0_0_0/0.6)]">
                  +{points(playback.wave.gain)}
                </p>
                {playback.number > 1 && (
                  <p className="text-sm font-semibold text-primary">
                    {t("Wave {n}", { n: playback.number })}
                  </p>
                )}
              </div>
            </>
          )}
          {levelUp && last?.cleared && (
            <LevelUpOverlay
              levelUp={levelUp}
              unit={t("Board")}
              next={t("Board {level}", { level: run.level })}
              note={note}
            />
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 pt-2">
        <p className="text-center text-xs text-muted-foreground tabular">
          {t("Sparks back: {one} pops +1 · {two} pops +2 · {three} pops +3", { one, two, three })}
        </p>
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
function statusLine(run: FuseboxRun, verifying: boolean): string {
  if (verifying) return t("Verifying your run with the server…");
  if (run.outcome === "over") {
    return run.ending === "sparks" ? t("Out of sparks. The run is over.") : t("Run ended.");
  }
  const last = run.last;
  if (!last) {
    return t("Tap a cell to add charge. At {n} it pops.", { n: 4 });
  }
  if (last.cleared) {
    return t("Board {n} cleared: +{FUSEBOX_CLEAR_SPARKS} sparks.", {
      n: last.level,
      FUSEBOX_CLEAR_SPARKS,
    });
  }
  if (last.refund > 0) {
    return last.refund === 1
      ? t("{pops} pops: 1 spark back.", { pops: last.pops })
      : t("{pops} pops: {refund} sparks back.", { pops: last.pops, refund: last.refund });
  }
  if (run.sparks === 1) return t("Last spark. Make it count.");
  if (last.pops > 0) {
    return last.pops === 1
      ? t("1 pop. Chains pay sparks back.")
      : t("{pops} pops. Longer chains pay sparks back.", { pops: last.pops });
  }
  return t("Charged. Line up a chain.");
}

/** Plays the tap that would have saved the run: the board, then each of its waves. */
function MissedTapCard({ missed }: { missed: FuseboxMissedTap }) {
  const frames = [missed.cells, ...missed.waves.map((wave) => wave.cells)];
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (document.documentElement.classList.contains("a11y-reduce-motion")) return;
    const timer = setInterval(() => setFrame((now) => (now + 1) % (frames.length + 2)), 420);
    return () => clearInterval(timer);
  }, [frames.length]);

  // The last frame holds for a beat before the loop starts over.
  const index = Math.min(frame, frames.length - 1);
  const cells = frames[index]!;
  const wave = index > 0 ? missed.waves[index - 1]! : null;
  const row = Math.floor(missed.cell / FUSEBOX_SIDE) + 1;
  const column = (missed.cell % FUSEBOX_SIDE) + 1;

  return (
    <section className="mx-auto flex w-full max-w-xs items-center gap-3 rounded-xl bg-surface p-3 text-left">
      <div
        role="img"
        aria-label={t("The missed tap: row {row}, column {column}.", { row, column })}
        className="relative grid aspect-square w-24 shrink-0 gap-0.5 [--fusebox-inset:0px]"
        style={{ gridTemplateColumns: `repeat(${FUSEBOX_SIDE}, minmax(0, 1fr))` }}
      >
        {cells.map((cell, at) => (
          <span
            key={at}
            className={cn(
              "relative flex items-center justify-center rounded-[3px]",
              fuseCellClass(cell),
              at === missed.cell && index === 0 && "ring-2 ring-foreground",
            )}
          >
            {wave?.fired.includes(at) && (
              <span aria-hidden className="fusebox-pop absolute inset-0 rounded-[inherit]" />
            )}
          </span>
        ))}
        {wave && <FuseBolts key={index} bolts={wave.bolts} durationMs={420} />}
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{t("One tap could have saved this run")}</h2>
        <p className="text-xs text-muted-foreground">
          {missed.pops === 1
            ? t("Row {row}, column {column} would have popped 1 cell for +{gain}.", {
                row,
                column,
                gain: points(missed.gain),
              })
            : t("Row {row}, column {column} would have popped {pops} cells for +{gain}.", {
                row,
                column,
                pops: missed.pops,
                gain: points(missed.gain),
              })}
        </p>
      </div>
    </section>
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
  run: FuseboxRun;
  onRestart: () => void;
}) {
  const [missed] = useState(() => missedTap(run));
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
          {run.ending === "sparks" ? t("Out of sparks") : t("Run ended")}
        </p>
        <p className="text-5xl font-semibold tabular">{points(result.score)}</p>
        <p className="text-sm text-muted-foreground">
          {t("{tilesPlaced} {n} popped, {clearedColumns} {n2} cleared.", {
            tilesPlaced: result.tilesPlaced,
            n: result.tilesPlaced === 1 ? t("cell") : t("cells"),
            clearedColumns: result.clearedColumns,
            n2: result.clearedColumns === 1 ? t("board") : t("boards"),
          })}
        </p>
      </div>

      {missed && <MissedTapCard missed={missed} />}

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Biggest chain")}</dt>
          <dd className="font-semibold tabular">{run.bestChain}</dd>
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
