import { Plane, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { DailyFrame, DailyResult, EndRunButton, RankChip } from "@/components/game/DailyShell";
import { Button } from "@/components/ui/button";
import { ROUNDS } from "@/lib/games/dead-reckoning-bank";
import {
  answer,
  ceilingAt,
  createRun,
  DEAD_RECKONING_RULES_VERSION,
  matches,
  nearest,
  parseEstimate,
  puzzleOf,
  rate,
  roundScore,
  roundView,
  scoreOf,
  SECONDS_PER_ROUND,
  stop,
  submission,
  timeOut,
  valueOf,
  withUnit,
  type Answer,
  type DeadReckoningRun,
  type Rating,
  type RoundView,
} from "@/lib/games/dead-reckoning";
import { useDailyRun, type DailyEngine } from "@/lib/games/daily-run";
import { isPracticeBoard } from "@/lib/games/offline";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import type { DailyShare } from "@/lib/games/share";
import { points } from "@/lib/format";
import { msg, t } from "@/lib/settings/language";
import { useGameSounds } from "@/lib/sound";
import { cn } from "@/lib/utils";

const RULES = GAME_RULES["dead-reckoning"];
const ROUND_MS = SECONDS_PER_ROUND * 1000;
/** How long a round's result shows before the next clock starts. */
const REVEAL_MS = 2600;
/** The altitude at the top of the sky, in points: a perfect day and some. */
const SKY_POINTS = 1000;

const ENGINE: DailyEngine<DeadReckoningRun> = {
  rulesVersion: DEAD_RECKONING_RULES_VERSION,
  create: (session) => createRun(session.seed, session.rulesVersion),
  over: (run) => run.outcome !== "playing",
  submission,
};

const RATING_LABEL: Record<Rating, string> = {
  dialed: msg("Dialed"),
  sharp: msg("Sharp"),
  near: msg("Near"),
  warm: msg("Warm"),
  rough: msg("Rough"),
  miss: msg("Miss"),
};

const RATING_STYLE: Record<Rating, string> = {
  dialed: "bg-primary text-primary-foreground",
  sharp: "bg-emerald-500/20 text-foreground ring-2 ring-emerald-500/50",
  near: "bg-lime-400/20 text-foreground ring-2 ring-lime-500/50",
  warm: "bg-amber-400/25 text-foreground ring-2 ring-amber-500/50",
  rough: "bg-orange-500/20 text-foreground ring-2 ring-orange-500/40",
  miss: "bg-surface-2 text-muted-foreground",
};

const RATING_SQUARE: Record<Rating, string> = {
  dialed: "🎯",
  sharp: "🟩",
  near: "🟨",
  warm: "🟧",
  rough: "🟥",
  miss: "⬛",
};

/** The round's prompt with its number filled in: "… closest to 6,200 m". */
function promptOf(view: RoundView): string {
  return view.category
    ? t(view.prompt, { target: withUnit(view.target, "", view.scale) })
    : t(view.prompt);
}

function ratingOf(view: RoundView, given: Answer): Rating | null {
  return given.answer === null ? null : rate(valueOf(view, given.answer), view.target, view.scale);
}

/** What was given, as the player would say it: "Denali (6,190 m)", "4,500 km". */
function givenText(view: RoundView, given: Answer): string {
  if (given.answer === null) return t("No answer");
  const value = withUnit(valueOf(view, given.answer), view.unit, view.scale);
  return view.category ? `${view.category.entries[given.answer]!.name} (${value})` : value;
}

/** Dead Reckoning, playing for real: seven numbers, thirty seconds each. */
export function DeadReckoningRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  autoStart?: boolean;
}) {
  const state = useDailyRun(slug, ENGINE, autoStart);
  // Stable, as `useReportRunProgress` needs: `play` never changes.
  const { play } = state;
  const onAnswer = useCallback(
    (value: number, seconds: number) => play((r) => answer(r, value, seconds)),
    [play],
  );
  const onTimeOut = useCallback(() => play(timeOut), [play]);
  const onStop = useCallback(() => play(stop), [play]);
  return (
    <DailyFrame
      state={state}
      slug={slug}
      title={title}
      rules={RULES}
      icon={<Plane className="size-5 text-muted-foreground" />}
      playLabel={t("Play today's seven")}
      loadingLabel={t("Fetching today's rounds…")}
      doneTitle={t("You've played today's seven")}
      board={(session, run, verifying) => (
        <Board
          key={session.id}
          run={run}
          verifying={verifying}
          ranked={<RankChip session={session} />}
          practice={isPracticeBoard(session)}
          onAnswer={onAnswer}
          onTimeOut={onTimeOut}
          onStop={onStop}
        />
      )}
      finished={(run, result) => {
        const ratings = run.answers.map((given, i) => ratingOf(roundView(puzzleOf(run), i), given));
        return (
          <DailyResult
            slug={slug}
            result={result}
            headline={headline(ratings)}
            stats={[
              {
                label: t("Dialed"),
                value: `${ratings.filter((r) => r === "dialed").length}/${ROUNDS}`,
              },
              {
                label: t("Answered"),
                value: `${run.answers.filter((a) => a.answer !== null).length}/${ROUNDS}`,
              },
            ]}
            share={deadReckoningShare(run)}
          >
            <Sky altitude={Math.min(1, scoreOf(run) / SKY_POINTS)} landed />
            <Recap run={run} />
          </DailyResult>
        );
      }}
    />
  );
}

function headline(ratings: readonly (Rating | null)[]): string {
  const dialed = ratings.filter((r) => r === "dialed").length;
  const hits = ratings.filter((r) => r && r !== "miss").length;
  if (dialed >= 4) return t("Dead on. Flying high!");
  if (hits >= 5) return t("A smooth flight");
  if (hits >= 3) return t("Some turbulence");
  return t("A bumpy landing");
}

/** One square per round by its rating, a clock for a time-out, a star after the golden one. */
function deadReckoningShare(run: DeadReckoningRun): DailyShare {
  const puzzle = puzzleOf(run);
  const squares = Array.from({ length: ROUNDS }, (_, i) => {
    const given = run.answers[i];
    const golden = puzzle.golden === i ? "⭐" : "";
    if (!given) return `▫️${golden}`;
    const rating = ratingOf(roundView(puzzle, i), given);
    return `${rating ? RATING_SQUARE[rating] : "⏱️"}${golden}`;
  });
  return {
    day: run.day,
    result: `${points(scoreOf(run)).toLocaleString("en-US")}`,
    grid: squares.join(""),
  };
}

/** The sky, and the plane at its altitude: points banked plus points still on offer. */
function Sky({ altitude, landed = false }: { altitude: number; landed?: boolean }) {
  const height = Math.max(0, Math.min(1, altitude));
  return (
    <div
      className="relative mx-auto h-28 w-full max-w-md overflow-hidden rounded-2xl bg-gradient-to-b from-sky-400/30 via-sky-300/15 to-emerald-400/20"
      role="img"
      aria-label={t("Altitude: {percent}%", { percent: Math.round(height * 100) })}
    >
      <span className="absolute top-3 left-[12%] h-3 w-10 rounded-full bg-white/50" aria-hidden />
      <span className="absolute top-8 right-[18%] h-3 w-14 rounded-full bg-white/40" aria-hidden />
      <span className="absolute top-14 left-[55%] h-2.5 w-8 rounded-full bg-white/30" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 h-2 bg-emerald-600/30" aria-hidden />
      <div
        className="absolute left-1/2 -translate-x-1/2 transition-[bottom] duration-700 ease-out"
        style={{ bottom: `calc(${height * 100}% * 0.78 + 0.5rem)` }}
        aria-hidden
      >
        <Plane
          className={cn(
            "size-8 rotate-45 fill-current text-foreground drop-shadow",
            landed && "rotate-[60deg]",
          )}
        />
      </div>
    </div>
  );
}

function Recap({ run }: { run: DeadReckoningRun }) {
  const puzzle = puzzleOf(run);
  return (
    <ol className="mx-auto flex w-full max-w-sm flex-col gap-1.5 text-left text-sm">
      {puzzle.rounds.map((_, i) => {
        const view = roundView(puzzle, i);
        const given = run.answers[i];
        const rating = given ? ratingOf(view, given) : null;
        const best = nearest(view)[0];
        return (
          <li key={i} className={cn("rounded-xl bg-surface px-3 py-2", !given && "opacity-50")}>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              {view.golden && <Star className="size-3 fill-amber-400 text-amber-500" />}
              {i + 1}. {promptOf(view)}
            </p>
            {given && (
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="font-semibold">{givenText(view, given)}</span>
                <span className="shrink-0 text-xs tabular">
                  {rating ? t(RATING_LABEL[rating]) : t("Timed out")} · +
                  {points(roundScore(view, given)).toLocaleString("en-US")}
                </span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {best
                ? t("Nearest: {answer}", {
                    answer: `${best.name} (${withUnit(best.value, view.unit, view.scale)})`,
                  })
                : t("Answer: {answer}", {
                    answer: withUnit(view.target, view.unit, view.scale),
                  })}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** Milliseconds left on a round whose clock started at `startedAt`. */
function remaining(startedAt: number, now: number): number {
  return Math.max(0, ROUND_MS - (now - startedAt));
}

function Board({
  run,
  verifying,
  ranked,
  practice,
  onAnswer,
  onTimeOut,
  onStop,
}: {
  run: DeadReckoningRun;
  verifying: boolean;
  ranked: ReactNode;
  /** An Unlimited round or a past day: not today's board, and not ranked. */
  practice: boolean;
  onAnswer: (value: number, seconds: number) => void;
  onTimeOut: () => void;
  onStop: () => void;
}) {
  const puzzle = puzzleOf(run);
  const index = run.answers.length;
  const view = index < ROUNDS ? roundView(puzzle, index) : null;
  const banked = scoreOf(run);
  /** The round just answered, shown until the next clock starts. */
  const [revealing, setRevealing] = useState<number | null>(null);
  const live = !verifying && run.outcome === "playing" && revealing === null;
  const [typed, setTyped] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const startedAt = useRef(Date.now());
  /** The last round answered or timed out, so no round is settled twice. */
  const settled = useRef(-1);
  const input = useRef<HTMLInputElement>(null);
  const options = useMemo(
    () => (view?.category && picked === null ? matches(view.category, typed) : []),
    [view, typed, picked],
  );

  const ratings = run.answers.map((given, i) => ratingOf(roundView(puzzle, i), given));
  useGameSounds({
    moves: run.answers.length,
    score: banked,
    cleared: ratings.filter((r) => r === "dialed").length,
    mistakes: ratings.filter((r) => r === null || r === "miss").length,
    over: run.outcome === "over",
    ending: "win",
  });
  useReportRunProgress(!verifying && run.outcome === "playing", onStop);

  // A new round, once its reveal is done, restarts the clock.
  useEffect(() => {
    if (revealing !== null) return;
    startedAt.current = Date.now();
    setNow(Date.now());
    setTyped("");
    setPicked(null);
    setNotice(null);
    input.current?.focus();
  }, [index, revealing]);

  // The parent hands a fresh callback each render; the clock reads the latest.
  const timeOutRef = useRef(onTimeOut);
  useEffect(() => {
    timeOutRef.current = onTimeOut;
  }, [onTimeOut]);

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      // Once a round: ticks can land before the render that stops this clock.
      if (remaining(startedAt.current, at) <= 0 && settled.current !== index) {
        settled.current = index;
        setRevealing(index);
        timeOutRef.current();
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [live, index]);

  useEffect(() => {
    if (revealing === null) return;
    const timer = window.setTimeout(() => setRevealing(null), REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [revealing]);

  const left = remaining(startedAt.current, now);
  const seconds = Math.min(SECONDS_PER_ROUND, Math.ceil(left / 1000));
  const ceiling = view && live ? ceilingAt(view, seconds) : 0;
  const altitude = (banked + ceiling) / SKY_POINTS;

  function commit(value: number) {
    if (!live || settled.current === index) return;
    settled.current = index;
    setRevealing(index);
    onAnswer(value, seconds);
  }

  function submit() {
    if (!live || !view) return;
    if (view.category) {
      const id = picked ?? options[0]?.id;
      if (id === undefined) {
        setNotice(t("Pick an answer from the suggestions."));
        return;
      }
      commit(id);
      return;
    }
    const value = parseEstimate(typed);
    if (value === null) {
      setNotice(t("Type a whole number, like 1,250."));
      return;
    }
    commit(value);
  }

  const shown = revealing !== null ? roundView(puzzle, revealing) : view;
  const shownGiven = revealing !== null ? run.answers[revealing] : undefined;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2 text-xs text-muted-foreground">
        <span className="tabular">
          {t("Score {score}", { score: points(banked).toLocaleString("en-US") })}
        </span>
        {ranked}
      </div>

      <ol className="mx-auto flex w-full max-w-md gap-1.5 pb-2" aria-label={t("Progress")}>
        {Array.from({ length: ROUNDS }, (_, i) => {
          const rating = ratings[i];
          return (
            <li
              key={i}
              className={cn(
                "relative h-2 flex-1 rounded-full bg-surface-2",
                i < index && (rating && rating !== "miss" ? "bg-primary" : "bg-foreground/30"),
                i === index && live && "bg-primary/40",
                puzzle.golden === i && i >= index && "bg-amber-400/50",
              )}
            />
          );
        })}
      </ol>

      <div className="mx-auto flex w-full max-w-md flex-col gap-3">
        <Sky altitude={altitude} />

        {shown && (
          <div className="text-center">
            <p className="flex items-center justify-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t("Round {n} of {max}", {
                n: (revealing ?? index) + 1,
                max: ROUNDS,
              })}
              {shown.golden && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/25 px-2 py-0.5 text-amber-700 normal-case dark:text-amber-300">
                  <Star className="size-3 fill-current" />
                  {t("Golden round: double points")}
                </span>
              )}
            </p>
            <h2 className="pt-1 text-xl font-semibold text-balance">
              {shown.category && <span aria-hidden>{shown.category.emoji} </span>}
              {promptOf(shown)}
            </h2>
            {shown.category && (
              <p className="pt-1 text-4xl font-bold tabular">
                {withUnit(shown.target, shown.unit, shown.scale)}
              </p>
            )}
          </div>
        )}

        {shown && shownGiven && <Reveal view={shown} given={shownGiven} />}

        {live && view && (
          <>
            <div className="flex items-center gap-3" aria-live="off">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={cn(
                    "h-full rounded-full bg-primary",
                    left < 10000 && "bg-amber-500",
                    left < 5000 && "bg-destructive",
                  )}
                  style={{ width: `${(left / ROUND_MS) * 100}%` }}
                />
              </div>
              <span className="w-10 text-right text-sm font-semibold tabular">{seconds}s</span>
            </div>
            <p className="text-center text-xs text-muted-foreground tabular">
              {t("Up to +{points} now", { points: points(ceiling).toLocaleString("en-US") })}
            </p>

            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <input
                ref={input}
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setPicked(null);
                  setNotice(null);
                }}
                inputMode={view.category ? "text" : "numeric"}
                placeholder={
                  view.category
                    ? t("Type {noun}…", { noun: t(view.category.noun) })
                    : t("Your estimate")
                }
                aria-label={t("Your answer")}
                autoComplete="off"
                autoCapitalize={view.category ? "words" : "off"}
                autoFocus
                className="h-12 min-w-0 flex-1 rounded-xl border border-input bg-surface px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" variant="play" size="lg" disabled={!typed.trim()}>
                {t("Submit")}
              </Button>
            </form>
            {!view.category && view.unit && (
              <p className="-mt-1 text-center text-xs text-muted-foreground">
                {t("In {unit}", { unit: view.unit })}
              </p>
            )}

            {options.length > 0 && (
              <ul className="flex flex-col gap-1" role="listbox" aria-label={t("Suggestions")}>
                {options.map(({ id, entry }) => (
                  <li key={id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        setPicked(id);
                        setTyped(entry.name);
                        input.current?.focus();
                      }}
                      className="w-full rounded-lg bg-surface px-3 py-2 text-left text-sm hover:bg-surface-2"
                    >
                      {entry.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <p className="min-h-5 text-center text-sm text-muted-foreground" aria-live="polite">
          {verifying ? t("Verifying your run with the server…") : notice}
        </p>

        {revealing !== null && run.outcome === "playing" && (
          <div className="flex justify-center">
            <Button variant="secondary" onClick={() => setRevealing(null)}>
              {t("Next round")}
            </Button>
          </div>
        )}

        {!verifying && run.outcome === "playing" && (
          <div className="flex justify-center pt-2">
            <EndRunButton
              label={t("End run")}
              title={practice ? t("End these seven here?") : t("End today's seven here?")}
              body={
                practice
                  ? t("Rounds answered keep their points. It's practice, so nothing is lost.")
                  : t(
                      "Rounds answered keep their points; the rest score nothing. There is one ranked play a day.",
                    )
              }
              keep={t("Keep playing")}
              onConfirm={onStop}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** A round's verdict: the rating, what the answer was worth, and the points. */
function Reveal({ view, given }: { view: RoundView; given: Answer }) {
  const rating = ratingOf(view, given);
  const best = nearest(view)[0];
  return (
    <div
      className={cn(
        "enter flex flex-col items-center gap-1 rounded-2xl p-4 text-center",
        rating ? RATING_STYLE[rating] : RATING_STYLE.miss,
      )}
      aria-live="polite"
    >
      <p className="text-2xl font-bold">{rating ? t(RATING_LABEL[rating]) : t("Time's up")}</p>
      <p className="text-sm">{givenText(view, given)}</p>
      <p className="text-xs opacity-80">
        {best
          ? t("Nearest: {answer}", {
              answer: `${best.name} (${withUnit(best.value, view.unit, view.scale)})`,
            })
          : t("Answer: {answer}", { answer: withUnit(view.target, view.unit, view.scale) })}
      </p>
      <p className="pt-1 text-lg font-semibold tabular">
        +{points(roundScore(view, given)).toLocaleString("en-US")}
      </p>
    </div>
  );
}
