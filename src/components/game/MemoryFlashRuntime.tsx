import { Loader2, RotateCcw, ShieldCheck, Trophy, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ErrorState } from "@/components/common";
import { BestScore } from "@/components/game/BestScore";
import { GameExits } from "@/components/game/GameExits";
import { EndRunButton } from "@/components/game/EndRunButton";
import { SavedRunCard } from "@/components/game/SavedRunCard";
import { RunEndActions } from "@/components/game/RunEndActions";
import { LevelUpOverlay } from "@/components/game/LevelUp";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { levelUpHold, useLevelUp } from "@/lib/games/level-up";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useMemoryFlashRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import {
  boardCells,
  boardSide,
  leadInMs,
  patternAt,
  showMs,
  type MemoryFlashRun,
} from "@/lib/games/memory-flash";
import { points } from "@/lib/format";
import { useGameSounds } from "@/lib/sound";
import { offlineResultNote } from "@/lib/games/offline";

import { t } from "@/lib/settings/language";
/**
 * Memory Flash, playing for real.
 *
 * The board is a view onto `useMemoryFlashRun`, which owns the whole lifecycle: a
 * session issued by the server, the run played against its seed's patterns, and
 * the score the server derived from the submitted tap list. Nothing on this screen
 * decides a number — the score shown at the end is the one that came back from
 * verification, and until it does the screen says the run is being verified rather
 * than showing a provisional total.
 *
 * The game is endless: the pattern grows by one cell every round, the board grows
 * when the pattern outgrows it, and the flash shortens. There is no final round, so
 * the screen never shows a countdown; it shows the round, the board and the flash
 * time, which are the three things that make the next round harder than this one.
 *
 * Three things the component refuses to do, because each would be a lie:
 *
 *   - **it never offers a tap while the pattern is showing.** The cells are
 *     disabled and say why; a tap that arrives one frame after the run ended lands
 *     on a disabled board rather than throwing inside a render.
 *   - **it never keeps the pattern lit during input.** The cells light only while
 *     showing; rebuilding the pattern is the player's memory, not the board's.
 *   - **it never claims a score was saved.** A failed submission is an error with
 *     the server's own message and a retry that re-sends the identical run, not a
 *     local "saved" that a reload would disprove.
 */
export function MemoryFlashRuntime({ slug, title }: { slug: string; title: string }) {
  const state = useMemoryFlashRun(slug);

  // A signed-in player's unfinished run is offered before a new one starts.
  if (state.status === "saved") {
    return (
      <SavedRunCard
        score={state.run.score}
        where={`Round ${state.run.round}`}
        onContinue={state.continueRun}
        onNewRun={state.newRun}
        slug={slug}
        title={title}
      />
    );
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

  // A submission failure keeps the board: the run exists, it is just not verified,
  // and offering to throw it away would be the one thing the player cannot undo.
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
        // A fresh board per run: the showing always starts at round one, even
        // when the next session deals the same seed.
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

/** The live board: a showing phase, then an input phase, per round. */
function Board({
  run,
  session,
  verifying,
  onTap,
  onFinish,
}: {
  run: MemoryFlashRun;
  session: PlaySession;
  verifying: boolean;
  onTap: (cell: number) => void;
  /** Ends the run where it stands and submits it. */
  onFinish: () => void;
}) {
  useGameSounds({
    moves: run.taps.length,
    score: run.score,
    cleared: run.roundsCleared,
    over: run.outcome === "over",
    ending: run.stopped ? "stop" : "lose",
  });
  const round = run.round;
  const seed = run.seed;
  const side = boardSide(round);
  const cells = boardCells(round);
  const flash = showMs(round);
  const [showing, setShowing] = useState(true);

  // A rebuilt pattern gets a beat before the next one, with a note when the board
  // grows. The next pattern waits for it: lighting it under the beat would spend
  // its whole exposure where the player cannot see it.
  const grew = round > 1 && side > boardSide(round - 1);
  const holdMs = levelUpHold(grew);
  const levelUp = useLevelUp(round, run.score, holdMs);
  const firstRound = useRef(round);
  const [shownRound, setShownRound] = useState(round);
  const between = shownRound !== round;

  // Each round starts by lighting its pattern, then hands over to the player. The
  // exposure shortens as the run goes on, and the board can grow between rounds,
  // so both the duration and the pattern are functions of the round. The effect
  // re-runs only when the round (or run) changes: entering a cell within a round
  // must not restart the showing. A round reached by rebuilding the last one
  // waits for the level-up beat first.
  useEffect(() => {
    const delay = round === firstRound.current ? 0 : holdMs;
    setShowing(true);
    const begin = setTimeout(() => setShownRound(round), delay);
    const hide = setTimeout(() => setShowing(false), delay + leadInMs(round) + showMs(round));
    return () => {
      clearTimeout(begin);
      clearTimeout(hide);
      setShowing(false);
    };
    // `holdMs` follows the round; the showing restarts only with a new round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, seed]);

  const accepting = !showing && !between && !levelUp && !verifying && run.outcome === "playing";

  // From the first showing beat the run is live: leaving loses it.
  useReportRunProgress(!verifying && run.outcome === "playing", onFinish, session);

  const pattern = patternAt(seed, round);
  const remaining = Math.max(0, round - run.entered.length);

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">{t("Score")}</dt>
          <dd className="text-2xl font-semibold tabular">{points(run.score)}</dd>
          <BestScore slug={session.gameSlug} score={run.score} />
        </dl>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular">{t("Round {round}", { round })}</span>
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
        {verifying
          ? t("Verifying your run with the server…")
          : showing
            ? t("Watch the pattern — {round} {n} lit.", {
                round,
                n: round === 1 ? t("cell") : t("cells"),
              })
            : run.outcome === "over"
              ? t("Pattern broken.")
              : t("Your turn — {remaining} more {n} in this pattern.", {
                  remaining,
                  n: remaining === 1 ? t("cell") : t("cells"),
                })}
      </p>

      {/* The difficulty of this round, read from the rules rather than guessed:
          the board the pattern is played on and how long it stays lit. Both are
          functions of the round, so they are the same for every player. */}
      <p className="pb-1 text-center text-xs text-muted-foreground">
        <span className="tabular">
          {side}×{side}
        </span>{" "}
        {t("board · flash")} <span className="tabular">{flash} ms</span>
      </p>

      {/* A square board, centred in whatever height is left: the grid's own
          aspect ratio sizes the cells, so they stay square at every viewport
          instead of stretching to fill a tall column. The column count comes from
          the rules, because the board grows with the pattern. */}
      <div className="flex flex-1 items-center justify-center py-3">
        <div
          className={cn(
            "relative grid aspect-square w-full max-w-md",
            side <= 5 ? "gap-2" : "gap-1",
          )}
          style={{ gridTemplateColumns: `repeat(${side}, minmax(0, 1fr))` }}
          role="group"
          aria-label={t("Pattern grid, {side} by {side2}", { side, side2: side })}
        >
          {Array.from({ length: cells }, (_, index) => {
            const lit = showing ? !between && pattern.includes(index) : run.entered.includes(index);
            const entered = !showing && run.entered.includes(index);
            return (
              <button
                key={index}
                type="button"
                disabled={!accepting}
                onClick={() => onTap(index)}
                aria-label={cellLabel(index, side, run, showing, verifying, entered)}
                className={cn(
                  "press flex items-center justify-center border transition-colors",
                  side <= 5 ? "rounded-xl" : "rounded-md",
                  "motion-reduce:transition-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "active:scale-[0.97]",
                  lit
                    ? entered
                      ? "border-primary/60 bg-primary/70"
                      : "border-transparent bg-foreground"
                    : accepting
                      ? "border-border bg-surface hover:bg-surface-2"
                      : "border-transparent bg-surface/40 opacity-60",
                )}
              >
                <span className="sr-only">{t("Cell {n}", { n: index + 1 })}</span>
              </button>
            );
          })}
          {levelUp && (
            <LevelUpOverlay
              levelUp={levelUp}
              unit={t("Round")}
              next={`Round ${round} · ${round} cells · ${flash} ms flash`}
              note={
                grew ? t("The board grows to {side}×{side2}.", { side, side2: side }) : undefined
              }
            />
          )}
        </div>
      </div>

      <p className="pt-1 text-center text-xs text-muted-foreground" aria-live="polite">
        {verifying
          ? t("The cells entered so far are your score if the server agrees.")
          : t(
              "Rebuild each pattern in any order. A wrong cell ends the run. 100 points a round, with no final pattern.",
            )}
      </p>
      <EndRunButton
        score={run.score}
        offline={session.offline}
        disabled={verifying || run.outcome !== "playing"}
        onEnd={onFinish}
      />
    </div>
  );
}

/** The accessible name of a cell, which states why a tap is or is not playable. */
function cellLabel(
  index: number,
  side: number,
  run: MemoryFlashRun,
  showing: boolean,
  verifying: boolean,
  entered: boolean,
): string {
  const row = Math.floor(index / side) + 1;
  const column = (index % side) + 1;
  const position = `Cell ${index + 1}, row ${row} column ${column}`;
  if (verifying) return `${position}. The run is being verified.`;
  if (run.outcome !== "playing") return `${position}. The run has ended.`;
  if (showing) return `${position}. Watch the pattern.`;
  if (entered) return `${position}. Already lit in this round.`;
  return `${position}. Tap to rebuild the pattern.`;
}

/** The end of a run: the score the server verified, or a guest's unranked result. */
function Finished({
  slug,
  run,
  result,
  onRestart,
}: {
  slug: string;
  run: MemoryFlashRun;
  result: RunResult;
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
          {run.stopped ? t("Run ended") : t("Pattern broken")}
        </p>
        <p className="text-5xl font-semibold tabular">{points(result.score)}</p>
        <p className="text-sm text-muted-foreground">
          {t("{tilesPlaced} cells tapped, {clearedColumns} rounds cleared.", {
            tilesPlaced: result.tilesPlaced,
            clearedColumns: result.clearedColumns,
          })}
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Duration")}</dt>
          <dd className="font-semibold tabular">{formatDuration(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Rounds cleared")}</dt>
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
      />
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
