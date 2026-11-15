import { ArrowDown, ArrowUp, Check, Tag } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { DailyFrame, DailyResult, RankChip } from "@/components/game/DailyShell";
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
import {
  BALLPARK_RULES_VERSION,
  closeness,
  createRun,
  direction,
  dollars,
  giveUp,
  guess,
  MAX_GUESSES,
  parsePrice,
  productOf,
  submission,
  type BallparkRun,
} from "@/lib/games/ballpark";
import { useDailyRun, type DailyEngine } from "@/lib/games/daily-run";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import type { DailyShare } from "@/lib/games/share";
import { useGameSounds } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

const RULES = GAME_RULES["ballpark"];

const ENGINE: DailyEngine<BallparkRun> = {
  rulesVersion: BALLPARK_RULES_VERSION,
  create: (session) => createRun(session.seed, session.rulesVersion),
  over: (run) => run.outcome !== "playing",
  submission,
};

/** Ballpark, playing for real: six guesses at the day's price. */
export function BallparkRuntime({
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
  const onGuess = useCallback((cents: number) => play((r) => guess(r, cents)), [play]);
  const onGiveUp = useCallback(() => play(giveUp), [play]);
  return (
    <DailyFrame
      state={state}
      slug={slug}
      title={title}
      rules={RULES}
      icon={<Tag className="size-5 text-muted-foreground" />}
      playLabel={t("Play today's product")}
      loadingLabel={t("Fetching today's product…")}
      doneTitle={t("You've played today's product")}
      board={(session, run, verifying) => (
        <Board
          key={session.id}
          run={run}
          verifying={verifying}
          ranked={<RankChip session={session} />}
          onGuess={onGuess}
          onGiveUp={onGiveUp}
        />
      )}
      finished={(run, result) => {
        const product = productOf(run);
        return (
          <DailyResult
            slug={slug}
            result={result}
            headline={
              run.ending === "solved"
                ? t("Within 5% in {n} of {max}", { n: run.guesses.length, max: MAX_GUESSES })
                : t("The price was")
            }
            stats={[
              { label: t("Price"), value: dollars(product.cents) },
              { label: t("Guesses"), value: `${run.guesses.length}/${MAX_GUESSES}` },
            ]}
            share={ballparkShare(run)}
          >
            <ProductCard run={run} />
            <GuessList run={run} />
          </DailyResult>
        );
      }}
    />
  );
}

/** One square per guess: green within 5%, amber within 25%, grey further, with its arrow. */
function ballparkShare(run: BallparkRun): DailyShare {
  const price = productOf(run).cents;
  const rows = run.guesses.map((g) => {
    const near = closeness(g, price);
    const way = direction(g, price);
    return `${near === "hit" ? "🟩" : near === "close" ? "🟨" : "⬜"}${
      way === "higher" ? "⬆️" : way === "lower" ? "⬇️" : "✅"
    }`;
  });
  return {
    day: run.day,
    result: run.ending === "solved" ? `${run.guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`,
    grid: rows.join("\n") || "—",
  };
}

function ProductCard({ run }: { run: BallparkRun }) {
  const product = productOf(run);
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-1 rounded-2xl bg-surface p-4 text-center">
      <span className="text-6xl leading-none" aria-hidden>
        {product.emoji}
      </span>
      <h2 className="pt-2 text-lg font-semibold">{t(product.name)}</h2>
      <p className="text-sm text-muted-foreground">{t(product.detail)}</p>
    </div>
  );
}

function GuessList({ run }: { run: BallparkRun }) {
  const price = productOf(run).cents;
  return (
    <ol className="mx-auto flex w-full max-w-sm flex-col gap-1.5" aria-label={t("Guesses")}>
      {Array.from({ length: MAX_GUESSES }, (_, i) => {
        const g = run.guesses[i];
        if (g === undefined) {
          return (
            <li
              key={i}
              className="h-11 rounded-xl border-2 border-dashed border-foreground/10"
              aria-hidden
            />
          );
        }
        const near = closeness(g, price);
        const way = direction(g, price);
        return (
          <li
            key={i}
            className={cn(
              "flex h-11 items-center justify-between rounded-xl px-4 text-sm font-semibold tabular",
              near === "hit" && "bg-primary text-primary-foreground",
              near === "close" && "bg-amber-400/25 text-foreground ring-2 ring-amber-500/60",
              near === "far" && "bg-surface-2 text-foreground",
            )}
            aria-label={t("{price}: {verdict}", {
              price: dollars(g),
              verdict:
                near === "hit"
                  ? t("within 5%")
                  : `${way === "higher" ? t("higher") : t("lower")}${near === "close" ? `, ${t("within 25%")}` : ""}`,
            })}
          >
            <span>{dollars(g)}</span>
            <span className="inline-flex items-center gap-1 text-xs font-medium">
              {near === "close" && <span>{t("Near")}</span>}
              {way === "higher" && <ArrowUp className="size-4" />}
              {way === "lower" && <ArrowDown className="size-4" />}
              {way === null && <Check className="size-4" />}
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
  onGuess,
  onGiveUp,
}: {
  run: BallparkRun;
  verifying: boolean;
  ranked: ReactNode;
  onGuess: (cents: number) => void;
  onGiveUp: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const live = !verifying && run.outcome === "playing";

  useGameSounds({
    moves: run.guesses.length,
    score: 0,
    over: run.outcome === "over",
    ending: run.ending === "solved" ? "win" : "stop",
  });
  useReportRunProgress(live, onGiveUp);

  function submit() {
    if (!live) return;
    const cents = parsePrice(typed);
    if (cents === null) {
      setNotice(t("Type a price, like 4.99."));
      return;
    }
    setTyped("");
    setNotice(null);
    onGuess(cents);
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2 text-xs text-muted-foreground">
        <span className="tabular">
          {t("Guess {n} of {max}", {
            n: Math.min(run.guesses.length + 1, MAX_GUESSES),
            max: MAX_GUESSES,
          })}
        </span>
        {ranked}
      </div>

      <div className="mx-auto flex w-full max-w-sm flex-col gap-3 pt-1">
        <ProductCard run={run} />
        <GuessList run={run} />

        {live && (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="flex h-12 min-w-0 flex-1 items-center rounded-xl border border-input bg-surface px-3 focus-within:ring-2 focus-within:ring-ring">
              <span className="pr-1 text-muted-foreground">$</span>
              <input
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setNotice(null);
                }}
                inputMode="decimal"
                placeholder="0.00"
                aria-label={t("Your guess, in dollars")}
                autoComplete="off"
                autoFocus
                className="h-full min-w-0 flex-1 bg-transparent text-base tabular outline-none"
              />
            </div>
            <Button type="submit" variant="play" size="lg" disabled={!typed.trim()}>
              {t("Guess")}
            </Button>
          </form>
        )}

        <p className="min-h-5 text-center text-sm text-muted-foreground" aria-live="polite">
          {verifying
            ? t("Verifying your run with the server…")
            : (notice ??
              (run.guesses.length === 0
                ? t("Within 5% wins. Amber means within 25%.")
                : t("{n} left.", { n: MAX_GUESSES - run.guesses.length })))}
        </p>

        <div className="flex justify-center">
          <Button variant="ghost" size="sm" disabled={!live} onClick={() => setConfirming(true)}>
            {t("Give up")}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Give up today's product?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("The price is shown and the run scores nothing. There is one play a day.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Keep guessing")}</AlertDialogCancel>
            <AlertDialogAction onClick={onGiveUp}>{t("Give up")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
