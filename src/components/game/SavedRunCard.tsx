import { History, Play, RotateCcw } from "lucide-react";

import { ExitGameLink } from "@/components/game/ExitGameLink";
import { Button } from "@/components/ui/button";

/**
 * An unfinished run, found on the player's account.
 *
 * Shown before a new run starts — even from Tap to play — because which run to
 * play is the player's call. Continue picks the run up where it was left; New
 * run ends it, keeping its score (it is submitted as it was left, like any run
 * the player ends), and starts a fresh one.
 */
export function SavedRunCard({
  score,
  where,
  onContinue,
  onNewRun,
  slug,
  title,
}: {
  /** The saved run's score so far. */
  score: number;
  /** Where the run was left, in a few words: "Board 7", "34 tiles placed". */
  where: string;
  onContinue: () => void;
  onNewRun: () => void;
  slug: string;
  title: string;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="enter mx-auto flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
          <History className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Pick up where you left off?</h1>
          <p className="text-sm text-muted-foreground">
            You have an unfinished run of {title}, saved to your account.
          </p>
        </div>

        <dl className="grid w-full grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs text-muted-foreground">Score so far</dt>
            <dd className="text-lg font-semibold tabular">{score}</dd>
          </div>
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs text-muted-foreground">Left at</dt>
            <dd className="text-lg font-semibold tabular">{where}</dd>
          </div>
        </dl>

        <div className="flex w-full flex-col gap-2">
          <Button variant="play" size="lg" onClick={onContinue} autoFocus>
            <Play className="fill-current" />
            Continue run
          </Button>
          <Button variant="secondary" size="lg" onClick={onNewRun}>
            <RotateCcw />
            New run
          </Button>
          <Button asChild variant="ghost" size="lg">
            <ExitGameLink slug={slug}>Back to {title}</ExitGameLink>
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          {`Starting a new run ends this one and keeps its score of ${score}.`}
        </p>
      </div>
    </div>
  );
}
