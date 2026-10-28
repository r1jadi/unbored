import { Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Delete,
  Eye,
  Loader2,
  RotateCcw,
  ShieldCheck,
  SpellCheck,
  Trophy,
  TriangleAlert,
  Type,
} from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

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
import {
  CHECK_PENALTY,
  dayNumber,
  entriesAt,
  estimate,
  isWeekend,
  REVEAL_PENALTY,
  weekdayOf,
  wrongCells,
  type CrosswordEntry,
  type CrosswordRun,
} from "@/lib/games/crossword";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useCrosswordRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES["crossword"];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const KEYBOARD = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

/** What a day's puzzle is called: the size, then the weekday. */
function dayLabel(day: number): string {
  return `${isWeekend(day) ? "Midi 7×7" : "Mini 5×5"} · ${WEEKDAYS[weekdayOf(day)]}`;
}

/**
 * The daily crossword, playing for real.
 *
 * The board is a view onto `useCrosswordRun`, which owns the lifecycle: the
 * rules first, today's session issued when the player presses Start, the grid
 * and clues from the bank, and the score the server derived. Nothing here decides
 * a number: the "worth" shown while solving is an estimate from the screen's own
 * clock.
 *
 * Pick a cell (pick it again to switch between across and down), then type —
 * on the keyboard below the grid or a real one. Which cell is picked and the
 * marks a check leaves are display; the letters, checks and reveals are the run.
 */
export function CrosswordRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useCrosswordRun(slug, autoStart);

  if (state.status === "intro") {
    return <Intro signedIn={state.signedIn} onBegin={state.begin} slug={slug} title={title} />;
  }

  if (state.status === "starting") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Fetching today's crossword…</p>
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
          title="Couldn't start today's crossword"
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
        <h2 className="text-xl font-semibold">Your solve was not verified</h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {playErrorMessage(state.error)} Nothing was saved. Sending it again is safe; the server
          times the solve itself, so a later retry scores a little less.
        </p>
        <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
          <Button variant="play" size="lg" onClick={state.retry}>
            Try submitting again
          </Button>
          <Button variant="secondary" size="lg" onClick={state.restart}>
            <RotateCcw />
            Back to the rules
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
        clues={state.clues}
        startedAt={state.startedAt}
        verifying={state.status === "submitting"}
        onEnter={state.enter}
        onCheck={state.check}
        onReveal={state.reveal}
        onFinish={state.finish}
      />
    );
  }

  if (state.status === "finished") {
    return (
      <Finished
        slug={slug}
        run={state.run}
        result={state.result}
        clues={state.clues}
        onRestart={state.restart}
      />
    );
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
  // Display only: the server's day decides the puzzle.
  const today = dayNumber(Date.now());
  return (
    <div className="flex flex-1 flex-col justify-center px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="enter mx-auto flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
          <Type className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{RULES.heading}</h1>
          <p className="text-sm text-muted-foreground">{RULES.summary}</p>
          <p className="text-xs font-medium text-muted-foreground">Today: {dayLabel(today)}</p>
        </div>

        <RulesList rules={RULES.rules} />

        <div className="flex w-full flex-col gap-2">
          <Button variant="play" size="lg" onClick={onBegin} autoFocus>
            Start today's crossword
          </Button>
          <Button asChild variant="ghost" size="lg">
            <ExitGameLink slug={slug}>Back to {title}</ExitGameLink>
          </Button>
        </div>

        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          {signedIn
            ? "Signed in: today's solve can be ranked, once"
            : "Guest run: verified, but not ranked"}
        </p>
      </div>
    </div>
  );
}

/** Today's ranked solve is already in; this is the rules, not a failure. */
function DailyDone({ slug, title, message }: { slug: string; title: string; message: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 px-6 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-2">
        <Clock className="size-5 text-muted-foreground" />
      </div>
      <h1 className="text-xl font-semibold">You've done today's crossword</h1>
      <p className="mx-auto max-w-sm text-sm text-muted-foreground">{message}</p>
      <p className="mx-auto max-w-sm text-xs text-muted-foreground">
        One ranked solve a day keeps the board a comparison of the same puzzle. {nextPuzzleIn()}
      </p>
      <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
        <Button asChild variant="play" size="lg">
          <Link to="/leaderboards/$id" params={{ id: slug }}>
            See the leaderboard
          </Link>
        </Button>
        <GameExits slug={slug} title={title} />
      </div>
    </div>
  );
}

/**
 * The grid is printed paper in either theme: white squares with dark ink and
 * near-black blocks, as a crossword is expected to look. The tints are mixed with
 * white rather than laid over it, so the grid lines never show through them.
 */
const INK = "#18181b";
const PAPER = "#ffffff";
const ENTRY_TINT = "color-mix(in oklch, var(--primary) 22%, white)";
const SELECTED_TINT = "color-mix(in oklch, var(--primary) 55%, white)";

/** The live solve. */
function Board({
  run,
  session,
  clues,
  startedAt,
  verifying,
  onEnter,
  onCheck,
  onReveal,
  onFinish,
}: {
  run: CrosswordRun;
  session: PlaySession;
  clues: Readonly<Record<string, string>>;
  startedAt: number;
  verifying: boolean;
  onEnter: (cell: number, letter: string) => void;
  onCheck: () => void;
  onReveal: (cells: readonly number[]) => void;
  onFinish: () => void;
}) {
  const { puzzle } = run;
  const side = puzzle.side;
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  const firstEntry = puzzle.entries[0];
  const [selected, setSelected] = useState(firstEntry.cells[0]);
  const [across, setAcross] = useState(firstEntry.across);
  // What the last check found wrong: a mark stays while the cell holds that letter.
  const [marked, setMarked] = useState<ReadonlyMap<number, string>>(new Map());
  const accepting = !verifying && run.outcome === "playing";

  useReportRunProgress(accepting, onFinish);

  useEffect(() => {
    if (!accepting) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [accepting]);

  // A check marks what is wrong at that moment.
  useEffect(() => {
    if (run.checks === 0) return;
    const wrong = wrongCells(run);
    setMarked(new Map([...wrong].map((cell) => [cell, run.letters[cell]])));
    // Only when a check happens: later letters clear their own marks below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.checks]);

  const { across: acrossEntry, down: downEntry } = entriesAt(puzzle, selected);
  const entry: CrosswordEntry = (across ? acrossEntry : downEntry) ?? acrossEntry ?? downEntry!;
  const inEntry = useMemo(() => new Set(entry.cells), [entry]);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const worth = estimate(run, seconds);
  const index = puzzle.entries.indexOf(entry);

  function choose(cell: number) {
    if (puzzle.solution[cell] === "#") return;
    const here = entriesAt(puzzle, cell);
    if (cell === selected && here.across && here.down) {
      setAcross((value) => !value);
    } else {
      setSelected(cell);
      if (across && !here.across) setAcross(false);
      if (!across && !here.down) setAcross(true);
    }
  }

  function goToEntry(step: number) {
    const count = puzzle.entries.length;
    const next = puzzle.entries[(index + step + count) % count];
    setAcross(next.across);
    setSelected(next.cells.find((cell) => !run.letters[cell]) ?? next.cells[0]);
  }

  /** After a letter: the next empty cell of the entry, else the next entry's first empty. */
  function advance(letters: readonly string[]) {
    const position = entry.cells.indexOf(selected);
    const after = entry.cells.slice(position + 1).find((cell) => !letters[cell]);
    if (after !== undefined) return setSelected(after);
    const anywhere = entry.cells.find((cell) => !letters[cell]);
    if (anywhere !== undefined) return setSelected(anywhere);
    if (position + 1 < entry.cells.length) return setSelected(entry.cells[position + 1]);
    goToEntry(1);
  }

  function type(letter: string) {
    if (!accepting) return;
    const letters = [...run.letters];
    if (!run.revealed[selected]) {
      letters[selected] = letter;
      onEnter(selected, letter);
    }
    advance(letters);
  }

  function erase() {
    if (!accepting) return;
    if (run.letters[selected] && !run.revealed[selected]) {
      onEnter(selected, "");
      return;
    }
    const position = entry.cells.indexOf(selected);
    if (position > 0) {
      const back = entry.cells[position - 1];
      setSelected(back);
      if (!run.revealed[back]) onEnter(back, "");
    }
  }

  function move(dr: number, dc: number) {
    setAcross(dc !== 0);
    let row = Math.floor(selected / side);
    let column = selected % side;
    for (;;) {
      row += dr;
      column += dc;
      if (row < 0 || column < 0 || row >= side || column >= side) return;
      if (puzzle.solution[row * side + column] !== "#") {
        setSelected(row * side + column);
        return;
      }
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^[a-zA-Z]$/.test(event.key)) {
      event.preventDefault();
      type(event.key.toUpperCase());
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      erase();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(0, -1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      move(0, 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1, 0);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1, 0);
    } else if (event.key === "Tab" || event.key === "Enter") {
      event.preventDefault();
      goToEntry(event.shiftKey ? -1 : 1);
    } else if (event.key === " ") {
      event.preventDefault();
      choose(selected);
    }
  }

  const clue = clues[entry.answer] ?? "";
  const hidden = entry.cells.filter((cell) => !run.revealed[cell]);

  return (
    <div
      className="flex flex-1 flex-col px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] outline-none"
      onKeyDown={onKeyDown}
      // The whole board takes keys, so typing works wherever focus sits on it.
      tabIndex={-1}
    >
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">Worth</dt>
          <dd className="text-2xl font-semibold tabular" aria-live="off">
            {worth}
          </dd>
        </dl>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular" aria-label={`Time ${formatSeconds(seconds * 1000)}`}>
            {formatSeconds(seconds * 1000)}
          </span>
          <span className="rounded-full bg-surface-2 px-2 py-1">{dayLabel(puzzle.day)}</span>
          {session.ranked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1">
              <ShieldCheck className="size-3.5" />
              Ranked
            </span>
          ) : null}
        </div>
      </div>

      {/* The clue bar: the selected entry's clue, with the neighbours either side. */}
      <div className="mx-auto flex w-full max-w-md items-stretch gap-1 rounded-xl bg-surface-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Previous clue"
          disabled={!accepting}
          onClick={() => goToEntry(-1)}
        >
          <ChevronLeft />
        </Button>
        <button
          type="button"
          className="flex min-h-12 flex-1 items-center gap-2 px-1 text-left text-sm"
          onClick={() => choose(selected)}
          aria-live="polite"
          aria-label={`${entry.number} ${entry.across ? "Across" : "Down"}: ${clue}. Tap to switch direction.`}
        >
          <span className="shrink-0 font-semibold tabular">
            {entry.number}
            {entry.across ? "A" : "D"}
          </span>
          <span>{verifying ? "Checking your solve with the server…" : clue}</span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Next clue"
          disabled={!accepting}
          onClick={() => goToEntry(1)}
        >
          <ChevronRight />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center py-2">
        <div className="flex max-h-full w-full justify-center">
          <div
            className="grid aspect-square w-full overflow-hidden rounded-lg border-2"
            style={{
              borderColor: INK,
              background: INK,
              maxWidth: "min(26rem, calc(100dvh - 26rem))",
              gridTemplateColumns: `repeat(${side}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${side}, minmax(0, 1fr))`,
              gap: 1,
            }}
            role="group"
            aria-label={`Today's crossword, ${side} by ${side}`}
          >
            {[...puzzle.solution].map((solutionLetter, cell) => {
              if (solutionLetter === "#") {
                return <div key={cell} aria-hidden style={{ background: INK }} />;
              }
              const letter = run.letters[cell];
              const isSelected = cell === selected;
              const wrong = marked.get(cell) === letter && !!letter;
              const number = puzzle.numbers[cell];
              return (
                <button
                  key={cell}
                  type="button"
                  disabled={!accepting}
                  onClick={() => choose(cell)}
                  aria-pressed={isSelected}
                  aria-label={cellLabel(cell, side, number, letter, run.revealed[cell], wrong)}
                  style={{
                    background: isSelected ? SELECTED_TINT : inEntry.has(cell) ? ENTRY_TINT : PAPER,
                  }}
                  className={cn(
                    "relative flex items-center justify-center font-semibold uppercase leading-none text-zinc-900",
                    side === 7
                      ? "text-[clamp(1rem,5.5vmin,1.6rem)]"
                      : "text-[clamp(1.3rem,8vmin,2.2rem)]",
                    wrong && "text-red-600",
                    run.revealed[cell] && "text-blue-700",
                    "focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  )}
                >
                  {number > 0 && (
                    <span
                      aria-hidden
                      className="absolute left-[6%] top-[4%] text-[clamp(0.5rem,2.2vmin,0.75rem)] font-medium leading-none text-zinc-500"
                    >
                      {number}
                    </span>
                  )}
                  {letter}
                  {run.revealed[cell] && (
                    <span
                      aria-hidden
                      className="absolute right-0 top-0 size-0 border-l-[0.45rem] border-t-[0.45rem] border-l-transparent border-t-blue-700"
                    />
                  )}
                  {wrong && (
                    <span
                      aria-hidden
                      className="absolute inset-x-[15%] top-1/2 h-0.5 -rotate-12 bg-red-600/70"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-md grid-cols-4 gap-1 pb-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!accepting}
          onClick={onCheck}
          className="flex-col gap-0 px-1 text-xs"
        >
          <span className="inline-flex items-center gap-1">
            <SpellCheck className="size-3.5" />
            Check
          </span>
          <span className="text-[0.65rem] text-muted-foreground">−{CHECK_PENALTY}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!accepting || run.revealed[selected]}
          onClick={() => onReveal([selected])}
          className="flex-col gap-0 px-1 text-xs"
        >
          <span className="inline-flex items-center gap-1">
            <Eye className="size-3.5" />
            Letter
          </span>
          <span className="text-[0.65rem] text-muted-foreground">−{REVEAL_PENALTY}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!accepting || hidden.length === 0}
          onClick={() => onReveal(hidden)}
          className="flex-col gap-0 px-1 text-xs"
        >
          <span className="inline-flex items-center gap-1">
            <Eye className="size-3.5" />
            Word
          </span>
          <span className="text-[0.65rem] text-muted-foreground">
            −{REVEAL_PENALTY * hidden.length}
          </span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!accepting}
          onClick={() => setConfirming(true)}
          className="px-1 text-xs"
        >
          Give up
        </Button>
      </div>

      {/* The keyboard: a phone's own keyboard would cover the grid. */}
      <div
        className="mx-auto flex w-full max-w-md flex-col gap-1"
        role="group"
        aria-label="Keyboard"
      >
        {KEYBOARD.map((row, line) => (
          <div key={row} className="flex justify-center gap-1">
            {[...row].map((key) => (
              <Button
                key={key}
                type="button"
                variant="secondary"
                disabled={!accepting}
                onClick={() => type(key)}
                className="h-11 min-w-0 flex-1 px-0 text-base font-semibold"
              >
                {key}
              </Button>
            ))}
            {line === KEYBOARD.length - 1 && (
              <Button
                type="button"
                variant="secondary"
                disabled={!accepting}
                onClick={erase}
                aria-label="Delete"
                className="h-11 min-w-0 flex-[1.5] px-0"
              >
                <Delete />
              </Button>
            )}
          </div>
        ))}
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Give up today's crossword?</AlertDialogTitle>
            <AlertDialogDescription>
              {session.ranked
                ? "An unsolved crossword scores nothing, and this is today's ranked attempt."
                : "An unsolved crossword scores nothing."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep solving</AlertDialogCancel>
            <AlertDialogAction onClick={onFinish}>Give up</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The accessible name of a cell: where it is, its number, and what it holds. */
function cellLabel(
  cell: number,
  side: number,
  number: number,
  letter: string,
  revealed: boolean,
  wrong: boolean,
): string {
  return `Row ${Math.floor(cell / side) + 1} column ${(cell % side) + 1}${
    number ? `, number ${number}` : ""
  }, ${letter || "empty"}${revealed ? ", revealed" : ""}${wrong ? ", wrong" : ""}`;
}

/** The end of the day's solve: the score the server verified. */
function Finished({
  slug,
  run,
  result,
  clues,
  onRestart,
}: {
  slug: string;
  run: CrosswordRun;
  result: RunResult;
  clues: Readonly<Record<string, string>>;
  onRestart: () => void;
}) {
  const solved = run.ending === "solved";
  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-[max(1rem,env(safe-area-inset-bottom))] text-center",
        solved ? "justify-center" : "pt-2",
      )}
    >
      <div className="enter flex flex-col items-center gap-2">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
          {result.ranked ? (
            <Trophy className="size-5 text-muted-foreground" />
          ) : (
            <ShieldCheck className="size-5 text-muted-foreground" />
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {solved ? `Solved · ${dayLabel(run.puzzle.day)}` : "Not solved today"}
        </p>
        <p className="text-5xl font-semibold tabular">{result.score}</p>
        {solved && (
          <p className="text-sm text-muted-foreground">
            {`In ${formatSeconds(result.durationMs)}${
              run.checks ? `, ${run.checks} ${run.checks === 1 ? "check" : "checks"}` : ""
            }${run.reveals ? `, ${run.reveals} ${run.reveals === 1 ? "letter" : "letters"} revealed` : ""}.`}
          </p>
        )}
      </div>

      {!solved && <AnswerReview run={run} clues={clues} />}

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Time</dt>
          <dd className="font-semibold tabular">{formatSeconds(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Help used</dt>
          <dd className="font-semibold tabular">{run.checks + run.reveals}</dd>
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
          ? "Verified by replaying your solve on the server, which timed it itself. That was today's ranked attempt."
          : "Verified by replaying your solve on the server. This was a guest run, so it is not on the leaderboard."}
        {result.duplicate && " This solve was already recorded, so nothing was counted twice."}
      </p>

      <RunEndActions slug={slug} ranked={result.ranked} onRestart={onRestart} autoFocus>
        {result.ranked && (
          <p className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-surface px-3 py-2 text-xs text-muted-foreground">
            <Clock className="size-3.5" />
            {nextPuzzleIn()}
          </p>
        )}
      </RunEndActions>
    </div>
  );
}

/**
 * The answers to a crossword the player did not finish: the solved grid, with
 * what they had wrong struck through and what they left empty filled in, then
 * every clue with its answer.
 */
function AnswerReview({
  run,
  clues,
}: {
  run: CrosswordRun;
  clues: Readonly<Record<string, string>>;
}) {
  const { puzzle } = run;
  const { side } = puzzle;
  let right = 0;
  let wrong = 0;
  let empty = 0;
  for (let cell = 0; cell < puzzle.solution.length; cell += 1) {
    if (puzzle.solution[cell] === "#") continue;
    const letter = run.letters[cell];
    if (!letter) empty += 1;
    else if (letter === puzzle.solution[cell]) right += 1;
    else wrong += 1;
  }
  const groups: [string, CrosswordEntry[]][] = [
    ["Across", puzzle.entries.filter((entry) => entry.across)],
    ["Down", puzzle.entries.filter((entry) => !entry.across)],
  ];

  return (
    <section className="enter mx-auto w-full max-w-sm space-y-3 text-left" aria-label="The answers">
      <h2 className="text-center text-base font-semibold">Here's how it solves</h2>
      <p className="text-center text-xs text-muted-foreground">
        {`You had ${right} ${right === 1 ? "letter" : "letters"} right${
          wrong ? `, ${wrong} wrong` : ""
        }${empty ? ` and ${empty} left empty` : ""}.`}
      </p>
      <div
        className="mx-auto grid aspect-square w-full max-w-[16rem] overflow-hidden rounded-lg border-2"
        style={{
          borderColor: INK,
          background: INK,
          gridTemplateColumns: `repeat(${side}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${side}, minmax(0, 1fr))`,
          gap: 1,
        }}
        role="img"
        aria-label={`The solved grid: ${puzzle.entries
          .map((entry) => `${entry.number} ${entry.across ? "across" : "down"} ${entry.answer}`)
          .join(", ")}`}
      >
        {[...puzzle.solution].map((answer, cell) => {
          if (answer === "#") return <div key={cell} style={{ background: INK }} />;
          const letter = run.letters[cell];
          const missed = !letter;
          const mistaken = !!letter && letter !== answer;
          const number = puzzle.numbers[cell];
          return (
            <div
              key={cell}
              className={cn(
                "relative flex items-center justify-center font-semibold uppercase leading-none",
                side === 7 ? "text-sm" : "text-lg",
                missed ? "text-blue-700" : mistaken ? "text-red-600" : "text-zinc-900",
              )}
              style={{ background: mistaken ? "#fee2e2" : PAPER }}
            >
              {number > 0 && (
                <span className="absolute left-[6%] top-[4%] text-[0.5rem] font-medium leading-none text-zinc-500">
                  {number}
                </span>
              )}
              {answer}
              {mistaken && (
                <span className="absolute bottom-[4%] right-[8%] text-[0.55rem] font-medium leading-none text-red-600/80 line-through">
                  {letter}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[0.7rem] text-muted-foreground">
        <span>Black: you had it</span>
        <span className="text-red-500">Red: you had it wrong (yours struck through)</span>
        <span className="text-blue-500">Blue: left empty</span>
      </p>
      {groups.map(([heading, list]) => (
        <div key={heading}>
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {heading}
          </h3>
          <ul className="mt-1 space-y-1 text-sm">
            {list.map((entry) => (
              <li key={`${entry.number}${entry.across}`} className="flex gap-2">
                <span className="w-5 shrink-0 text-right font-medium tabular text-muted-foreground">
                  {entry.number}
                </span>
                <span className="min-w-0 flex-1">
                  {clues[entry.answer] ?? ""}{" "}
                  <span className="font-semibold tracking-wider whitespace-nowrap">
                    {entry.answer}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** "The next crossword arrives in 5 h 12 min", counting to midnight UTC. */
function nextPuzzleIn(): string {
  const now = Date.now();
  const left = Math.max(0, (dayNumber(now) + 1) * 86_400_000 - now);
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return `The next crossword arrives in ${hours ? `${hours} h ` : ""}${minutes} min (midnight UTC).`;
}

/** Milliseconds as `m:ss`. */
function formatSeconds(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
