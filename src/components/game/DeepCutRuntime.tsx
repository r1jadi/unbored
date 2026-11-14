import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Bomb,
  CalendarDays,
  Clock,
  Infinity as InfinityIcon,
  Loader2,
  RotateCcw,
  SendHorizontal,
  ShieldCheck,
  TriangleAlert,
  Waves,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { ErrorState } from "@/components/common";
import { DeepCutDive } from "@/components/game/DeepCutDive";
import { DeepCutParty } from "@/components/game/DeepCutParty";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { GameExits } from "@/components/game/GameExits";
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
import { msUntilLocalMidnight } from "@/lib/games/crossword";
import {
  dayLabel,
  DEEP_CUT_MAX_POINTS,
  DEEP_CUT_QUESTIONS,
  deepestTier,
  fetchArchiveDays,
  ratingFor,
  shareGrid,
  tierInfo,
  TIERS,
  totalPoints,
  verdictLabel,
  type DeepCutMode,
  type DeepCutQuestion,
  type PlayedTurn,
  type Tier,
} from "@/lib/games/deep-cut";
import { useDeepCutRun, type DeepCutControls } from "@/lib/games/deep-cut-run";
import type { Check, CheckResult } from "@/lib/games/deep-cut";
import { GAME_RULES } from "@/lib/games/rules";
import { playErrorMessage } from "@/lib/games/sessions";
import { useGameSounds } from "@/lib/sound";
import { t } from "@/lib/settings/language";
import { cn } from "@/lib/utils";

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES["deep-cut"];

/**
 * The colour of each depth, sunlit to black. The light tiers take dark text and
 * the deep ones light text, in both themes.
 */
const TIER_STYLE: Record<Tier, { background: string; color: string }> = {
  1: { background: "oklch(0.9 0.13 95)", color: "oklch(0.25 0.04 95)" },
  2: { background: "oklch(0.82 0.13 165)", color: "oklch(0.22 0.05 165)" },
  3: { background: "oklch(0.68 0.13 225)", color: "oklch(0.18 0.05 225)" },
  4: { background: "oklch(0.52 0.16 285)", color: "oklch(0.97 0.01 285)" },
  5: { background: "oklch(0.36 0.11 270)", color: "oklch(0.95 0.01 270)" },
  6: { background: "oklch(0.2 0.07 280)", color: "oklch(0.92 0.06 330)" },
};

function tierStyle(tier: Tier | null | undefined): CSSProperties | undefined {
  return tier ? TIER_STYLE[tier] : undefined;
}

/**
 * Deep Cut, playing for real: name something correct that few others would.
 *
 * The screen is a view onto `useDeepCutRun`. Questions arrive from the server one
 * at a time as their clocks start, and every verdict and point is the server's.
 */
export function DeepCutRuntime({ slug, title }: { slug: string; title: string }) {
  const state = useDeepCutRun(slug);
  const [party, setParty] = useState(false);

  if (party && state.status === "intro") {
    return <DeepCutParty onExit={() => setParty(false)} />;
  }

  switch (state.status) {
    case "intro":
      return <Intro state={state} slug={slug} title={title} onParty={() => setParty(true)} />;
    case "starting":
    case "finishing":
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {state.status === "finishing" ? t("Surfacing with your score…") : t("Diving…")}
          </p>
        </div>
      );
    case "question":
    case "answering":
      return (
        <QuestionScreen
          key={state.question.position}
          question={state.question}
          deadline={state.deadline}
          turns={state.turns}
          answering={state.status === "answering" ? state.answer : null}
          mode={state.mode}
          onSubmit={state.submit}
          onCheck={state.check}
          onEnd={state.end}
        />
      );
    case "reveal":
      return (
        <Reveal
          key={state.question.position}
          question={state.question}
          turn={state.turns[state.turns.length - 1]!}
          turns={state.turns}
          mode={state.mode}
          onNext={state.next}
        />
      );
    case "finished":
      return <Finished state={state} slug={slug} />;
    case "played":
      return <DailyDone slug={slug} title={title} onPractice={state.begin} />;
    case "error":
      return <ErrorScreen state={state} slug={slug} title={title} />;
  }
}

// ── The mode picker ─────────────────────────────────────────────────────────

function Intro({
  state,
  slug,
  title,
  onParty,
}: {
  state: DeepCutControls;
  slug: string;
  title: string;
  onParty: () => void;
}) {
  const [archive, setArchive] = useState(false);
  if (archive) {
    return (
      <ArchivePicker
        onPick={(day) => state.begin("archive", day)}
        onBack={() => setArchive(false)}
      />
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="enter m-auto flex w-full max-w-sm flex-col items-center gap-4 py-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
          <Waves className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{t(RULES.heading)}</h1>
          <p className="text-sm text-muted-foreground">{t(RULES.summary)}</p>
        </div>

        <TierLadder />
        <RulesList rules={RULES.rules} />

        <div className="flex w-full flex-col gap-2">
          <Button variant="play" size="lg" onClick={() => state.begin("daily")} autoFocus>
            {t("Dive into today's seven")}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => state.begin("unlimited")}>
              <InfinityIcon />
              {t("Unlimited")}
            </Button>
            <Button variant="secondary" size="lg" onClick={() => setArchive(true)}>
              <CalendarDays />
              {t("Archive")}
            </Button>
          </div>
          <Button variant="secondary" size="lg" onClick={onParty}>
            <Bomb />
            {t("Party: hot potato")}
          </Button>
          <Button asChild variant="ghost" size="lg">
            <ExitGameLink slug={slug}>{t("Back to {title}", { title })}</ExitGameLink>
          </Button>
        </div>

        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          {state.signedIn
            ? t("Signed in: one ranked dive a day. Unlimited and the archive are practice.")
            : t("Guest run: verified, but not ranked")}
        </p>
      </div>
    </div>
  );
}

/** The six depths and what each is worth. */
function TierLadder({ highlight }: { highlight?: Tier | null }) {
  return (
    <ol
      className="w-full overflow-hidden rounded-2xl text-left text-sm"
      aria-label={t("Rarity tiers")}
    >
      {TIERS.map((tier) => (
        <li
          key={tier.tier}
          className={cn(
            "flex items-center justify-between px-4 py-1 text-[13px] transition-opacity",
            highlight !== undefined && highlight !== tier.tier && "opacity-45",
          )}
          style={tierStyle(tier.tier)}
        >
          <span className="font-medium">{t(tier.name)}</span>
          <span className="tabular text-xs opacity-80">
            {tier.depth} · {t("{n} pts", { n: tier.points })}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ArchivePicker({ onPick, onBack }: { onPick: (day: number) => void; onBack: () => void }) {
  const [days, setDays] = useState<number[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchArchiveDays(controller.signal)
      .then(setDays)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setFailed(playErrorMessage(error));
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="enter mx-auto flex w-full max-w-sm flex-col gap-4 py-6">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">{t("Past dives")}</h1>
          <p className="text-sm text-muted-foreground">
            {t(
              "Any of the last month's daily sets, as practice. A question that's back in play today is swapped for another.",
            )}
          </p>
        </div>
        {failed && <p className="text-center text-sm text-destructive">{failed}</p>}
        {!days && !failed && (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        )}
        {days && (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {days.map((day) => (
              <li key={day}>
                <Button variant="secondary" className="w-full" onClick={() => onPick(day)}>
                  {dayLabel(day)}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="ghost" onClick={onBack}>
          {t("Back")}
        </Button>
      </div>
    </div>
  );
}

// ── A question ──────────────────────────────────────────────────────────────

/** Seven dots across the top: answered ones in their depth's colour. */
function Progress({ turns, position }: { turns: readonly PlayedTurn[]; position: number }) {
  return (
    <ol
      className="flex items-center gap-1.5"
      aria-label={t("Question {n} of {total}", { n: position + 1, total: DEEP_CUT_QUESTIONS })}
    >
      {Array.from({ length: DEEP_CUT_QUESTIONS }, (_, index) => {
        const turn = turns[index];
        return (
          <li
            key={index}
            className={cn(
              "h-2 w-6 rounded-full bg-surface-2 transition-colors",
              index === position && !turn && "bg-foreground/50",
              turn && turn.verdict !== "correct" && "bg-destructive/50",
            )}
            style={
              turn?.verdict === "correct"
                ? { background: TIER_STYLE[turn.tier ?? 1].background }
                : undefined
            }
          />
        );
      })}
    </ol>
  );
}

function TopBar({
  turns,
  position,
  mode,
  onEnd,
}: {
  turns: readonly PlayedTurn[];
  position: number;
  mode: DeepCutMode;
  onEnd?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-3">
      <div className="flex flex-col gap-1">
        <Progress turns={turns} position={position} />
        <span className="text-xs text-muted-foreground">
          {mode === "daily"
            ? t("Today's dive")
            : mode === "unlimited"
              ? t("Unlimited · practice")
              : t("Archive · practice")}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="tabular text-sm font-semibold" aria-label={t("Points so far")}>
          {t("{n} pts", { n: totalPoints(turns) })}
        </span>
        {onEnd && (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("End run")}
              onClick={() => setConfirming(true)}
            >
              <X />
            </Button>
            <AlertDialog open={confirming} onOpenChange={setConfirming}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("Surface now?")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {mode === "daily"
                      ? t(
                          "Your answers so far are scored and saved. The questions you haven't seen count as zero, and today's dive is used up.",
                        )
                      : t("Your answers so far are totalled. The rest are skipped.")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("Keep diving")}</AlertDialogCancel>
                  <AlertDialogAction onClick={onEnd}>{t("End run")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
    </div>
  );
}

/** Milliseconds left until `deadline`, ticking. */
function useCountdown(deadline: number, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [running]);
  return Math.max(0, deadline - now);
}

function Countdown({ left, seconds }: { left: number; seconds: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.min(1, left / (seconds * 1000));
  const shown = Math.ceil(left / 1000);
  const urgent = shown <= 5;
  return (
    <div
      className={cn("relative size-16", urgent ? "text-destructive" : "text-primary")}
      role="timer"
      aria-label={t("{n} seconds left", { n: shown })}
    >
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth="6"
        />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          className="deep-cut-ring"
        />
      </svg>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center text-lg font-semibold tabular text-foreground",
          urgent && "animate-pulse text-destructive motion-reduce:animate-none",
        )}
      >
        {shown}
      </span>
    </div>
  );
}

/** The answer's normalised form, to tell whether it changed since its check. */
function sameAnswer(a: string, b: string): boolean {
  const fold = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  return fold(a) === fold(b);
}

/** Why an answer can't go in yet, in words. */
const CHECK_MESSAGES: Partial<Record<CheckResult, string>> = {
  invalid: "Not a valid answer. Try another.",
  ambiguous: "That's close to more than one answer. Check the spelling.",
};

function QuestionScreen({
  question,
  deadline,
  turns,
  answering,
  mode,
  onSubmit,
  onCheck,
  onEnd,
}: {
  question: DeepCutQuestion;
  deadline: number;
  turns: readonly PlayedTurn[];
  answering: string | null;
  mode: DeepCutMode;
  onSubmit: (answer: string) => void;
  onCheck: (answer: string) => Promise<Check>;
  onEnd: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const latest = useRef(answer);
  latest.current = answer;
  const left = useCountdown(deadline, answering === null);
  const input = useRef<HTMLInputElement>(null);
  const fired = useRef(false);
  /** The answer being checked, while its check is with the server. */
  const [checking, setChecking] = useState<string | null>(null);
  /** The last answer the server turned down, and why. */
  const [refused, setRefused] = useState<{
    answer: string;
    result: CheckResult;
    suggestions: string[];
  } | null>(null);
  const refusedRef = useRef(refused);
  refusedRef.current = refused;
  const busy = answering !== null || checking !== null;
  const showRefusal = refused !== null && sameAnswer(refused.answer, answer);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  // Time's up: whatever is typed goes in (the server allows a little grace) —
  // unless it is the answer just turned down, which would only score nothing.
  useEffect(() => {
    if (left > 0 || answering !== null || fired.current) return;
    fired.current = true;
    const typed = latest.current.trim();
    const turnedDown = refusedRef.current && sameAnswer(refusedRef.current.answer, typed);
    onSubmit(turnedDown ? "" : typed);
  }, [left, answering, onSubmit]);

  const send = (value: string) => {
    if (answering !== null || fired.current) return;
    fired.current = true;
    onSubmit(value.trim());
  };

  /** Checks the answer first: one that wouldn't count stays in the box to fix. */
  const checkThenSend = async (value: string) => {
    if (busy || fired.current) return;
    const typed = value.trim();
    if (refused && sameAnswer(refused.answer, typed)) return;
    setChecking(typed);
    const { result, suggestions } = await onCheck(typed);
    setChecking(null);
    if (fired.current) return;
    if (result === "invalid" || result === "ambiguous") {
      setRefused({ answer: typed, result, suggestions });
      requestAnimationFrame(() => input.current?.select());
      return;
    }
    send(typed);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
      <TopBar
        turns={turns}
        position={question.position}
        mode={mode}
        onEnd={busy ? undefined : onEnd}
      />
      <div className="deep-cut-rise mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-6">
        <Countdown
          left={answering === null ? left : Math.max(left, 0)}
          seconds={question.seconds}
        />
        <div className="space-y-2 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("Question {n} of {total}", { n: question.position + 1, total: question.total })} ·{" "}
            {t(question.category)}
          </p>
          <h2 className="text-balance text-2xl font-semibold leading-tight sm:text-3xl">
            {question.prompt}
          </h2>
          <p className="text-sm text-muted-foreground">{t("Correct counts. Rare counts more.")}</p>
        </div>

        <form
          className="flex w-full flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (answer.trim()) void checkThenSend(answer);
          }}
        >
          <div className="flex gap-2">
            <input
              ref={input}
              value={answering ?? answer}
              onChange={(event) => setAnswer(event.target.value)}
              maxLength={60}
              disabled={answering !== null}
              readOnly={checking !== null}
              placeholder={t("Your answer")}
              aria-label={t("Your answer")}
              aria-invalid={showRefusal || undefined}
              aria-describedby={showRefusal ? "deep-cut-refusal" : undefined}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              className={cn(
                "h-12 min-w-0 flex-1 rounded-xl border border-input bg-surface px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70",
                showRefusal && "border-destructive focus-visible:ring-destructive",
              )}
            />
            <Button
              type="submit"
              variant="play"
              size="lg"
              className="h-12 px-4"
              disabled={busy || !answer.trim() || showRefusal}
              aria-label={t("Submit answer")}
            >
              {busy ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
            </Button>
          </div>
          {showRefusal ? (
            <>
              <p
                id="deep-cut-refusal"
                className="flex items-center justify-center gap-1.5 text-center text-sm font-medium text-destructive"
                role="alert"
              >
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
                {t(CHECK_MESSAGES[refused.result] ?? CHECK_MESSAGES.invalid!)}
              </p>
              {refused.suggestions.length > 0 && (
                <div className="flex flex-wrap items-center justify-center gap-1.5 text-sm">
                  <span className="text-muted-foreground">{t("Did you mean:")}</span>
                  {refused.suggestions.map((suggestion) => (
                    <Button
                      key={suggestion}
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-8 rounded-full"
                      onClick={() => {
                        setAnswer(suggestion);
                        send(suggestion);
                      }}
                    >
                      {suggestion}
                    </Button>
                  ))}
                </div>
              )}
            </>
          ) : null}
          {busy ? (
            <p className="text-center text-sm text-muted-foreground" aria-live="polite">
              {checking !== null ? t("Checking your answer…") : t("Measuring the depth…")}
            </p>
          ) : (
            <button
              type="button"
              className="mx-auto text-xs text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => send("")}
            >
              {t("Skip this one")}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

// ── A verdict ───────────────────────────────────────────────────────────────

function Reveal({
  question,
  turn,
  turns,
  mode,
  onNext,
}: {
  question: DeepCutQuestion;
  turn: PlayedTurn;
  turns: readonly PlayedTurn[];
  mode: DeepCutMode;
  onNext: () => void;
}) {
  const correct = turn.verdict === "correct";
  const last = question.position + 1 >= DEEP_CUT_QUESTIONS;
  const info = tierInfo(turn.tier);
  useGameSounds({
    moves: turns.length,
    score: totalPoints(turns),
    mistakes: turns.filter((one) => one.verdict !== "correct").length,
    over: false,
  });
  const counted =
    correct &&
    turn.canonical &&
    turn.answer &&
    turn.canonical.toLowerCase() !== turn.answer.toLowerCase()
      ? turn.canonical
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
      <TopBar turns={turns} position={question.position} mode={mode} />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <p className="text-sm text-muted-foreground">{question.prompt}</p>
        <p className="text-xl font-semibold">“{turn.answer ?? "—"}”</p>

        <div className="flex w-full items-center justify-center gap-5">
          <DeepCutDive tier={correct ? turn.tier : null} className="flex-1" />
          <div className="flex shrink-0 flex-col items-center gap-1">
            <span
              className={cn(
                "deep-cut-pop text-4xl font-bold tabular",
                !correct && "text-muted-foreground",
              )}
              aria-live="polite"
            >
              +{turn.points}
            </span>
            <span
              className="deep-cut-pop rounded-full px-3 py-1 text-sm font-semibold"
              style={correct ? tierStyle(turn.tier) : undefined}
            >
              {t(verdictLabel(turn))}
            </span>
            {info && <span className="text-xs text-muted-foreground">{info.depth}</span>}
          </div>
        </div>

        <div className="space-y-1 text-sm text-muted-foreground">
          {counted && <p>{t("Counted as {answer}.", { answer: counted })}</p>}
          {turn.verdict === "unverified" && (
            <p>
              {t(
                "We don't know that one yet. It's been sent for review, and if it's right it will count for the next diver.",
              )}
            </p>
          )}
          {correct && turn.sharePercent !== null && (
            <p>{t("{percent}% of divers gave this answer.", { percent: turn.sharePercent })}</p>
          )}
          {turn.commonAnswer && (
            <p>{t("Most people say {answer}.", { answer: turn.commonAnswer })}</p>
          )}
          {turn.deepestAnswers && (
            <p>{t("Deepest answers: {answers}.", { answers: turn.deepestAnswers })}</p>
          )}
        </div>

        <Button variant="play" size="lg" className="w-full max-w-xs" onClick={onNext} autoFocus>
          {last ? t("See your dive") : t("Next question")}
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}

// ── The result ──────────────────────────────────────────────────────────────

/** Counts up to `target` over about a second, once. */
function useCountUp(target: number): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / 1100);
      setValue(Math.round(target * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

function Finished({
  state,
  slug,
}: {
  state: Extract<DeepCutControls, { status: "finished" }>;
  slug: string;
}) {
  const { turns, points, result, mode, day } = state;
  const shown = useCountUp(points);
  const rank = ratingFor(points);
  const deepest = deepestTier(turns);
  const correct = turns.filter((turn) => turn.verdict === "correct").length;
  useGameSounds({
    moves: turns.length + 1,
    score: points,
    over: true,
    ending: points > 0 ? "win" : "stop",
  });

  const daily = useMemo(
    () =>
      mode === "daily" && day !== null
        ? { day, result: `${points}/${DEEP_CUT_MAX_POINTS}`, grid: shareGrid(turns) }
        : undefined,
    [mode, day, points, turns],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 py-6 text-center">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {mode === "daily"
              ? t("Today's dive")
              : mode === "archive" && day !== null
                ? t("Archive · {day}", { day: dayLabel(day) })
                : t("Unlimited")}
          </p>
          <p className="text-6xl font-bold tabular" aria-label={t("{n} points", { n: points })}>
            {shown}
            <span className="text-2xl font-semibold text-muted-foreground">
              /{DEEP_CUT_MAX_POINTS}
            </span>
          </p>
          <h1 className="deep-cut-pop text-2xl font-semibold">{t(rank.title)}</h1>
          <p className="text-sm text-muted-foreground">{t(rank.blurb)}</p>
          <p className="text-xs text-muted-foreground">
            {t("{correct} of {total} correct", {
              correct,
              total: turns.length || DEEP_CUT_QUESTIONS,
            })}
            {deepest ? ` · ${t("deepest: {tier}", { tier: t(tierInfo(deepest)!.name) })}` : ""}
          </p>
        </div>

        <DiveChart turns={turns} />

        <ol className="w-full space-y-2 text-left">
          {turns.map((turn, index) => (
            <li
              key={turn.position}
              className="deep-cut-rise flex items-center gap-3 rounded-xl bg-surface p-3"
              style={{ ["--rise-delay" as string]: `${index * 70}ms` } as CSSProperties}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold tabular",
                  turn.verdict !== "correct" && "bg-surface-2 text-muted-foreground",
                )}
                style={turn.verdict === "correct" ? tierStyle(turn.tier) : undefined}
              >
                {turn.points}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-muted-foreground">{turn.prompt}</span>
                <span className="block truncate font-medium">
                  {turn.verdict === "correct"
                    ? (turn.canonical ?? turn.answer)
                    : (turn.answer ?? "—")}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t(verdictLabel(turn))}
              </span>
            </li>
          ))}
        </ol>

        {result && !result.ranked && (
          <p className="text-xs text-muted-foreground">
            {t("Guest run: verified, but not ranked. Sign in to keep your scores and streak.")}
          </p>
        )}

        {mode === "daily" ? (
          <RunEndActions
            slug={slug}
            ranked={result?.ranked ?? false}
            score={result?.score ?? points / 10}
            daily={daily}
            sessionId={state.sessionId ?? undefined}
          >
            <PracticeButtons onBegin={state.begin} />
          </RunEndActions>
        ) : (
          <RunEndActions
            slug={slug}
            ranked={false}
            score={points / 10}
            onRestart={() => (mode === "unlimited" ? state.begin("unlimited") : state.restart())}
            autoFocus
          />
        )}
      </div>
    </div>
  );
}

/** Seven columns, each as deep as its answer dove; a miss is a short red stub. */
function DiveChart({ turns }: { turns: readonly PlayedTurn[] }) {
  return (
    <div
      className="flex h-28 w-full items-start justify-center gap-2 rounded-2xl bg-surface p-3"
      aria-hidden
    >
      {Array.from({ length: DEEP_CUT_QUESTIONS }, (_, index) => {
        const turn = turns[index];
        const depth = turn?.verdict === "correct" ? (turn.tier ?? 1) : 0;
        return (
          <div key={index} className="flex h-full w-7 flex-col items-center justify-start">
            <div
              className={cn(
                "w-full origin-top rounded-b-lg transition-[height] duration-700 ease-out motion-reduce:transition-none",
                !depth && (turn ? "bg-destructive/50" : "bg-surface-2"),
              )}
              style={{
                height: depth ? `${(depth / 6) * 100}%` : "8%",
                background: depth ? TIER_STYLE[depth as Tier].background : undefined,
                transitionDelay: `${index * 80}ms`,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function PracticeButtons({ onBegin }: { onBegin: (mode: DeepCutMode) => void }) {
  return (
    <Button variant="play" size="lg" onClick={() => onBegin("unlimited")}>
      <InfinityIcon />
      {t("Keep diving: Unlimited")}
    </Button>
  );
}

// ── Done for today, and failures ────────────────────────────────────────────

function nextDiveIn(): string {
  const left = Math.max(0, msUntilLocalMidnight(Date.now()));
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return t("New questions in {n}{minutes} min.", { n: hours ? `${hours} h ` : "", minutes });
}

function DailyDone({
  slug,
  title,
  onPractice,
}: {
  slug: string;
  title: string;
  onPractice: (mode: DeepCutMode, day?: number) => void;
}) {
  const [archive, setArchive] = useState(false);
  if (archive)
    return (
      <ArchivePicker
        onPick={(day) => onPractice("archive", day)}
        onBack={() => setArchive(false)}
      />
    );
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 px-6 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-2">
        <Clock className="size-5 text-muted-foreground" />
      </div>
      <h1 className="text-xl font-semibold">{t("You've done today's dive")}</h1>
      <p className="mx-auto max-w-sm text-sm text-muted-foreground">{nextDiveIn()}</p>
      <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
        <Button variant="play" size="lg" onClick={() => onPractice("unlimited")}>
          <InfinityIcon />
          {t("Keep diving: Unlimited")}
        </Button>
        <Button variant="secondary" size="lg" onClick={() => setArchive(true)}>
          <CalendarDays />
          {t("Play a past day")}
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link to="/leaderboards/$id" params={{ id: slug }}>
            {t("See the leaderboard")}
          </Link>
        </Button>
        <GameExits slug={slug} title={title} />
      </div>
    </div>
  );
}

function ErrorScreen({
  state,
  slug,
  title,
}: {
  state: Extract<DeepCutControls, { status: "error" }>;
  slug: string;
  title: string;
}) {
  if (state.stage === "finish") {
    return (
      <div className="flex flex-1 flex-col justify-center gap-4 px-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-2">
          <TriangleAlert className="size-5 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold">{t("Your dive was not saved yet")}</h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {t("{error} Your answers are safe on our side — sending again is safe.", {
            error: playErrorMessage(state.error),
          })}
        </p>
        <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
          <Button variant="play" size="lg" onClick={state.retry}>
            {t("Try again")}
          </Button>
          <Button variant="secondary" size="lg" onClick={state.restart}>
            <RotateCcw />
            {t("Back to the start")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col justify-center px-6">
      <ErrorState
        title={
          state.stage === "start" ? t("Couldn't start the dive") : t("Lost the connection mid-dive")
        }
        body={playErrorMessage(state.error)}
        onRetry={state.retry}
      />
      <div className="mx-auto mt-2 w-full max-w-xs">
        <Button variant="ghost" size="lg" className="w-full" onClick={state.restart}>
          {t("Back to the start")}
        </Button>
      </div>
      <GameExits slug={slug} title={title} />
    </div>
  );
}
