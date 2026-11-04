import {
  Bolt as BoltIcon,
  Loader2,
  Plus,
  RotateCcw,
  ShieldCheck,
  Lock,
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
  canMove,
  coloursFor,
  BOLTED_DEPTH,
  BOLTED_EXTRA_BOLT_MS,
  isLocked,
  type BoltedRun,
  type Bolt,
} from "@/lib/games/bolted";
import { formatClockGain } from "@/lib/games/clock";
import { levelUpHold, useLevelUp } from "@/lib/games/level-up";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useBoltedRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import { cn } from "@/lib/utils";
import { useGameSounds } from "@/lib/sound";
import { offlineResultNote } from "@/lib/games/offline";

import { t } from "@/lib/settings/language";
/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES.bolted;

/**
 * The eight nut colours, 1 to 8, with the names a screen reader says. Mostly the
 * app's game hues; violet and pink are fixed, as in Decant, because the theme's
 * own turn pastel in light mode.
 */
const NUTS: readonly { fill: string; name: string }[] = [
  { fill: "var(--game-5)", name: "red" },
  { fill: "var(--game-7)", name: "orange" },
  { fill: "var(--game-4)", name: "yellow" },
  { fill: "var(--game-2)", name: "green" },
  { fill: "var(--game-6)", name: "teal" },
  { fill: "var(--game-1)", name: "blue" },
  { fill: "oklch(0.56 0.17 300)", name: "violet" },
  { fill: "oklch(0.74 0.15 350)", name: "pink" },
];

/** Keys that pick a bolt, in order: 1 to 9, then 0, - and =. */
const BOLT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="];

/**
 * Bolted, playing for real.
 *
 * The bolts are a view onto `useBoltedRun`, which owns the lifecycle and the
 * clock: the rules first, a session issued when the player presses Start, boards
 * dealt from its seed, and the score the server derived from the submitted
 * actions. Nothing here decides a number.
 *
 * Tap a bolt to pick its top nuts up, then another to move them there. Every bolt
 * is a real button, and the number keys pick bolts too. Face-down nuts show as
 * blanks until the nuts above them are moved off.
 */
export function BoltedRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useBoltedRun(slug, autoStart);

  if (state.status === "intro") {
    return <Intro signedIn={state.signedIn} onBegin={state.begin} slug={slug} title={title} />;
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

  if (state.status === "error" && state.stage === "submit" && state.run && state.session) {
    return (
      <div className="flex flex-1 flex-col justify-center gap-4 px-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-2">
          <TriangleAlert className="size-5 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold">{t("Your run was not verified")}</h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {t(
            "{error} Nothing was saved. Sending the same run again is safe, but a timed run has to reach the server soon after its clock runs out.",
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
        key={state.session.id}
        run={state.run}
        session={state.session}
        deadline={state.deadline}
        verifying={state.status === "submitting"}
        onMove={state.move}
        onUndo={state.undo}
        onReset={state.reset}
        onAddBolt={state.addBolt}
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
          <BoltIcon className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{t(RULES.heading)}</h1>
          <p className="text-sm text-muted-foreground">{t(RULES.summary)}</p>
        </div>

        <RulesList rules={RULES.rules} />

        <div className="flex w-full flex-col gap-2">
          <Button variant="play" size="lg" onClick={onBegin} autoFocus>
            {t("Start run")}
          </Button>
          <Button asChild variant="ghost" size="lg">
            <ExitGameLink slug={slug}>{t("Back to {title}", { title })}</ExitGameLink>
          </Button>
        </div>

        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          {signedIn
            ? t("Signed in: this run can be ranked")
            : t("Guest run: verified, but not ranked")}
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
  onMove,
  onUndo,
  onReset,
  onAddBolt,
  onFinish,
}: {
  run: BoltedRun;
  session: PlaySession;
  deadline: number;
  verifying: boolean;
  onMove: (from: number, to: number) => void;
  onUndo: () => void;
  onReset: () => void;
  onAddBolt: () => void;
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
  const [heldFor, setHeldFor] = useState(run.bolts);
  if (heldFor !== run.bolts) {
    setHeldFor(run.bolts);
    if (held !== null) setHeld(null);
  }

  const remaining = Math.max(0, deadline - now);
  const earned = Math.max(1, budgetMs(run.levelsCleared, run.extraBolts));

  /** A tap on a bolt: pick its nuts up, move them onto it, or put them down. */
  const choose = (tube: number) => {
    if (!accepting) return;
    if (held === null) {
      if (run.bolts[tube].length > 0 && !isLocked(run.bolts[tube])) setHeld(tube);
      return;
    }
    if (held === tube) {
      setHeld(null);
      return;
    }
    if (canMove(run, held, tube)) {
      onMove(held, tube);
      return;
    }
    // Not a move: pick this bolt up instead, if anything on it can move.
    setHeld(run.bolts[tube].length > 0 && !isLocked(run.bolts[tube]) ? tube : null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!accepting) return;
    const index = BOLT_KEYS.indexOf(event.key);
    if (index >= 0 && index < run.bolts.length) {
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

  // Up to six bolts stand in one row; more stand in two.
  const perRow = run.bolts.length > 6 ? Math.ceil(run.bolts.length / 2) : run.bolts.length;
  const rows = [run.bolts.slice(0, perRow), run.bolts.slice(perRow)].filter((row) => row.length);
  const colours = coloursFor(run.level);

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">{t("Score")}</dt>
          <dd className="text-2xl font-semibold tabular">{points(run.score)}</dd>
        </dl>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular">{t("Board {level}", { level: run.level })}</span>
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
        {statusLine(run, verifying, held)}
      </p>

      <div className="mx-auto flex w-full max-w-md items-center gap-3 pb-1 text-xs text-muted-foreground">
        <span className="tabular">
          {colours} {t("colours ·")} {run.moves} {run.moves === 1 ? t("move") : t("moves")}
        </span>
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-label={t("Time left")}
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
          aria-label={t(
            "Board {level}, {length} bolts. Number keys pick a bolt; U undoes, R restarts the board.",
            { level: run.level, length: run.bolts.length },
          )}
        >
          {rows.map((row, r) => (
            <div key={r} className="flex items-end justify-center gap-2.5 sm:gap-3.5">
              {row.map((tube, i) => {
                const index = r * perRow + i;
                return (
                  <BoltButton
                    key={index}
                    bolt={tube}
                    hidden={run.hidden[index] ?? 0}
                    index={index}
                    held={held === index}
                    target={held !== null && held !== index && canMove(run, held, index)}
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
              unit={t("Board")}
              next={`Board ${run.level} · ${colours} colours · clock +${formatClockGain(
                budgetMs(run.levelsCleared) - budgetMs(run.levelsCleared - 1),
              )}`}
              note={
                colours > coloursFor(run.level - 1) ? t("One more colour from here.") : undefined
              }
            />
          )}
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-md grid-cols-3 gap-2 pt-1">
        <Button
          variant="secondary"
          disabled={!accepting || run.moves === 0}
          onClick={onUndo}
          aria-keyshortcuts="U"
        >
          <Undo2 />
          {t("Undo")}
        </Button>
        <Button
          variant="secondary"
          disabled={!accepting || run.moves === 0}
          onClick={onReset}
          aria-keyshortcuts="R"
        >
          <RotateCcw />
          {t("Restart")}
        </Button>
        <Button
          variant="secondary"
          disabled={!accepting || run.extraBolt}
          onClick={onAddBolt}
          aria-label={t("Add an empty bolt to this board, for {n} seconds of clock", {
            n: BOLTED_EXTRA_BOLT_MS / 1000,
          })}
        >
          <Plus />
          {t("Bolt")}
          <span className="text-xs text-muted-foreground tabular">
            −{BOLTED_EXTRA_BOLT_MS / 1000}s
          </span>
        </Button>
      </div>

      <div className="flex flex-col items-center gap-1 pt-2">
        <p className="text-center text-xs text-muted-foreground" aria-live="polite">
          {verifying
            ? t("The moves you made are your score if the server agrees.")
            : t("Solving this board adds {formatClockGain}.", {
                formatClockGain: formatClockGain(
                  budgetMs(run.levelsCleared + 1) - budgetMs(run.levelsCleared),
                ),
              })}
        </p>
        <Button variant="ghost" size="sm" disabled={!accepting} onClick={() => setConfirming(true)}>
          {t("End run")}
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("End this run?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {session.offline
                ? t(
                    "Your score of {score} is kept as practice: offline runs are not verified or saved.",
                    { score: points(run.score) },
                  )
                : t(
                    "Your score of {score} is kept and sent for verification. The board you are on is not scored.",
                    { score: points(run.score) },
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Keep playing")}</AlertDialogCancel>
            <AlertDialogAction onClick={onFinish}>{t("End run")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** One nut: a flat hexagon in its colour, or a blank while it is face down. */
function Nut({ colour, hidden }: { colour: number; hidden: boolean }) {
  return (
    <svg viewBox="0 0 48 20" className="block w-full shrink-0" aria-hidden>
      <path
        d="M7 1h34l6 9-6 9H7l-6-9Z"
        fill={hidden ? "var(--surface-2)" : NUTS[colour - 1]?.fill}
        stroke="oklch(0 0 0 / 0.25)"
        strokeWidth="1.2"
      />
      {/* The threaded hole and a rim of light: a nut, not a bar. */}
      <rect x="18" y="5" width="12" height="10" rx="2" fill="oklch(0 0 0 / 0.28)" />
      <path
        d="M8 3h32"
        stroke="white"
        strokeOpacity="0.3"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      {hidden && (
        <text
          x="24"
          y="14"
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill="var(--muted-foreground)"
        >
          ?
        </text>
      )}
    </svg>
  );
}

/** One bolt: a threaded rod on a base, nuts stacked from the bottom, lifted while held. */
function BoltButton({
  bolt,
  hidden,
  index,
  held,
  target,
  disabled,
  onChoose,
}: {
  bolt: Bolt;
  hidden: number;
  index: number;
  held: boolean;
  target: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  const locked = isLocked(bolt);
  const names = bolt.map((colour, nut) =>
    nut < hidden ? "hidden" : (NUTS[colour - 1]?.name ?? "unknown"),
  );
  const label = t("Bolt {n}{n2}: {n3}{n4}{n5}{n6}", {
    n: index + 1,
    n2: BOLT_KEYS[index] ? ` (key ${BOLT_KEYS[index]})` : "",
    n3: bolt.length === 0 ? "empty" : `${names.join(", ")}, bottom to top`,
    n4: locked ? ", locked" : "",
    n5: held ? ", picked up" : "",
    n6: target ? ", can take the move" : "",
  });
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={held}
      aria-disabled={disabled}
      onClick={onChoose}
      className={cn(
        "group relative flex h-[clamp(8.5rem,26vmin,11rem)] w-[clamp(2.8rem,10vmin,3.6rem)] flex-col items-center justify-end rounded-xl pb-2 transition-[transform,background-color] duration-150 ease-out motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        held ? "-translate-y-3 bg-primary/15" : target ? "bg-foreground/10" : "bg-transparent",
      )}
    >
      {/* The rod, threaded, and the base it stands on. */}
      <span
        aria-hidden
        className={cn(
          "absolute top-1 bottom-3 left-1/2 w-[18%] -translate-x-1/2 rounded-t-full",
          "bg-[repeating-linear-gradient(180deg,oklch(0.72_0.01_270)_0_3px,oklch(0.6_0.01_270)_3px_5px)]",
          held && "ring-2 ring-primary",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "absolute bottom-1 left-1/2 h-2 w-[92%] -translate-x-1/2 rounded-full",
          locked ? "bg-success/80" : "bg-foreground/25",
        )}
      />
      <span className="relative z-10 flex w-full flex-col-reverse gap-[3px] px-[4%] pb-1.5">
        {bolt.map((colour, nut) => (
          <Nut key={nut} colour={colour} hidden={nut < hidden} />
        ))}
        {/* The empty slots keep every bolt the same height. */}
        {Array.from({ length: BOLTED_DEPTH - bolt.length }, (_, slot) => (
          <span key={`empty-${slot}`} className="block aspect-[48/20] w-full" aria-hidden />
        ))}
      </span>
      {locked && (
        <span
          aria-hidden
          className="absolute -top-2 right-0 z-20 flex size-5 items-center justify-center rounded-full bg-success text-background"
        >
          <Lock className="size-3" />
        </span>
      )}
    </button>
  );
}

/** The line above the board: what just happened, or what to do. */
function statusLine(run: BoltedRun, verifying: boolean, held: number | null): string {
  if (verifying) return t("Verifying your run with the server…");
  if (run.outcome === "over") return run.ending === "time" ? t("Time's up.") : t("Run ended.");
  if (held !== null)
    return t("Bolt {n} picked up — tap a bolt to move its nuts there.", { n: held + 1 });
  if (run.levelsCleared > 0 && run.moves === 0 && !run.extraBolt) {
    return t("Board {n} sorted, +{points}.", {
      n: run.level - 1,
      points: points(coloursFor(run.level - 1)),
    });
  }
  return t("Tap a bolt, then the bolt to move its top nuts onto.");
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
        <p className="text-sm text-muted-foreground">
          {outOfTime ? t("Time's up") : t("Run ended")}
        </p>
        <p className="text-5xl font-semibold tabular">{points(result.score)}</p>
        <p className="text-sm text-muted-foreground">
          {t("{clearedColumns} {n} sorted, {tilesPlaced} {n2}.", {
            clearedColumns: result.clearedColumns,
            n: result.clearedColumns === 1 ? t("board") : t("boards"),
            tilesPlaced: result.tilesPlaced,
            n2: result.tilesPlaced === 1 ? t("move") : t("moves"),
          })}
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Duration")}</dt>
          <dd className="font-semibold tabular">{formatSeconds(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Boards sorted")}</dt>
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
          ? t("Verified by replaying your moves on the server, then saved to the leaderboard.")
          : result.offline
            ? offlineResultNote()
            : t(
                "Verified by replaying your moves on the server. This was a guest run, so it is not on the leaderboard.",
              )}
        {result.duplicate && t(" This run was already recorded, so nothing was counted twice.")}
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
