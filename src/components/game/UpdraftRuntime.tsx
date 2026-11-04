import { Eye, Loader2, RotateCcw, ShieldCheck, Trophy, TriangleAlert, Wind } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorState } from "@/components/common";
import { BestScore } from "@/components/game/BestScore";
import { GameExits } from "@/components/game/GameExits";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { RunEndActions } from "@/components/game/RunEndActions";
import { RulesList } from "@/components/game/RulesList";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  UPDRAFT_COLUMN_WIDTH,
  UPDRAFT_GLIDER_RADIUS,
  UPDRAFT_GLIDER_X,
  UPDRAFT_GROUND,
  UPDRAFT_HEIGHT,
  UPDRAFT_MAX_FALL,
  UPDRAFT_SPACING,
  UPDRAFT_TICK_MS,
  UPDRAFT_WIDTH,
  columnAt,
  type UpdraftRun,
} from "@/lib/games/updraft";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useUpdraftRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import { points } from "@/lib/format";
import { useGameSounds } from "@/lib/sound";
import { offlineResultNote } from "@/lib/games/offline";

import { t } from "@/lib/settings/language";
/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES.updraft;

/**
 * The most ticks one animation frame may run. A frame that arrives late — a
 * busy main thread, a tab coming back from the background — drops the time it
 * missed instead of fast-forwarding the glider into a column it never saw.
 */
const MAX_TICKS_PER_FRAME = 4;

/** One light-and-dark stripe of the ground, in world units. */
const GROUND_STRIPE = 6_000;

/** A world length as a share of the field's width or height, for CSS. */
const across = (units: number) => `${(units / UPDRAFT_WIDTH) * 100}%`;
const down = (units: number) => `${(units / UPDRAFT_HEIGHT) * 100}%`;

/**
 * Flutter (slug `updraft`), playing for real.
 *
 * The field is a view onto `useUpdraftRun`, which owns the whole lifecycle: a
 * session issued by the server, the columns laid out from its seed, and the score
 * the server derived by replaying the flaps. The screen owns only the clock: it
 * decides how many fixed ticks have elapsed, never what a tick does — so the
 * flight on screen and the flight the server replays are the same flight.
 */
export function UpdraftRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useUpdraftRun(slug);

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

  // A submission failure keeps the run: it exists, it is just not verified.
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
        onFlap={state.flap}
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

/** The live run: the rules first, then the field. */
function Field({
  run,
  session,
  verifying,
  onFlap,
  onAdvance,
  onFinish,
  onBegin,
  autoStart,
  slug,
  title,
}: {
  run: UpdraftRun;
  session: PlaySession;
  verifying: boolean;
  onFlap: () => void;
  onAdvance: (ticks: number) => void;
  onFinish: () => void;
  /** Starts the run's clock; the time spent on the rules is not the run's. */
  onBegin: () => void;
  autoStart: boolean;
  slug: string;
  title: string;
}) {
  useGameSounds({
    moves: run.actions.length,
    score: run.passed,
    over: run.outcome === "over",
    ending: run.stopped || run.endReason === "limit" ? "stop" : "lose",
  });
  // A retried submission re-mounts with a run that has flown: no rules again.
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
  // The world waits, glider bobbing, until the first flap.
  const airborne = run.actions.length > 0;

  useReportRunProgress(started && accepting, onFinish);

  // The clock: fixed ticks, as many as real time allows, never more.
  useEffect(() => {
    if (!started || !accepting || !airborne) return;
    let last = performance.now();
    let owed = 0;
    let frame = requestAnimationFrame(function tick(now) {
      owed = Math.min(owed + now - last, MAX_TICKS_PER_FRAME * UPDRAFT_TICK_MS);
      last = now;
      const ticks = Math.floor(owed / UPDRAFT_TICK_MS);
      if (ticks > 0) {
        owed -= ticks * UPDRAFT_TICK_MS;
        onAdvance(ticks);
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [started, accepting, airborne, onAdvance]);

  const flap = useCallback(() => {
    if (accepting) onFlap();
  }, [accepting, onFlap]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key === " " || event.key === "ArrowUp" || event.key === "w" || event.key === "W") {
        event.preventDefault();
        flap();
      }
    },
    [flap],
  );

  if (!started) {
    return (
      <div className="flex flex-1 flex-col justify-center px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="enter mx-auto flex w-full max-w-sm flex-col items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
            <Wind className="size-5 text-muted-foreground" />
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

  // The columns on screen: the one just passed, and the next few coming in.
  const first = Math.max(0, run.passed - 1);
  const onScreen = Math.ceil(UPDRAFT_WIDTH / UPDRAFT_SPACING) + 2;
  const columns = Array.from({ length: onScreen }, (_, i) => columnAt(run.seed, first + i)).filter(
    (column) => {
      const left = column.x - run.distance;
      return left < UPDRAFT_WIDTH && left + UPDRAFT_COLUMN_WIDTH > 0;
    },
  );
  const tilt = airborne ? Math.max(-25, Math.min(70, (run.vy / UPDRAFT_MAX_FALL) * 70)) : 0;
  const diameter = UPDRAFT_GLIDER_RADIUS * 2;
  // The ground's stripes move with the field, wrapping every stripe.
  const groundShift = -(run.distance % GROUND_STRIPE);
  const stripe = (GROUND_STRIPE / (UPDRAFT_WIDTH + GROUND_STRIPE)) * 100;

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">{t("Score")}</dt>
          <dd className="text-2xl font-semibold tabular">{points(run.score)}</dd>
          <BestScore slug={session.gameSlug} score={run.score} />
        </dl>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular">
            {run.passed} {run.passed === 1 ? t("gap") : t("gaps")}
          </span>
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
          aria-label={t("Flutter field. Tap, click or press Space to flap.")}
          aria-disabled={!accepting}
          onPointerDown={(event) => {
            event.preventDefault();
            fieldRef.current?.focus({ preventScroll: true });
            flap();
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "relative aspect-[3/4] max-h-full w-full max-w-md touch-none overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-surface-2 to-surface outline-none select-none",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            accepting && "cursor-pointer",
          )}
        >
          {/* The columns: a block above the gap and one below it, down to the ground. */}
          {columns.map((column) => {
            const left = across(column.x - run.distance);
            const width = across(UPDRAFT_COLUMN_WIDTH);
            const bottom = column.top + column.gap;
            return (
              <div key={column.x} aria-hidden="true">
                <div
                  className="absolute top-0 rounded-b-xl border-x-2 border-b-4 border-background/25 bg-game-2"
                  style={{ left, width, height: down(column.top) }}
                />
                <div
                  className="absolute rounded-t-xl border-x-2 border-t-4 border-background/25 bg-game-2"
                  style={{ left, width, top: down(bottom), height: down(UPDRAFT_GROUND - bottom) }}
                />
              </div>
            );
          })}

          {/* The ground. */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 overflow-hidden border-t-2 border-border bg-surface-2"
            style={{ height: down(UPDRAFT_HEIGHT - UPDRAFT_GROUND) }}
          >
            <div
              className="absolute inset-y-0"
              style={{
                left: across(groundShift),
                width: `calc(100% + ${across(GROUND_STRIPE)})`,
                // Stops are shares of this strip, which is one stripe wider than the field.
                backgroundImage: `repeating-linear-gradient(90deg, color-mix(in oklab, var(--foreground) 7%, transparent) 0 ${stripe / 2}%, transparent ${stripe / 2}% ${stripe}%)`,
              }}
            />
          </div>

          {/* The glider. */}
          <div
            aria-hidden="true"
            className={cn("absolute", !airborne && accepting && "updraft-hover")}
            style={{
              left: across(UPDRAFT_GLIDER_X - UPDRAFT_GLIDER_RADIUS),
              top: down(run.y - UPDRAFT_GLIDER_RADIUS),
              width: across(diameter),
              aspectRatio: "1",
            }}
          >
            <div
              className="relative size-full rounded-full bg-primary shadow-md ring-2 ring-background/40"
              style={{ transform: `rotate(${tilt}deg)` }}
            >
              <span className="absolute top-[22%] right-[14%] size-[30%] rounded-full bg-background">
                <span className="absolute top-[25%] right-[15%] size-1/2 rounded-full bg-foreground" />
              </span>
              <span
                className={cn(
                  "absolute top-[48%] left-[-8%] h-[30%] w-[55%] rounded-full bg-primary-foreground/25 transition-transform duration-100",
                  run.vy < -900 ? "-rotate-30" : "rotate-12",
                )}
              />
            </div>
          </div>

          {/* The score, large, over the sky. */}
          <p
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-[6%] text-center text-5xl font-semibold text-foreground/80 tabular"
          >
            {points(run.score)}
          </p>

          {!airborne && accepting && (
            <p className="pointer-events-none absolute inset-x-0 top-[62%] animate-pulse text-center text-sm font-medium text-muted-foreground">
              {t("Tap to flap")}
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
                "Tap, click or press Space to flap. Thread the gaps; don't touch the columns or the ground.",
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
  run: UpdraftRun;
  result: RunResult;
  onRestart: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 px-6 pb-[max(1rem,env(safe-area-inset-bottom))] text-center">
      <div className="enter flex flex-col items-center gap-2">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
          {result.ranked ? (
            <Trophy className="size-5 text-muted-foreground" />
          ) : (
            <Eye className="size-5 text-muted-foreground" />
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {run.endReason === "crash" ? t("You hit the wall") : t("Run ended")}
        </p>
        <p className="text-5xl font-semibold tabular">{points(result.score)}</p>
        <p className="text-sm text-muted-foreground">
          {run.passed} {run.passed === 1 ? t("gap") : t("gaps")} threaded.
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Flight time")}</dt>
          <dd className="font-semibold tabular">{formatDuration(run.tick * UPDRAFT_TICK_MS)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Flaps")}</dt>
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
          ? t("Verified by replaying your flight on the server, then saved to the leaderboard.")
          : result.offline
            ? offlineResultNote()
            : t(
                "Verified by replaying your flight on the server. This was a guest run, so it is not on the leaderboard.",
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
