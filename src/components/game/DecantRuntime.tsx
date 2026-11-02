import {
  Loader2,
  Plus,
  RotateCcw,
  ShieldCheck,
  TestTubes,
  Trophy,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { ErrorState } from "@/components/common";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { GameExits } from "@/components/game/GameExits";
import { LevelUpOverlay } from "@/components/game/LevelUp";
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
import { points } from "@/lib/format";
import {
  budgetMs,
  canPour,
  coloursFor,
  DECANT_BONUS_MS_PER_COLOUR,
  DECANT_DEPTH,
  DECANT_EXTRA_TUBE_MS,
  isComplete,
  type DecantRun,
  type Tube,
} from "@/lib/games/decant";
import { levelUpHold, useLevelUp } from "@/lib/games/level-up";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useDecantRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import { cn } from "@/lib/utils";
import { useGameSounds } from "@/lib/sound";

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES.decant;

/**
 * The nine liquids, colour 1 to 9, with the names a screen reader says. Mostly
 * the app's game hues, chosen to stay apart from one another.
 */
const LIQUIDS: readonly { fill: string; name: string }[] = [
  { fill: "var(--game-5)", name: "red" },
  { fill: "var(--game-7)", name: "orange" },
  { fill: "var(--game-4)", name: "yellow" },
  { fill: "var(--game-2)", name: "green" },
  { fill: "var(--game-6)", name: "teal" },
  { fill: "var(--game-1)", name: "blue" },
  // Violet, pink and white are fixed: the theme's own versions of these turn
  // pastel in light mode and blur together.
  { fill: "oklch(0.56 0.17 300)", name: "violet" },
  { fill: "oklch(0.74 0.15 350)", name: "pink" },
  { fill: "oklch(0.94 0.005 270)", name: "white" },
];

/** Keys that pick a tube, in order: 1 to 9, then 0, - and =. */
const TUBE_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="];

/**
 * Decant, playing for real.
 *
 * The tubes are a view onto `useDecantRun`, which owns the lifecycle and the
 * clock: the rules first, a session issued when the player presses Start, boards
 * dealt from its seed, and the score the server derived from the submitted
 * actions. Nothing here decides a number.
 *
 * Tap a tube to pick it up, then another to pour into it. Every tube is a real
 * button, and the number keys pick tubes too.
 */
export function DecantRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useDecantRun(slug, autoStart);

  if (state.status === "intro") {
    return <Intro signedIn={state.signedIn} onBegin={state.begin} slug={slug} title={title} />;
  }

  if (state.status === "starting") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Starting a run…</p>
      </div>
    );
  }

  if (state.status === "error" && state.stage === "start") {
    return (
      <div className="flex flex-1 flex-col justify-center px-6">
        <ErrorState
          title="Couldn't start a run"
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
        <h2 className="text-xl font-semibold">Your run was not verified</h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {playErrorMessage(state.error)} Nothing was saved. Sending the same run again is safe, but
          a timed run has to reach the server soon after its clock runs out.
        </p>
        <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
          <Button variant="play" size="lg" onClick={state.retry}>
            Try submitting again
          </Button>
          <Button variant="secondary" size="lg" onClick={state.restart}>
            <RotateCcw />
            Start a new run
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
        deadline={state.deadline}
        verifying={state.status === "submitting"}
        onPour={state.pour}
        onUndo={state.undo}
        onReset={state.reset}
        onAddTube={state.addTube}
        onFinish={state.finish}
      />
    );
  }

  if (state.status === "finished") {
    return (
      <Finished
        slug={slug}
        result={state.result}
        outOfTime={state.run.ending === "time"}
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
  return (
    <div className="flex flex-1 flex-col justify-center px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="enter mx-auto flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
          <TestTubes className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{RULES.heading}</h1>
          <p className="text-sm text-muted-foreground">{RULES.summary}</p>
        </div>

        <RulesList rules={RULES.rules} />

        <div className="flex w-full flex-col gap-2">
          <Button variant="play" size="lg" onClick={onBegin} autoFocus>
            Start run
          </Button>
          <Button asChild variant="ghost" size="lg">
            <ExitGameLink slug={slug}>Back to {title}</ExitGameLink>
          </Button>
        </div>

        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          {signedIn ? "Signed in: this run can be ranked" : "Guest run: verified, but not ranked"}
        </p>
      </div>
    </div>
  );
}

/** The live run: one board at a time, against the clock. */
function Board({
  run,
  session,
  deadline,
  verifying,
  onPour,
  onUndo,
  onReset,
  onAddTube,
  onFinish,
}: {
  run: DecantRun;
  session: PlaySession;
  deadline: number;
  verifying: boolean;
  onPour: (from: number, to: number) => void;
  onUndo: () => void;
  onReset: () => void;
  onAddTube: () => void;
  onFinish: () => void;
}) {
  useGameSounds({
    moves: run.actions.length,
    score: run.score,
    cleared: run.levelsCleared,
    over: run.outcome === "over",
    ending: run.ending === "time" ? "lose" : "stop",
  });
  const [confirming, setConfirming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [held, setHeld] = useState<number | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const levelUp = useLevelUp(run.level, run.score, levelUpHold(false));
  const accepting = !verifying && run.outcome === "playing" && !levelUp;

  useReportRunProgress(accepting, onFinish);

  // The board takes focus so the number keys work straight away.
  useEffect(() => {
    boardRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!accepting) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [accepting]);

  // A new board, an undo or a restart puts down whatever was held.
  const [heldFor, setHeldFor] = useState(run.tubes);
  if (heldFor !== run.tubes) {
    setHeldFor(run.tubes);
    if (held !== null) setHeld(null);
  }

  const remaining = Math.max(0, deadline - now);
  const earned = Math.max(1, budgetMs(run.levelsCleared, run.extraTubes));

  /** A tap on a tube: pick it up, pour into it, or put it down. */
  const choose = (tube: number) => {
    if (!accepting) return;
    if (held === null) {
      if (run.tubes[tube].length > 0 && !isComplete(run.tubes[tube])) setHeld(tube);
      return;
    }
    if (held === tube) {
      setHeld(null);
      return;
    }
    if (canPour(run, held, tube)) {
      onPour(held, tube);
      return;
    }
    // Not a pour: pick this tube up instead, if there is anything in it.
    setHeld(run.tubes[tube].length > 0 && !isComplete(run.tubes[tube]) ? tube : null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!accepting) return;
    const index = TUBE_KEYS.indexOf(event.key);
    if (index >= 0 && index < run.tubes.length) {
      event.preventDefault();
      choose(index);
    } else if (event.key === "u" || event.key === "U" || event.key === "Backspace") {
      event.preventDefault();
      onUndo();
    } else if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      onReset();
    } else if (event.key === "Escape") {
      setHeld(null);
    }
  };

  // Up to six tubes stand in one row; more stand in two.
  const perRow = run.tubes.length > 6 ? Math.ceil(run.tubes.length / 2) : run.tubes.length;
  const rows = [run.tubes.slice(0, perRow), run.tubes.slice(perRow)].filter((row) => row.length);
  const colours = coloursFor(run.level);

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">Score</dt>
          <dd className="text-2xl font-semibold tabular">{points(run.score)}</dd>
        </dl>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular">Board {run.level}</span>
          {session.ranked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1">
              <ShieldCheck className="size-3.5" />
              Ranked
            </span>
          ) : (
            <span className="rounded-full bg-surface-2 px-2 py-1">Guest run</span>
          )}
        </div>
      </div>

      <p className="py-1 text-center text-sm text-muted-foreground" aria-live="polite">
        {statusLine(run, verifying, held)}
      </p>

      <div className="mx-auto flex w-full max-w-md items-center gap-3 pb-1 text-xs text-muted-foreground">
        <span className="tabular">
          {colours} colours · {run.pours} {run.pours === 1 ? "pour" : "pours"}
        </span>
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-label="Time left"
          aria-valuemin={0}
          aria-valuemax={Math.round(earned / 1000)}
          aria-valuenow={Math.ceil(remaining / 1000)}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none",
              remaining < 10_000 ? "bg-destructive" : "bg-primary",
            )}
            style={{ width: `${Math.min(100, (remaining / earned) * 100)}%` }}
          />
        </div>
        <span className={cn("tabular", remaining < 10_000 && "text-destructive")}>
          {formatSeconds(remaining)}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center py-3">
        <div
          ref={boardRef}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className="relative flex w-full max-w-md flex-col items-center justify-center gap-6 rounded-2xl bg-surface px-3 py-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="group"
          aria-label={`Board ${run.level}, ${run.tubes.length} tubes. Number keys pick a tube; U undoes, R restarts the board.`}
        >
          {rows.map((row, r) => (
            <div key={r} className="flex items-end justify-center gap-2.5 sm:gap-3.5">
              {row.map((tube, i) => {
                const index = r * perRow + i;
                return (
                  <TubeButton
                    key={index}
                    tube={tube}
                    index={index}
                    held={held === index}
                    target={held !== null && held !== index && canPour(run, held, index)}
                    disabled={!accepting}
                    onChoose={() => choose(index)}
                  />
                );
              })}
            </div>
          ))}
          {levelUp && (
            <LevelUpOverlay
              levelUp={levelUp}
              unit="Board"
              next={`Board ${run.level} · ${colours} colours · clock +${
                (DECANT_BONUS_MS_PER_COLOUR * coloursFor(run.level - 1)) / 1000
              } s`}
              note={colours > coloursFor(run.level - 1) ? "One more colour from here." : undefined}
            />
          )}
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-md grid-cols-3 gap-2 pt-1">
        <Button
          variant="secondary"
          disabled={!accepting || run.pours === 0}
          onClick={onUndo}
          aria-keyshortcuts="U"
        >
          <Undo2 />
          Undo
        </Button>
        <Button
          variant="secondary"
          disabled={!accepting || run.pours === 0}
          onClick={onReset}
          aria-keyshortcuts="R"
        >
          <RotateCcw />
          Restart
        </Button>
        <Button
          variant="secondary"
          disabled={!accepting || run.extraTube}
          onClick={onAddTube}
          aria-label={`Add an empty tube to this board, for ${DECANT_EXTRA_TUBE_MS / 1000} seconds of clock`}
        >
          <Plus />
          Tube
          <span className="text-xs text-muted-foreground tabular">
            −{DECANT_EXTRA_TUBE_MS / 1000}s
          </span>
        </Button>
      </div>

      <div className="flex flex-col items-center gap-1 pt-2">
        <p className="text-center text-xs text-muted-foreground" aria-live="polite">
          {verifying
            ? "The pours you made are your score if the server agrees."
            : `A solved board adds ${DECANT_BONUS_MS_PER_COLOUR / 1000} seconds per colour.`}
        </p>
        <Button variant="ghost" size="sm" disabled={!accepting} onClick={() => setConfirming(true)}>
          End run
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this run?</AlertDialogTitle>
            <AlertDialogDescription>
              {`Your score of ${points(run.score)} is kept and sent for verification. The board you are on is not scored.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep playing</AlertDialogCancel>
            <AlertDialogAction onClick={onFinish}>End run</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** One tube: a glass column of up to four units, lifted while it is held. */
function TubeButton({
  tube,
  index,
  held,
  target,
  disabled,
  onChoose,
}: {
  tube: Tube;
  index: number;
  held: boolean;
  target: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  const complete = isComplete(tube);
  const names = tube.map((colour) => LIQUIDS[colour - 1]?.name ?? "unknown");
  const label = `Tube ${index + 1}${TUBE_KEYS[index] ? ` (key ${TUBE_KEYS[index]})` : ""}: ${
    tube.length === 0 ? "empty" : `${names.join(", ")}, bottom to top`
  }${complete ? ", sorted" : ""}${held ? ", picked up" : ""}${target ? ", can take the pour" : ""}`;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={held}
      aria-disabled={disabled}
      onClick={onChoose}
      className={cn(
        "group relative flex h-[clamp(8.5rem,26vmin,11rem)] w-[clamp(2.4rem,9vmin,3.25rem)] flex-col-reverse gap-[3px] overflow-hidden rounded-t-md rounded-b-[1.4rem] border-2 p-[3px] transition-[transform,border-color,box-shadow] duration-150 ease-out motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        held
          ? "-translate-y-3 border-primary shadow-[0_10px_24px_-8px_oklch(0.7_0.18_40/0.6)]"
          : target
            ? "border-foreground/40"
            : complete
              ? "border-success/70"
              : "border-foreground/15",
        "bg-surface-2/50",
      )}
    >
      {tube.map((colour, unit) => (
        <span
          key={unit}
          className={cn(
            "w-full shrink-0 shadow-[inset_0_-3px_0_oklch(0_0_0/0.18)] ring-1 ring-inset ring-foreground/10",
            unit === 0 ? "rounded-b-[1.1rem] rounded-t-[0.2rem]" : "rounded-[0.2rem]",
          )}
          style={{
            height: `calc((100% - ${3 * (DECANT_DEPTH - 1)}px) / ${DECANT_DEPTH})`,
            backgroundColor: LIQUIDS[colour - 1]?.fill,
          }}
        />
      ))}
      {/* A highlight down the glass. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-2 left-1 w-1 rounded-full bg-foreground/10"
      />
    </button>
  );
}

/** The line above the board: what just happened, or what to do. */
function statusLine(run: DecantRun, verifying: boolean, held: number | null): string {
  if (verifying) return "Verifying your run with the server…";
  if (run.outcome === "over") return run.ending === "time" ? "Time's up." : "Run ended.";
  if (held !== null) return `Tube ${held + 1} picked up — tap a tube to pour into it.`;
  if (run.levelsCleared > 0 && run.pours === 0 && !run.extraTube) {
    return `Board ${run.level - 1} sorted, +${points(coloursFor(run.level - 1))}.`;
  }
  return "Tap a tube, then the tube to pour it into.";
}

/** The end of a run: the score the server verified, or a guest's unranked result. */
function Finished({
  slug,
  result,
  outOfTime,
  onRestart,
}: {
  slug: string;
  result: RunResult;
  outOfTime: boolean;
  onRestart: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 px-6 pb-[max(1rem,env(safe-area-inset-bottom))] text-center">
      <div className="enter flex flex-col items-center gap-2">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
          {result.ranked ? (
            <Trophy className="size-5 text-muted-foreground" />
          ) : (
            <ShieldCheck className="size-5 text-muted-foreground" />
          )}
        </div>
        <p className="text-sm text-muted-foreground">{outOfTime ? "Time's up" : "Run ended"}</p>
        <p className="text-5xl font-semibold tabular">{points(result.score)}</p>
        <p className="text-sm text-muted-foreground">
          {`${result.clearedColumns} ${result.clearedColumns === 1 ? "board" : "boards"} sorted, ${
            result.tilesPlaced
          } ${result.tilesPlaced === 1 ? "pour" : "pours"}.`}
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Duration</dt>
          <dd className="font-semibold tabular">{formatSeconds(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Boards sorted</dt>
          <dd className="font-semibold tabular">{result.clearedColumns}</dd>
        </div>
        {result.personalBest !== null && (
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs text-muted-foreground">Your best</dt>
            <dd className="font-semibold tabular">{points(result.personalBest)}</dd>
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
          ? "Verified by replaying your pours on the server, then saved to the leaderboard."
          : "Verified by replaying your pours on the server. This was a guest run, so it is not on the leaderboard."}
        {result.duplicate && " This run was already recorded, so nothing was counted twice."}
      </p>

      <RunEndActions slug={slug} ranked={result.ranked} onRestart={onRestart} autoFocus />
    </div>
  );
}

/** Milliseconds as `m:ss`, rounded up so the last second shows as 0:01. */
function formatSeconds(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
