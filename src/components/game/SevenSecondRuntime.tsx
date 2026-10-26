import { Link } from "@tanstack/react-router";
import {
  Clock,
  Eye,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Timer,
  Trophy,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorState } from "@/components/common";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { RulesList } from "@/components/game/RulesList";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  currentChallenge,
  progress,
  promptOf,
  SEVEN_SECOND_BASE_MS,
  SEVEN_SECOND_BONUS_MS,
  SEVEN_SECOND_PENALTY_MS,
  type SevenSecondRun,
} from "@/lib/games/seven-second";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useSevenSecondRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";

/**
 * 7 Second, playing for real.
 *
 * The table is a view onto `useSevenSecondRun`, which owns the whole lifecycle: a
 * session issued by the server, the daily deck drawn from its seed, and the score
 * the server derived by replaying the submitted answers. The screen owns only the
 * part the rules cannot see — time. It runs the clock, decides when an answer can
 * be pressed, and ends the run when the clock empties; it never decides what an
 * answer is worth.
 *
 * Three things the component refuses to do, because each would be a lie:
 *
 *   - **it never lets the clock be started twice.** One run, one start; the timer
 *     is keyed to the start so a re-render cannot reset it.
 *   - **it never records a press the rules would not.** A press after the clock
 *     has emptied, a repeated press as the submission is verified, or a key that
 *     is not a button is ignored, so what is submitted is exactly what was played.
 *   - **it never claims a score was saved.** A failed submission is an error with
 *     the server's own message and a retry that re-sends the identical run, not a
 *     local "saved" that a reload would disprove. A daily limit is shown as a
 *     daily limit, not as a broken game.
 */

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES["seven-second"];

/** One clock tick. The clock is shown to a tenth of a second, so 100 ms is enough. */
const TICK_MS = 100;

export function SevenSecondRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useSevenSecondRun(slug);

  if (state.status === "starting") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Starting a run…</p>
      </div>
    );
  }

  if (state.status === "error" && state.stage === "start") {
    // A signed-in player who has already finished today's deck gets a 409. That is
    // the rules working, not a failure: showing the generic error state would tell
    // them the game is broken and offer a retry that can only fail again.
    if (state.error.status === 409) {
      return <DailyDone slug={slug} title={title} message={playErrorMessage(state.error)} />;
    }
    return (
      <div className="flex flex-1 flex-col justify-center px-6">
        <ErrorState
          title="Couldn't start a run"
          body={playErrorMessage(state.error)}
          onRetry={state.retry}
        />
      </div>
    );
  }

  // A submission failure keeps the run: the run exists, it is just not verified,
  // and offering to throw it away would be the one thing the player cannot undo.
  if (state.status === "error" && state.stage === "submit" && state.run && state.session) {
    return (
      <div className="flex flex-1 flex-col justify-center gap-4 px-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-2">
          <TriangleAlert className="size-5 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold">Your run was not verified</h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {playErrorMessage(state.error)} Nothing was saved, and nothing needs to be — sending the
          same run again is safe.
        </p>
        <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
          <Button variant="play" size="lg" onClick={state.retry}>
            Try submitting again
          </Button>
          <Button variant="secondary" size="lg" onClick={state.restart}>
            <RotateCcw />
            Start a new run
          </Button>
          <Button asChild variant="ghost" size="lg">
            <ExitGameLink slug={slug}>{title}</ExitGameLink>
          </Button>
        </div>
      </div>
    );
  }

  if (state.status === "playing" || state.status === "submitting") {
    return (
      <Table
        // A fresh table per run: the clock always starts at seven seconds, even
        // when the next session deals the same daily seed.
        key={state.session.id}
        run={state.run}
        session={state.session}
        verifying={state.status === "submitting"}
        onBegin={state.begin}
        autoStart={autoStart}
        onAnswer={state.answer}
        onFinish={state.finish}
        slug={slug}
        title={title}
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

/** The live run: the rules first, then the table and its clock. */
function Table({
  run,
  session,
  verifying,
  onBegin,
  autoStart,
  onAnswer,
  onFinish,
  slug,
  title,
}: {
  run: SevenSecondRun;
  session: PlaySession;
  verifying: boolean;
  onBegin: () => void;
  /** Start without the rules screen (Tap to play). */
  autoStart: boolean;
  onAnswer: (option: number) => void;
  onFinish: () => void;
  slug: string;
  title: string;
}) {
  // A retry of a failed submission re-mounts this table with the run it already
  // has; a run with answers has started, so the rules must not reappear.
  const [started, setStarted] = useState(autoStart || run.answers.length > 0);

  // Tap to play skips the rules: the run, and its clock, start at once.
  useEffect(() => {
    if (autoStart && run.answers.length === 0) onBegin();
    // Once, on the first board: a retried submission remounts with a started run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [remaining, setRemaining] = useState(SEVEN_SECOND_BASE_MS);
  const [lastResult, setLastResult] = useState<"right" | "wrong" | null>(null);
  const buttonsRef = useRef<HTMLDivElement>(null);
  const finishing = useRef(false);
  // A press is taken once per challenge. Two events landing in one frame — a
  // double tap, or a click and its key — would otherwise both read the same
  // challenge and the second would be scored against the next one, with a bonus
  // the rules had not paid for. The lock is released when the answer count moves.
  const answering = useRef(false);

  const live = started && !verifying && run.outcome === "playing";
  const accepting = live && remaining > 0;

  // A started, unverified run is progress the player would lose by leaving.
  useReportRunProgress(live, onFinish);
  const challenge = currentChallenge(run);
  const stats = progress(run);

  // Pressing Start removes the button that had focus. Moving focus to the answer
  // buttons means a keyboard player lands on them rather than at the top of the
  // page, and the number keys keep working.
  useEffect(() => {
    if (started) buttonsRef.current?.focus({ preventScroll: true });
  }, [started]);

  // The clock. One interval for the whole run, keyed on whether it is live: an
  // answer re-renders the table, and restarting the interval on every answer
  // would make a fast player's clock run slow. At zero the run ends — once.
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      setRemaining((current) => Math.max(0, current - TICK_MS));
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [live]);

  useEffect(() => {
    if (!live || remaining > 0 || finishing.current) return;
    finishing.current = true;
    onFinish();
  }, [live, remaining, onFinish]);

  // The answer landed: the next challenge is on screen, so the next press is a
  // new decision rather than a repeat of the last one.
  useEffect(() => {
    answering.current = false;
  }, [run.answers.length]);

  const press = useCallback(
    (option: number) => {
      if (!accepting || answering.current) return;
      const dealt = currentChallenge(run);
      if (!dealt) return;
      answering.current = true;

      const right = option === dealt.correct;
      // The rules score the answer; the clock pays for it. Both happen from the
      // same press, and neither can happen twice: `accepting` is false the moment
      // the clock empties.
      onAnswer(option);
      setRemaining((current) =>
        Math.max(0, current + (right ? SEVEN_SECOND_BONUS_MS : -SEVEN_SECOND_PENALTY_MS)),
      );
      setLastResult(right ? "right" : "wrong");
      buttonsRef.current?.focus({ preventScroll: true });
    },
    [accepting, onAnswer, run],
  );

  const start = useCallback(() => {
    finishing.current = false;
    onBegin();
    setStarted(true);
  }, [onBegin]);

  // Keyboard play, on the window rather than on the button group: a press must
  // work even after focus has wandered, and the game has no text inputs to steal
  // the keys. 1–3 and A–C both map to the three answers.
  useEffect(() => {
    if (!accepting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const option = keyOption(event.key);
      if (option === null) return;
      event.preventDefault();
      press(option);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [accepting, press]);

  if (!started) {
    return (
      <div className="flex flex-1 flex-col justify-center px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="enter mx-auto flex w-full max-w-sm flex-col items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
            <Timer className="size-5 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">{RULES.heading}</h1>
            <p className="text-sm text-muted-foreground">{RULES.summary}</p>
          </div>

          <RulesList rules={RULES.rules} />

          <div className="flex w-full flex-col gap-2">
            <Button variant="play" size="lg" onClick={start} autoFocus>
              Start run
            </Button>
            <Button asChild variant="ghost" size="lg">
              <ExitGameLink slug={slug}>Back to {title}</ExitGameLink>
            </Button>
          </div>

          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            {session.ranked
              ? "Signed in: this is today's ranked attempt"
              : "Guest run: verified, but not ranked — practise as often as you like"}
          </p>
        </div>
      </div>
    );
  }

  const seconds = remaining / 1000;
  const clock = seconds.toFixed(1);
  const fill = Math.min(100, Math.max(0, (remaining / SEVEN_SECOND_BASE_MS) * 100));
  const low = remaining <= 2000;

  return (
    <div
      className="flex flex-1 flex-col gap-4 px-6 pb-[max(1rem,env(safe-area-inset-bottom))]"
      aria-label="7 Second table"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Time</p>
          <p
            role="timer"
            aria-label="Time remaining"
            className={cn(
              "text-4xl font-semibold tabular transition-colors",
              low && "text-destructive",
            )}
          >
            {clock}s
          </p>
        </div>
        <dl className="flex gap-4 text-right">
          <div>
            <dt className="text-xs text-muted-foreground">Score</dt>
            <dd className="text-2xl font-semibold tabular">{run.score}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Correct</dt>
            <dd className="text-2xl font-semibold tabular">{stats.correct}</dd>
          </div>
        </dl>
      </div>

      <div
        role="progressbar"
        aria-label="Clock remaining"
        aria-valuemin={0}
        aria-valuemax={SEVEN_SECOND_BASE_MS}
        aria-valuenow={Math.round(remaining)}
        className="h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-100 ease-linear",
            low ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${fill}%` }}
        />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        {verifying ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Checking your run…</p>
            <p className="text-xs text-muted-foreground">
              The score is the server's replay, not the number on this screen.
            </p>
          </div>
        ) : (
          <>
            <div className="text-center">
              <p aria-live="polite" className="text-6xl font-semibold tabular tracking-tight">
                {challenge ? promptOf(challenge) : "—"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {lastResult === "right" && "Correct — 1.5 seconds back."}
                {lastResult === "wrong" && "Wrong — 2 seconds gone."}
                {lastResult === null && "Pick the right answer."}
              </p>
            </div>

            <div
              ref={buttonsRef}
              tabIndex={-1}
              aria-label="Answers"
              className="grid w-full max-w-sm grid-cols-3 gap-2 outline-none"
            >
              {challenge?.options.map((option, index) => (
                <Button
                  key={`${challenge.index}-${index}`}
                  variant="secondary"
                  size="lg"
                  className="h-20 text-2xl tabular"
                  aria-label={`Answer ${option}`}
                  disabled={!accepting}
                  onClick={() => press(index)}
                >
                  {option}
                </Button>
              ))}
            </div>

            <p className="text-center text-xs text-muted-foreground">
              Press <span className="tabular">1</span>–<span className="tabular">3</span> or{" "}
              <span className="tabular">A</span>–<span className="tabular">C</span> · right answers
              add 1.5s · wrong answers cost 2s
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** The button a key names, or null when the key is not an answer. */
function keyOption(key: string): number | null {
  switch (key) {
    case "1":
    case "a":
    case "A":
      return 0;
    case "2":
    case "b":
    case "B":
      return 1;
    case "3":
    case "c":
    case "C":
      return 2;
    default:
      return null;
  }
}

/** The end of a run: the score the server verified, or a guest's unranked result. */
function Finished({
  slug,
  run,
  result,
  onRestart,
}: {
  slug: string;
  run: SevenSecondRun;
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
          {run.endReason === "answers" ? "Sixty answers — the deck is done" : "Time's up"}
        </p>
        <p className="text-5xl font-semibold tabular">{result.score}</p>
        <p className="text-sm text-muted-foreground">
          {run.correct} correct of {run.answers.length} answered
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Duration</dt>
          <dd className="font-semibold tabular">{formatDuration(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Correct</dt>
          <dd className="font-semibold tabular">{run.correct}</dd>
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
          ? "Verified by replaying your answers on the server, then saved to the leaderboard. That was today's ranked attempt."
          : "Verified by replaying your answers on the server. This was a guest run, so it is not on the leaderboard."}
        {result.duplicate && " This run was already recorded, so nothing was counted twice."}
      </p>

      <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
        {result.ranked ? (
          <p className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-surface px-3 py-2 text-xs text-muted-foreground">
            <Clock className="size-3.5" />
            The next daily deck arrives at midnight UTC.
          </p>
        ) : (
          <Button variant="play" size="lg" onClick={onRestart} autoFocus>
            <RotateCcw />
            Play again
          </Button>
        )}
        <Button asChild variant="secondary" size="lg">
          <Link to="/leaderboards/$id" params={{ id: slug }}>
            See the leaderboard
          </Link>
        </Button>
        {!result.ranked && (
          <Button asChild variant="ghost" size="lg">
            <Link to="/login" search={{ redirect: `/games/${slug}` }}>
              Sign in to rank your scores
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

/** Today's ranked attempt is already in; this is the rules, not a failure. */
function DailyDone({ slug, title, message }: { slug: string; title: string; message: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 px-6 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-2">
        <Clock className="size-5 text-muted-foreground" />
      </div>
      <h1 className="text-xl font-semibold">Today's attempt is done</h1>
      <p className="mx-auto max-w-sm text-sm text-muted-foreground">{message}</p>
      <p className="mx-auto max-w-sm text-xs text-muted-foreground">
        One ranked run a day keeps the daily board a comparison of the same deck. The next one
        arrives at midnight UTC.
      </p>
      <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
        <Button asChild variant="play" size="lg">
          <Link to="/leaderboards/$id" params={{ id: slug }}>
            See the leaderboard
          </Link>
        </Button>
        <Button asChild variant="ghost" size="lg">
          <ExitGameLink slug={slug}>Back to {title}</ExitGameLink>
        </Button>
      </div>
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
