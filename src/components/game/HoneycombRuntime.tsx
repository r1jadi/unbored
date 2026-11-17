import { Delete, Hexagon, Shuffle } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { DailyFrame, DailyResult, RankChip } from "@/components/game/DailyShell";
import { Button } from "@/components/ui/button";
import { useDailyRun, type DailyEngine } from "@/lib/games/daily-run";
import {
  attempt,
  createRun,
  find,
  HONEYCOMB_RULES_VERSION,
  maxScore,
  outerLetters,
  puzzleOf,
  rankIndex,
  RANKS,
  scoreOf,
  stop,
  submission,
  usesAllSeven,
  wordPoints,
  type HoneycombRun,
} from "@/lib/games/honeycomb";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import type { DailyShare } from "@/lib/games/share";
import { points } from "@/lib/format";
import { useGameSounds } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

const RULES = GAME_RULES.honeycomb;

const ENGINE: DailyEngine<HoneycombRun> = {
  rulesVersion: HONEYCOMB_RULES_VERSION,
  create: (session) => createRun(session.seed, session.rulesVersion),
  over: (run) => run.outcome !== "playing",
  submission,
};

/** Honeycomb, playing for real: seven letters and every word they make. */
export function HoneycombRuntime({
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
  const onFind = useCallback((id: number) => play((r) => find(r, id)), [play]);
  const onStop = useCallback(() => play(stop), [play]);
  return (
    <DailyFrame
      state={state}
      slug={slug}
      title={title}
      rules={RULES}
      icon={<Hexagon className="size-5 text-muted-foreground" />}
      playLabel={t("Play today's letters")}
      loadingLabel={t("Fetching today's letters…")}
      doneTitle={t("You've played today's letters")}
      board={(session, run, verifying) => (
        <Board
          key={session.id}
          run={run}
          verifying={verifying}
          ranked={<RankChip session={session} />}
          onFind={onFind}
          onStop={onStop}
        />
      )}
      finished={(run, result) => (
        <DailyResult
          slug={slug}
          result={result}
          headline={t("Rank: {rank}", { rank: t(RANKS[rankIndex(run)]!.name) })}
          stats={[
            { label: t("Words"), value: `${run.found.length}/${puzzleOf(run).words.length}` },
            {
              label: t("Points"),
              value: `${points(scoreOf(run))}/${points(maxScore(puzzleOf(run)))}`,
            },
          ]}
          share={honeycombShare(run)}
        >
          <WordList run={run} reveal />
        </DailyResult>
      )}
    />
  );
}

/** "1 word", "12 words". */
function wordCount(n: number): string {
  return n === 1 ? t("1 word") : t("{n} words", { n });
}

/** The rank reached, as filled hexagons, and the words and points found. */
function honeycombShare(run: HoneycombRun): DailyShare {
  const rank = rankIndex(run);
  return {
    day: run.day,
    result: t(RANKS[rank]!.name),
    grid: `${"🟨".repeat(rank + 1)}${"⬜".repeat(RANKS.length - rank - 1)}\n${wordCount(run.found.length)}`,
  };
}

/** The words found, and after the day every word, the missed ones dimmed. */
function WordList({ run, reveal = false }: { run: HoneycombRun; reveal?: boolean }) {
  const puzzle = puzzleOf(run);
  const found = new Set(run.found);
  const shown = reveal
    ? puzzle.words.map((word, id) => ({ word, id }))
    : run.found
        .map((id) => ({ word: puzzle.words[id]!, id }))
        .sort((a, b) => a.word.localeCompare(b.word));
  if (shown.length === 0) {
    return <p className="text-center text-sm text-muted-foreground">{t("No words yet.")}</p>;
  }
  return (
    <ul className="flex flex-wrap justify-center gap-1.5" aria-label={t("Words found")}>
      {shown.map(({ word, id }) => (
        <li
          key={id}
          className={cn(
            "rounded-lg px-2 py-1 text-sm capitalize",
            found.has(id) ? "bg-surface-2" : "bg-surface text-muted-foreground/60",
            usesAllSeven(puzzle, word) && "font-bold text-primary",
          )}
        >
          {word}
        </li>
      ))}
    </ul>
  );
}

/**
 * Where the six outer cells sit around the centre, as a share of the hive: flat-topped
 * hexagons 32% wide touch at 0.75 × width across and 0.9 × width (their drawn
 * height) down, spread a little so the edges show.
 */
const SPOTS = [
  [50, 19],
  [76, 34.5],
  [76, 65.5],
  [50, 81],
  [24, 65.5],
  [24, 34.5],
] as const;

/**
 * How near a cell's centre a swipe must pass to pick it up, as a share of the hive.
 * A cell is 32% wide and about 29% high, so this is well inside it: a swipe that
 * cuts the corner between two cells does not catch the cell beside them.
 */
const SWIPE_REACH = 11;

/** The letter whose cell centre is within reach of a point on the hive, if any. */
function letterNear(
  cells: readonly { letter: string; x: number; y: number }[],
  x: number,
  y: number,
): string | null {
  for (const cell of cells) {
    if (Math.hypot(cell.x - x, cell.y - y) <= SWIPE_REACH) return cell.letter;
  }
  return null;
}

/** A swipe in progress: the pointer, and the letters it has crossed. */
type Trace = { pointer: number; letters: string[]; swiped: boolean };

function Board({
  run,
  verifying,
  ranked,
  onFind,
  onStop,
}: {
  run: HoneycombRun;
  verifying: boolean;
  ranked: ReactNode;
  onFind: (id: number) => void;
  onStop: () => void;
}) {
  const puzzle = puzzleOf(run);
  const centre = puzzle.letters[0]!;
  const [outer, setOuter] = useState(() => outerLetters(puzzle));
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState<{ text: string; good: boolean } | null>(null);
  const live = !verifying && run.outcome === "playing";
  const rank = rankIndex(run);
  const max = maxScore(puzzle);
  const score = scoreOf(run);

  useGameSounds({
    moves: run.found.length,
    score,
    over: run.outcome === "over",
    ending: run.ending === "all" ? "win" : "stop",
  });
  useReportRunProgress(live, onStop);

  const submit = useCallback(
    (word: string) => {
      if (!live || !word) return;
      const result = attempt(run, word);
      setTyped("");
      if (result.kind === "word") {
        const word = puzzle.words[result.id]!;
        const gained = wordPoints(puzzle, word);
        setNotice({
          text: usesAllSeven(puzzle, word)
            ? t("All seven! +{n}", { n: points(gained) })
            : t("+{n}", { n: points(gained) }),
          good: true,
        });
        onFind(result.id);
        return;
      }
      const why: Record<typeof result.kind, string> = {
        short: t("Too short: four letters at least."),
        centre: t("Every word needs the centre letter."),
        letters: t("Only these seven letters."),
        unknown: t("Not in the word list."),
        found: t("Already found."),
      };
      setNotice({ text: why[result.kind], good: false });
    },
    [live, run, puzzle, onFind],
  );
  const enter = useCallback(() => submit(typed), [submit, typed]);

  const add = useCallback(
    (letter: string) => {
      if (!live) return;
      setNotice(null);
      setTyped((current) => (current.length < 19 ? current + letter : current));
    },
    [live],
  );

  // A physical keyboard types too.
  const enterRef = useRef(enter);
  enterRef.current = enter;
  useEffect(() => {
    if (!live) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        enterRef.current();
      } else if (event.key === "Backspace") {
        setTyped((current) => current.slice(0, -1));
      } else if (/^[a-z]$/i.test(event.key)) {
        add(event.key.toLowerCase());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, add]);

  // Swiping: press a letter and drag across the others, then let go to enter the
  // word. A press that never reaches another letter is a tap and adds its letter.
  // The hive keeps the pointer for the whole gesture, so a swipe that strays off
  // it still ends cleanly; a cell's own click only answers the keyboard.
  const cells = [
    { letter: centre, x: 50, y: 50 },
    ...outer.map((letter, i) => ({ letter, x: SPOTS[i]![0], y: SPOTS[i]![1] })),
  ];
  const trace = useRef<Trace | null>(null);
  const [traced, setTraced] = useState<readonly string[]>([]);

  function hiveLetter(event: ReactPointerEvent<HTMLDivElement>): string | null {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return letterNear(
      cells,
      ((event.clientX - box.left) / box.width) * 100,
      ((event.clientY - box.top) / box.height) * 100,
    );
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!live || (event.pointerType === "mouse" && event.button !== 0)) return;
    const letter = (event.target as HTMLElement).closest<HTMLElement>("[data-letter]")?.dataset[
      "letter"
    ];
    if (!letter) return;
    event.preventDefault();
    trace.current = { pointer: event.pointerId, letters: [letter], swiped: false };
    setTraced([letter]);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Capture is a nicety: without it a swipe still works while it stays on the hive.
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = trace.current;
    if (!current || current.pointer !== event.pointerId) return;
    const letter = hiveLetter(event);
    // The same cell again is the pointer resting on it: a doubled letter is a tap.
    if (!letter || letter === current.letters[current.letters.length - 1]) return;
    current.letters.push(letter);
    if (!current.swiped) {
      current.swiped = true;
      setNotice(null);
    }
    // A swipe is a whole word: it replaces whatever was tapped in before it.
    setTyped(current.letters.join("").slice(0, 19));
    setTraced([...current.letters]);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const current = trace.current;
    if (!current || current.pointer !== event.pointerId) return;
    trace.current = null;
    setTraced([]);
    if (current.swiped) submit(current.letters.join("").slice(0, 19));
    else add(current.letters[0]!);
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const current = trace.current;
    if (!current || current.pointer !== event.pointerId) return;
    trace.current = null;
    setTraced([]);
    if (current.swiped) setTyped("");
  }

  function shuffle() {
    setOuter((current) => {
      const next = [...current];
      for (let i = next.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j]!, next[i]!];
      }
      return next;
    });
  }

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2 text-xs text-muted-foreground">
        <span className="tabular">{points(score)}</span>
        {ranked}
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col gap-3 pt-1">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">{t(RANKS[rank]!.name)}</span>
            <span className="text-muted-foreground tabular">{wordCount(run.found.length)}</span>
          </div>
          <div className="flex gap-1" aria-hidden>
            {RANKS.map((r, i) => (
              <span
                key={r.name}
                className={cn(
                  "h-1.5 flex-1 rounded-full",
                  i <= rank ? "bg-primary" : "bg-surface-2",
                )}
              />
            ))}
          </div>
          <p className="sr-only">
            {t("{score} of {max} points", { score: points(score), max: points(max) })}
          </p>
        </div>

        <p
          className="flex h-10 items-center justify-center text-2xl font-bold tracking-wide uppercase"
          aria-live="polite"
          aria-label={t("Your word")}
        >
          {typed ? (
            [...typed].map((ch, i) => (
              <span
                key={i}
                className={cn(
                  ch === centre && "text-primary",
                  !puzzle.letters.includes(ch) && "text-muted-foreground/40",
                )}
              >
                {ch}
              </span>
            ))
          ) : (
            <span className="h-7 w-0.5 animate-pulse bg-foreground/60" />
          )}
        </p>

        <div
          className="relative mx-auto aspect-square w-full max-w-[17rem] touch-none select-none"
          role="group"
          aria-label={t("Letters")}
          aria-description={t("Tap the letters, or swipe across them and let go to enter a word.")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <Cell
            letter={centre}
            centre
            x={50}
            y={50}
            disabled={!live}
            traced={traced.includes(centre)}
            onPress={add}
          />
          {outer.map((letter, i) => (
            <Cell
              key={letter}
              letter={letter}
              x={SPOTS[i]![0]}
              y={SPOTS[i]![1]}
              disabled={!live}
              traced={traced.includes(letter)}
              onPress={add}
            />
          ))}
        </div>

        <p
          className={cn(
            "min-h-5 text-center text-sm font-medium",
            notice?.good ? "text-primary" : "text-foreground",
          )}
          aria-live="polite"
        >
          {verifying ? t("Verifying your run with the server…") : notice?.text}
        </p>

        {live && (
          <div className="flex justify-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setTyped((current) => current.slice(0, -1))}
              aria-label={t("Delete")}
            >
              <Delete className="size-4" />
            </Button>
            <Button variant="secondary" onClick={shuffle} aria-label={t("Shuffle")}>
              <Shuffle className="size-4" />
            </Button>
            <Button variant="play" onClick={enter} disabled={!typed}>
              {t("Enter")}
            </Button>
          </div>
        )}

        <WordList run={run} />

        {live && run.found.length > 0 && (
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" onClick={onStop}>
              {t("I'm done ({points})", { points: points(score) })}
            </Button>
          </div>
        )}
        <p className="text-center text-xs text-muted-foreground">
          {t("Royal at {n} points.", {
            n: points(Math.ceil((max * RANKS[RANKS.length - 1]!.at) / 100)),
          })}
        </p>
      </div>
    </div>
  );
}

function Cell({
  letter,
  centre = false,
  x,
  y,
  disabled,
  traced = false,
  onPress,
}: {
  letter: string;
  centre?: boolean;
  x: number;
  y: number;
  disabled: boolean;
  /** Crossed by the swipe in progress. */
  traced?: boolean;
  onPress: (letter: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      data-letter={letter}
      // A press of the pointer is the hive's (a tap or a swipe); this click is the
      // keyboard's, whose clicks carry no count.
      onClick={(event) => {
        if (event.detail === 0) onPress(letter);
      }}
      aria-label={letter.toUpperCase()}
      className={cn(
        "absolute flex size-[32%] -translate-x-1/2 -translate-y-1/2 items-center justify-center text-2xl font-bold uppercase transition-transform active:scale-95 motion-reduce:transition-none",
        "[clip-path:polygon(25%_5%,75%_5%,100%_50%,75%_95%,25%_95%,0%_50%)]",
        centre ? "bg-primary text-primary-foreground" : "bg-surface-2 hover:bg-surface",
        traced && "scale-95 brightness-110",
        traced && !centre && "bg-primary/30",
      )}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      {letter}
    </button>
  );
}
