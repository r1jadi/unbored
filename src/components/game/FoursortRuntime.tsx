import { LayoutGrid, Shuffle } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { DailyFrame, DailyResult, RankChip } from "@/components/game/DailyShell";
import { Button } from "@/components/ui/button";
import { useDailyRun, type DailyEngine } from "@/lib/games/daily-run";
import {
  bestOverlap,
  boardOrder,
  createRun,
  FOURSORT_RULES_VERSION,
  GROUP_SIZE,
  groupMask,
  groupOfMask,
  GROUPS,
  guess,
  idsOf,
  MAX_MISTAKES,
  maskOf,
  puzzleOf,
  refusal,
  scoreOf,
  stop,
  submission,
  wordOf,
  type FoursortRun,
} from "@/lib/games/foursort";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import type { DailyShare } from "@/lib/games/share";
import { points } from "@/lib/format";
import { useGameSounds } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

const RULES = GAME_RULES.foursort;

/** A group's colour, easiest to hardest. */
const TONES = [
  "bg-amber-300 text-amber-950",
  "bg-emerald-400 text-emerald-950",
  "bg-sky-400 text-sky-950",
  "bg-violet-400 text-violet-950",
] as const;
const SQUARES = ["🟨", "🟩", "🟦", "🟪"] as const;

const ENGINE: DailyEngine<FoursortRun> = {
  rulesVersion: FOURSORT_RULES_VERSION,
  create: (session) => createRun(session.seed, session.rulesVersion),
  over: (run) => run.outcome !== "playing",
  submission,
};

/** Foursort, playing for real: sixteen words, four hidden groups. */
export function FoursortRuntime({
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
  const onGuess = useCallback((mask: number) => play((r) => guess(r, mask)), [play]);
  const onStop = useCallback(() => play(stop), [play]);
  return (
    <DailyFrame
      state={state}
      slug={slug}
      title={title}
      rules={RULES}
      icon={<LayoutGrid className="size-5 text-muted-foreground" />}
      playLabel={t("Play today's words")}
      loadingLabel={t("Fetching today's words…")}
      doneTitle={t("You've played today's words")}
      board={(session, run, verifying) => (
        <Board
          key={session.id}
          run={run}
          verifying={verifying}
          ranked={<RankChip session={session} />}
          onGuess={onGuess}
          onStop={onStop}
        />
      )}
      finished={(run, result) => (
        <DailyResult
          slug={slug}
          result={result}
          headline={headlineFor(run)}
          stats={[
            { label: t("Groups"), value: `${run.found.length}/${GROUPS}` },
            { label: t("Mistakes"), value: `${run.mistakes}/${MAX_MISTAKES}` },
          ]}
          share={foursortShare(run)}
        >
          <div className="mx-auto flex w-full max-w-sm flex-col gap-1.5">
            {Array.from({ length: GROUPS }, (_, g) => (
              <GroupBar key={g} run={run} group={g} dim={!run.found.includes(g)} />
            ))}
          </div>
        </DailyResult>
      )}
    />
  );
}

function headlineFor(run: FoursortRun): string {
  if (run.ending === "solved") {
    return run.mistakes === 0
      ? t("Perfect sort!")
      : run.mistakes === 1
        ? t("Sorted with 1 mistake")
        : t("Sorted with {n} mistakes", { n: run.mistakes });
  }
  return t("{n} of 4 groups found", { n: run.found.length });
}

/** One row per guess: each word's square in its group's colour. */
function foursortShare(run: FoursortRun): DailyShare {
  return {
    day: run.day,
    result: run.ending === "solved" ? `${run.mistakes}/${MAX_MISTAKES}` : `X/${MAX_MISTAKES}`,
    grid:
      run.guesses
        .map((mask) =>
          idsOf(mask)
            .map((id) => SQUARES[Math.floor(id / GROUP_SIZE)])
            .join(""),
        )
        .join("\n") || "—",
  };
}

function GroupBar({ run, group, dim = false }: { run: FoursortRun; group: number; dim?: boolean }) {
  const g = puzzleOf(run).groups[group]!;
  return (
    <div
      className={cn(
        "enter flex flex-col items-center justify-center rounded-xl px-3 py-2 text-center",
        TONES[group],
        dim && "opacity-45",
      )}
    >
      <p className="text-sm font-bold uppercase tracking-wide">{g.title}</p>
      <p className="text-sm">{g.words.join(", ")}</p>
    </div>
  );
}

function Board({
  run,
  verifying,
  ranked,
  onGuess,
  onStop,
}: {
  run: FoursortRun;
  verifying: boolean;
  ranked: ReactNode;
  onGuess: (mask: number) => void;
  onStop: () => void;
}) {
  const puzzle = puzzleOf(run);
  const [order, setOrder] = useState(() => boardOrder(run.day));
  const [picked, setPicked] = useState<number[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const live = !verifying && run.outcome === "playing";

  const taken = useMemo(() => new Set(run.found.flatMap((g) => idsOf(groupMask(g)))), [run.found]);
  const left = order.filter((id) => !taken.has(id));

  useGameSounds({
    moves: run.guesses.length,
    score: scoreOf(run),
    over: run.outcome === "over",
    ending: run.ending === "solved" ? "win" : run.ending === "out" ? "lose" : "stop",
  });
  useReportRunProgress(live, onStop);

  function toggle(id: number) {
    if (!live) return;
    setNotice(null);
    setPicked((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length < GROUP_SIZE
          ? [...current, id]
          : current,
    );
  }

  function submit() {
    if (!live || picked.length !== GROUP_SIZE) return;
    const mask = maskOf(picked);
    const why = refusal(run, mask);
    if (why === "repeat") {
      setNotice(t("You've already tried those four."));
      return;
    }
    if (why) return;
    if (groupOfMask(mask) >= 0) {
      setPicked([]);
      setNotice(null);
    } else {
      setShake((n) => n + 1);
      setNotice(bestOverlap(mask) === 3 ? t("One away…") : t("Not a group."));
    }
    onGuess(mask);
  }

  function shuffle() {
    setOrder((current) => {
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
        <span className="tabular">{points(scoreOf(run))}</span>
        {ranked}
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col gap-3 pt-2">
        <p className="text-center text-sm text-muted-foreground">
          {t("Make four groups of four.")}
        </p>

        <div className="flex flex-col gap-1.5">
          {run.found.map((g) => (
            <GroupBar key={g} run={run} group={g} />
          ))}
        </div>

        {left.length > 0 && (
          <div
            key={shake}
            className={cn("grid grid-cols-4 gap-1.5", shake > 0 && "shake")}
            role="group"
            aria-label={t("Words")}
          >
            {left.map((id) => {
              const on = picked.includes(id);
              const word = wordOf(puzzle, id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  disabled={!live}
                  onClick={() => toggle(id)}
                  className={cn(
                    "flex aspect-[5/4] items-center justify-center rounded-xl p-1 text-center font-semibold uppercase leading-tight transition-colors motion-reduce:transition-none",
                    word.length > 9 ? "text-[0.6rem] sm:text-xs" : "text-xs sm:text-sm",
                    on ? "bg-foreground text-background" : "bg-surface-2 hover:bg-surface",
                  )}
                >
                  <span className="break-words [overflow-wrap:anywhere]">{word}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <span>{t("Mistakes left:")}</span>
          <span
            className="flex gap-1"
            aria-label={t("{n} mistakes left", { n: MAX_MISTAKES - run.mistakes })}
          >
            {Array.from({ length: MAX_MISTAKES }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "size-3 rounded-full",
                  i < MAX_MISTAKES - run.mistakes ? "bg-foreground/70" : "bg-foreground/15",
                )}
              />
            ))}
          </span>
        </div>

        <p className="min-h-5 text-center text-sm font-medium" aria-live="polite">
          {verifying ? t("Verifying your run with the server…") : notice}
        </p>

        {live && (
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={shuffle} aria-label={t("Shuffle")}>
              <Shuffle className="size-4" />
              {t("Shuffle")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPicked([])}
              disabled={picked.length === 0}
            >
              {t("Deselect all")}
            </Button>
            <Button variant="play" onClick={submit} disabled={picked.length !== GROUP_SIZE}>
              {t("Submit")}
            </Button>
          </div>
        )}

        {live && run.guesses.length > 0 && (
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" onClick={onStop}>
              {t("Stop here ({points})", { points: points(scoreOf(run)) })}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
