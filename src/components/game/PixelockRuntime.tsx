import { Grid3x3, Heart, PaintBucket, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { DailyFrame, DailyResult, RankChip } from "@/components/game/DailyShell";
import { Button } from "@/components/ui/button";
import { useDailyRun, type DailyEngine } from "@/lib/games/daily-run";
import {
  CELLS,
  CROSS,
  CROSSED,
  cluesOf,
  code,
  createRun,
  FILL,
  FILLED,
  isRight,
  LIVES,
  lineDone,
  move,
  pictureOf,
  PIXELOCK_RULES_VERSION,
  refusal,
  scoreOf,
  SIZE,
  stop,
  submission,
  UNKNOWN,
  type Mode,
  type PixelockRun,
} from "@/lib/games/pixelock";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import type { DailyShare } from "@/lib/games/share";
import { points } from "@/lib/format";
import { useGameSounds } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

const RULES = GAME_RULES.pixelock;

const ENGINE: DailyEngine<PixelockRun> = {
  rulesVersion: PIXELOCK_RULES_VERSION,
  create: (session) => createRun(session.seed, session.rulesVersion),
  over: (run) => run.outcome !== "playing",
  submission,
};

/** Pixelock, playing for real: today's picture, drawn from its clues. */
export function PixelockRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  autoStart?: boolean;
}) {
  const state = useDailyRun(slug, ENGINE, autoStart);
  const { play } = state;
  const onMove = useCallback((m: number) => play((r) => move(r, m)), [play]);
  const onStop = useCallback(() => play(stop), [play]);
  return (
    <DailyFrame
      state={state}
      slug={slug}
      title={title}
      rules={RULES}
      icon={<Grid3x3 className="size-5 text-muted-foreground" />}
      playLabel={t("Play today's picture")}
      loadingLabel={t("Fetching today's picture…")}
      doneTitle={t("You've played today's picture")}
      board={(session, run, verifying) => (
        <Board
          key={session.id}
          run={run}
          verifying={verifying}
          ranked={<RankChip session={session} />}
          onMove={onMove}
          onStop={onStop}
        />
      )}
      finished={(run, result) => (
        <DailyResult
          slug={slug}
          result={result}
          headline={headlineFor(run)}
          stats={[
            { label: t("Lives left"), value: `${LIVES - run.mistakes}/${LIVES}` },
            { label: t("Cells filled"), value: run.fills },
          ]}
          share={pixelockShare(run)}
        >
          <Picture run={run} />
        </DailyResult>
      )}
    />
  );
}

function headlineFor(run: PixelockRun): string {
  const name = t(pictureOf(run).name);
  if (run.ending === "solved") {
    return run.mistakes === 0
      ? t("A flawless {name}!", { name })
      : t("You drew the {name}!", { name });
  }
  return t("It was a {name}", { name });
}

/** Lives as hearts, then the share-safe outcome: the picture itself is the spoiler. */
function pixelockShare(run: PixelockRun): DailyShare {
  const lives = "❤️".repeat(LIVES - run.mistakes) + "🖤".repeat(run.mistakes);
  const done = Math.round((run.cells.filter((c) => c === FILLED).length / inkTotal(run)) * 10);
  return {
    day: run.day,
    result: run.ending === "solved" ? t("Solved") : `${done * 10}%`,
    grid: `${lives}\n${"🟩".repeat(done)}${"⬜".repeat(10 - done)}`,
  };
}

function inkTotal(run: PixelockRun): number {
  const clues = cluesOf(pictureOf(run));
  return clues.rows.flat().reduce((sum, n) => sum + n, 0);
}

/** The finished picture: every inked cell, with the ones a mistake showed marked. */
function Picture({ run }: { run: PixelockRun }) {
  const picture = pictureOf(run);
  return (
    <div
      className="mx-auto grid w-40 grid-cols-10 gap-px overflow-hidden rounded-lg bg-foreground/10 p-px"
      aria-label={t(picture.name)}
      role="img"
    >
      {Array.from({ length: CELLS }, (_, i) => {
        const on = picture.rows[Math.floor(i / SIZE)]![i % SIZE] === "#";
        return <div key={i} className={cn("aspect-square", on ? "bg-foreground" : "bg-surface")} />;
      })}
    </div>
  );
}

function Board({
  run,
  verifying,
  ranked,
  onMove,
  onStop,
}: {
  run: PixelockRun;
  verifying: boolean;
  ranked: ReactNode;
  onMove: (m: number) => void;
  onStop: () => void;
}) {
  const clues = useMemo(() => cluesOf(pictureOf(run)), [run.picture]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState<Mode>(FILL);
  const [notice, setNotice] = useState<string | null>(null);
  const live = !verifying && run.outcome === "playing";
  // The run as of the last render, so a drag's moves see every move before them.
  const runRef = useRef(run);
  runRef.current = run;
  const dragging = useRef(false);
  // The last cell a drag played, so a fast swipe fills every cell it skipped over.
  const lastCell = useRef<number | null>(null);

  useGameSounds({
    moves: run.moves.length,
    score: scoreOf(run),
    over: run.outcome === "over",
    ending: run.ending === "solved" ? "win" : run.ending === "out" ? "lose" : "stop",
  });
  useReportRunProgress(live, onStop);

  /** Plays a move on a cell; returns false when the drag should stop. */
  function apply(cell: number): boolean {
    const current = runRef.current;
    const m = code(cell, mode);
    if (current.outcome !== "playing" || refusal(current, m) !== null) return true;
    const right = isRight(current, m);
    runRef.current = move(current, m);
    onMove(m);
    if (!right) {
      setNotice(
        mode === FILL
          ? t("That cell is blank — a life lost.")
          : t("That cell is filled — a life lost."),
      );
      return false;
    }
    setNotice(null);
    return true;
  }

  function cellAt(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y);
    const value = el instanceof HTMLElement ? el.dataset["cell"] : undefined;
    return value === undefined ? null : Number(value);
  }

  const lives = LIVES - run.mistakes;

  return (
    <div className="flex flex-1 flex-col px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1" aria-label={t("{n} lives left", { n: lives })}>
          {Array.from({ length: LIVES }, (_, i) => (
            <Heart
              key={i}
              className={cn(
                "size-4",
                i < lives ? "fill-destructive text-destructive" : "text-foreground/25",
              )}
            />
          ))}
          <span className="ml-2 tabular">{points(scoreOf(run))}</span>
        </span>
        {ranked}
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col gap-3 pt-1">
        <div
          className="grid select-none"
          style={{
            gridTemplateColumns: `auto repeat(${SIZE}, minmax(0, 1fr))`,
            touchAction: "none",
          }}
          onPointerMove={(event) => {
            if (!dragging.current || !live) return;
            const cell = cellAt(event.clientX, event.clientY);
            if (cell === null || cell === lastCell.current) return;
            for (const next of between(lastCell.current, cell)) {
              lastCell.current = next;
              if (!apply(next)) {
                dragging.current = false;
                return;
              }
            }
          }}
          onPointerUp={() => (dragging.current = false)}
          onPointerLeave={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
        >
          <div />
          {clues.columns.map((clue, c) => (
            <div
              key={`c${c}`}
              className={cn(
                "flex flex-col items-center justify-end pb-1 text-[0.65rem] font-semibold leading-tight tabular sm:text-xs",
                lineDone(run, "column", c) && "text-muted-foreground/50",
              )}
            >
              {(clue.length ? clue : [0]).map((n, i) => (
                <span key={i}>{n}</span>
              ))}
            </div>
          ))}
          {Array.from({ length: SIZE }, (_, r) => (
            <Row
              key={r}
              r={r}
              run={run}
              clue={clues.rows[r]!}
              live={live}
              onStart={(cell) => {
                lastCell.current = cell;
                dragging.current = apply(cell);
              }}
            />
          ))}
        </div>

        <p className="min-h-5 text-center text-sm font-medium" aria-live="polite">
          {verifying ? t("Verifying your run with the server…") : notice}
        </p>

        {live && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <div
              className="inline-flex rounded-xl bg-surface-2 p-1"
              role="radiogroup"
              aria-label={t("Tool")}
            >
              {(
                [
                  [FILL, t("Fill"), <PaintBucket key="f" className="size-4" />],
                  [CROSS, t("Cross out"), <X key="x" className="size-4" />],
                ] as const
              ).map(([value, label, icon]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => setMode(value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium",
                    mode === value ? "bg-background shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
            {run.moves.length > 0 && (
              <Button variant="ghost" size="sm" onClick={onStop}>
                {t("Stop here ({points})", { points: points(scoreOf(run)) })}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The cells a drag crossed from `from` to `to`, `to` last: every cell between them
 * when they share a row or column, else just `to`.
 */
function between(from: number | null, to: number): number[] {
  if (from === null) return [to];
  const [fr, fc, tr, tc] = [Math.floor(from / SIZE), from % SIZE, Math.floor(to / SIZE), to % SIZE];
  if (fr !== tr && fc !== tc) return [to];
  const step = fr === tr ? Math.sign(tc - fc) : Math.sign(tr - fr) * SIZE;
  const cells: number[] = [];
  for (let cell = from + step; cell !== to; cell += step) cells.push(cell);
  cells.push(to);
  return cells;
}

function Row({
  r,
  run,
  clue,
  live,
  onStart,
}: {
  r: number;
  run: PixelockRun;
  clue: readonly number[];
  live: boolean;
  onStart: (cell: number) => void;
}) {
  return (
    <>
      <div
        className={cn(
          "flex items-center justify-end gap-1 pr-1.5 text-[0.65rem] font-semibold tabular sm:text-xs",
          lineDone(run, "row", r) && "text-muted-foreground/50",
        )}
      >
        {(clue.length ? clue : [0]).map((n, i) => (
          <span key={i}>{n}</span>
        ))}
      </div>
      {Array.from({ length: SIZE }, (_, c) => {
        const cell = r * SIZE + c;
        const state = run.cells[cell];
        const shown = run.revealed.includes(cell);
        return (
          <button
            key={c}
            type="button"
            data-cell={cell}
            // Not `disabled`: a disabled button swallows the pointer events a drag
            // across shown cells needs. A shown cell's move is refused anyway.
            aria-disabled={!live || state !== UNKNOWN}
            aria-label={t("Row {r}, column {c}", { r: r + 1, c: c + 1 })}
            onClick={(event) => {
              // A keyboard press: a pointer already played the cell on pointer down.
              if (event.detail === 0 && live) onStart(cell);
            }}
            onPointerDown={(event) => {
              if (!live) return;
              event.preventDefault();
              (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
              onStart(cell);
            }}
            className={cn(
              "flex aspect-square items-center justify-center bg-surface-2 transition-colors motion-reduce:transition-none aria-disabled:cursor-default",
              // Thin lines between cells, heavier every five and round the edge.
              "border-r border-b border-foreground/15",
              c === 0 && "border-l-2 border-l-foreground/40",
              r === 0 && "border-t-2 border-t-foreground/40",
              (c === 4 || c === 9) && "border-r-2 border-r-foreground/40",
              (r === 4 || r === 9) && "border-b-2 border-b-foreground/40",
              state === FILLED && "bg-foreground",
              state === FILLED && shown && "bg-destructive/80",
              state === UNKNOWN && live && "hover:bg-surface",
            )}
          >
            {state === CROSSED && (
              <X
                className={cn(
                  "size-[70%]",
                  shown ? "text-destructive" : "text-muted-foreground/60",
                )}
                strokeWidth={2.5}
              />
            )}
          </button>
        );
      })}
    </>
  );
}
