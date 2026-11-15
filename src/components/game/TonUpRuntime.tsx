import { Target } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { DailyFrame, DailyResult, RankChip } from "@/components/game/DailyShell";
import { Button } from "@/components/ui/button";
import { useDailyRun, type DailyEngine } from "@/lib/games/daily-run";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import type { DailyShare } from "@/lib/games/share";
import {
  categoryOf,
  createRun,
  MAX_DARTS,
  refusal,
  scoreOf,
  stand,
  submission,
  suggestions,
  TARGET,
  throwDart,
  TON_UP_RULES_VERSION,
  type TonUpRun,
} from "@/lib/games/ton-up";
import { points } from "@/lib/format";
import { useGameSounds } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

const RULES = GAME_RULES["ton-up"];

const ENGINE: DailyEngine<TonUpRun> = {
  rulesVersion: TON_UP_RULES_VERSION,
  create: (session) => createRun(session.seed, session.rulesVersion),
  over: (run) => run.outcome !== "playing",
  submission,
};

/** Ton Up, playing for real: three darts at exactly one hundred. */
export function TonUpRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  autoStart?: boolean;
}) {
  const state = useDailyRun(slug, ENGINE, autoStart);
  // Stable, as `useReportRunProgress` needs: `play` never changes.
  const { play } = state;
  const onThrow = useCallback((index: number) => play((r) => throwDart(r, index)), [play]);
  const onStand = useCallback(() => play(stand), [play]);
  return (
    <DailyFrame
      state={state}
      slug={slug}
      title={title}
      rules={RULES}
      icon={<Target className="size-5 text-muted-foreground" />}
      playLabel={t("Play today's category")}
      loadingLabel={t("Fetching today's category…")}
      doneTitle={t("You've played today's category")}
      board={(session, run, verifying) => (
        <Board
          key={session.id}
          run={run}
          verifying={verifying}
          ranked={<RankChip session={session} />}
          onThrow={onThrow}
          onStand={onStand}
        />
      )}
      finished={(run, result) => (
        <DailyResult
          slug={slug}
          result={result}
          headline={headlineFor(run)}
          stats={[
            { label: t("Total"), value: run.total },
            { label: t("Darts"), value: `${run.darts.length}/${MAX_DARTS}` },
          ]}
          share={tonUpShare(run)}
        >
          <DartList run={run} />
        </DailyResult>
      )}
    />
  );
}

function headlineFor(run: TonUpRun): string {
  if (run.ending === "ton") return t("A ton in {n}!", { n: run.darts.length });
  if (run.ending === "bust") return t("Bust on {total}", { total: run.total });
  return t("Stood on {total}", { total: run.total });
}

/** One row per dart: 🎯 for each that counted, 💥 for the one that busted. */
function tonUpShare(run: TonUpRun): DailyShare {
  const marks = run.darts.map((_, i) =>
    run.ending === "bust" && i === run.darts.length - 1 ? "💥" : "🎯",
  );
  return {
    day: run.day,
    result: run.ending === "bust" ? t("Bust") : `${run.total}/${TARGET}`,
    grid: marks.join("") || "—",
  };
}

function DartList({ run }: { run: TonUpRun }) {
  const category = categoryOf(run);
  let total = 0;
  return (
    <ol className="mx-auto flex w-full max-w-xs flex-col gap-1.5 text-sm">
      {run.darts.map((index, i) => {
        const answer = category.answers[index]!;
        total += answer.value;
        return (
          <li
            key={index}
            className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2"
          >
            <span className="truncate text-left">{answer.name}</span>
            <span className="shrink-0 tabular text-muted-foreground">
              +{answer.value} = <span className="font-semibold text-foreground">{total}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Board({
  run,
  verifying,
  ranked,
  onThrow,
  onStand,
}: {
  run: TonUpRun;
  verifying: boolean;
  ranked: ReactNode;
  onThrow: (index: number) => void;
  onStand: () => void;
}) {
  const category = categoryOf(run);
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const live = !verifying && run.outcome === "playing";
  const options = useMemo(() => suggestions(category, typed), [category, typed]);

  useGameSounds({
    moves: run.darts.length,
    score: run.total,
    over: run.outcome === "over",
    ending: run.ending === "ton" ? "win" : run.ending === "bust" ? "lose" : "stop",
  });
  useReportRunProgress(live, onStand);

  function pick(index: number) {
    if (!live) return;
    const why = refusal(run, index);
    if (why === "used") {
      setNotice(t("You've already thrown {name}.", { name: category.answers[index]!.name }));
      return;
    }
    if (why) return;
    setTyped("");
    setNotice(null);
    onThrow(index);
    input.current?.focus();
  }

  const left = TARGET - run.total;
  const pct = Math.min(100, Math.max(0, (run.total / TARGET) * 100));

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2 text-xs text-muted-foreground">
        <span className="tabular">
          {t("Dart {n} of {max}", { n: Math.min(run.darts.length + 1, MAX_DARTS), max: MAX_DARTS })}
        </span>
        {ranked}
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col gap-4 pt-2">
        <div className="text-center">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("Today's category")}
          </p>
          <h2 className="text-xl font-semibold">{t(category.title)}</h2>
          <p className="text-xs text-muted-foreground">{t(category.source)}</p>
        </div>

        <div className="flex flex-col items-center gap-2">
          <p
            className={cn(
              "text-6xl font-semibold tabular",
              run.total > TARGET && "text-destructive",
              run.total === TARGET && "text-primary",
            )}
            aria-live="polite"
          >
            {run.total}
          </p>
          <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn(
                "h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none",
                run.total > TARGET && "bg-destructive",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {run.total > TARGET
              ? t("Bust!")
              : run.total === TARGET
                ? t("A ton!")
                : t("{n} to go", { n: left })}
          </p>
        </div>

        <ol className="grid grid-cols-3 gap-2" aria-label={t("Darts")}>
          {Array.from({ length: MAX_DARTS }, (_, i) => {
            const index = run.darts[i];
            const answer = index === undefined ? null : category.answers[index]!;
            return (
              <li
                key={i}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center rounded-xl border-2 border-dashed border-foreground/15 p-2 text-center",
                  answer && "border-solid border-primary/40 bg-surface",
                )}
              >
                {answer ? (
                  <>
                    <span className="line-clamp-2 text-xs">{answer.name}</span>
                    <span className="text-lg font-semibold tabular">+{answer.value}</span>
                  </>
                ) : (
                  <Target className="size-5 text-muted-foreground/40" />
                )}
              </li>
            );
          })}
        </ol>

        {live && (
          <div className="flex flex-col gap-2">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (options[0]) pick(options[0].index);
              }}
            >
              <input
                ref={input}
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setNotice(null);
                }}
                placeholder={t("Type an answer…")}
                aria-label={t("Your answer")}
                autoComplete="off"
                autoCapitalize="words"
                autoFocus
                className="h-12 min-w-0 flex-1 rounded-xl border border-input bg-surface px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" variant="play" size="lg" disabled={options.length === 0}>
                {t("Throw")}
              </Button>
            </form>
            {options.length > 0 && (
              <ul className="flex flex-col gap-1" role="listbox" aria-label={t("Suggestions")}>
                {options.map(({ index, answer }) => {
                  const used = run.darts.includes(index);
                  return (
                    <li key={index}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        disabled={used}
                        onClick={() => pick(index)}
                        className="w-full rounded-lg bg-surface px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-40"
                      >
                        {answer.name}
                        {used && <span className="ml-2 text-xs">{t("(thrown)")}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {typed.trim() && options.length === 0 && (
              <p className="text-center text-sm text-muted-foreground">
                {t("Nothing in today's category matches that.")}
              </p>
            )}
          </div>
        )}

        <p className="min-h-5 text-center text-sm text-muted-foreground" aria-live="polite">
          {verifying ? t("Verifying your run with the server…") : notice}
        </p>

        {live && (
          <div className="flex justify-center">
            <Button variant="secondary" onClick={onStand}>
              {run.darts.length === 0
                ? t("Give up")
                : t("Stand on {total} ({points})", {
                    total: run.total,
                    points: points(scoreOf(run)),
                  })}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
