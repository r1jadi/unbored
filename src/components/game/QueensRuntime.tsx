import { Crown, Loader2, RotateCcw, ShieldCheck, Trophy, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { ErrorState } from "@/components/common";
import { GameExits } from "@/components/game/GameExits";
import { HintButton, HintNote } from "@/components/game/Hint";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { SavedRunCard } from "@/components/game/SavedRunCard";
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
  blockedCells,
  board as drawBoard,
  boardSize,
  QUEENS_MISTAKES,
  type QueensCell,
  type QueensRun,
} from "@/lib/games/queens";
import { levelUpHold, useLevelUp } from "@/lib/games/level-up";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import { queensHint, queensPlaced } from "@/lib/games/hints";
import { useHint } from "@/lib/games/use-hint";
import {
  playErrorMessage,
  useQueensRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import { points } from "@/lib/format";
import { useGameSounds } from "@/lib/sound";
import { offlineResultNote } from "@/lib/games/offline";

import { t } from "@/lib/settings/language";
/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES["queens"];

/**
 * Crowns, playing for real.
 *
 * The board is a view onto `useQueensRun`, which owns the whole lifecycle: a
 * session issued by the server, the boards played against its seed, and the score
 * the server derived from the submitted taps. Nothing on this screen decides a
 * number — the score shown at the end is the one that came back from verification.
 *
 * The screen starts with its rules, the same way every other game does, and the
 * board is drawn from the engine: the regions and the automatic X are display, the
 * taps are the run.
 */
export function QueensRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useQueensRun(slug);

  // A signed-in player's unfinished run is offered before a new one starts.
  if (state.status === "saved") {
    return (
      <SavedRunCard
        score={state.run.score}
        where={`Board ${state.run.level}`}
        onContinue={state.continueRun}
        onNewRun={state.newRun}
        slug={slug}
        title={title}
      />
    );
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

  // A submission failure keeps the board: the run exists, it is just not verified.
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
      <Board
        key={state.session.id}
        run={state.run}
        session={state.session}
        verifying={state.status === "submitting"}
        onTap={state.tap}
        onFinish={state.finish}
        onBegin={state.begin}
        autoStart={autoStart}
        slug={slug}
        title={title}
      />
    );
  }

  if (state.status === "finished") {
    return (
      <Finished
        slug={slug}
        result={state.result}
        stopped={state.run.stopped}
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

/**
 * The region colours, by region. Regions are numbered by the row of their Queen,
 * so neighbouring rows' regions are often neighbours on the board; spreading the
 * order across the palette keeps two regions that share an edge far apart in hue.
 */
const REGION_COLOURS = [
  "bg-queens-1",
  "bg-queens-5",
  "bg-queens-9",
  "bg-queens-4",
  "bg-queens-8",
  "bg-queens-3",
  "bg-queens-7",
  "bg-queens-2",
  "bg-queens-6",
] as const;

/** The edge between two regions; the edges inside a region are hairlines. */
const REGION_EDGE = "color-mix(in oklch, var(--foreground) 70%, transparent)";
const CELL_EDGE = "color-mix(in oklch, var(--foreground) 14%, transparent)";

/** The live run: the rules first, then one board per level. */
function Board({
  run,
  session,
  verifying,
  onTap,
  onFinish,
  onBegin,
  autoStart,
  slug,
  title,
}: {
  run: QueensRun;
  session: PlaySession;
  verifying: boolean;
  onTap: (cell: number) => void;
  onFinish: () => void;
  /** Starts the run's clock; the time spent on the rules is not the run's. */
  onBegin: () => void;
  /** Start without the rules screen (Tap to play). */
  autoStart: boolean;
  slug: string;
  title: string;
}) {
  useGameSounds({
    moves: run.taps.length,
    score: run.score,
    cleared: run.levelsCleared,
    mistakes: run.mistakes,
    over: run.outcome === "over",
    ending: run.stopped ? "stop" : "lose",
  });
  const [started, setStarted] = useState(autoStart || run.taps.length > 0);

  // Tap to play skips the rules: the run, and its clock, start at once.
  useEffect(() => {
    if (autoStart && run.taps.length === 0) onBegin();
    // Once, on the first board: a retried submission remounts with a started run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [confirming, setConfirming] = useState(false);
  const firstCell = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (started) firstCell.current?.focus();
  }, [started]);

  useReportRunProgress(started && !verifying && run.outcome === "playing", onFinish, session);

  // A solved board gets a beat before the next one, with a note when it grows.
  const nextSide = boardSize(run.level);
  const grew = run.level > 1 && nextSide > boardSize(run.level - 1);
  const levelUp = useLevelUp(run.level, run.score, levelUpHold(grew));

  // A right move is a Queen placed: Xs are notes, not progress.
  const hints = useHint({
    progress: `${run.level}:${queensPlaced(run)}`,
    active: started && !verifying && run.outcome === "playing" && !levelUp,
    compute: () => queensHint(run),
  });

  // Drawing a board runs the region search, so it is done once per board rather
  // than on every tap.
  const drawn = useMemo(
    () => (started ? drawBoard(run.seed, run.level) : null),
    [started, run.seed, run.level],
  );

  if (!started || !drawn) {
    return (
      <div className="flex flex-1 flex-col justify-center px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="enter mx-auto flex w-full max-w-sm flex-col items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
            <Crown className="size-5 text-muted-foreground" />
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

  const { size, regions } = drawn;
  const accepting = !verifying && run.outcome === "playing" && !levelUp;
  const blocked = blockedCells(size, regions, run.cells);
  const queens = run.cells.filter((cell) => cell === "queen").length;
  const mistakesLeft = Math.max(0, QUEENS_MISTAKES - run.mistakes);

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

      {hints.hint ? (
        <HintNote reason={hints.hint.reason} className="my-0.5" />
      ) : (
        <p className="py-1 text-center text-sm text-muted-foreground" aria-live="polite">
          {statusLine(run, verifying)}
        </p>
      )}

      <div className="flex items-center justify-center gap-3 pb-1 text-xs text-muted-foreground">
        <span>
          <span className="tabular">
            {size}×{size}
          </span>{" "}
          {t("board ·")} <span className="tabular">{queens}</span> of{" "}
          <span className="tabular">{size}</span> crowns
        </span>
        <span
          className="inline-flex items-center gap-1"
          aria-label={t("{mistakesLeft} of {QUEENS_MISTAKES} mistakes left", {
            mistakesLeft,
            QUEENS_MISTAKES,
          })}
          role="img"
        >
          {Array.from({ length: QUEENS_MISTAKES }, (_, index) => (
            <span
              key={index}
              className={cn(
                "size-2 rounded-full",
                index < mistakesLeft ? "bg-foreground/70" : "bg-destructive",
              )}
            />
          ))}
        </span>
      </div>

      {/* A square board, centred in whatever space is left, sized the way One
          Move's is: the smaller of the column and the viewport height minus the
          chrome around it, so it never scrolls on a phone or a laptop. The
          chrome is taller than One Move's — the mistakes row above the board and
          End run below it — so 16rem is held back rather than 12rem. */}
      <div className="flex min-h-0 flex-1 items-center justify-center py-3">
        <div className="flex max-h-full w-full justify-center">
          <div
            className="relative grid aspect-square w-full overflow-hidden rounded-lg border-2"
            style={{
              borderColor: REGION_EDGE,
              maxWidth: `min(${size > 7 ? 36 : 28}rem, calc(100dvh - ${hints.hint ? 18.5 : 16}rem))`,
              gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${size}, minmax(0, 1fr))`,
            }}
            role="group"
            aria-label={t("Board {level}, {size} by {size2}", {
              level: run.level,
              size,
              size2: size,
            })}
          >
            {run.cells.map((cell, index) => {
              const row = Math.floor(index / size);
              const column = index % size;
              const region = regions[index];
              const right = column < size - 1 ? regions[index + 1] : region;
              const below = row < size - 1 ? regions[index + size] : region;
              const edges: CSSProperties = {
                borderRightWidth: column < size - 1 ? (right !== region ? 2 : 1) : 0,
                borderBottomWidth: row < size - 1 ? (below !== region ? 2 : 1) : 0,
                borderRightColor: right !== region ? REGION_EDGE : CELL_EDGE,
                borderBottomColor: below !== region ? REGION_EDGE : CELL_EDGE,
              };
              const auto = cell === "empty" && blocked.has(index);
              const hinted = hints.hint?.cell === index;
              // The row, column or region the hint's reason is about.
              const focused = !hinted && !!hints.hint?.focus.includes(index);
              return (
                <button
                  key={index}
                  ref={index === 0 ? firstCell : undefined}
                  type="button"
                  disabled={!accepting || cell === "ruled-out"}
                  onClick={() => onTap(index)}
                  aria-label={`${cellLabel(row, column, region, cell, auto, run, verifying)}${
                    hinted
                      ? hints.hint?.kind === "mark"
                        ? " " + t("Hint: no crown goes here.")
                        : " " + t("Hint: a crown goes here.")
                      : ""
                  }`}
                  style={edges}
                  className={cn(
                    "flex items-center justify-center border-solid transition-colors",
                    "motion-reduce:transition-none",
                    "focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    REGION_COLOURS[region % REGION_COLOURS.length],
                    accepting ? "hover:brightness-110" : "opacity-70",
                    focused && "outline-2 -outline-offset-4 outline-dashed outline-primary",
                    hinted && "animate-pulse ring-2 ring-inset ring-primary",
                  )}
                >
                  <CellMark cell={cell} auto={auto} />
                </button>
              );
            })}
            {levelUp && (
              <LevelUpOverlay
                levelUp={levelUp}
                unit={t("Board")}
                next={`Board ${run.level} · ${nextSide}×${nextSide}`}
                note={
                  grew
                    ? t("Boards are {nextSide}×{nextSide2} from here.", {
                        nextSide,
                        nextSide2: nextSide,
                      })
                    : undefined
                }
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 pt-1">
        <HintButton offered={hints.offered} waitSeconds={hints.waitSeconds} onAsk={hints.ask} />
        <p className="text-center text-xs text-muted-foreground" aria-live="polite">
          {verifying
            ? t("The taps you made are your score if the server agrees.")
            : t("Faint Xs mark cells your crowns already rule out.")}
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

/** What a cell shows: a Queen, an X, a ruled-out X, or a faint automatic X. */
function CellMark({ cell, auto }: { cell: QueensCell; auto: boolean }) {
  if (cell === "queen") {
    return <Crown className="size-[55%] fill-current text-foreground" strokeWidth={1.75} />;
  }
  if (cell === "mark") {
    return <X className="size-[40%] text-foreground/75" strokeWidth={2.5} />;
  }
  if (cell === "ruled-out") {
    return <X className="size-[50%] text-destructive" strokeWidth={3} />;
  }
  if (auto) {
    return <X className="size-[30%] text-foreground/30" strokeWidth={2} />;
  }
  return null;
}

/** The line above the board: what just happened, or what to do. */
function statusLine(run: QueensRun, verifying: boolean): string {
  if (verifying) return t("Verifying your run with the server…");
  if (run.outcome === "over") {
    return run.stopped ? t("Run ended.") : t("Three mistakes. The run is over.");
  }
  const last = run.taps.at(-1);
  if (last !== undefined && run.cells[last] === "ruled-out") {
    const left = QUEENS_MISTAKES - run.mistakes;
    return t("No crown goes there. {left} {n} left.", {
      left,
      n: left === 1 ? t("mistake") : t("mistakes"),
    });
  }
  if (run.levelsCleared > 0 && run.cells.every((cell) => cell === "empty")) {
    const solved = boardSize(run.level - 1);
    return t("Board {n} solved, +{points}. Board {level} is {level2}×{level3}.", {
      n: run.level - 1,
      points: points(solved * 10),
      level: run.level,
      level2: boardSize(run.level),
      level3: boardSize(run.level),
    });
  }
  return t("Board {level} — one crown per row, column and colour.", { level: run.level });
}

/** The accessible name of a cell: where it is, its region, and what it holds. */
function cellLabel(
  row: number,
  column: number,
  region: number,
  cell: QueensCell,
  auto: boolean,
  run: QueensRun,
  verifying: boolean,
): string {
  const contents =
    cell === "queen"
      ? "crown"
      : cell === "mark"
        ? t("marked X")
        : cell === "ruled-out"
          ? t("ruled out by a mistake")
          : auto
            ? t("empty, ruled out by a crown")
            : "empty";
  const position = `Row ${row + 1} column ${column + 1}, region ${region + 1}, ${contents}`;
  if (verifying) return `${position}. The run is being verified.`;
  if (run.outcome !== "playing") return `${position}. The run has ended.`;
  if (cell === "ruled-out") return `${position}.`;
  const next =
    cell === "empty" ? t("mark an X") : cell === "mark" ? t("place a crown") : t("clear it");
  return `${position}. Tap to ${next}.`;
}

/** The end of a run: the score the server verified, or a guest's unranked result. */
function Finished({
  slug,
  result,
  stopped,
  onRestart,
}: {
  slug: string;
  result: RunResult;
  stopped: boolean;
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
          {stopped ? t("Run ended") : t("Out of mistakes")}
        </p>
        <p className="text-5xl font-semibold tabular">{points(result.score)}</p>
        <p className="text-sm text-muted-foreground">
          {t("{tilesPlaced} {n}, {clearedColumns} {n2} solved.", {
            tilesPlaced: result.tilesPlaced,
            n: result.tilesPlaced === 1 ? t("tap") : t("taps"),
            clearedColumns: result.clearedColumns,
            n2: result.clearedColumns === 1 ? t("board") : t("boards"),
          })}
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Duration")}</dt>
          <dd className="font-semibold tabular">{formatDuration(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">{t("Boards solved")}</dt>
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
          ? t("Verified by replaying your taps on the server, then saved to the leaderboard.")
          : result.offline
            ? offlineResultNote()
            : t(
                "Verified by replaying your taps on the server. This was a guest run, so it is not on the leaderboard.",
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
