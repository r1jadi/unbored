import { Link } from "@tanstack/react-router";
import {
  Clock,
  Infinity as InfinityIcon,
  Loader2,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  Trophy,
} from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";

import { ErrorState } from "@/components/common";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { GuestOr } from "@/components/game/GuestOr";
import { GameExits } from "@/components/game/GameExits";
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
import { msUntilLocalMidnight } from "@/lib/games/crossword";
import type { DailyRunControls } from "@/lib/games/daily-run";
import { practiceLabel, offlineResultNote } from "@/lib/games/offline";
import type { GameRules } from "@/lib/games/rules";
import { playErrorMessage, type PlaySession, type RunResult } from "@/lib/games/sessions";
import type { DailyShare } from "@/lib/games/share";
import { points } from "@/lib/format";
import { t } from "@/lib/settings/language";

/**
 * Starts an Unlimited round, for a result screen inside a `DailyFrame` whose game
 * has one; null otherwise.
 */
const UnlimitedRound = createContext<(() => void) | null>(null);

/**
 * The screens every daily game around a `useDailyRun` shares: the rules before a
 * session exists, the wait for it, the two failures, and the frame of the result.
 * Each game brings its own board and its own result body.
 */
export function DailyFrame<R>({
  state,
  slug,
  title,
  rules,
  icon,
  playLabel,
  loadingLabel,
  doneTitle,
  intro,
  board,
  finished,
}: {
  state: DailyRunControls<R>;
  slug: string;
  title: string;
  rules: GameRules;
  icon: ReactNode;
  /** The Start button: "Play today's board". */
  playLabel: string;
  loadingLabel: string;
  /** The heading when today's ranked play is used: "You've played today's board". */
  doneTitle: string;
  /** Anything the rules screen shows above the rules. */
  intro?: ReactNode;
  board: (session: PlaySession, run: R, verifying: boolean) => ReactNode;
  finished: (run: R, result: RunResult) => ReactNode;
}) {
  const playUnlimited = state.unlimited ? () => state.begin("unlimited") : null;

  if (state.status === "intro") {
    return (
      <div className="flex flex-1 flex-col justify-center overflow-y-auto px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="enter mx-auto flex w-full max-w-sm flex-col items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
            {icon}
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">{t(rules.heading)}</h1>
            <p className="text-sm text-muted-foreground">{t(rules.summary)}</p>
          </div>
          {intro}
          <RulesList rules={rules.rules} />
          <div className="flex w-full flex-col gap-2">
            <Button variant="play" size="lg" onClick={() => state.begin()} autoFocus>
              {playLabel}
            </Button>
            {playUnlimited && (
              <Button variant="secondary" size="lg" onClick={playUnlimited}>
                <InfinityIcon />
                {t("Unlimited")}
              </Button>
            )}
            <Button asChild variant="ghost" size="lg">
              <ExitGameLink slug={slug}>{t("Back to {title}", { title })}</ExitGameLink>
            </Button>
          </div>
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            {state.signedIn
              ? playUnlimited
                ? t("Signed in: one ranked play a day. Unlimited is practice.")
                : t("Signed in: one ranked play a day")
              : t("Guest run: verified, but not ranked")}
          </p>
        </div>
      </div>
    );
  }

  if (state.status === "starting") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{loadingLabel}</p>
      </div>
    );
  }

  if (state.status === "error" && state.stage === "start") {
    if (state.error.status === 409) {
      return (
        <div className="flex flex-1 flex-col justify-center gap-4 px-6 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-2">
            <Clock className="size-5 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-semibold">{doneTitle}</h1>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            {playErrorMessage(state.error)}
          </p>
          <p className="mx-auto max-w-sm text-xs text-muted-foreground">{nextDailyIn()}</p>
          <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
            {playUnlimited && (
              <Button variant="play" size="lg" onClick={playUnlimited} autoFocus>
                <InfinityIcon />
                {t("Keep playing: Unlimited")}
              </Button>
            )}
            <Button asChild variant={playUnlimited ? "secondary" : "play"} size="lg">
              <Link to="/leaderboards/$id" params={{ id: slug }}>
                {t("See the leaderboard")}
              </Link>
            </Button>
            <GameExits slug={slug} title={title} />
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-1 flex-col justify-center px-6">
        <ErrorState
          title={t("Couldn't start today's game")}
          body={playErrorMessage(state.error)}
          onRetry={state.retry}
        />
        <GameExits slug={slug} title={title} />
      </div>
    );
  }

  if (state.status === "error" && state.stage === "submit" && state.session) {
    return (
      <div className="flex flex-1 flex-col justify-center gap-4 px-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-2">
          <TriangleAlert className="size-5 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold">{t("Your run was not verified")}</h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {t(
            "{error} Nothing was saved, and nothing needs to be — sending the same run again is safe.",
            { error: playErrorMessage(state.error) },
          )}
        </p>
        <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
          <Button variant="play" size="lg" onClick={state.retry}>
            {t("Try submitting again")}
          </Button>
          <Button variant="secondary" size="lg" onClick={state.restart}>
            <RotateCcw />
            {t("Back to the rules")}
          </Button>
          <GameExits slug={slug} title={title} />
        </div>
      </div>
    );
  }

  if (state.status === "playing" || state.status === "submitting") {
    return <>{board(state.session, state.run, state.status === "submitting")}</>;
  }

  if (state.status === "finished") {
    return (
      <UnlimitedRound.Provider value={playUnlimited}>
        {finished(state.run, state.result)}
      </UnlimitedRound.Provider>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * A quiet button that ends a daily run, after asking: there is one ranked play a
 * day, so ending it early is not something to do by a stray tap.
 */
export function EndRunButton({
  label,
  title,
  body,
  keep,
  disabled = false,
  onConfirm,
}: {
  label: string;
  title: string;
  body: string;
  keep: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{keep}</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>{label}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The chip at the top of a board: ranked, guest or practice. */
export function RankChip({ session }: { session: PlaySession }) {
  return session.ranked ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1">
      <ShieldCheck className="size-3.5" />
      {t("Ranked")}
    </span>
  ) : (
    <span className="rounded-full bg-surface-2 px-2 py-1">
      {session.offline ? (
        practiceLabel(session)
      ) : (
        <GuestOr signedIn={t("Unranked run")}>{t("Guest run")}</GuestOr>
      )}
    </span>
  );
}

/** The result screen's frame: a headline, the verified score, the game's own body, then the way out. */
export function DailyResult({
  slug,
  result,
  headline,
  children,
  stats,
  share,
}: {
  slug: string;
  result: RunResult;
  headline: ReactNode;
  children?: ReactNode;
  /** Two small figures under the score. */
  stats: readonly { label: string; value: ReactNode }[];
  share: DailyShare;
}) {
  const playUnlimited = useContext(UnlimitedRound);
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] text-center">
      <div className="enter flex flex-col items-center gap-2">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
          {result.ranked ? (
            <Trophy className="size-5 text-muted-foreground" />
          ) : (
            <ShieldCheck className="size-5 text-muted-foreground" />
          )}
        </div>
        {result.unlimited && (
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("Unlimited")}
          </p>
        )}
        <div className="text-sm text-muted-foreground">{headline}</div>
        <p className="pt-1 text-5xl font-semibold tabular">{points(result.score)}</p>
      </div>

      {children}

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl bg-surface p-3">
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd className="font-semibold tabular">{stat.value}</dd>
          </div>
        ))}
        {result.rank !== null && stats.length < 2 && (
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs text-muted-foreground">{t("Rank")}</dt>
            <dd className="font-semibold tabular">#{result.rank}</dd>
          </div>
        )}
      </dl>

      <p className="mx-auto max-w-sm text-xs text-muted-foreground">
        {result.ranked
          ? t("Verified by replaying your run on the server, then saved to the leaderboard.")
          : result.offline
            ? offlineResultNote(result)
            : t(
                "Verified by replaying your run on the server. This was a guest run, so it is not on the leaderboard.",
              )}
        {result.duplicate && t(" This run was already recorded, so nothing was counted twice.")}
      </p>
      <p className="text-xs text-muted-foreground">{nextDailyIn()}</p>

      <RunEndActions
        slug={slug}
        ranked={result.ranked}
        score={result.score}
        // An Unlimited board is not the day's: its grid is not today's to share.
        daily={result.unlimited ? undefined : share}
        sessionId={result.unlimited ? undefined : result.sessionId}
        autoFocus={!playUnlimited}
      >
        {playUnlimited && <UnlimitedButton unlimited={!!result.unlimited} onPlay={playUnlimited} />}
      </RunEndActions>
    </div>
  );
}

/** How long until the next daily board, at the player's own midnight. */
function nextDailyIn(): string {
  const left = Math.max(0, msUntilLocalMidnight(Date.now()));
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return t("A new one arrives in {n}{minutes} min.", {
    n: hours ? `${hours} h ` : "",
    minutes,
  });
}

/**
 * The way on from a daily result: Unlimited after today's board, or the next round
 * after an Unlimited one.
 */
export function UnlimitedButton({ unlimited, onPlay }: { unlimited: boolean; onPlay: () => void }) {
  return (
    <Button variant="play" size="lg" onClick={onPlay} autoFocus>
      <InfinityIcon />
      {unlimited ? t("Next round") : t("Keep playing: Unlimited")}
    </Button>
  );
}
