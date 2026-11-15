import { ArrowDownUp, Check, History } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { DailyFrame, DailyResult, RankChip } from "@/components/game/DailyShell";
import { Button } from "@/components/ui/button";
import { useDailyRun, type DailyEngine } from "@/lib/games/daily-run";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import type { DailyShare } from "@/lib/games/share";
import {
  createRun,
  decode,
  encode,
  EVENTS,
  MAX_TRIES,
  placedCount,
  puzzleOf,
  refusal,
  scoreOf,
  startOrder,
  stop,
  submission,
  submit,
  THEN_AND_NOW_RULES_VERSION,
  yearLabel,
  type ThenAndNowRun,
} from "@/lib/games/then-and-now";
import { points } from "@/lib/format";
import { useGameSounds } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

const RULES = GAME_RULES["then-and-now"];

const ENGINE: DailyEngine<ThenAndNowRun> = {
  rulesVersion: THEN_AND_NOW_RULES_VERSION,
  create: (session) => createRun(session.seed, session.rulesVersion),
  over: (run) => run.outcome !== "playing",
  submission,
};

/** Then & Now, playing for real: six events, put in the order they happened. */
export function ThenAndNowRuntime({
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
  const onSubmit = useCallback((code: number) => play((r) => submit(r, code)), [play]);
  const onStop = useCallback(() => play(stop), [play]);
  return (
    <DailyFrame
      state={state}
      slug={slug}
      title={title}
      rules={RULES}
      icon={<History className="size-5 text-muted-foreground" />}
      playLabel={t("Play today's timeline")}
      loadingLabel={t("Fetching today's timeline…")}
      doneTitle={t("You've played today's timeline")}
      board={(session, run, verifying) => (
        <Board
          key={session.id}
          run={run}
          verifying={verifying}
          ranked={<RankChip session={session} />}
          onSubmit={onSubmit}
          onStop={onStop}
        />
      )}
      finished={(run, result) => (
        <DailyResult
          slug={slug}
          result={result}
          headline={headlineFor(run)}
          stats={[
            { label: t("In place"), value: `${placedCount(run)}/${EVENTS}` },
            { label: t("Tries"), value: `${run.tries.length}/${MAX_TRIES}` },
          ]}
          share={thenAndNowShare(run)}
        >
          <ol className="mx-auto flex w-full max-w-sm flex-col gap-1.5 text-left text-sm">
            {puzzleOf(run).events.map((event, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-xl px-3 py-2",
                  run.locked[i] ? "bg-emerald-500/15" : "bg-surface",
                )}
              >
                <span>{t(event.text)}</span>
                <span className="shrink-0 font-semibold tabular">{yearLabel(event.year)}</span>
              </li>
            ))}
          </ol>
        </DailyResult>
      )}
    />
  );
}

function headlineFor(run: ThenAndNowRun): string {
  if (run.ending === "solved") {
    return run.tries.length === 1
      ? t("Perfect timeline!")
      : t("In order in {n} tries", { n: run.tries.length });
  }
  return t("{n} of 6 in place", { n: placedCount(run) });
}

/** One row per try: a green square for each event in place. */
function thenAndNowShare(run: ThenAndNowRun): DailyShare {
  return {
    day: run.day,
    result: run.ending === "solved" ? `${run.tries.length}/${MAX_TRIES}` : `X/${MAX_TRIES}`,
    grid:
      run.tries
        .map((code) =>
          decode(code)!
            .map((id, p) => (id === p ? "🟩" : "⬜"))
            .join(""),
        )
        .join("\n") || "—",
  };
}

function Board({
  run,
  verifying,
  ranked,
  onSubmit,
  onStop,
}: {
  run: ThenAndNowRun;
  verifying: boolean;
  ranked: ReactNode;
  onSubmit: (code: number) => void;
  onStop: () => void;
}) {
  const puzzle = puzzleOf(run);
  const [order, setOrder] = useState(() => startOrder(run.day));
  const [picked, setPicked] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const live = !verifying && run.outcome === "playing";

  useGameSounds({
    moves: run.tries.length,
    score: scoreOf(run),
    over: run.outcome === "over",
    ending: run.ending === "solved" ? "win" : run.ending === "out" ? "lose" : "stop",
  });
  useReportRunProgress(live, onStop);

  function tap(place: number) {
    if (!live || run.locked[place]) return;
    setNotice(null);
    if (picked === null) {
      setPicked(place);
      return;
    }
    if (picked !== place) {
      setOrder((current) => {
        const next = [...current];
        [next[picked], next[place]] = [next[place]!, next[picked]!];
        return next;
      });
    }
    setPicked(null);
  }

  function send() {
    if (!live) return;
    const code = encode(order);
    if (refusal(run, code) === "repeat") {
      setNotice(t("You've already tried that order."));
      return;
    }
    if (refusal(run, code) !== null) return;
    const placed = order.filter((id, p) => id === p).length;
    setPicked(null);
    setNotice(placed === EVENTS ? null : t("{n} of 6 in place. Swap the rest.", { n: placed }));
    onSubmit(code);
  }

  const triesLeft = MAX_TRIES - run.tries.length;

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2 text-xs text-muted-foreground">
        <span className="tabular">{points(scoreOf(run))}</span>
        {ranked}
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col gap-3 pt-1">
        <div className="text-center">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("Today's theme")}
          </p>
          <h2 className="text-xl font-semibold">{t(puzzle.theme)}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Tap two events to swap them. Oldest at the top.")}
          </p>
        </div>

        <ol className="flex flex-col gap-1.5" aria-label={t("Timeline")}>
          {order.map((id, place) => {
            const event = puzzle.events[id]!;
            const locked = run.locked[place]!;
            return (
              <li key={id} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right text-xs font-semibold text-muted-foreground tabular">
                  {place + 1}
                </span>
                <button
                  type="button"
                  aria-pressed={picked === place}
                  aria-disabled={!live || locked}
                  onClick={() => tap(place)}
                  className={cn(
                    "flex min-h-12 flex-1 items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors motion-reduce:transition-none",
                    locked
                      ? "cursor-default bg-emerald-500/20 text-foreground"
                      : picked === place
                        ? "bg-foreground text-background"
                        : "bg-surface-2 hover:bg-surface",
                  )}
                >
                  <span>{t(event.text)}</span>
                  {locked ? (
                    <span className="flex shrink-0 items-center gap-1 font-semibold tabular">
                      <Check className="size-4 text-emerald-500" />
                      {yearLabel(event.year)}
                    </span>
                  ) : (
                    picked === place && <ArrowDownUp className="size-4 shrink-0" />
                  )}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <span>{t("Tries left:")}</span>
          <span className="flex gap-1" aria-label={t("{n} tries left", { n: triesLeft })}>
            {Array.from({ length: MAX_TRIES }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "size-3 rounded-full",
                  i < triesLeft ? "bg-foreground/70" : "bg-foreground/15",
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
            <Button variant="play" onClick={send}>
              {t("Submit order")}
            </Button>
            {run.tries.length > 0 && (
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
