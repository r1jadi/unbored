import {
  ArrowDownUp,
  Eye,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Trophy,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorState } from "@/components/common";
import { BestScore } from "@/components/game/BestScore";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { FLIPSIDE_VIEWBOX, rockColor } from "@/lib/games/flipside-view";
import { TunnelHazard, TunnelRock, TunnelRunner } from "@/components/game/FlipsideScene";
import { GameExits } from "@/components/game/GameExits";
import { RulesList } from "@/components/game/RulesList";
import { RunEndActions } from "@/components/game/RunEndActions";
import { Button } from "@/components/ui/button";
import {
  FLIPSIDE_SPACING,
  FLIPSIDE_TICK_MS,
  FLIPSIDE_WIDTH,
  hazardAt,
  type FlipsideRun,
} from "@/lib/games/flipside";
import { points } from "@/lib/format";
import { offlineResultNote } from "@/lib/games/offline";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useFlipsideRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import { t } from "@/lib/settings/language";
import { useGameSounds } from "@/lib/sound";
import { cn } from "@/lib/utils";

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES.flipside;

/**
 * The most ticks one animation frame may run: a late frame drops the time it
 * missed instead of fast-forwarding the runner into a hole it never saw.
 */
const MAX_TICKS_PER_FRAME = 4;

/** How long the near-miss call stays up, in ticks. */
const GRAZE_FLASH_TICKS = 40;

/**
 * Flipside, playing for real.
 *
 * The tunnel is a view onto `useFlipsideRun`, which owns the session, the
 * hazards laid out from its seed, and the score the server derived by replaying
 * the taps. The screen owns only the clock: how many fixed ticks have elapsed.
 */
export function FlipsideRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useFlipsideRun(slug);

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
      <Field
        key={state.session.id}
        run={state.run}
        session={state.session}
        verifying={state.status === "submitting"}
        onTap={state.tap}
        onAdvance={state.advance}
        onFinish={state.finish}
        onBegin={state.begin}
        autoStart={autoStart}
        slug={slug}
        title={title}
      />
    );
  }

  if (state.status === "finished") {
    return <Finished slug={slug} run={state.run} result={state.result} onRestart={state.restart} />;
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/** The live run: the rules first, then the tunnel. */
function Field({
  run,
  session,
  verifying,
  onTap,
  onAdvance,
  onFinish,
  onBegin,
  autoStart,
  slug,
  title,
}: {
  run: FlipsideRun;
  session: PlaySession;
  verifying: boolean;
  onTap: () => void;
  onAdvance: (ticks: number) => void;
  onFinish: () => void;
  onBegin: () => void;
  autoStart: boolean;
  slug: string;
  title: string;
}) {
  useGameSounds({
    moves: run.actions.length,
    score: run.score,
    over: run.outcome === "over",
    ending: run.stopped || run.endReason === "limit" ? "stop" : "lose",
  });
  const [started, setStarted] = useState(autoStart || run.tick > 0);

  useEffect(() => {
    if (autoStart && run.tick === 0) onBegin();
    // Once, on the first field: a retried submission remounts with a started run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fieldRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (started) fieldRef.current?.focus({ preventScroll: true });
  }, [started]);

  const accepting = !verifying && run.outcome === "playing";
  // The tunnel waits, runner idling, until the first tap.
  const moving = run.actions.length > 0;

  useReportRunProgress(started && accepting, onFinish);

  useEffect(() => {
    if (!started || !accepting || !moving) return;
    let last = performance.now();
    let owed = 0;
    let frame = requestAnimationFrame(function tick(now) {
      owed = Math.min(owed + now - last, MAX_TICKS_PER_FRAME * FLIPSIDE_TICK_MS);
      last = now;
      const ticks = Math.floor(owed / FLIPSIDE_TICK_MS);
      if (ticks > 0) {
        owed -= ticks * FLIPSIDE_TICK_MS;
        onAdvance(ticks);
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [started, accepting, moving, onAdvance]);

  const flip = useCallback(() => {
    if (accepting) onTap();
  }, [accepting, onTap]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.repeat) return;
      if (
        event.key === " " ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "w" ||
        event.key === "W"
      ) {
        event.preventDefault();
        flip();
      }
    },
    [flip],
  );

  if (!started) {
    return (
      <div className="flex flex-1 flex-col justify-center px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="enter mx-auto flex w-full max-w-sm flex-col items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
            <ArrowDownUp className="size-5 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">{t(RULES.heading)}</h1>
            <p className="text-sm text-muted-foreground">{t(RULES.summary)}</p>
          </div>

          <RulesList rules={RULES.rules} />

          <div className="flex w-full flex-col gap-2">
            <Button
              variant="play"
              size="lg"
              onClick={() => {
                onBegin();
                setStarted(true);
              }}
              autoFocus
            >
              {t("Start run")}
            </Button>
            <Button asChild variant="ghost" size="lg">
              <ExitGameLink slug={slug}>{t("Back to {title}", { title })}</ExitGameLink>
            </Button>
          </div>

          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            {session.ranked
              ? t("Signed in: this run can be ranked")
              : t("Guest run: verified, but not ranked")}
          </p>
        </div>
      </div>
    );
  }

  // The hazards on screen: the one alongside and the next few coming in.
  const onScreen = Math.ceil(FLIPSIDE_WIDTH / FLIPSIDE_SPACING) + 2;
  const hazards = Array.from({ length: onScreen }, (_, i) =>
    hazardAt(run.seed, run.passed + i, run.rulesVersion),
  );
  const grazeAge = run.lastGraze < 0 ? Infinity : run.tick - run.lastGraze;

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">{t("Score")}</dt>
          <dd className="text-2xl font-semibold tabular">{points(run.score)}</dd>
          <BestScore slug={session.gameSlug} score={run.score} />
        </dl>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {run.combo > 0 && (
            <span className="rounded-full bg-primary/15 px-2 py-1 font-semibold text-primary tabular">
              {t("Combo ×{count}", { count: run.combo })}
            </span>
          )}
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

      <div className="relative flex min-h-0 flex-1 items-center justify-center py-2">
        <div
          ref={fieldRef}
          tabIndex={0}
          role="button"
          aria-label={t("Flipside tunnel. Tap, click or press Space to flip gravity.")}
          aria-disabled={!accepting}
          onPointerDown={(event) => {
            event.preventDefault();
            fieldRef.current?.focus({ preventScroll: true });
            flip();
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "relative aspect-[3/4] max-h-full w-full max-w-md touch-none overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-surface-2 via-surface to-surface-2 outline-none select-none",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            accepting && "cursor-pointer",
          )}
        >
          <svg
            aria-hidden="true"
            viewBox={FLIPSIDE_VIEWBOX}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full"
          >
            <TunnelRock color={rockColor(run.passed)} />
            <g transform={`translate(${-run.distance} 0)`}>
              {hazards.map((hazard) => (
                <TunnelHazard key={hazard.x} hazard={hazard} />
              ))}
            </g>
            <TunnelRunner y={run.y} />
          </svg>

          <p
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-[16%] text-center text-5xl font-semibold text-foreground/80 tabular"
          >
            {points(run.score)}
          </p>

          {grazeAge < GRAZE_FLASH_TICKS && (
            <p
              key={run.lastGraze}
              aria-hidden="true"
              className="flipside-graze pointer-events-none absolute inset-x-0 top-[40%] text-center text-lg font-bold text-primary"
            >
              {t("Near miss!")}
            </p>
          )}

          {!moving && accepting && (
            <p className="pointer-events-none absolute inset-x-0 top-[52%] animate-pulse text-center text-sm font-medium text-muted-foreground">
              {t("Tap to flip")}
            </p>
          )}
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-md justify-center pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onFinish} disabled={!accepting}>
          {t("End run")}
        </Button>
      </div>

      <p className="pt-1 text-center text-xs text-muted-foreground" aria-live="polite">
        {verifying
          ? t("Verifying your run with the server…")
          : run.outcome === "over"
            ? t("The run is over. Your result is on its way.")
            : t(
                "Tap, click or press Space to flip gravity. Jump the holes; don't touch the spikes.",
              )}
      </p>
    </div>
  );
}

/** The end of a run: the score the server verified, or a guest's unranked result. */
function Finished({
  slug,
  run,
  result,
  onRestart,
}: {
  slug: string;
  run: FlipsideRun;
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
            <Eye className="size-5 text-muted-foreground" />
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {run.endReason === "crash" ? t("Wiped out") : t("Run ended")}
        </p>
        <p className="text-5xl font-semibold tabular">{points(result.score)}</p>
        <p className="text-sm text-muted-foreground">
          {run.passed === 1
            ? t("1 hazard cleared.")
            : t("{count} hazards cleared.", { count: run.passed })}
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Run time")}</dt>
          <dd className="font-semibold tabular">{formatDuration(run.tick * FLIPSIDE_TICK_MS)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Flips")}</dt>
          <dd className="font-semibold tabular">
            {run.actions.filter((action) => action % 2 === 0).length}
          </dd>
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
          ? t("Verified by replaying your run on the server, then saved to the leaderboard.")
          : result.offline
            ? offlineResultNote()
            : t(
                "Verified by replaying your run on the server. This was a guest run, so it is not on the leaderboard.",
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

/** Milliseconds as `m:ss`. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
