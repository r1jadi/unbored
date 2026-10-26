import { Grid3x3, Loader2, RotateCcw, ShieldCheck, Trophy, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { ErrorState } from "@/components/common";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { RulesList } from "@/components/game/RulesList";
import { RunEndActions } from "@/components/game/RunEndActions";
import { LevelUpOverlay } from "@/components/game/LevelUp";
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
  board as drawBoard,
  budgetMs,
  canTap,
  cellForArrow,
  EIGHT_PUZZLE_BONUS_MS,
  EIGHT_PUZZLE_SIDE,
  fewestMoves,
  scrambleLength,
  type EightPuzzleRun,
} from "@/lib/games/eight-puzzle";
import { levelUpHold, useLevelUp } from "@/lib/games/level-up";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useEightPuzzleRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES["eight-puzzle"];

/**
 * 8 Puzzle, playing for real.
 *
 * The board is a view onto `useEightPuzzleRun`, which owns the lifecycle and the
 * clock: the rules first, a session issued when the player presses Start, boards
 * scrambled from its seed, and the score the server derived from the submitted
 * slides. Nothing here decides a number.
 *
 * Tap a tile next to the gap to slide it, or use the arrow keys: each tile is a
 * real button, and the board answers arrows by sliding the tile on the far side
 * of the gap in that direction.
 */
export function EightPuzzleRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  // Tap to play skips the rules, on the first run and on Play again.
  const state = useEightPuzzleRun(slug, autoStart);

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
          <Button asChild variant="ghost" size="lg">
            <ExitGameLink slug={slug}>{title}</ExitGameLink>
          </Button>
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
        onTap={state.tap}
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
          <Grid3x3 className="size-5 text-muted-foreground" />
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

const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;
type Arrow = (typeof ARROWS)[number];

/** The live run: one board at a time, against the clock. */
function Board({
  run,
  session,
  deadline,
  verifying,
  onTap,
  onFinish,
}: {
  run: EightPuzzleRun;
  session: PlaySession;
  deadline: number;
  verifying: boolean;
  onTap: (cell: number) => void;
  onFinish: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const boardRef = useRef<HTMLDivElement>(null);
  // A solved board gets a beat before the next one. It is short: the clock keeps
  // running, on the server as well as here. The scramble stops growing at
  // eighty steps, which is worth saying once.
  const fullyScrambled =
    run.level > 1 && scrambleLength(run.level) === 80 && scrambleLength(run.level - 1) < 80;
  const levelUp = useLevelUp(run.level, run.score, levelUpHold(fullyScrambled));
  const accepting = !verifying && run.outcome === "playing" && !levelUp;

  useReportRunProgress(accepting, onFinish);

  // The board takes focus so the arrow keys work straight away.
  useEffect(() => {
    boardRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!accepting) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [accepting]);

  // The par is the board's own, computed once when it is dealt.
  const par = useMemo(() => fewestMoves(drawBoard(run.seed, run.level)), [run.seed, run.level]);

  const remaining = Math.max(0, deadline - now);
  const earned = budgetMs(run.levelsCleared);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!accepting || !(ARROWS as readonly string[]).includes(event.key)) return;
    event.preventDefault();
    const cell = cellForArrow(run, event.key as Arrow);
    if (cell !== null) onTap(cell);
  };

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">Score</dt>
          <dd className="text-2xl font-semibold tabular">{run.score}</dd>
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
        {statusLine(run, verifying)}
      </p>

      <div className="mx-auto flex w-full max-w-md items-center gap-3 pb-1 text-xs text-muted-foreground">
        <span className="tabular">
          {run.moves} {run.moves === 1 ? "move" : "moves"} · par {par}
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

      {/* A square board, centred in whatever space is left, sized like the other
          grids: the smaller of the column and the viewport height minus the
          chrome. Three tiles a side never need more than 24rem. */}
      <div className="flex min-h-0 flex-1 items-center justify-center py-3">
        <div className="flex max-h-full w-full justify-center">
          <div
            ref={boardRef}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="relative aspect-square w-full rounded-2xl bg-surface p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ maxWidth: "min(24rem, calc(100dvh - 16rem))" }}
            role="group"
            aria-label={`Board ${run.level}, 3 by 3. Arrow keys slide a tile into the gap.`}
          >
            <div className="relative size-full">
              {run.tiles.map((tile, cell) => {
                if (tile === 0) return null;
                const row = Math.floor(cell / EIGHT_PUZZLE_SIDE);
                const column = cell % EIGHT_PUZZLE_SIDE;
                const movable = accepting && canTap(run, cell);
                const home = tile - 1 === cell;
                return (
                  <button
                    // Keyed by tile, not by cell, so a tile keeps its element and
                    // its slide animates from one cell to the next.
                    key={`${run.level}-${tile}`}
                    type="button"
                    aria-disabled={!movable}
                    onClick={() => {
                      if (movable) onTap(cell);
                    }}
                    aria-label={tileLabel(tile, row, column, movable, home, run, verifying)}
                    className={cn(
                      "absolute left-0 top-0 flex size-1/3 items-center justify-center p-1",
                      "transition-transform duration-150 ease-out motion-reduce:transition-none",
                      "focus-visible:outline-none [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-ring",
                    )}
                    style={{ transform: `translate(${column * 100}%, ${row * 100}%)` }}
                  >
                    <span
                      className={cn(
                        "flex size-full items-center justify-center rounded-xl text-[clamp(1.5rem,9vmin,3rem)] font-semibold tabular shadow-sm",
                        home ? "bg-primary/20 text-foreground" : "bg-surface-2 text-foreground",
                        movable ? "press hover:brightness-110" : !accepting && "opacity-70",
                      )}
                    >
                      {tile}
                    </span>
                  </button>
                );
              })}
            </div>
            {levelUp && (
              <LevelUpOverlay
                levelUp={levelUp}
                unit="Board"
                next={`Board ${run.level} · par ${par} · clock +${EIGHT_PUZZLE_BONUS_MS / 1000} s`}
                note={fullyScrambled ? "Every board is fully scrambled from here." : undefined}
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 pt-1">
        <p className="text-center text-xs text-muted-foreground" aria-live="polite">
          {verifying
            ? "The slides you made are your score if the server agrees."
            : `A solved board adds ${EIGHT_PUZZLE_BONUS_MS / 1000} seconds. Arrow keys slide too.`}
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
              {`Your score of ${run.score} is kept and sent for verification. The board you are on is not scored.`}
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

/** The line above the board: what just happened, or what to do. */
function statusLine(run: EightPuzzleRun, verifying: boolean): string {
  if (verifying) return "Verifying your run with the server…";
  if (run.outcome === "over") return run.ending === "time" ? "Time's up." : "Run ended.";
  if (run.levelsCleared > 0 && run.moves === 0) {
    return `Board ${run.level - 1} solved, +10. Board ${run.level} is scrambled a little more.`;
  }
  return `Board ${run.level} — 1 to 8, gap last.`;
}

/** The accessible name of a tile: its number, where it is, and what a tap does. */
function tileLabel(
  tile: number,
  row: number,
  column: number,
  movable: boolean,
  home: boolean,
  run: EightPuzzleRun,
  verifying: boolean,
): string {
  const position = `Tile ${tile}, row ${row + 1} column ${column + 1}${home ? ", in place" : ""}`;
  if (verifying) return `${position}. The run is being verified.`;
  if (run.outcome !== "playing") return `${position}. The run has ended.`;
  return movable ? `${position}. Tap to slide it into the gap.` : `${position}.`;
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
        <p className="text-5xl font-semibold tabular">{result.score}</p>
        <p className="text-sm text-muted-foreground">
          {`${result.tilesPlaced} ${result.tilesPlaced === 1 ? "slide" : "slides"}, ${
            result.clearedColumns
          } ${result.clearedColumns === 1 ? "board" : "boards"} solved.`}
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Duration</dt>
          <dd className="font-semibold tabular">{formatSeconds(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Boards solved</dt>
          <dd className="font-semibold tabular">{result.clearedColumns}</dd>
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
          ? "Verified by replaying your slides on the server, then saved to the leaderboard."
          : "Verified by replaying your slides on the server. This was a guest run, so it is not on the leaderboard."}
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
