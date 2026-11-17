import { Lightbulb, Spline, Undo2, X } from "lucide-react";
import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { DailyFrame, DailyResult, RankChip } from "@/components/game/DailyShell";
import { Button } from "@/components/ui/button";
import { useDailyRun, type DailyEngine } from "@/lib/games/daily-run";
import type { MeanderPuzzle } from "@/lib/games/meander-bank";
import {
  adjacent,
  CELLS,
  createRun,
  encodeTrace,
  HINT,
  hintTarget,
  isPlaced,
  lettersOf,
  liftCode,
  MAX_HINTS,
  MAX_LENGTH,
  MEANDER_RULES_VERSION,
  MIN_LENGTH,
  move,
  owners,
  puzzleOf,
  refusal,
  scoreOf,
  SIZE,
  stop,
  submission,
  type MeanderRun,
} from "@/lib/games/meander";
import { isPracticeBoard } from "@/lib/games/offline";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import type { DailyShare } from "@/lib/games/share";
import { points } from "@/lib/format";
import { useGameSounds } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

const RULES = GAME_RULES.meander;

const ENGINE: DailyEngine<MeanderRun> = {
  rulesVersion: MEANDER_RULES_VERSION,
  create: (session) => createRun(session.seed, session.rulesVersion),
  over: (run) => run.outcome !== "playing",
  submission,
};

/** One colour per word, in the day's order: a cell's fill, its path's line, its share square. */
export const WORD_COLOURS = [
  { cell: "bg-sky-500/30", line: "stroke-sky-500", emoji: "🟦" },
  { cell: "bg-amber-500/30", line: "stroke-amber-500", emoji: "🟨" },
  { cell: "bg-emerald-500/30", line: "stroke-emerald-500", emoji: "🟩" },
  { cell: "bg-rose-500/30", line: "stroke-rose-500", emoji: "🟥" },
  { cell: "bg-violet-500/30", line: "stroke-violet-500", emoji: "🟪" },
] as const;

const colourOf = (word: number) => WORD_COLOURS[word % WORD_COLOURS.length]!;

/** Meander, playing for real: one theme a day, its words wound through the grid. */
export function MeanderRuntime({
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
  const onMove = useCallback((code: number) => play((r) => move(r, code)), [play]);
  const onStop = useCallback(() => play(stop), [play]);
  return (
    <DailyFrame
      state={state}
      slug={slug}
      title={title}
      rules={RULES}
      icon={<Spline className="size-5 text-muted-foreground" />}
      playLabel={t("Play today's grid")}
      loadingLabel={t("Fetching today's grid…")}
      doneTitle={t("You've played today's grid")}
      board={(session, run, verifying) => (
        <Board
          key={session.id}
          run={run}
          verifying={verifying}
          ranked={<RankChip session={session} />}
          practice={isPracticeBoard(session)}
          onMove={onMove}
          onStop={onStop}
        />
      )}
      finished={(run, result) => {
        const puzzle = puzzleOf(run);
        return (
          <DailyResult
            slug={slug}
            result={result}
            headline={headlineFor(run)}
            stats={[
              { label: t("Words"), value: `${run.placed.length}/${puzzle.words.length}` },
              { label: t("Hints"), value: `${run.hinted.length}/${MAX_HINTS}` },
            ]}
            share={meanderShare(run)}
          >
            <div className="mx-auto flex w-full max-w-xs flex-col gap-3">
              <p className="text-sm font-medium">{t(puzzle.theme)}</p>
              <Grid
                puzzle={puzzle}
                placed={puzzle.paths.map((cells, word) => ({ word, cells }))}
                trace={[]}
              />
              <ul className="flex flex-wrap justify-center gap-1.5" aria-label={t("The words")}>
                {puzzle.words.map((word, i) => (
                  <li
                    key={word}
                    className={cn(
                      "rounded-lg px-2 py-1 text-sm font-semibold tracking-wide",
                      colourOf(i).cell,
                      !isPlaced(run, i) && "opacity-60",
                    )}
                  >
                    {word}
                  </li>
                ))}
              </ul>
            </div>
          </DailyResult>
        );
      }}
    />
  );
}

function headlineFor(run: MeanderRun): string {
  if (run.ending === "solved") {
    return run.hinted.length === 0
      ? t("Every word, no hints!")
      : run.hinted.length === 1
        ? t("Grid filled with 1 hint")
        : t("Grid filled with {n} hints", { n: run.hinted.length });
  }
  return t("{n} of {total} words", {
    n: run.placed.length,
    total: puzzleOf(run).words.length,
  });
}

/** The grid as the run left it, one coloured square a word, and the hints taken. */
function meanderShare(run: MeanderRun): DailyShare {
  const owner = owners(run);
  const rows = Array.from({ length: SIZE }, (_, r) =>
    owner
      .slice(r * SIZE, r * SIZE + SIZE)
      .map((word) => (word < 0 ? "⬜" : colourOf(word).emoji))
      .join(""),
  );
  const words = puzzleOf(run).words.length;
  return {
    day: run.day,
    result: `${run.placed.length}/${words}${run.hinted.length ? ` 💡${run.hinted.length}` : ""}`,
    grid: rows.join("\n"),
  };
}

/** The centre of a cell, in the grid's 0–100 drawing box. */
function centre(cell: number): [number, number] {
  return [((cell % SIZE) + 0.5) * (100 / SIZE), (Math.floor(cell / SIZE) + 0.5) * (100 / SIZE)];
}

function polyline(cells: readonly number[]): string {
  return cells.map((cell) => centre(cell).join(",")).join(" ");
}

/** The letters, the placed words' colours and lines, and the trace in progress. */
function Grid({
  puzzle,
  placed,
  trace,
  hintCell = null,
  interactive,
}: {
  puzzle: MeanderPuzzle;
  placed: readonly { word: number; cells: readonly number[] }[];
  trace: readonly number[];
  /** The first cell of the word a hint showed, ringed. */
  hintCell?: number | null;
  interactive?: {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onKeyCell: (cell: number) => void;
  };
}) {
  const letters = lettersOf(puzzle);
  const owner: number[] = Array(CELLS).fill(-1);
  for (const { word, cells } of placed) for (const cell of cells) owner[cell] = word;
  return (
    <div
      className={cn(
        "relative mx-auto aspect-square w-full max-w-[20rem] select-none",
        interactive && "touch-none",
      )}
      role="grid"
      aria-label={t("Letter grid")}
      onPointerDown={interactive?.onPointerDown}
      onPointerMove={interactive?.onPointerMove}
      onPointerUp={interactive?.onPointerUp}
      onPointerCancel={interactive?.onPointerCancel}
    >
      <div className="grid size-full grid-cols-5 gap-1.5">
        {letters.map((letter, cell) => {
          const word = owner[cell]!;
          const traced = trace.includes(cell);
          return (
            <button
              key={cell}
              type="button"
              tabIndex={interactive ? 0 : -1}
              aria-label={letter}
              aria-pressed={traced}
              onClick={(event) => {
                // A pointer press is handled by the grid; this is the keyboard's.
                if (event.detail === 0) interactive?.onKeyCell(cell);
              }}
              className={cn(
                "relative flex items-center justify-center rounded-xl text-[clamp(1.1rem,6vw,1.6rem)] font-bold transition-colors motion-reduce:transition-none",
                traced
                  ? "bg-foreground text-background"
                  : word >= 0
                    ? colourOf(word).cell
                    : "bg-surface-2",
                hintCell === cell &&
                  !traced &&
                  "ring-2 ring-primary ring-offset-2 ring-offset-background",
                !interactive && "cursor-default",
              )}
            >
              {letter}
            </button>
          );
        })}
      </div>
      <svg
        viewBox="0 0 100 100"
        className="pointer-events-none absolute inset-0 size-full"
        aria-hidden="true"
      >
        {placed.map(({ word, cells }) => (
          <polyline
            key={word}
            points={polyline(cells)}
            className={cn("fill-none opacity-50", colourOf(word).line)}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {trace.length > 1 && (
          <polyline
            points={polyline(trace)}
            className="fill-none stroke-foreground opacity-40"
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  );
}

/**
 * A press in progress: the pointer, whether it has crossed a second cell, a word it
 * may lift, and whether it began on the trace's last cell (a tap there enters it).
 */
type Gesture = { pointer: number; dragged: boolean; lift: number | null; onEnd: boolean };

function Board({
  run,
  verifying,
  ranked,
  practice,
  onMove,
  onStop,
}: {
  run: MeanderRun;
  verifying: boolean;
  ranked: ReactNode;
  /** An Unlimited round or a past day: not today's board, and not ranked. */
  practice: boolean;
  onMove: (code: number) => void;
  onStop: () => void;
}) {
  const puzzle = puzzleOf(run);
  const letters = lettersOf(puzzle);
  const [trace, setTrace] = useState<number[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const live = !verifying && run.outcome === "playing";
  const owner = owners(run);

  useGameSounds({
    moves: run.moves.length,
    score: scoreOf(run),
    over: run.outcome === "over",
    ending: run.ending === "solved" ? "win" : "stop",
  });
  useReportRunProgress(live, onStop);

  /** Tries the trace as a word; clears it either way. */
  function enter(cells: readonly number[]) {
    setTrace([]);
    if (cells.length < MIN_LENGTH) {
      if (cells.length > 1) setNotice(t("Words have at least four letters."));
      return;
    }
    const code = encodeTrace(cells);
    if (code === null) return;
    const spelled = cells.map((cell) => letters[cell]).join("");
    const why = refusal(run, code);
    if (why === null) {
      setNotice(t("{word}!", { word: spelled }));
      onMove(code);
    } else if (why === "unknown") {
      const already = puzzle.words.some((w, i) => w === spelled && isPlaced(run, i));
      setNotice(
        already
          ? t("Already on the grid.")
          : t("{word} isn't one of today's words.", { word: spelled }),
      );
    } else if (why === "full") {
      setNotice(t("That's the most moves a day allows. Stop to keep your words."));
    }
  }

  function lift(word: number) {
    if (!live) return;
    setTrace([]);
    setNotice(null);
    onMove(liftCode(word));
  }

  /** Whether a cell may be added to the trace. */
  function canExtend(path: readonly number[], cell: number): boolean {
    if (owner[cell] !== -1 || path.includes(cell) || path.length >= MAX_LENGTH) return false;
    return path.length === 0 || adjacent(path[path.length - 1]!, cell);
  }

  /** The cell under the pointer, only near its centre so a corner cut doesn't catch a neighbour. */
  function cellAt(event: ReactPointerEvent<HTMLDivElement>): number | null {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * SIZE;
    const y = ((event.clientY - box.top) / box.height) * SIZE;
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return null;
    const c = Math.floor(x);
    const r = Math.floor(y);
    const near = Math.hypot(x - c - 0.5, y - r - 0.5) <= 0.42;
    return near ? r * SIZE + c : null;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!live || (event.pointerType === "mouse" && event.button !== 0)) return;
    const cell = cellAt(event);
    if (cell === null) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // A synthetic pointer (tests) cannot be captured; the gesture still works.
    }
    setNotice(null);
    if (owner[cell] !== -1) {
      gesture.current = {
        pointer: event.pointerId,
        dragged: false,
        lift: owner[cell]!,
        onEnd: false,
      };
      return;
    }
    const onEnd = trace[trace.length - 1] === cell;
    gesture.current = { pointer: event.pointerId, dragged: false, lift: null, onEnd };
    setTrace((path) => {
      if (path[path.length - 1] === cell) return path; // a tap on the end: decided on release
      if (canExtend(path, cell)) return [...path, cell];
      return [cell];
    });
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId || current.lift !== null) return;
    const cell = cellAt(event);
    if (cell === null) return;
    setTrace((path) => {
      if (path.length === 0 || path[path.length - 1] === cell) return path;
      // Back onto the cell before: the trace steps back.
      if (path[path.length - 2] === cell) {
        current.dragged = true;
        return path.slice(0, -1);
      }
      if (!canExtend(path, cell)) return path;
      current.dragged = true;
      return [...path, cell];
    });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    gesture.current = null;
    if (current.lift !== null) {
      if (cellAt(event) !== null && owner[cellAt(event)!] === current.lift) lift(current.lift);
      return;
    }
    if (current.dragged) {
      enter(trace);
      return;
    }
    // A tap that began on the trace's end: enter a long enough trace, or take the end back.
    const cell = cellAt(event);
    if (current.onEnd && cell !== null && trace[trace.length - 1] === cell) {
      if (trace.length >= MIN_LENGTH) enter(trace);
      else setTrace(trace.slice(0, -1));
    }
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointer === event.pointerId) gesture.current = null;
  }

  /** The keyboard: Enter or Space on a cell builds the trace a cell at a time. */
  function onKeyCell(cell: number) {
    if (!live) return;
    setNotice(null);
    if (owner[cell] !== -1) {
      lift(owner[cell]!);
      return;
    }
    if (trace[trace.length - 1] === cell) {
      if (trace.length >= MIN_LENGTH) enter(trace);
      else setTrace(trace.slice(0, -1));
      return;
    }
    setTrace(canExtend(trace, cell) ? [...trace, cell] : [cell]);
  }

  const target = hintTarget(run);
  const hintsLeft = MAX_HINTS - run.hinted.length;
  const lastPlaced = run.placed[run.placed.length - 1];
  // The ring marks the first cell of the latest hinted word still to place.
  const ringed = [...run.hinted].reverse().find((word) => !isPlaced(run, word));
  const hintCell = ringed === undefined ? null : puzzle.paths[ringed]![0]!;

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2 text-xs text-muted-foreground">
        <span className="tabular">{points(scoreOf(run))}</span>
        {ranked}
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col gap-3 pt-1">
        <div className="text-center">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {practice ? t("The theme") : t("Today's theme")}
          </p>
          <h2 className="text-xl font-semibold">{t(puzzle.theme)}</h2>
        </div>

        <ul className="flex flex-col items-center gap-1.5" aria-label={t("The words")}>
          {puzzle.words.map((word, i) => {
            const placed = isPlaced(run, i);
            const hinted = run.hinted.includes(i);
            return (
              <li key={i}>
                <button
                  type="button"
                  disabled={!live || !placed}
                  onClick={() => lift(i)}
                  aria-label={
                    placed
                      ? t("{word}, placed. Lift it", { word })
                      : hinted
                        ? t("{word}, from a hint", { word })
                        : t("A word of {n} letters", { n: word.length })
                  }
                  className="flex gap-1 rounded-lg p-0.5 disabled:cursor-default"
                >
                  {word.split("").map((letter, k) => (
                    <span
                      key={k}
                      className={cn(
                        "flex size-7 items-center justify-center rounded-md text-sm font-bold",
                        placed ? colourOf(i).cell : "bg-surface-2",
                        !placed && hinted && "text-muted-foreground",
                      )}
                    >
                      {placed || hinted ? letter : ""}
                    </span>
                  ))}
                </button>
              </li>
            );
          })}
        </ul>

        <Grid
          puzzle={puzzle}
          placed={run.placed}
          trace={trace}
          hintCell={hintCell}
          interactive={
            live
              ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyCell }
              : undefined
          }
        />

        <p className="min-h-5 text-center text-sm font-medium" aria-live="polite">
          {verifying
            ? t("Verifying your run with the server…")
            : trace.length > 0
              ? trace.map((cell) => letters[cell]).join("")
              : notice}
        </p>

        {live && (
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={target === null}
              onClick={() => {
                setTrace([]);
                setNotice(null);
                onMove(HINT);
              }}
            >
              <Lightbulb className="size-4" />
              {t("Hint ({n} left)", { n: hintsLeft })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!lastPlaced}
              onClick={() => lastPlaced && lift(lastPlaced.word)}
            >
              <Undo2 className="size-4" />
              {t("Undo")}
            </Button>
            {trace.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setTrace([])}>
                <X className="size-4" />
                {t("Clear")}
              </Button>
            )}
            {run.placed.length > 0 && (
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
