import { LayoutGrid, Loader2, RotateCcw, ShieldCheck, Trophy, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ErrorState } from "@/components/common";
import { EndRunButton } from "@/components/game/EndRunButton";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { GameExits } from "@/components/game/GameExits";
import { HintButton, HintNote } from "@/components/game/Hint";
import { RulesList } from "@/components/game/RulesList";
import { RunEndActions } from "@/components/game/RunEndActions";
import { SavedRunCard } from "@/components/game/SavedRunCard";
import { Button } from "@/components/ui/button";
import {
  GRIDBURST_CELLS,
  GRIDBURST_SIZE,
  canPlace,
  dropped,
  fitsAnywhere,
  fullLines,
  shapeCells,
  shapeSize,
  type GridburstRun,
} from "@/lib/games/gridburst";
import { gridburstHint } from "@/lib/games/hints";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useGridburstRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import { useHint } from "@/lib/games/use-hint";
import { cn } from "@/lib/utils";

/** This game's rules, shared with the feed's How to play sheet. */
const RULES = GAME_RULES.gridburst;

/** A piece's colour: the shape picks one of the game hues, so a board reads as a mosaic. */
const TONES = [
  "var(--game-1)",
  "var(--game-2)",
  "var(--game-4)",
  "var(--game-5)",
  "var(--game-6)",
  "var(--game-7)",
  "var(--info)",
];
function tone(shape: number): string {
  return TONES[shape % TONES.length];
}

/**
 * Gridburst, playing for real.
 *
 * The board is a view onto `useGridburstRun`, which owns the lifecycle: a
 * session issued by the server, the run played against its seed, and the score
 * the server derived from the submitted placements. Nothing here decides a
 * number — the score shown at the end is the one verification returned.
 */
export function GridburstRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  /** Skip the rules and start the run as soon as it exists: the feed's Tap to play. */
  autoStart?: boolean;
}) {
  const state = useGridburstRun(slug);

  if (state.status === "saved") {
    const placed = state.run.moves.length;
    return (
      <SavedRunCard
        score={state.run.score}
        where={`${placed} ${placed === 1 ? "piece" : "pieces"} placed`}
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

  // A submission failure keeps the board: the run exists, it is just not verified.
  if (state.status === "error" && state.stage === "submit" && state.run && state.session) {
    return (
      <div className="flex flex-1 flex-col justify-center gap-4 px-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-2">
          <TriangleAlert className="size-5 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold">Your run was not verified</h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {playErrorMessage(state.error)} Nothing was saved, and nothing needs to be — sending the
          same run again is safe.
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
        onPlace={state.place}
        onFinish={state.finish}
        onBegin={state.begin}
        autoStart={autoStart}
        slug={slug}
        title={title}
      />
    );
  }

  if (state.status === "finished") {
    return <Finished slug={slug} run={state.run} result={state.result} onRestart={state.restart} />;
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/** A piece in the player's hand: which tray slot, and where the pointer is. */
type Drag = {
  slot: number;
  pointer: number;
  /** Touch lifts the piece above the finger so it stays visible. */
  lifted: boolean;
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
};

/** A burst being drawn: the cells that cleared and what the placement earned. */
type Flash = { key: number; cells: Set<number>; gain: number; combo: number };

function Board({
  run,
  session,
  verifying,
  onPlace,
  onFinish,
  onBegin,
  autoStart,
  slug,
  title,
}: {
  run: GridburstRun;
  session: PlaySession;
  verifying: boolean;
  onPlace: (slot: number, cell: number) => void;
  onFinish: () => void;
  onBegin: () => void;
  autoStart: boolean;
  slug: string;
  title: string;
}) {
  const [started, setStarted] = useState(autoStart || run.moves.length > 0);
  useEffect(() => {
    if (autoStart && run.moves.length === 0) onBegin();
    // Once, on the first board: a retried submission remounts with a started run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accepting = !verifying && run.outcome === "playing";
  useReportRunProgress(started && accepting, onFinish, session);

  const hints = useHint({
    progress: run.moves.length,
    active: started && accepting,
    compute: () => gridburstHint(run),
  });

  const boardRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // The cell under the mouse or the keyboard cursor, for a selected piece.
  const [cursor, setCursor] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pitch, setPitch] = useState(40);
  const [flash, setFlash] = useState<Flash | null>(null);

  // A slot that was placed is no longer selectable.
  useEffect(() => {
    if (selected !== null && run.tray[selected] === null) setSelected(null);
  }, [run.tray, selected]);

  // The board's cell pitch, read from the layout, sizes the piece in hand.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const first = grid.querySelector<HTMLElement>('[data-cell="0"]');
      const next = grid.querySelector<HTMLElement>('[data-cell="1"]');
      if (first && next) {
        setPitch(next.getBoundingClientRect().left - first.getBoundingClientRect().left);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [started]);

  /** The corner cell a dragged piece would land on, from where it is drawn. */
  const dragAnchor = useCallback(
    (current: Drag): number | null => {
      const grid = gridRef.current;
      const shape = run.tray[current.slot];
      if (!grid || shape === null || shape === undefined) return null;
      const first = grid.querySelector<HTMLElement>('[data-cell="0"]');
      if (!first) return null;
      const origin = first.getBoundingClientRect();
      const { rows, columns } = shapeSize(shape);
      const left = current.x - (columns * pitch) / 2;
      const top = current.lifted
        ? current.y - rows * pitch - pitch * 1.2
        : current.y - (rows * pitch) / 2;
      const column = Math.round((left - origin.left) / pitch);
      const row = Math.round((top - origin.top) / pitch);
      if (row < 0 || column < 0 || row >= GRIDBURST_SIZE || column >= GRIDBURST_SIZE) return null;
      return row * GRIDBURST_SIZE + column;
    },
    [pitch, run.tray],
  );

  const place = useCallback(
    (slot: number, cell: number) => {
      if (!accepting || !canPlace(run, slot, cell)) return false;
      const shape = run.tray[slot] as number;
      const filled = dropped(run.board, shape, cell);
      const { rows, columns } = fullLines(filled);
      if (rows.length + columns.length > 0) {
        const cells = new Set<number>();
        for (let index = 0; index < GRIDBURST_CELLS; index += 1) {
          if (
            rows.includes(Math.floor(index / GRIDBURST_SIZE)) ||
            columns.includes(index % GRIDBURST_SIZE)
          ) {
            cells.add(index);
          }
        }
        const lines = rows.length + columns.length;
        const combo = run.combo + 1;
        setFlash({ key: run.moves.length, cells, gain: 10 * lines * lines * combo, combo });
      }
      onPlace(slot, cell);
      setSelected(null);
      return true;
    },
    [accepting, onPlace, run],
  );

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 700);
    return () => window.clearTimeout(timer);
  }, [flash]);

  // Dragging is followed on the window, so a piece can travel anywhere on the
  // screen and still land when the finger lifts over the board.
  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointer) return;
      setDrag((current) =>
        current
          ? {
              ...current,
              x: event.clientX,
              y: event.clientY,
              moved:
                current.moved ||
                Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 8,
            }
          : current,
      );
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointer) return;
      const current = { ...drag, x: event.clientX, y: event.clientY };
      setDrag(null);
      if (!drag.moved) {
        // A tap picks the piece up for tap-to-place, or puts it back down.
        setSelected((value) => (value === drag.slot ? null : drag.slot));
        return;
      }
      const anchor = dragAnchor(current);
      if (anchor !== null) place(drag.slot, anchor);
    };
    const cancel = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [drag, dragAnchor, place]);

  // What the board previews: the piece in hand, or the selected piece under the
  // cursor, and the lines it would burst.
  const preview = useMemo(() => {
    let slot: number | null = null;
    let cell: number | null = null;
    if (drag?.moved) {
      slot = drag.slot;
      cell = dragAnchor(drag);
    } else if (selected !== null && cursor !== null) {
      slot = selected;
      cell = cursor;
    } else if (hints.hint) {
      slot = hints.hint.slot;
      cell = hints.hint.cell;
    }
    if (slot === null || cell === null || !canPlace(run, slot, cell)) return null;
    const shape = run.tray[slot] as number;
    const filled = dropped(run.board, shape, cell);
    const { rows, columns } = fullLines(filled);
    const piece = new Set(shapeCells(shape).map(([dr, dc]) => cell + dr * GRIDBURST_SIZE + dc));
    const bursting = new Set<number>();
    for (let index = 0; index < GRIDBURST_CELLS; index += 1) {
      if (
        rows.includes(Math.floor(index / GRIDBURST_SIZE)) ||
        columns.includes(index % GRIDBURST_SIZE)
      ) {
        bursting.add(index);
      }
    }
    return { shape, piece, bursting, hinted: !drag?.moved && selected === null };
  }, [cursor, drag, dragAnchor, hints.hint, run, selected]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!accepting) return;
      if (event.key === "1" || event.key === "2" || event.key === "3") {
        const slot = Number(event.key) - 1;
        if (run.tray[slot] !== null) {
          setSelected(slot);
          setCursor((value) => value ?? 0);
        }
        event.preventDefault();
        return;
      }
      if (selected === null) return;
      const at = cursor ?? 0;
      const row = Math.floor(at / GRIDBURST_SIZE);
      const column = at % GRIDBURST_SIZE;
      const step: Record<string, [number, number]> = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      };
      if (step[event.key]) {
        event.preventDefault();
        const [dr, dc] = step[event.key];
        const r = Math.min(GRIDBURST_SIZE - 1, Math.max(0, row + dr));
        const c = Math.min(GRIDBURST_SIZE - 1, Math.max(0, column + dc));
        setCursor(r * GRIDBURST_SIZE + c);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        place(selected, at);
      } else if (event.key === "Escape") {
        setSelected(null);
      }
    },
    [accepting, cursor, place, run.tray, selected],
  );

  if (!started) {
    return (
      <div className="flex flex-1 flex-col justify-center px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="enter mx-auto flex w-full max-w-sm flex-col items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
            <LayoutGrid className="size-5 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">{RULES.heading}</h1>
            <p className="text-sm text-muted-foreground">{RULES.summary}</p>
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
              Start run
            </Button>
            <Button asChild variant="ghost" size="lg">
              <ExitGameLink slug={slug}>Back to {title}</ExitGameLink>
            </Button>
          </div>

          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            {session.ranked
              ? "Signed in: this run can be ranked"
              : "Guest run: verified, but not ranked"}
          </p>
        </div>
      </div>
    );
  }

  const inHand = drag?.moved ? run.tray[drag.slot] : null;

  return (
    <div
      ref={boardRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      aria-label="Gridburst board. Press 1, 2 or 3 to pick a piece, the arrow keys to move it and Enter to place it."
    >
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">Score</dt>
          <dd className="text-2xl font-semibold tabular">{run.score}</dd>
        </dl>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {run.combo > 0 && (
            <span
              key={run.combo}
              className="enter rounded-full bg-primary/15 px-2 py-1 font-semibold text-primary tabular"
            >
              Combo ×{run.combo}
            </span>
          )}
          <span className="tabular">{run.lines} lines</span>
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

      {hints.hint ? (
        <HintNote reason={hints.hint.reason} className="my-0.5" />
      ) : (
        <p className="py-1 text-center text-sm text-muted-foreground" aria-live="polite">
          {verifying
            ? "Verifying your run with the server…"
            : run.outcome === "over"
              ? "Nothing in your tray fits."
              : selected !== null
                ? "Tap a square for the piece's top-left corner."
                : "Drag a piece onto the grid. Fill a row or column to burst it."}
        </p>
      )}

      <div className="flex min-h-0 flex-1 items-center justify-center py-2">
        <div
          className="relative w-full"
          style={{ maxWidth: `min(26rem, calc(100dvh - ${hints.hint ? 22.5 : 20}rem))` }}
        >
          <div
            ref={gridRef}
            className="grid aspect-square w-full gap-1 rounded-2xl bg-surface p-1.5"
            style={{
              gridTemplateColumns: `repeat(${GRIDBURST_SIZE}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${GRIDBURST_SIZE}, minmax(0, 1fr))`,
              touchAction: "none",
            }}
            role="grid"
            aria-label={`Board — ${run.moves.length} pieces placed`}
            onPointerLeave={() => setCursor(null)}
          >
            {Array.from({ length: GRIDBURST_CELLS }, (_, cell) => {
              const value = run.board[cell];
              const ghost = preview?.piece.has(cell);
              const lit = preview?.bursting.has(cell);
              const popping = flash?.cells.has(cell);
              const row = Math.floor(cell / GRIDBURST_SIZE) + 1;
              const column = (cell % GRIDBURST_SIZE) + 1;
              const paint =
                value !== 0 ? tone(value - 1) : ghost ? tone(preview!.shape) : undefined;
              return (
                <button
                  key={cell}
                  type="button"
                  tabIndex={-1}
                  data-cell={cell}
                  role="gridcell"
                  aria-label={`Row ${row} column ${column}, ${value === 0 ? "empty" : "filled"}`}
                  onPointerEnter={() => {
                    if (selected !== null) setCursor(cell);
                  }}
                  onClick={() => {
                    if (selected !== null) place(selected, cell);
                  }}
                  className={cn(
                    "relative rounded-[0.3rem] transition-[background-color,transform,opacity] duration-100 motion-reduce:transition-none",
                    value === 0 && !ghost && "bg-surface-2/50",
                    value !== 0 && "shadow-[inset_0_-3px_0_oklch(0_0_0/0.18)]",
                    ghost && (preview!.hinted ? "opacity-45 animate-pulse" : "opacity-60"),
                    lit && value !== 0 && "brightness-125 ring-2 ring-foreground/70",
                    popping && "gridburst-pop",
                  )}
                  style={paint ? { backgroundColor: paint } : undefined}
                />
              );
            })}
          </div>

          {flash && (
            <div
              key={flash.key}
              className="gridburst-float pointer-events-none absolute inset-x-0 top-1/3 text-center"
              aria-hidden
            >
              <p className="text-3xl font-bold text-foreground drop-shadow tabular">
                +{flash.gain}
              </p>
              {flash.combo > 1 && (
                <p className="text-sm font-semibold text-primary">Combo ×{flash.combo}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div
        className="mx-auto grid w-full max-w-[26rem] grid-cols-3 gap-2 pt-1"
        role="group"
        aria-label="Your pieces"
      >
        {run.tray.map((shape, slot) => {
          const holding = drag?.moved && drag.slot === slot;
          const usable = shape !== null && fitsAnywhere(run.board, shape);
          const hinted = hints.hint?.slot === slot;
          return (
            <button
              key={slot}
              type="button"
              disabled={!accepting || shape === null}
              aria-pressed={selected === slot}
              aria-label={
                shape === null
                  ? `Slot ${slot + 1}, placed`
                  : `Piece ${slot + 1}, ${shapeCells(shape).length} squares${usable ? "" : ", fits nowhere"}${hinted ? ". Hint: place this piece." : ""}`
              }
              onPointerDown={(event) => {
                if (!accepting || shape === null) return;
                event.preventDefault();
                setDrag({
                  slot,
                  pointer: event.pointerId,
                  lifted: event.pointerType === "touch" || event.pointerType === "pen",
                  x: event.clientX,
                  y: event.clientY,
                  startX: event.clientX,
                  startY: event.clientY,
                  moved: false,
                });
              }}
              onKeyDown={(event) => {
                if ((event.key === "Enter" || event.key === " ") && shape !== null) {
                  event.preventDefault();
                  setSelected((value) => (value === slot ? null : slot));
                  setCursor((value) => value ?? 0);
                  boardRef.current?.focus({ preventScroll: true });
                }
              }}
              className={cn(
                "flex h-24 items-center justify-center rounded-xl border bg-surface transition-colors",
                selected === slot ? "border-primary bg-primary/10" : "border-border",
                hinted && "ring-2 ring-primary",
                !usable && shape !== null && "opacity-40",
              )}
              style={{ touchAction: "none" }}
            >
              {shape !== null && !holding && <Piece shape={shape} size="1rem" />}
            </button>
          );
        })}
      </div>

      <div className="flex justify-center pt-2">
        <HintButton offered={hints.offered} waitSeconds={hints.waitSeconds} onAsk={hints.ask} />
      </div>
      <p className="pt-2 text-center text-xs text-muted-foreground" aria-live="polite">
        {verifying
          ? "The pieces you placed are your score if the server agrees."
          : run.outcome === "over"
            ? "The run is over. Your result is on its way."
            : run.combo > 0
              ? `Combo ×${run.combo} — burst again within ${3 - run.misses} ${3 - run.misses === 1 ? "piece" : "pieces"} to keep it.`
              : "Bigger pieces turn up more often the longer you last."}
      </p>
      <EndRunButton score={run.score} disabled={!accepting} onEnd={onFinish} />

      {inHand !== null && inHand !== undefined && drag && (
        <div
          className="pointer-events-none fixed z-50 drop-shadow-xl"
          style={{
            left: drag.x - (shapeSize(inHand).columns * pitch) / 2,
            top: drag.lifted
              ? drag.y - shapeSize(inHand).rows * pitch - pitch * 1.2
              : drag.y - (shapeSize(inHand).rows * pitch) / 2,
          }}
          aria-hidden
        >
          <Piece shape={inHand} size={`${pitch}px`} gap="4px" />
        </div>
      )}
    </div>
  );
}

/** A piece drawn on its own, at `size` per square. */
function Piece({ shape, size, gap = "2px" }: { shape: number; size: string; gap?: string }) {
  const { rows, columns } = shapeSize(shape);
  const cells = new Set(shapeCells(shape).map(([r, c]) => r * columns + c));
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${columns}, ${size})`,
        gridTemplateRows: `repeat(${rows}, ${size})`,
        gap,
      }}
    >
      {Array.from({ length: rows * columns }, (_, index) => (
        <div
          key={index}
          className={cn(
            cells.has(index) && "rounded-[0.25rem] shadow-[inset_0_-3px_0_oklch(0_0_0/0.18)]",
          )}
          style={cells.has(index) ? { backgroundColor: tone(shape) } : undefined}
        />
      ))}
    </div>
  );
}

/** The end of a run: the score the server verified, or a guest's unranked result. */
function Finished({
  slug,
  run,
  result,
  onRestart,
}: {
  slug: string;
  run: GridburstRun;
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
        <p className="text-sm text-muted-foreground">
          {run.stopped
            ? "Run ended"
            : run.endReason === "stuck"
              ? "Nothing fits"
              : "Submission limit reached"}
        </p>
        <p className="text-5xl font-semibold tabular">{result.score}</p>
        <p className="text-sm text-muted-foreground">
          {result.tilesPlaced} {result.tilesPlaced === 1 ? "piece" : "pieces"}, {run.lines}{" "}
          {run.lines === 1 ? "line" : "lines"} burst.
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Duration</dt>
          <dd className="font-semibold tabular">{formatDuration(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Lines</dt>
          <dd className="font-semibold tabular">{run.lines}</dd>
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
          ? "Verified by replaying your placements on the server, then saved to the leaderboard."
          : "Verified by replaying your placements on the server. This was a guest run, so it is not on the leaderboard."}
        {result.duplicate && " This run was already recorded, so nothing was counted twice."}
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
