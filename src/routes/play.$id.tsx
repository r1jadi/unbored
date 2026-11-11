import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Clock, Flame, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { GameExits } from "@/components/game/GameExits";
import { RUNTIMES } from "@/components/game/runtimes";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { useDocumentTitle } from "@/lib/document-title";
import { useSoundEnabled } from "@/lib/sound";
import {
  releaseActiveChallenge,
  setActiveChallenge,
  subscribeChallengeRunDone,
} from "@/lib/games/challenge-run";
import { titleFromSlug, useGame } from "@/lib/games/catalog";
import { points } from "@/lib/format";
import { RunLeaveContext, RunProgressContext } from "@/lib/games/run-progress";
import { prefetchPlay } from "@/lib/prefetch";
import { useOnline } from "@/lib/service-worker";

import { t } from "@/lib/settings/language";
import { absoluteUrl, gameImage } from "@/lib/seo";
import { streakStatus, useMyGameStreak } from "@/lib/games/streaks";
import { cn } from "@/lib/utils";
/**
 * `?start=1` starts the run straight away instead of showing the game's rules
 * first: the feed's Tap to play sends it, because a player who tapped Play has
 * already chosen to play. A link without it shows the rules, as before.
 */
type PlaySearch = {
  start?: boolean;
  /** A callout this run belongs to, and the friend's username to go back to. */
  challenge?: string;
  with?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME = /^[a-z0-9_.-]{1,64}$/i;

export const Route = createFileRoute("/play/$id")({
  validateSearch: (search: Record<string, unknown>): PlaySearch => {
    const start = search["start"] === 1 || search["start"] === "1" || search["start"] === true;
    const challenge = search["challenge"];
    const rival = search["with"];
    return {
      ...(start ? { start: true } : {}),
      ...(typeof challenge === "string" &&
      UUID.test(challenge) &&
      typeof rival === "string" &&
      USERNAME.test(rival)
        ? { challenge, with: rival }
        : {}),
    };
  },
  loader: ({ context, params }) => prefetchPlay(context.queryClient, params.id),
  head: ({ params }) => {
    const title = titleFromSlug(params.id);
    return {
      meta: [
        { title: t("{title} — Unbored", { title }) },
        { name: "description", content: `${title} on Unbored.` },
        { property: "og:title", content: `${title} — Unbored` },
        ...(gameImage(params.id)
          ? [{ property: "og:image", content: absoluteUrl(`/og/${params.id}.png`) }]
          : []),
      ],
    };
  },
  component: PlayScreen,
});

/**
 * The play screen.
 *
 * It used to be a working prototype that scored `10 + random(15)` points on every
 * tap and then reported a global rank and a personal best. None of that was real:
 * there was no game, and no score was ever stored. Presenting it as playable was the
 * most misleading thing in the app, so it now mounts a runtime only when the
 * catalogue says the game has one.
 *
 * The runtime is chosen by the game's `runtime` identifier — `stack-10` plays Stack
 * 10, `chain` plays Chain, `memory-flash` plays Memory Flash, `one-move` plays One
 * Move, `color-merge` plays Color Merge, `dont-touch` plays Don't Touch the Black,
 * `seven-second` plays 7 Second, `queens` plays Crowns, `zip` plays Trail,
 * `eight-puzzle` plays 8 Puzzle, `tango` plays Sun & Moon, `sudoku` plays Sudoku,
 * `crossword` plays the daily crossword, `gridburst` plays Gridburst,
 * `updraft` plays Flutter, `decant` plays Decant, `mini-sudoku` plays Mini Sudoku, `scatter` plays Scatter, `huedini` plays Huedini,
 * `cascade` plays Cascade, `checkmate` plays Checkmate,
 * and anything else gets the honest "no runtime
 * yet" screen rather than a board that does not follow that game's rules. Every
 * catalogue game now has a runtime, but the branch stays a feature rather than a
 * leftover: it is what stops a future catalogue entry from silently pretending.
 */
function PlayScreen() {
  const { id } = Route.useParams();
  const { start, challenge, with: rival } = Route.useSearch();
  const nav = useNavigate();
  // Set while rendering: a runtime's first effect starts its run, and children's effects
  // run before this component's. The server has no runs to start and shares this module.
  if (typeof window !== "undefined") setActiveChallenge(challenge ?? null);
  useEffect(() => {
    if (!challenge || !rival) return;
    setActiveChallenge(challenge);
    const backToChat = () =>
      void nav({ to: "/messages/$username", params: { username: rival }, replace: true });
    const unsubscribe = subscribeChallengeRunDone((score) => {
      toast.success(t("Score locked in: {score}", { score: points(score) }));
      backToChat();
    });
    return () => {
      unsubscribe();
      releaseActiveChallenge();
    };
  }, [challenge, rival, nav]);
  return (
    <Play
      id={id}
      autoStart={start === true || challenge !== undefined}
      calloutWith={challenge ? rival : undefined}
    />
  );
}

/**
 * The play screen for a slug, with the reporter that tells its quit control
 * whether leaving would cost the player a run. Exported so the navigation tests
 * can mount the real composition without the generated route tree.
 */
export function Play({
  id,
  autoStart = false,
  calloutWith,
}: {
  id: string;
  autoStart?: boolean;
  /** This run is a callout against this username: quitting goes back to the chat. */
  calloutWith?: string;
}) {
  // Whether a run is live, and how to end it, reported by the runtime below.
  const [progress, setProgress] = useState<{
    active: boolean;
    endRun?: () => void;
    resumable?: boolean;
  }>({
    active: false,
  });
  const report = useCallback(
    (active: boolean, endRun?: () => void, resumable?: boolean) =>
      setProgress({ active, endRun, resumable }),
    [],
  );

  return (
    <RunProgressContext.Provider value={report}>
      <PlaySurface
        id={id}
        progress={progress.active}
        endRun={progress.endRun}
        resumable={progress.resumable === true && !calloutWith}
        autoStart={autoStart}
        calloutWith={calloutWith}
      />
    </RunProgressContext.Provider>
  );
}

/**
 * The screen itself, given the slug and whether a run is live. The quit control
 * and every exit from here are the navigation contract this file owns.
 *
 * Quitting a live run ends it rather than discarding it: when the runtime has
 * handed over `endRun`, confirming submits the run and the runtime shows its
 * verified score, from where leaving is a single tap. A runtime that offers no
 * way to end its run keeps the old choice, to leave without a score. A run that
 * is saved as it is played (`resumable`) can also be left as it is, to finish
 * later: opening the game again offers Continue run or New run.
 */
export function PlaySurface({
  id,
  progress,
  endRun,
  resumable = false,
  autoStart = false,
  calloutWith,
}: {
  id: string;
  progress: boolean;
  endRun?: () => void;
  /** The live run is saved to the player's account and can be continued later. */
  resumable?: boolean;
  /** Start the run without the rules screen (`?start=1`). */
  autoStart?: boolean;
  calloutWith?: string;
}) {
  const state = useGame(id);
  const title = state.status === "ready" ? state.game.title : titleFromSlug(id);
  useDocumentTitle(
    state.status === "ready"
      ? state.game.title
      : state.status === "missing"
        ? t("Game not found")
        : undefined,
  );
  const playable = state.status === "ready" && state.game.playable && !!state.game.runtime;
  // A runtime this bundle ships: anything else renders the honest
  // "no runtime yet" screen below rather than a board with foreign rules.
  const Runtime =
    state.status === "ready" && state.game.runtime ? RUNTIMES[state.game.runtime] : undefined;
  const hasShippedRuntime = Runtime !== undefined;

  const nav = useNavigate();
  const online = useOnline();
  const [confirming, setConfirming] = useState(false);

  // Leaving replaces this screen instead of stacking on top of it: the feed is
  // where the player asked to be, and Back from it must not land back in the
  // game they just quit.
  const quit = useCallback(() => {
    if (calloutWith) {
      void nav({ to: "/messages/$username", params: { username: calloutWith }, replace: true });
      return;
    }
    void nav({ to: "/", search: { game: id }, replace: true });
  }, [calloutWith, id, nav]);

  // `quit` is a dependency: this screen stays mounted when the route's game
  // changes, and a stale one would leave to the previous game's place in the feed.
  const leave = useMemo(() => ({ resumable, leave: quit }), [resumable, quit]);

  return (
    <RunLeaveContext.Provider value={leave}>
      <div className="fixed inset-0 flex flex-col bg-background">
        <header className="flex items-center gap-3 px-4 pt-[calc(0.75rem+var(--safe-top))] pb-3">
          <Button
            variant="glass"
            size="icon"
            aria-label={t("Quit game")}
            onClick={() => (progress ? setConfirming(true) : quit())}
          >
            <X />
          </Button>
          <div className="flex-1 text-center">
            <p className="text-xs text-muted-foreground">{title}</p>
            <StreakChip slug={id} />
            {calloutWith && (
              <p className="text-[11px] font-medium text-primary">
                {t("Callout with @{username} · one attempt", { username: calloutWith })}
              </p>
            )}
            {!online && (
              <p className="text-[11px] text-muted-foreground/80">{t("Offline · practice only")}</p>
            )}
          </div>
          <SoundToggle />
        </header>

        {state.status === "loading" && (
          <div className="flex flex-1 items-center justify-center">
            <Clock className="size-5 animate-pulse text-muted-foreground" />
          </div>
        )}

        {state.status === "ready" && Runtime && playable && (
          <Runtime
            key={state.game.slug}
            slug={state.game.slug}
            title={state.game.title}
            autoStart={autoStart}
          />
        )}

        {state.status === "ready" && !(hasShippedRuntime && playable) && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
              <Clock className="size-5 text-muted-foreground" />
            </div>
            <h1 className="text-xl font-semibold">{t("Not playable yet")}</h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              {t(
                "{title} has no runtime yet, so there is nothing to start. It is listed because it is part of the catalogue.",
                { title },
              )}
            </p>
            <div className="mt-2 w-full">
              <GameExits slug={id} title={title} />
            </div>
          </div>
        )}

        {state.status === "error" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <h1 className="text-xl font-semibold">{t("Couldn't load this game")}</h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              {online
                ? t("The catalogue is unavailable, so there is nothing to start.")
                : t(
                    "You're offline and this game isn't saved on this device yet. Open it once while online to play it offline.",
                  )}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={state.retry}>
                {t("Try again")}
              </Button>
              <Button asChild variant="ghost">
                <Link to="/explore">{t("Browse games")}</Link>
              </Button>
            </div>
            <div className="w-full">
              <GameExits />
            </div>
          </div>
        )}

        {state.status === "missing" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <h1 className="text-xl font-semibold">{t("No such game")}</h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              {t("That game is not in the catalogue.")}
            </p>
            <Button asChild variant="play" size="lg" className="mt-2">
              <Link to="/explore">{t("Browse games")}</Link>
            </Button>
            <div className="w-full">
              <GameExits />
            </div>
          </div>
        )}

        {/* A started run is real progress, so ending it is a decision the player
          makes deliberately rather than by a mis-tap on the way out. Ending it
          saves it: the score so far is submitted and verified. */}
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {endRun ? t("End this run?") : t("Leave this run?")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {endRun && resumable
                  ? t(
                      "Your run is still going. Finish it later and it is waiting for you next time you open this game — or end it now to save your score so far.",
                    )
                  : endRun && !online
                    ? t(
                        "Your run is still going. You're offline, so it is a practice run: ending it shows your score, but it is not verified or saved.",
                      )
                    : endRun
                      ? t(
                          "Your run is still going. Ending it now saves your score so far: it is sent for verification, and the board you are on is not scored.",
                        )
                      : t(
                          "Your run is still going. Leaving now discards it, and it will not be scored.",
                        )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Keep playing")}</AlertDialogCancel>
              {endRun && resumable && (
                <AlertDialogAction
                  className={buttonVariants({ variant: "secondary" })}
                  onClick={quit}
                >
                  {t("Finish later")}
                </AlertDialogAction>
              )}
              {endRun ? (
                <AlertDialogAction onClick={endRun}>{t("End run and save")}</AlertDialogAction>
              ) : (
                <AlertDialogAction onClick={quit}>{t("Leave run")}</AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </RunLeaveContext.Provider>
  );
}

/**
 * The streak in this game, kept in view for the whole run: how many days, and
 * whether today still has to be played to keep it. Nothing for a guest or a
 * player with no streak. It refreshes when a run is verified.
 */
function StreakChip({ slug }: { slug: string }) {
  const streak = useMyGameStreak(slug);
  if (!streak.data) return null;
  const status = streakStatus(streak.data);
  if (status === "none") return null;
  const days =
    streak.data.streak === 1
      ? t("1-day streak")
      : t("{streak}-day streak", { streak: streak.data.streak });
  const owed = status !== "done";
  return (
    <p
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium tabular",
        owed ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Flame className="size-3 text-primary" aria-hidden />
      {owed ? t("{days} · play today to keep it", { days }) : days}
    </p>
  );
}

/** Turns game sound effects on or off; the choice is remembered on this device. */
function SoundToggle() {
  const [on, setOn] = useSoundEnabled();
  return (
    <Button
      variant="glass"
      size="icon"
      aria-label={on ? t("Mute sound effects") : t("Unmute sound effects")}
      aria-pressed={!on}
      onClick={() => setOn(!on)}
    >
      {on ? <Volume2 /> : <VolumeX />}
    </Button>
  );
}
