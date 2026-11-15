import { Mountain } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { DailyFrame, DailyResult, EndRunButton, RankChip } from "@/components/game/DailyShell";
import { Button } from "@/components/ui/button";
import { useDailyRun, type DailyEngine } from "@/lib/games/daily-run";
import { articled, QUESTIONS_PER_PUZZLE } from "@/lib/games/only-once-bank";
import {
  answer,
  createRun,
  currentQuestion,
  kindOf,
  matches,
  ONLY_ONCE_RULES_VERSION,
  puzzleOf,
  READING_MS,
  refusal,
  SECONDS_PER_QUESTION,
  stop,
  submission,
  timeOut,
  type OnlyOnceRun,
} from "@/lib/games/only-once";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import type { DailyShare } from "@/lib/games/share";
import { useGameSounds } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

const RULES = GAME_RULES["only-once"];
const QUESTION_MS = SECONDS_PER_QUESTION * 1000;

const ENGINE: DailyEngine<OnlyOnceRun> = {
  rulesVersion: ONLY_ONCE_RULES_VERSION,
  create: (session) => createRun(session.seed, session.rulesVersion),
  over: (run) => run.outcome !== "playing",
  submission,
};

/** Only Once, playing for real: seven questions, never the same answer twice. */
export function OnlyOnceRuntime({
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
  const onAnswer = useCallback((id: number) => play((r) => answer(r, id)), [play]);
  const onTimeOut = useCallback(() => play(timeOut), [play]);
  const onStop = useCallback(() => play(stop), [play]);
  return (
    <DailyFrame
      state={state}
      slug={slug}
      title={title}
      rules={RULES}
      icon={<Mountain className="size-5 text-muted-foreground" />}
      playLabel={t("Play today's seven")}
      loadingLabel={t("Fetching today's questions…")}
      doneTitle={t("You've played today's seven")}
      board={(session, run, verifying) => (
        <Board
          key={session.id}
          run={run}
          verifying={verifying}
          ranked={<RankChip session={session} />}
          onAnswer={onAnswer}
          onTimeOut={onTimeOut}
          onStop={onStop}
        />
      )}
      finished={(run, result) => (
        <DailyResult
          slug={slug}
          result={result}
          headline={
            run.ending === "summit"
              ? t("All seven — you reached the top!")
              : t("{n} of {max} answered", { n: run.answers.length, max: QUESTIONS_PER_PUZZLE })
          }
          stats={[
            { label: t("Today"), value: t(kindOf(run).label) },
            { label: t("Answered"), value: `${run.answers.length}/${QUESTIONS_PER_PUZZLE}` },
          ]}
          share={onlyOnceShare(run)}
        >
          <Recap run={run} />
        </DailyResult>
      )}
    />
  );
}

/** One square per question: green answered, red where the day ended, black never reached. */
function onlyOnceShare(run: OnlyOnceRun): DailyShare {
  const n = run.answers.length;
  const squares = Array.from({ length: QUESTIONS_PER_PUZZLE }, (_, i) =>
    i < n ? "🟩" : i === n && run.ending !== "summit" ? "🟥" : "⬛",
  );
  return { day: run.day, result: `${n}/${QUESTIONS_PER_PUZZLE}`, grid: squares.join("") };
}

/** Every question, the answer given, and for the one that ended the day a few that fit. */
function Recap({ run }: { run: OnlyOnceRun }) {
  const kind = kindOf(run);
  const questions = puzzleOf(run).questions;
  return (
    <ol className="mx-auto flex w-full max-w-sm flex-col gap-1.5 text-left text-sm">
      {questions.map((question, i) => {
        const given = run.answers[i];
        const missed = given === undefined && i === run.answers.length;
        const hints = missed
          ? question.answers
              .filter((id) => !run.answers.includes(id))
              .slice(0, 4)
              .map((id) => kind.entities[id]!.name)
          : [];
        return (
          <li
            key={i}
            className={cn(
              "rounded-xl bg-surface px-3 py-2",
              given === undefined && !missed && "opacity-50",
            )}
          >
            <p className="text-xs text-muted-foreground">
              {i + 1}. {t(question.text)}
            </p>
            {given !== undefined ? (
              <p className="font-semibold">{kind.entities[given]!.name}</p>
            ) : missed ? (
              <p className="text-xs text-muted-foreground">
                {t("Could have been: {names}", { names: hints.join(", ") || "—" })}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Milliseconds left on the question that began at `startedAt`, after the reading grace. */
function remaining(startedAt: number, now: number): number {
  return Math.max(0, QUESTION_MS - Math.max(0, now - startedAt - READING_MS));
}

function Board({
  run,
  verifying,
  ranked,
  onAnswer,
  onTimeOut,
  onStop,
}: {
  run: OnlyOnceRun;
  verifying: boolean;
  ranked: ReactNode;
  onAnswer: (id: number) => void;
  onTimeOut: () => void;
  onStop: () => void;
}) {
  const kind = kindOf(run);
  const question = currentQuestion(run);
  const index = run.answers.length;
  const live = !verifying && run.outcome === "playing";
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const startedAt = useRef(Date.now());
  const input = useRef<HTMLInputElement>(null);
  const options = useMemo(() => matches(kind, typed), [kind, typed]);

  useGameSounds({
    moves: run.answers.length,
    score: run.answers.length,
    over: run.outcome === "over",
    ending: run.ending === "summit" ? "win" : "lose",
  });
  useReportRunProgress(live, onStop);

  // A new question restarts the clock.
  useEffect(() => {
    startedAt.current = Date.now();
    setNow(Date.now());
    setTyped("");
    input.current?.focus();
  }, [index]);

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
      if (remaining(startedAt.current, at) <= 0) timeOutRef.current();
    }, 100);
    return () => window.clearInterval(timer);
  }, [live, index]);

  function pick(id: number) {
    if (!live) return;
    const why = refusal(run, id);
    const name = kind.entities[id]!.name;
    if (why === "used") {
      setNotice(t("You've already used {name}.", { name }));
      return;
    }
    if (why === "wrong") {
      setNotice(t("{name} doesn't fit. Try another.", { name }));
      setTyped("");
      return;
    }
    if (why) return;
    setNotice(null);
    onAnswer(id);
  }

  const left = remaining(startedAt.current, now);
  const reading = now - startedAt.current < READING_MS;
  const seconds = Math.ceil(left / 1000);

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2 text-xs text-muted-foreground">
        <span>{t(kind.label)}</span>
        {ranked}
      </div>

      <ol className="mx-auto flex w-full max-w-md gap-1.5 py-2" aria-label={t("Progress")}>
        {Array.from({ length: QUESTIONS_PER_PUZZLE }, (_, i) => (
          <li
            key={i}
            className={cn(
              "h-2 flex-1 rounded-full bg-surface-2",
              i < index && "bg-primary",
              i === index && live && "bg-primary/40",
            )}
          />
        ))}
      </ol>

      <div className="mx-auto flex w-full max-w-md flex-col gap-3 pt-2">
        <div className="text-center">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("Question {n} of {max}", {
              n: Math.min(index + 1, QUESTIONS_PER_PUZZLE),
              max: QUESTIONS_PER_PUZZLE,
            })}
          </p>
          <h2 className="pt-1 text-2xl font-semibold text-balance">
            {question ? t(question.text) : "…"}
          </h2>
        </div>

        {live && (
          <div className="flex items-center gap-3" aria-live="off">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className={cn(
                  "h-full rounded-full bg-primary",
                  left < 8000 && "bg-amber-500",
                  left < 4000 && "bg-destructive",
                )}
                style={{ width: `${(left / QUESTION_MS) * 100}%` }}
              />
            </div>
            <span className="w-10 text-right text-sm font-semibold tabular">
              {reading ? t("Read") : `${seconds}s`}
            </span>
          </div>
        )}

        {live && (
          <div className="flex flex-col gap-2">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (options[0]) pick(options[0].id);
              }}
            >
              <input
                ref={input}
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setNotice(null);
                }}
                placeholder={t("Type {noun}…", { noun: t(articled(kind.noun)) })}
                aria-label={t("Your answer")}
                autoComplete="off"
                autoCapitalize="words"
                autoFocus
                className="h-12 w-full rounded-xl border border-input bg-surface px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </form>
            {options.length > 0 && (
              <ul className="flex flex-col gap-1" role="listbox" aria-label={t("Suggestions")}>
                {options.map(({ id, entity }) => {
                  const used = run.answers.includes(id);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => pick(id)}
                        className={cn(
                          "w-full rounded-lg bg-surface px-3 py-2 text-left text-sm hover:bg-surface-2",
                          used && "text-muted-foreground line-through",
                        )}
                      >
                        {entity.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <p className="min-h-5 text-center text-sm text-muted-foreground" aria-live="polite">
          {verifying ? t("Verifying your run with the server…") : notice}
        </p>

        {run.answers.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5" aria-label={t("Used answers")}>
            {run.answers.map((id) => (
              <span key={id} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs">
                {kind.entities[id]!.name}
              </span>
            ))}
          </div>
        )}

        {live && (
          <div className="flex justify-center pt-2">
            <EndRunButton
              label={t("End run")}
              title={t("End today's seven here?")}
              body={t(
                "Questions answered keep their points; the rest score nothing. There is one ranked play a day.",
              )}
              keep={t("Keep playing")}
              onConfirm={onStop}
            />
          </div>
        )}
      </div>
    </div>
  );
}
