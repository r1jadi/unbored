import { Delete, Hexagon, Shuffle } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

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
            { label: t("Points"), value: `${scoreOf(run)}/${maxScore(puzzleOf(run))}` },
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

  const enter = useCallback(() => {
    if (!live || !typed) return;
    const result = attempt(run, typed);
    setTyped("");
    if (result.kind === "word") {
      const word = puzzle.words[result.id]!;
      const gained = wordPoints(puzzle, word);
      setNotice({
        text: usesAllSeven(puzzle, word)
          ? t("All seven! +{n}", { n: gained })
          : t("+{n}", { n: gained }),
        good: true,
      });
      onFind(result.id);
      return;
    }
    const why: Record<typeof result.kind, string> = {
      short: t("Too short: four letters at least."),
      centre: t("Every word needs the centre letter."),
      letters: t("Only today's seven letters."),
      unknown: t("Not in the word list."),
      found: t("Already found."),
    };
    setNotice({ text: why[result.kind], good: false });
  }, [live, typed, run, puzzle, onFind]);

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
          <p className="sr-only">{t("{score} of {max} points", { score, max })}</p>
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
          className="relative mx-auto aspect-square w-full max-w-[17rem]"
          role="group"
          aria-label={t("Letters")}
        >
          <Cell letter={centre} centre x={50} y={50} disabled={!live} onPress={add} />
          {outer.map((letter, i) => (
            <Cell
              key={letter}
              letter={letter}
              x={SPOTS[i]![0]}
              y={SPOTS[i]![1]}
              disabled={!live}
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
          {t("Royal at {n} points.", { n: Math.ceil((max * RANKS[RANKS.length - 1]!.at) / 100) })}
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
  onPress,
}: {
  letter: string;
  centre?: boolean;
  x: number;
  y: number;
  disabled: boolean;
  onPress: (letter: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPress(letter)}
      aria-label={letter.toUpperCase()}
      className={cn(
        "absolute flex size-[32%] -translate-x-1/2 -translate-y-1/2 items-center justify-center text-2xl font-bold uppercase transition-transform active:scale-95 motion-reduce:transition-none",
        "[clip-path:polygon(25%_5%,75%_5%,100%_50%,75%_95%,25%_95%,0%_50%)]",
        centre ? "bg-primary text-primary-foreground" : "bg-surface-2 hover:bg-surface",
      )}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      {letter}
    </button>
  );
}
