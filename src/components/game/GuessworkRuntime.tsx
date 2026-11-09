import { Link } from "@tanstack/react-router";
import {
  Clock,
  CornerDownLeft,
  Delete,
  Loader2,
  RotateCcw,
  ShieldCheck,
  SpellCheck,
  Trophy,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ErrorState } from "@/components/common";
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
import { cn } from "@/lib/utils";
import { msUntilLocalMidnight } from "@/lib/games/crossword";
import {
  alphabetFor,
  keyboardFor,
  letterMarks,
  lettersOf,
  marksFor,
  MAX_GUESSES,
  refusal,
  scoreOf,
  WORD_LENGTH,
  type GuessworkRun,
  type Mark,
} from "@/lib/games/guesswork";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useGuessworkRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import { points } from "@/lib/format";
import { useGameSounds } from "@/lib/sound";
import { offlineResultNote } from "@/lib/games/offline";

import { msg, t } from "@/lib/settings/language";

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES["guesswork"];

/**
 * Guesswork, playing for real — and Gjeje when the app is in Albanian.
 *
 * The board is a view onto `useGuessworkRun`, which owns the lifecycle: the rules
 * first, today's session issued on Start, the words from the bank, and the score
 * the server derived. The letters being typed are the screen's; a guess is the run.
 */
export function GuessworkRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useGuessworkRun(slug, autoStart);

  if (state.status === "intro") {
    return <Intro signedIn={state.signedIn} onBegin={state.begin} slug={slug} title={title} />;
  }

  if (state.status === "starting") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("Fetching today's word…")}</p>
      </div>
    );
  }

  if (state.status === "error" && state.stage === "start") {
    if (state.error.status === 409) {
      return <DailyDone slug={slug} title={title} message={playErrorMessage(state.error)} />;
    }
    return (
      <div className="flex flex-1 flex-col justify-center px-6">
        <ErrorState
          title={t("Couldn't start today's word")}
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
            {
              error: playErrorMessage(state.error),
            },
          )}
        </p>
        <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
          <Button variant="play" size="lg" onClick={state.retry}>
            {t("Try submitting again")}
          </Button>
          <Button variant="secondary" size="lg" onClick={state.restart}>
            <RotateCcw />
            {t("Back to the rules")}
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
        isWord={state.isWord}
        verifying={state.status === "submitting"}
        onGuess={state.guess}
        onFinish={state.finish}
      />
    );
  }

  if (state.status === "finished") {
    return <Finished slug={slug} run={state.run} result={state.result} />;
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
          <SpellCheck className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{t(RULES.heading)}</h1>
          <p className="text-sm text-muted-foreground">{t(RULES.summary)}</p>
        </div>

        <MarkLegend />
        <RulesList rules={RULES.rules} />

        <div className="flex w-full flex-col gap-2">
          <Button variant="play" size="lg" onClick={onBegin} autoFocus>
            {t("Play today's word")}
          </Button>
          <Button asChild variant="ghost" size="lg">
            <ExitGameLink slug={slug}>{t("Back to {title}", { title })}</ExitGameLink>
          </Button>
        </div>

        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          {signedIn
            ? t("Signed in: one ranked play a day")
            : t("Guest run: verified, but not ranked")}
        </p>
      </div>
    </div>
  );
}

/** The three marks, drawn once so the rules can point at them. */
function MarkLegend() {
  const items: { mark: Mark; letter: string; label: string }[] = [
    { mark: 2, letter: "A", label: t("Right place") },
    { mark: 1, letter: "B", label: t("Elsewhere") },
    { mark: 0, letter: "C", label: t("Not in it") },
  ];
  return (
    <ul className="flex justify-center gap-4 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.mark} className="flex items-center gap-1.5">
          <Tile letter={item.letter} mark={item.mark} small />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function DailyDone({ slug, title, message }: { slug: string; title: string; message: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 px-6 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-2">
        <Clock className="size-5 text-muted-foreground" />
      </div>
      <h1 className="text-xl font-semibold">{t("You've played today's word")}</h1>
      <p className="mx-auto max-w-sm text-sm text-muted-foreground">{message}</p>
      <p className="mx-auto max-w-sm text-xs text-muted-foreground">{nextWordIn()}</p>
      <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
        <Button asChild variant="play" size="lg">
          <Link to="/leaderboards/$id" params={{ id: slug }}>
            {t("See the leaderboard")}
          </Link>
        </Button>
        <GameExits slug={slug} title={title} />
      </div>
    </div>
  );
}

/** One square: a letter and, once guessed, its mark. */
function Tile({
  letter,
  mark,
  active = false,
  small = false,
}: {
  letter: string;
  mark?: Mark;
  active?: boolean;
  small?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-lg border-2 font-semibold uppercase leading-none tabular transition-colors motion-reduce:transition-none",
        small
          ? "size-6 rounded-md text-xs"
          : "aspect-square w-full text-[clamp(1.1rem,6vmin,2rem)]",
        mark === 2 && "border-primary bg-primary text-primary-foreground",
        mark === 1 && "border-primary bg-primary/10 text-primary border-dashed",
        mark === 0 && "border-transparent bg-surface-2 text-muted-foreground/70",
        mark === undefined && letter && "border-foreground/40 bg-surface text-foreground",
        mark === undefined && !letter && "border-foreground/10 bg-surface",
        active && "border-foreground/60",
      )}
    >
      {letter}
    </span>
  );
}

const MARK_WORDS: Record<Mark, string> = {
  2: msg("right place"),
  1: msg("elsewhere"),
  0: msg("not in the word"),
};

/** The live game. */
function Board({
  run,
  session,
  isWord,
  verifying,
  onGuess,
  onFinish,
}: {
  run: GuessworkRun;
  session: PlaySession;
  isWord: (word: string) => boolean;
  verifying: boolean;
  onGuess: (word: string) => void;
  onFinish: () => void;
}) {
  useGameSounds({
    moves: run.moves.length,
    score: 0,
    over: run.outcome === "over",
    ending: run.ending === "solved" ? "win" : "stop",
  });
  const [typed, setTyped] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const accepting = !verifying && run.outcome === "playing";
  const alphabet = alphabetFor(run.rulesVersion);
  const keyboard = keyboardFor(run.rulesVersion);
  const marks = letterMarks(run);

  useReportRunProgress(accepting, onFinish);

  // What is typed, as of the last key: keys can arrive faster than renders, so
  // each one reads and writes this, never a render's copy.
  const latest = useRef<string[]>([]);
  function setLetters(next: string[]) {
    latest.current = next;
    setTyped(next);
  }

  function type(letter: string) {
    if (!accepting) return;
    setNotice(null);
    if (latest.current.length < WORD_LENGTH) setLetters([...latest.current, letter]);
  }

  function erase() {
    if (!accepting) return;
    setNotice(null);
    setLetters(latest.current.slice(0, -1));
  }

  function submit() {
    if (!accepting) return;
    const word = latest.current.join("");
    const why = refusal(run, word, isWord);
    if (why === "short") {
      setNotice(t("Five letters, please."));
      setShake((n) => n + 1);
      return;
    }
    if (why === "unknown") {
      setNotice(t("{word} isn't in the word list.", { word }));
      setShake((n) => n + 1);
      return;
    }
    // Cleared at once, so a second Enter cannot play the same word again.
    setLetters([]);
    onGuess(word);
  }

  // A real keyboard types too, Ç and Ë included.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.closest("[role=alertdialog]")) return;
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      } else if (event.key === "Backspace") {
        event.preventDefault();
        erase();
      } else if (event.key.length === 1) {
        const letter = event.key.toLocaleUpperCase("sq");
        if (alphabet.includes(letter)) {
          event.preventDefault();
          type(letter);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const rows = Array.from({ length: MAX_GUESSES }, (_, row) => {
    if (row < run.guesses.length) {
      const word = run.guesses[row]!;
      return { letters: lettersOf(word), marks: marksFor(word, run.answer), current: false };
    }
    if (row === run.guesses.length && accepting) {
      return { letters: typed, marks: undefined, current: true };
    }
    return { letters: [] as string[], marks: undefined, current: false };
  });

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2 text-xs text-muted-foreground">
        <span className="tabular">
          {t("Guess {n} of {max}", {
            n: Math.min(run.guesses.length + 1, MAX_GUESSES),
            max: MAX_GUESSES,
          })}
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

      <p className="min-h-6 py-1 text-center text-sm text-muted-foreground" aria-live="polite">
        {verifying
          ? t("Verifying your run with the server…")
          : (notice ??
            (run.guesses.length === 0
              ? t("Type a five-letter word, then Enter.")
              : t("{n} {guesses} left.", {
                  n: MAX_GUESSES - run.guesses.length,
                  guesses: MAX_GUESSES - run.guesses.length === 1 ? t("guess") : t("guesses"),
                })))}
      </p>

      <div className="flex min-h-0 flex-1 items-center justify-center py-2">
        <div
          className="grid w-full gap-1.5"
          style={{ maxWidth: "min(22rem, calc((100dvh - 22rem) * 5 / 6))" }}
          role="group"
          aria-label={t("Guesses")}
        >
          {rows.map((row, index) => (
            <div
              key={row.current ? `current-${shake}` : index}
              className={cn("grid grid-cols-5 gap-1.5", row.current && shake > 0 && "shake")}
              aria-label={
                row.marks
                  ? t("Guess {n}: {letters}", {
                      n: index + 1,
                      letters: row.letters
                        .map((letter, i) => `${letter} ${t(MARK_WORDS[row.marks![i]!])}`)
                        .join(", "),
                    })
                  : undefined
              }
            >
              {Array.from({ length: WORD_LENGTH }, (_, column) => (
                <Tile
                  key={column}
                  letter={row.letters[column] ?? ""}
                  mark={row.marks?.[column]}
                  active={row.current && column === row.letters.length}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div
        className="mx-auto flex w-full max-w-md flex-col gap-1.5 pt-1"
        role="group"
        aria-label={t("Keyboard")}
      >
        {keyboard.map((keys, line) => (
          <div key={keys} className="flex justify-center gap-1">
            {line === keyboard.length - 1 && (
              <Button
                type="button"
                variant="secondary"
                className="h-12 flex-[1.5] px-0 text-xs font-semibold"
                disabled={!accepting}
                onClick={submit}
                aria-label={t("Enter")}
              >
                <CornerDownLeft />
              </Button>
            )}
            {[...keys].map((letter) => {
              const mark = marks.get(letter);
              return (
                <Button
                  key={letter}
                  type="button"
                  variant="secondary"
                  disabled={!accepting}
                  onClick={() => type(letter)}
                  aria-label={mark === undefined ? letter : `${letter}, ${t(MARK_WORDS[mark])}`}
                  className={cn(
                    "h-12 min-w-0 flex-1 px-0 text-sm font-semibold",
                    mark === 2 && "bg-primary text-primary-foreground hover:bg-primary/90",
                    mark === 1 &&
                      "border-2 border-dashed border-primary bg-primary/10 text-primary",
                    mark === 0 && "bg-surface text-muted-foreground/50",
                  )}
                >
                  {letter}
                </Button>
              );
            })}
            {line === keyboard.length - 1 && (
              <Button
                type="button"
                variant="secondary"
                className="h-12 flex-[1.5] px-0"
                disabled={!accepting}
                onClick={erase}
                aria-label={t("Delete")}
              >
                <Delete />
              </Button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-center pt-2">
        <Button variant="ghost" size="sm" disabled={!accepting} onClick={() => setConfirming(true)}>
          {t("Give up")}
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Give up today's word?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("The word is shown and the run scores nothing. There is one play a day.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Keep guessing")}</AlertDialogCancel>
            <AlertDialogAction onClick={onFinish}>{t("Give up")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The end of a run: the word, the guesses, and the score the server verified. */
function Finished({ slug, run, result }: { slug: string; run: GuessworkRun; result: RunResult }) {
  const solved = run.ending === "solved";
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] text-center">
      <div className="enter flex flex-col items-center gap-2">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
          {result.ranked ? (
            <Trophy className="size-5 text-muted-foreground" />
          ) : (
            <ShieldCheck className="size-5 text-muted-foreground" />
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {solved
            ? t("Solved in {n} of {max}", { n: run.guesses.length, max: MAX_GUESSES })
            : t("Today's word was")}
        </p>
        <div className="flex gap-1.5" aria-label={t("The word: {word}", { word: run.answer })}>
          {lettersOf(run.answer).map((letter, index) => (
            <span key={index} className="w-11">
              <Tile letter={letter} mark={2} />
            </span>
          ))}
        </div>
        <p className="pt-2 text-5xl font-semibold tabular">{points(result.score)}</p>
      </div>

      <div className="mx-auto flex flex-col gap-1" aria-hidden>
        {run.guesses.map((word, row) => (
          <div key={row} className="flex justify-center gap-1">
            {marksFor(word, run.answer).map((mark, column) => (
              <Tile key={column} letter="" mark={mark} small />
            ))}
          </div>
        ))}
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Guesses")}</dt>
          <dd className="font-semibold tabular">
            {run.guesses.length}/{MAX_GUESSES}
          </dd>
        </div>
        {result.rank !== null ? (
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs text-muted-foreground">{t("Rank")}</dt>
            <dd className="font-semibold tabular">#{result.rank}</dd>
          </div>
        ) : (
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs text-muted-foreground">{t("Points")}</dt>
            <dd className="font-semibold tabular">{points(scoreOf(run))}</dd>
          </div>
        )}
      </dl>

      <p className="mx-auto max-w-sm text-xs text-muted-foreground">
        {result.ranked
          ? t("Verified by replaying your guesses on the server, then saved to the leaderboard.")
          : result.offline
            ? offlineResultNote()
            : t(
                "Verified by replaying your guesses on the server. This was a guest run, so it is not on the leaderboard.",
              )}
        {result.duplicate && t(" This run was already recorded, so nothing was counted twice.")}
      </p>
      <p className="text-xs text-muted-foreground">{nextWordIn()}</p>

      <RunEndActions slug={slug} ranked={result.ranked} autoFocus />
    </div>
  );
}

function nextWordIn(): string {
  const left = Math.max(0, msUntilLocalMidnight(Date.now()));
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return t("The next word arrives in {n}{minutes} min.", {
    n: hours ? `${hours} h ` : "",
    minutes,
  });
}
