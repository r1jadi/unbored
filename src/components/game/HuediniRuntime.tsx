import {
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trophy,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { ErrorState } from "@/components/common";
import { BestScore } from "@/components/game/BestScore";
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
import { formatClockGain } from "@/lib/games/clock";
import {
  budgetMs,
  slide,
  tierIndex,
  type Direction,
  type HuediniBlock,
  type HuediniBoard,
  type HuediniGate,
  type HuediniRun,
} from "@/lib/games/huedini";
import { HUEDINI_TIERS } from "@/lib/games/huedini-bank";
import { levelUpHold, useLevelUp } from "@/lib/games/level-up";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useHuediniRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import { useGameSounds } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { offlineResultNote } from "@/lib/games/offline";

import { t } from "@/lib/settings/language";
/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES.huedini;

/**
 * The six block colours, 1 to 6, with the names a screen reader says. Fixed
 * rather than themed: they must stay apart from one another in light and dark.
 */
const HUES: readonly { fill: string; name: string }[] = [
  { fill: "oklch(0.64 0.21 25)", name: "red" },
  { fill: "oklch(0.75 0.17 60)", name: "orange" },
  { fill: "oklch(0.86 0.17 95)", name: "yellow" },
  { fill: "oklch(0.7 0.18 150)", name: "green" },
  { fill: "oklch(0.62 0.17 250)", name: "blue" },
  { fill: "oklch(0.6 0.2 310)", name: "violet" },
];

const DIRECTION_NAMES = ["up", "right", "down", "left"] as const;
const EDGE_NAMES = ["top", "right", "bottom", "left"] as const;
const ARROW_KEYS: Record<string, Direction> = {
  ArrowUp: 0,
  ArrowRight: 1,
  ArrowDown: 2,
  ArrowLeft: 3,
};

/** How far a finger must travel before a drag counts as a slide, in px. */
const DRAG_THRESHOLD = 14;
/** How long a block takes to slide: a beat, plus a little per cell. */
const slideMs = (distance: number) => 110 + 40 * distance;
/** How long a leaving block's flight lasts. */
const EXIT_MS = 420;

/**
 * Huedini, playing for real.
 *
 * The board is a view onto `useHuediniRun`, which owns the lifecycle and the
 * clock: the rules first, a session issued when the player presses Start, boards
 * dealt from its seed, and the score the server derived from the submitted
 * actions. Nothing here decides a number.
 *
 * Drag a block to slide it; a focused block slides with the arrow keys too.
 * Every block is a real button.
 */
export function HuediniRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useHuediniRun(slug, autoStart);

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
          <Sparkles className="size-5 text-muted-foreground" />
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

/** A block on its way out, drawn after it has left the board. */
type Ghost = {
  readonly key: string;
  readonly block: HuediniBlock;
  readonly side: number;
  readonly dir: Direction;
  /** Where it started, in cells, relative to where it meets the edge. */
  readonly from: { readonly r: number; readonly c: number };
};

/** The live run: one board at a time, against the clock. */
function Board({
  run,
  session,
  deadline,
  verifying,
  onMove,
  onUndo,
  onReset,
  onFinish,
}: {
  run: HuediniRun;
  session: PlaySession;
  deadline: number;
  verifying: boolean;
  onMove: (block: number, dir: Direction) => void;
  onUndo: () => void;
  onReset: () => void;
  onFinish: () => void;
}) {
  useGameSounds({
    moves: run.actions.length,
    score: run.exits,
    cleared: run.levelsCleared,
    over: run.outcome === "over",
    ending: run.ending === "time" ? "lose" : "stop",
  });
  const [confirming, setConfirming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const stepped = tierIndex(run.level) > tierIndex(Math.max(1, run.level - 1));
  const levelUp = useLevelUp(run.level, run.score, levelUpHold(stepped));
  const accepting = !verifying && run.outcome === "playing" && !levelUp;

  useReportRunProgress(accepting, onFinish);

  useEffect(() => {
    if (!accepting) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [accepting]);

  // Each block's last slide, so its animation lasts as long as the slide was long.
  const [durations, setDurations] = useState<Record<number, number>>({});
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [flash, setFlash] = useState<{ gate: HuediniGate; key: string } | null>(null);
  const previous = useRef({ board: run.board, level: run.level, actions: run.actions.length });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Compare the board with the last one drawn: how far each block went, and
  // which block left through a gate.
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { board: run.board, level: run.level, actions: run.actions.length };
    if (before.board === run.board || run.actions.length <= before.actions) {
      return;
    }
    const action = run.actions[run.actions.length - 1]!;
    if (action >= 254) return;
    const dir = (action % 4) as Direction;
    const old = before.board;
    const changes: Record<number, number> = {};
    for (const block of run.board.blocks) {
      const was = old.blocks.find((other) => other.id === block.id);
      if (was && run.level === before.level && (was.r !== block.r || was.c !== block.c)) {
        changes[block.id] = Math.abs(was.r - block.r) + Math.abs(was.c - block.c);
      }
    }
    if (Object.keys(changes).length) setDurations((d) => ({ ...d, ...changes }));

    const leaver =
      run.level !== before.level
        ? old.blocks[0]
        : old.blocks.find((block) => !run.board.blocks.some((other) => other.id === block.id));
    if (!leaver) return;
    const result = slide(old, leaver, dir);
    if (result?.kind !== "exit") return;
    const edge = edgePosition(leaver, old.side, dir);
    const key = `${run.actions.length}`;
    setGhosts((list) => [
      ...list,
      {
        key,
        block: { ...leaver, r: edge.r, c: edge.c },
        side: old.side,
        dir,
        from: { r: leaver.r - edge.r, c: leaver.c - edge.c },
      },
    ]);
    setFlash({ gate: result.gate, key });
    try {
      navigator.vibrate?.(12);
    } catch {
      // Not every device can.
    }
    // Each flight clears itself; a quick next move must not cut the last one short.
    timers.current.push(
      setTimeout(
        () => setGhosts((list) => list.filter((ghost) => ghost.key !== key)),
        EXIT_MS + 380,
      ),
    );
  }, [run.board, run.level, run.actions]);

  const remaining = Math.max(0, deadline - now);
  const earned = Math.max(1, budgetMs(run.levelsCleared));
  const { board } = run;
  const tier = HUEDINI_TIERS[tierIndex(run.level)];

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">{t("Score")}</dt>
          <dd className="text-2xl font-semibold tabular">{points(run.score)}</dd>
          <BestScore slug={session.gameSlug} score={run.score} />
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
        {statusLine(run, verifying)}
      </p>

      <div className="mx-auto flex w-full max-w-md items-center gap-3 pb-1 text-xs text-muted-foreground">
        <span className="tabular">
          {capitalise(tier)} · {board.blocks.length} left
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
        <div className="relative aspect-square w-full max-w-md rounded-[1.6rem] bg-surface shadow-[inset_0_2px_0_oklch(1_0_0/0.04)]">
          <Gates board={board} flash={flash} />
          <div
            // Inset, not padding: a percentage inset is of this board, padding of its parent.
            className="absolute inset-[4.5%] touch-none select-none"
            onKeyDown={(event) => {
              if (!accepting || event.metaKey || event.ctrlKey || event.altKey) return;
              if (event.key === "u" || event.key === "U" || event.key === "Backspace") {
                event.preventDefault();
                onUndo();
              } else if (event.key === "r" || event.key === "R") {
                event.preventDefault();
                onReset();
              }
            }}
            role="group"
            aria-label={t(
              "Board {level}, {side} by {side2}, {length} blocks. Drag a block, or focus it and use the arrow keys.",
              {
                level: run.level,
                side: board.side,
                side2: board.side,
                length: board.blocks.length,
              },
            )}
          >
            <Floor board={board} />
            {board.blocks.map((block) => (
              <BlockButton
                key={`${run.level}:${block.id}`}
                block={block}
                board={board}
                ms={slideMs(durations[block.id] ?? 0)}
                disabled={!accepting}
                onMove={(dir) => onMove(block.id, dir)}
              />
            ))}
            {ghosts.map((ghost) => (
              <GhostBlock key={ghost.key} ghost={ghost} />
            ))}
          </div>
          {levelUp && (
            <LevelUpOverlay
              levelUp={levelUp}
              unit={t("Board")}
              next={`Board ${run.level} · ${tier} · clock +${formatClockGain(
                budgetMs(run.levelsCleared) - budgetMs(run.levelsCleared - 1),
              )}`}
              note={stepped ? t("{tier} boards from here.", { tier: capitalise(tier) }) : undefined}
            />
          )}
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-md grid-cols-2 gap-2 pt-1">
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
      </div>

      <div className="flex flex-col items-center gap-1 pt-2">
        <p className="text-center text-xs text-muted-foreground" aria-live="polite">
          {verifying
            ? t("The moves you made are your score if the server agrees.")
            : t("Clearing this board scores {dealt} and adds {formatClockGain}.", {
                dealt: points(run.dealt),
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

/** Where a block meets the edge on its way out `dir`. */
function edgePosition(block: HuediniBlock, side: number, dir: Direction) {
  if (dir === 0) return { r: 0, c: block.c };
  if (dir === 2) return { r: side - block.h, c: block.c };
  if (dir === 1) return { r: block.r, c: side - block.w };
  return { r: block.r, c: 0 };
}

/** A box on the board, in percent of the board. */
function place(r: number, c: number, h: number, w: number, side: number): CSSProperties {
  return {
    top: `${(r / side) * 100}%`,
    left: `${(c / side) * 100}%`,
    height: `${(h / side) * 100}%`,
    width: `${(w / side) * 100}%`,
  };
}

/** The empty cells and the walls. */
function Floor({ board }: { board: HuediniBoard }) {
  const walls = new Set(board.walls);
  return (
    <div
      aria-hidden
      className="absolute inset-0 grid"
      style={{
        gridTemplateColumns: `repeat(${board.side}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${board.side}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: board.side * board.side }, (_, cell) => (
        <div key={cell} className="p-[6%]">
          {walls.has(cell) ? (
            <div className="huedini-wall size-full rounded-[22%]" />
          ) : (
            <div className="size-full rounded-[22%] bg-surface-2/45" />
          )}
        </div>
      ))}
    </div>
  );
}

/** The gates, set into the board's frame. */
function Gates({
  board,
  flash,
}: {
  board: HuediniBoard;
  flash: { gate: HuediniGate; key: string } | null;
}) {
  // The frame is 4.5% of the board on each side; the playing area is 91%.
  const inner = 91;
  const frame = 4.5;
  return (
    <>
      {board.gates.map((gate) => {
        const along = frame + ((gate.start + 0.08) / board.side) * inner;
        const length = (1.84 / board.side) * inner;
        const horizontal = gate.edge === 0 || gate.edge === 2;
        const style: CSSProperties = horizontal
          ? {
              left: `${along}%`,
              width: `${length}%`,
              height: `${frame * 0.62}%`,
              [gate.edge === 0 ? "top" : "bottom"]: `${frame * 0.19}%`,
            }
          : {
              top: `${along}%`,
              height: `${length}%`,
              width: `${frame * 0.62}%`,
              [gate.edge === 3 ? "left" : "right"]: `${frame * 0.19}%`,
            };
        const lit =
          flash &&
          flash.gate.edge === gate.edge &&
          flash.gate.start === gate.start &&
          flash.gate.colour === gate.colour;
        return (
          <span
            key={`${gate.edge}:${gate.start}:${lit ? flash.key : ""}`}
            role="img"
            aria-label={t("{n} gate on the {n2} edge", {
              n: HUES[gate.colour - 1]?.name ?? "unknown",
              n2: EDGE_NAMES[gate.edge],
            })}
            className={cn("absolute rounded-full", lit && "huedini-gate-flash")}
            style={{
              ...style,
              backgroundColor: HUES[gate.colour - 1]?.fill,
              boxShadow: `0 0 12px -2px ${HUES[gate.colour - 1]?.fill}`,
            }}
          />
        );
      })}
    </>
  );
}

/** One block: a glossy tile you drag, or focus and steer with the arrow keys. */
function BlockButton({
  block,
  board,
  ms,
  disabled,
  onMove,
}: {
  block: HuediniBlock;
  board: HuediniBoard;
  ms: number;
  disabled: boolean;
  onMove: (dir: Direction) => void;
}) {
  const drag = useRef<{ x: number; y: number; id: number; done: boolean } | null>(null);
  const hue = HUES[block.colour - 1];
  const free = ([0, 1, 2, 3] as const).filter((dir) => slide(board, block, dir) !== null);
  const label = t("{n} block, {w} by {h}, row {n2}, column {n3}. {n4}", {
    n: hue?.name ?? "unknown",
    w: block.w,
    h: block.h,
    n2: block.r + 1,
    n3: block.c + 1,
    n4: free.length
      ? `Can slide ${free.map((dir) => DIRECTION_NAMES[dir]).join(", ")}.`
      : "Boxed in.",
  });

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, id: event.pointerId, done: false };
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    if (!start || start.done || start.id !== event.pointerId || disabled) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_THRESHOLD) return;
    start.done = true;
    onMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const dir = ARROW_KEYS[event.key];
    if (dir === undefined || disabled) return;
    event.preventDefault();
    onMove(dir);
  };

  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className={cn(
        "huedini-block absolute z-10 p-[3px] outline-none sm:p-1",
        "focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-foreground",
        disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing",
      )}
      style={{
        ...place(block.r, block.c, block.h, block.w, board.side),
        transitionDuration: `${ms}ms`,
        ["--hue" as string]: hue?.fill,
      }}
    >
      <span className="huedini-face relative flex size-full items-center justify-center rounded-[18%]">
        <Grip w={block.w} h={block.h} />
      </span>
    </button>
  );
}

/** A few studs on the block's face, one per cell, so the size reads at a glance. */
function Grip({ w, h }: { w: number; h: number }) {
  return (
    <span
      aria-hidden
      className="grid size-full p-[14%]"
      style={{ gridTemplateColumns: `repeat(${w}, 1fr)`, gridTemplateRows: `repeat(${h}, 1fr)` }}
    >
      {Array.from({ length: w * h }, (_, i) => (
        <span key={i} className="flex items-center justify-center">
          <span className="block size-[26%] min-h-1 min-w-1 rounded-full bg-black/15 shadow-[0_1px_0_oklch(1_0_0/0.35)]" />
        </span>
      ))}
    </span>
  );
}

/** A block that just left: it runs to the edge, out through its gate, and fades. */
function GhostBlock({ ghost }: { ghost: Ghost }) {
  const { block, side, dir, from } = ghost;
  const hue = HUES[block.colour - 1]?.fill;
  const out = [
    [0, -130],
    [130, 0],
    [0, 130],
    [-130, 0],
  ][dir]!;
  const sparks = Array.from({ length: 10 }, (_, i) => {
    const angle = (i / 10) * Math.PI * 2;
    return { x: Math.cos(angle), y: Math.sin(angle), delay: (i % 3) * 30 };
  });
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-20"
      style={place(block.r, block.c, block.h, block.w, side)}
    >
      <div
        className="huedini-leave size-full p-[3px] sm:p-1"
        style={
          {
            "--hue": hue,
            "--from-x": `${(from.c / block.w) * 100}%`,
            "--from-y": `${(from.r / block.h) * 100}%`,
            "--out-x": `${out[0]}%`,
            "--out-y": `${out[1]}%`,
            animationDuration: `${EXIT_MS}ms`,
          } as CSSProperties
        }
      >
        <span className="huedini-face flex size-full rounded-[18%]" />
      </div>
      {sparks.map((spark, i) => (
        <span
          key={i}
          className="huedini-spark absolute left-1/2 top-1/2 size-[14%] rounded-[30%]"
          style={
            {
              backgroundColor: hue,
              "--spark-x": `${spark.x * 160 + out[0] * 0.9}%`,
              "--spark-y": `${spark.y * 160 + out[1] * 0.9}%`,
              animationDelay: `${EXIT_MS * 0.45 + spark.delay}ms`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** The line above the board: what to do, or what is happening. */
function statusLine(run: HuediniRun, verifying: boolean): string {
  if (verifying) return t("Verifying your run with the server…");
  if (run.outcome === "over") return run.ending === "time" ? t("Time's up.") : t("Run ended.");
  if (run.levelsCleared > 0 && run.moves === 0) {
    return t("Board {n} cleared. Here comes the next one.", { n: run.level - 1 });
  }
  return t("Drag each block out through the gate of its colour.");
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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
          {t("{clearedColumns} {n} cleared, {tilesPlaced} {n2}.", {
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
          <dt className="text-xs text-muted-foreground">{t("Boards cleared")}</dt>
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
