import { Loader2, RotateCcw, Shapes, ShieldCheck, Trophy, TriangleAlert } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { ErrorState } from "@/components/common";
import { CASCADE_TILES, CascadeTile, SPECIAL_NAMES } from "@/components/game/CascadeTile";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { GameExits } from "@/components/game/GameExits";
import { LevelUpOverlay } from "@/components/game/LevelUp";
import { RulesList } from "@/components/game/RulesList";
import { RunEndActions } from "@/components/game/RunEndActions";
import { SavedRunCard } from "@/components/game/SavedRunCard";
import { t } from "@/lib/settings/language";
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
  canSwap,
  CASCADE_SIZE,
  colourOf,
  columnOf,
  findSwap,
  goalFor,
  rowOf,
  specialOf,
  swapBetween,
  swapCells,
  type CascadeBoard,
  type CascadeMove,
  type CascadeRun,
} from "@/lib/games/cascade";
import { levelUpHold, useLevelUp } from "@/lib/games/level-up";
import { GAME_RULES } from "@/lib/games/rules";
import { endRunMessage, useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useCascadeRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import { playSound, useGameSounds } from "@/lib/sound";
import { useMyBestScore } from "@/lib/social/engagement";
import { cn } from "@/lib/utils";

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES.cascade;

/** How long the screen waits on an idle board before it points out a swap. */
const HINT_AFTER_MS = 6000;

/** The board's gap between cells, in px: one fall step is a tile plus this. */
const GAP_PX = 4;

/**
 * Cascade, playing for real.
 *
 * The board is a view onto `useCascadeRun`, which owns the lifecycle and the
 * clock: the rules first, a session issued when the player presses Start, every
 * tile drawn from its seed, and the score the server derived from the submitted
 * swaps. Nothing here decides a number; the engine resolves a swap at once, and
 * this screen only plays back what it did, wave by wave.
 *
 * Drag a tile onto a neighbour, or tap one and then the other. The arrow keys
 * move a cursor; Enter picks a tile up, and an arrow then swaps it that way.
 */
export function CascadeRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useCascadeRun(slug, autoStart);

  if (state.status === "saved") {
    return (
      <SavedRunCard
        score={state.run.score}
        where={t("Board {level}", { level: state.run.level })}
        onContinue={state.continueRun}
        onNewRun={state.newRun}
        slug={slug}
        title={title}
      />
    );
  }

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
          Submit it again, or start over.
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
        verifying={state.status === "submitting"}
        onSwap={state.swap}
        onFinish={state.finish}
      />
    );
  }

  if (state.status === "finished") {
    return <Finished slug={slug} result={state.result} onRestart={state.restart} />;
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
          <Shapes className="size-5 text-muted-foreground" />
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

/** One step of a swap's playback: a board, and how its tiles move into it. */
type Frame =
  | { kind: "swap"; board: CascadeBoard; from: number; to: number; ms: number }
  | {
      kind: "clear";
      board: CascadeBoard;
      cleared: ReadonlySet<number>;
      created: ReadonlyMap<number, number>;
      wave: number;
      points: number;
      ms: number;
    }
  | { kind: "fall"; board: CascadeBoard; fall: readonly number[]; wave: number; ms: number }
  | { kind: "deal"; board: CascadeBoard; ms: number };

/** A swap's playback: the slide, then each wave's clear and fall, then any fresh deal. */
function framesFor(move: CascadeMove, settled: CascadeBoard): Frame[] {
  const frames: Frame[] = [
    { kind: "swap", board: move.swapped, from: move.from, to: move.to, ms: 150 },
  ];
  move.waves.forEach((wave, index) => {
    const before = index === 0 ? move.swapped : move.waves[index - 1].board;
    frames.push({
      kind: "clear",
      board: before,
      cleared: new Set(wave.cleared),
      created: new Map(wave.created),
      wave: index + 1,
      points: wave.points,
      ms: 200,
    });
    frames.push({
      kind: "fall",
      board: wave.board,
      fall: wave.fall,
      wave: index + 1,
      ms: 140 + Math.max(...wave.fall) * 45,
    });
  });
  if (move.reshuffled) frames.push({ kind: "deal", board: settled, ms: 520 });
  return frames;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The live run: one board, against the clock. */
function Board({
  run,
  session,
  verifying,
  onSwap,
  onFinish,
}: {
  run: CascadeRun;
  session: PlaySession;
  verifying: boolean;
  onSwap: (action: number) => void;
  onFinish: () => void;
}) {
  useGameSounds({
    moves: run.actions.length,
    score: run.score,
    cleared: run.levelsCleared,
    over: run.outcome === "over",
    ending: "stop",
  });
  const best = useMyBestScore(session.gameSlug);
  const [confirming, setConfirming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<number | null>(null);
  const [cursor, setCursor] = useState(27);
  const [keyboard, setKeyboard] = useState(false);
  const [nope, setNope] = useState<{ a: number; b: number; key: number } | null>(null);
  const [idleSince, setIdleSince] = useState(() => Date.now());
  const boardRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ cell: number; x: number; y: number; done: boolean } | null>(null);

  // The playback of the last swap. The run has already moved on; the header shows
  // `shown` — the run as of the last finished playback — so the score and level
  // land with the tiles, not before them.
  const [frames, setFrames] = useState<{ list: Frame[]; at: number; move: CascadeMove | null }>({
    list: [],
    at: 0,
    move: run.lastMove,
  });
  const [shown, setShown] = useState(run);
  if (frames.move !== run.lastMove) {
    const list = run.lastMove && !prefersReducedMotion() ? framesFor(run.lastMove, run.board) : [];
    setFrames({ list, at: 0, move: run.lastMove });
    if (list.length === 0) setShown(run);
  }
  const frame = frames.list[frames.at] as Frame | undefined;
  const animating = frame !== undefined;

  useEffect(() => {
    if (!frame) return;
    const timer = setTimeout(() => {
      setFrames((current) => ({ ...current, at: current.at + 1 }));
    }, frame.ms);
    return () => clearTimeout(timer);
  }, [frame]);

  // The playback finished: the header catches up with the run.
  if (!animating && shown !== run) setShown(run);

  const levelUp = useLevelUp(shown.level, shown.score, levelUpHold(false));
  const accepting = !verifying && run.outcome === "playing" && !levelUp && !animating;

  useReportRunProgress(run.outcome === "playing" && !verifying, onFinish, session);

  // The board takes focus so the arrow keys work straight away.
  useEffect(() => {
    boardRef.current?.focus();
  }, []);

  // The hint's wait needs a clock to compare against `idleSince`.
  useEffect(() => {
    if (verifying || run.outcome !== "playing") return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [verifying, run.outcome]);

  // A new board puts down whatever was picked up, and restarts the hint's wait.
  const [selectedFor, setSelectedFor] = useState(run.board);
  if (selectedFor !== run.board) {
    setSelectedFor(run.board);
    if (selected !== null) setSelected(null);
    setIdleSince(Date.now());
  }

  useEffect(() => {
    if (!nope) return;
    const timer = setTimeout(() => setNope(null), 280);
    return () => clearTimeout(timer);
  }, [nope]);

  const hintAction = accepting && now - idleSince >= HINT_AFTER_MS ? findSwap(run.board) : null;
  const hint = hintAction !== null ? swapCells(hintAction) : null;

  /** Tries the swap between two cells: made if it lines up three, a nudge back if not. */
  const attempt = (a: number, b: number) => {
    setIdleSince(Date.now());
    const action = swapBetween(a, b);
    setSelected(null);
    if (action !== null && canSwap(run, action)) {
      onSwap(action);
      return;
    }
    if (action !== null) {
      setNope({ a, b, key: Date.now() });
      playSound("error");
    }
  };

  const neighbours = (a: number, b: number) => swapBetween(a, b) !== null;

  /** A tap on a tile: pick it up, swap it with the one picked up, or put it down. */
  const tap = (cell: number) => {
    if (!accepting) return;
    setIdleSince(Date.now());
    setCursor(cell);
    if (selected === null) {
      setSelected(cell);
    } else if (selected === cell) {
      setSelected(null);
    } else if (neighbours(selected, cell)) {
      attempt(selected, cell);
    } else {
      setSelected(cell);
    }
  };

  const onPointerDown = (cell: number, event: PointerEvent<HTMLButtonElement>) => {
    if (!accepting || event.button > 0) return;
    setKeyboard(false);
    drag.current = { cell, x: event.clientX, y: event.clientY, done: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    if (!start || start.done || !accepting) return;
    const size = event.currentTarget.getBoundingClientRect().width || 40;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < size * 0.35) return;
    start.done = true;
    const row = rowOf(start.cell);
    const column = columnOf(start.cell);
    const target =
      Math.abs(dx) > Math.abs(dy)
        ? column + Math.sign(dx) >= 0 && column + Math.sign(dx) < CASCADE_SIZE
          ? start.cell + Math.sign(dx)
          : null
        : row + Math.sign(dy) >= 0 && row + Math.sign(dy) < CASCADE_SIZE
          ? start.cell + Math.sign(dy) * CASCADE_SIZE
          : null;
    if (target !== null) attempt(start.cell, target);
  };

  const onPointerUp = (cell: number) => {
    const start = drag.current;
    drag.current = null;
    if (start && !start.done && start.cell === cell) tap(cell);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!accepting) return;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
    };
    if (event.key in step) {
      event.preventDefault();
      setKeyboard(true);
      const [dr, dc] = step[event.key];
      const from = selected ?? cursor;
      const row = rowOf(from) + dr;
      const column = columnOf(from) + dc;
      if (row < 0 || row >= CASCADE_SIZE || column < 0 || column >= CASCADE_SIZE) return;
      const target = row * CASCADE_SIZE + column;
      if (selected !== null) attempt(selected, target);
      else setCursor(target);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setKeyboard(true);
      tap(cursor);
    } else if (event.key === "Escape") {
      setSelected(null);
    }
  };

  const board = frame ? frame.board : run.board;
  const goal = goalFor(shown.level);
  const wave = frame && frame.kind !== "swap" && frame.kind !== "deal" ? frame.wave : 0;

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">Score</dt>
          <dd className="text-2xl font-semibold tabular">{points(shown.score)}</dd>
        </dl>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {best !== null && (
            <span className="tabular">Best {points(Math.max(best, shown.score))}</span>
          )}
          <span className="tabular">Level {shown.level}</span>
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
        {statusLine(run, verifying, selected, wave, frame)}
      </p>

      <div className="mx-auto flex w-full max-w-md items-center gap-3 pb-1 text-xs text-muted-foreground">
        <span className="w-24 shrink-0 tabular">
          {Math.min(shown.progress, goal)}/{goal} tiles
        </span>
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-label="Tiles cleared this level"
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={Math.min(shown.progress, goal)}
        >
          <div
            className="h-full rounded-full bg-success transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${Math.min(100, (shown.progress / goal) * 100)}%` }}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center py-3">
        <div
          ref={boardRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="relative w-full max-w-md touch-none rounded-2xl bg-surface p-2 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
          role="group"
          aria-label={`Level ${shown.level} board, 8 by 8. Arrow keys move; Enter picks a tile up, then an arrow swaps it.`}
        >
          <div
            className="grid aspect-square grid-cols-8 overflow-hidden rounded-xl"
            style={{ gap: GAP_PX, "--cascade-step": `calc(100% + ${GAP_PX}px)` } as CSSProperties}
          >
            {board.map((tile, cell) => (
              <Cell
                key={cell}
                cell={cell}
                tile={tile}
                frame={frame}
                frameIndex={frames.at}
                selected={selected === cell}
                cursor={keyboard && cursor === cell}
                hint={hint !== null && hint.includes(cell)}
                nope={nope && (nope.a === cell || nope.b === cell) ? nope : null}
                disabled={!accepting}
                onPointerDown={(event) => onPointerDown(cell, event)}
                onPointerMove={onPointerMove}
                onPointerUp={() => onPointerUp(cell)}
                onActivate={() => tap(cell)}
              />
            ))}
          </div>
          {frame?.kind === "clear" && (
            <div
              key={`wave-${frames.at}`}
              className="gridburst-float pointer-events-none absolute inset-x-0 top-1/3 text-center text-2xl font-semibold tabular text-foreground drop-shadow"
              aria-hidden
            >
              +{points(frame.points)}
              {frame.wave > 1 && <span className="ml-2 text-base text-primary">×{frame.wave}</span>}
            </div>
          )}
          {levelUp && (
            <LevelUpOverlay
              levelUp={levelUp}
              unit="Level"
              next={`Level ${shown.level} · ${goalFor(shown.level)} tiles`}
            />
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 pt-1">
        <p className="text-center text-xs text-muted-foreground" aria-live="polite">
          {verifying
            ? "The swaps you made are your score if the server agrees."
            : "No clock: play as long as you like, then end the run."}
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
              {endRunMessage(session, points(run.score))}
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

/** One cell: a real button, with the tile in it moving as the current frame says. */
function Cell({
  cell,
  tile,
  frame,
  frameIndex,
  selected,
  cursor,
  hint,
  nope,
  disabled,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onActivate,
}: {
  cell: number;
  tile: number;
  frame: Frame | undefined;
  frameIndex: number;
  selected: boolean;
  cursor: boolean;
  hint: boolean;
  nope: { a: number; b: number; key: number } | null;
  disabled: boolean;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: () => void;
  onActivate: () => void;
}) {
  let shown = tile;
  let motion = "";
  const vars: Record<string, number> = {};
  if (frame?.kind === "swap" && (cell === frame.from || cell === frame.to)) {
    // The tile now here came from the other cell: it slides in from there.
    const other = cell === frame.from ? frame.to : frame.from;
    motion = "cascade-swap";
    vars["--dx"] = columnOf(other) - columnOf(cell);
    vars["--dy"] = rowOf(other) - rowOf(cell);
  } else if (frame?.kind === "clear") {
    const made = frame.created.get(cell);
    if (made !== undefined) {
      shown = made;
      motion = "cascade-made";
    } else if (frame.cleared.has(cell)) {
      motion = "cascade-clear";
    }
  } else if (frame?.kind === "fall" && frame.fall[cell] > 0) {
    motion = "cascade-fall";
    vars["--fall"] = frame.fall[cell];
  } else if (frame?.kind === "deal") {
    motion = "cascade-fall";
    vars["--fall"] = CASCADE_SIZE;
  } else if (nope) {
    const other = cell === nope.a ? nope.b : nope.a;
    motion = "cascade-nope";
    vars["--dx"] = columnOf(other) - columnOf(cell);
    vars["--dy"] = rowOf(other) - rowOf(cell);
  } else if (hint) {
    motion = "cascade-hint";
  }

  const colour = colourOf(shown);
  const special = specialOf(shown);
  const label = `Row ${rowOf(cell) + 1}, column ${columnOf(cell) + 1}: ${
    CASCADE_TILES[colour - 1]?.name ?? "empty"
  }${special ? ` ${SPECIAL_NAMES[special]}` : ""}${selected ? ", picked up" : ""}`;

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      aria-pressed={selected}
      aria-disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // A click with no pointer behind it (detail 0) is a keyboard or assistive
      // tech activating the button; pointer taps are handled above.
      onClick={(event) => event.detail === 0 && onActivate()}
      className={cn(
        "relative aspect-square rounded-lg bg-surface-2/60 transition-[box-shadow,background-color] duration-150",
        selected && "bg-foreground/15 ring-2 ring-primary ring-inset",
        cursor && !selected && "ring-2 ring-foreground/40 ring-inset",
      )}
    >
      <span
        key={motion ? `${frameIndex}-${motion}-${nope?.key ?? ""}` : "still"}
        className={cn(
          "absolute inset-[8%] block transition-transform duration-150",
          selected && "scale-110",
          motion,
        )}
        style={vars as CSSProperties}
      >
        <CascadeTile colour={colour} special={special} />
      </span>
    </button>
  );
}

/** The line above the board: what just happened, or what to do. */
function statusLine(
  run: CascadeRun,
  verifying: boolean,
  selected: number | null,
  wave: number,
  frame: Frame | undefined,
): string {
  if (verifying) return "Verifying your run with the server…";
  if (run.outcome === "over") return "Run ended.";
  if (frame?.kind === "deal") return "No swaps left: a fresh board.";
  if (wave > 1) return `Cascade ×${wave}!`;
  if (selected !== null) return "Now tap a neighbour to swap with it.";
  return "Swap two neighbours to line up three.";
}

/** The end of a run: the score the server verified, or a guest's unranked result. */
function Finished({
  slug,
  result,
  onRestart,
}: {
  slug: string;
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
            <ShieldCheck className="size-5 text-muted-foreground" />
          )}
        </div>
        <p className="text-sm text-muted-foreground">Run ended</p>
        <p className="text-5xl font-semibold tabular">{points(result.score)}</p>
        <p className="text-sm text-muted-foreground">
          {`${result.clearedColumns} ${result.clearedColumns === 1 ? "level" : "levels"} cleared, ${
            result.tilesPlaced
          } ${result.tilesPlaced === 1 ? "tile" : "tiles"} matched.`}
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Duration</dt>
          <dd className="font-semibold tabular">{formatSeconds(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Levels cleared</dt>
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
          ? "Verified by replaying your swaps on the server, then saved to the leaderboard."
          : "Verified by replaying your swaps on the server. This was a guest run, so it is not on the leaderboard."}
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
