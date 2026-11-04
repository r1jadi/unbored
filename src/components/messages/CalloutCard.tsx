import { Link, useNavigate } from "@tanstack/react-router";
import { Check, Clock, Swords, Trophy, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { points } from "@/lib/format";
import {
  cancelCallout,
  createCallout,
  createRefusal,
  respondToCallout,
  type Callout,
} from "@/lib/messages/callouts";
import { t } from "@/lib/settings/language";
import { cn } from "@/lib/utils";

/** What the caller claimed, from this player's side. */
export function calloutClaim(callout: Callout, me: string | undefined, username: string): string {
  const mine = callout.challengerId === me;
  const game = callout.gameTitle;
  if (callout.format === "score_target") {
    const target = points(callout.targetScore ?? 0);
    return mine
      ? t("You called it: {target}+ on {game}", { target, game })
      : t("@{username} says they'll score {target}+ on {game}", { username, target, game });
  }
  if (callout.margin > 0) {
    const margin = points(callout.margin);
    return mine
      ? t("You called it: you'll beat @{username} by {margin}+ on {game}", {
          username,
          margin,
          game,
        })
      : t("@{username} says they'll beat you by {margin}+ on {game}", { username, margin, game });
  }
  return mine
    ? t("You called out @{username} on {game}", { username, game })
    : t("@{username} called you out on {game}", { username, game });
}

function timeLeft(until: string | null): string | null {
  if (!until) return null;
  const hours = Math.ceil((new Date(until).getTime() - Date.now()) / 3_600_000);
  return hours > 0 ? t("{hours}h left", { hours }) : null;
}

/** A callout in the chat. It changes with the callout, and moves down when settled. */
export function CalloutCard({
  callout,
  me,
  username,
  otherId,
  onChanged,
}: {
  callout: Callout;
  me: string | undefined;
  username: string;
  otherId: string;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const mine = callout.challengerId === me;
  const isTarget = callout.format === "score_target";

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      onChanged();
    } catch {
      toast.error(t("That didn't go through. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function rematch(double: boolean) {
    setBusy(true);
    try {
      // A score target was one player's claim. Settling it again is head to head.
      const format = isTarget ? "sealed" : callout.format;
      const result = await createCallout({
        opponentId: otherId,
        gameSlug: callout.gameSlug,
        format,
        stake: callout.stake ?? undefined,
        rematchOf: callout.id,
        double,
      });
      if (result.outcome !== "created" || !result.id) {
        toast.error(createRefusal(result.outcome));
        return;
      }
      onChanged();
      if (format === "beat_my_score") {
        void navigate({
          to: "/play/$id",
          params: { id: callout.gameSlug },
          search: { start: true, challenge: result.id, with: username },
        });
      }
    } catch {
      toast.error(t("That didn't go through. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const canPlay = callout.status === "active" && !callout.iStarted && (!isTarget || mine);
  const won = callout.status === "finished" && callout.winnerId === me;
  const draw = callout.status === "finished" && callout.winnerId === null;
  const lost = callout.status === "finished" && !won && !draw;

  return (
    <li className="my-2 flex justify-center">
      <div
        className={cn(
          "enter w-full max-w-sm rounded-3xl border p-4 shadow-lg",
          won ? "dm-card-glow border-primary/60" : "border-border bg-surface",
        )}
      >
        <p className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-primary uppercase">
          <Swords className="size-3.5" aria-hidden />
          {callout.isDouble ? t("Double or nothing") : t("Callout")}
        </p>
        <p className="mt-1.5 text-sm font-medium">{calloutClaim(callout, me, username)}</p>
        {callout.stake && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("On the line: {stake}", { stake: callout.stake })}
          </p>
        )}

        {callout.status === "pending" && (
          <>
            {callout.format === "beat_my_score" && callout.theirScore !== null && (
              <p className="mt-3 text-center text-2xl font-bold tabular">
                {points(callout.theirScore)}
                <span className="block text-xs font-normal text-muted-foreground">
                  {t("the score to beat")}
                </span>
              </p>
            )}
            {mine ? (
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {t("Waiting for @{username} to accept", { username })}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void act(() => cancelCallout(callout.id))}
                >
                  {t("Cancel")}
                </Button>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => void act(() => respondToCallout(callout.id, true))}
                >
                  <Check /> {t("Accept")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => void act(() => respondToCallout(callout.id, false))}
                >
                  <X /> {t("Decline")}
                </Button>
              </div>
            )}
            {timeLeft(callout.respondBy) && (
              <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3" aria-hidden /> {timeLeft(callout.respondBy)}
              </p>
            )}
          </>
        )}

        {callout.status === "active" && (
          <>
            {callout.format === "beat_my_score" && !mine && callout.theirScore !== null && (
              <p className="mt-3 text-center text-2xl font-bold tabular">
                {points(callout.theirScore)}
                <span className="block text-xs font-normal text-muted-foreground">
                  {t("the score to beat")}
                </span>
              </p>
            )}
            {canPlay ? (
              <>
                <Button asChild size="sm" className="mt-3 w-full">
                  <Link
                    to="/play/$id"
                    params={{ id: callout.gameSlug }}
                    search={{ start: true, challenge: callout.id, with: username }}
                  >
                    {t("Play your one attempt")}
                  </Link>
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  {isTarget
                    ? t("Leaving without finishing means no score.")
                    : t("Same board for both of you. Leaving without finishing means no score.")}
                </p>
              </>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                {callout.myScore !== null
                  ? t("You scored {score}. Waiting for @{username}.", {
                      score: points(callout.myScore),
                      username,
                    })
                  : callout.iStarted
                    ? t("Your attempt has started.")
                    : t("Waiting for @{username} to play.", { username })}
                {callout.theyFinished &&
                  !isTarget &&
                  ` ${t("@{username} has played.", { username })}`}
              </p>
            )}
            {timeLeft(callout.playBy) && (
              <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3" aria-hidden /> {timeLeft(callout.playBy)}
              </p>
            )}
          </>
        )}

        {callout.status === "finished" && (
          <>
            <p
              className={cn(
                "mt-3 flex items-center gap-1.5 text-base font-bold",
                won && "text-primary",
              )}
            >
              {won && <Trophy className="size-4" aria-hidden />}
              {won ? t("You won") : draw ? t("It's a draw") : t("You lost")}
            </p>
            {isTarget ? (
              <p className="mt-1 text-sm tabular">
                {t("Called {target}, scored {score}", {
                  target: points(callout.targetScore ?? 0),
                  score:
                    (mine ? callout.myScore : callout.theirScore) === null
                      ? "—"
                      : points((mine ? callout.myScore : callout.theirScore) ?? 0),
                })}
              </p>
            ) : (
              <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-2xl bg-background/50 px-3 py-2.5 text-center tabular">
                <span className="min-w-0">
                  <span className={cn("block text-2xl font-black", won && "text-primary")}>
                    {callout.myScore === null ? "—" : points(callout.myScore)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{t("You")}</span>
                </span>
                <span className="text-xs font-black text-muted-foreground">{t("VS")}</span>
                <span className="min-w-0">
                  <span className={cn("block text-2xl font-black", lost && "text-primary")}>
                    {callout.theirScore === null ? "—" : points(callout.theirScore)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">@{username}</span>
                </span>
              </div>
            )}
            {!callout.rematchTaken && (
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => void rematch(false)}
                >
                  {t("Rematch")}
                </Button>
                {lost && !callout.isDouble && (
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={busy}
                    onClick={() => void rematch(true)}
                  >
                    {t("Double or nothing")}
                  </Button>
                )}
              </div>
            )}
          </>
        )}

        {callout.status === "declined" && (
          <p className="mt-3 text-xs text-muted-foreground">{t("Declined")}</p>
        )}
        {callout.status === "cancelled" && (
          <p className="mt-3 text-xs text-muted-foreground">{t("Called off")}</p>
        )}
        {callout.status === "expired" && (
          <p className="mt-3 text-xs text-muted-foreground">{t("Ran out of time")}</p>
        )}
      </div>
    </li>
  );
}
