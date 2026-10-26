import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  Bookmark,
  Clock,
  Heart,
  Info,
  MessageCircle,
  Play,
  Share2,
  Trophy,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { GameArt } from "./GameArt";
import { HowToPlaySheet } from "./HowToPlaySheet";
import { CommentsSheet, ShareSheet } from "@/components/social/Sheets";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { fmt } from "@/lib/format";
import { categoryName, type Game } from "@/lib/games/catalog";
import { useGameEngagement } from "@/lib/social/engagement";
import { cn } from "@/lib/utils";

/**
 * One item in the swipeable feed.
 *
 * Two things changed when the catalogue became real, and both are about not
 * claiming more than is known:
 *
 *   - **Every engagement count is measured.** Likes and comments are stored in
 *     the database and read back with exact counts; a count the server did not
 *     report is omitted rather than zeroed, because a zero is a measurement
 *     and nothing was measured.
 *   - **Playability is stated.** A game without a runtime is never offered as
 *     playable: its board links to the game's page, and the button says so.
 *
 * A playable game starts from here in one tap. Tap to play (the board or the
 * button) opens the game with `?start=1`, which skips the game's own rules
 * screen and starts the run at once; Rules shows the full rules in a sheet
 * without leaving the feed.
 */
function Action({
  icon: Icon,
  label,
  active,
  count,
  onClick,
  to,
}: {
  icon: typeof Heart;
  label: string;
  count?: number | null;
  active?: boolean;
  onClick?: () => void;
  to?: { id: string };
}) {
  const body = (
    <span
      className={cn(
        "flex size-12 items-center justify-center rounded-full glass",
        active && "border-primary/40",
      )}
    >
      <Icon
        className={cn("size-[22px]", active && "fill-primary text-primary")}
        strokeWidth={1.75}
      />
    </span>
  );
  const cls = "press flex flex-col items-center gap-1";
  const tally =
    count === undefined || count === null ? null : (
      <span className="text-xs tabular text-muted-foreground">{fmt(count)}</span>
    );
  return to ? (
    <Link to="/leaderboards/$id" params={to} aria-label={label} className={cls}>
      {body}
      {tally}
    </Link>
  ) : (
    <button
      type="button"
      aria-label={count === null || count === undefined ? label : `${label}, ${fmt(count)}`}
      aria-pressed={active}
      onClick={onClick}
      className={cls}
    >
      {body}
      {tally}
    </button>
  );
}

export function FeedItem({ game }: { game: Game }) {
  const [comments, setComments] = useState(false);
  const [share, setShare] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const nav = useNavigate();
  // Where the visitor is now — the feed they were scrolling, with its query.
  const here = useRouterState({ select: (s) => s.location.href });
  const engagement = useGameEngagement(game.slug);

  const category = categoryName(game);

  // Liking and saving need an account. Anonymous visitors are sent to sign in
  // with a redirect back to the feed they were on, instead of watching a toggle
  // that cannot persist.
  async function guarded(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError && error.code === "unauthorized") {
        nav({ to: "/login", search: { redirect: here } });
        return;
      }
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    }
  }

  return (
    <article
      className="relative flex h-dvh snap-start snap-always items-stretch justify-center md:h-[calc(100dvh-0px)] md:py-6"
      aria-label={game.title}
    >
      <div className="relative flex w-full max-w-[460px] flex-col overflow-hidden md:rounded-2xl md:border md:border-glass-border">
        {/* Board — a playable game starts, an unplayable one opens its page. */}
        <BoardLink game={game}>
          {/* The art gets the space the overlays leave free: below the badges,
              above the title block, and — on a phone — left of the action rail.
              The "Tap to play" pill sits under the board rather than on it, so
              nothing covers the picture. */}
          <div className="absolute inset-0 flex flex-col items-center gap-3 pt-[max(8rem,calc(env(safe-area-inset-top)+7rem))] pr-[4.5rem] pb-[calc(13.75rem+env(safe-area-inset-bottom))] pl-4 md:px-4 md:pt-16 md:pb-[8.75rem]">
            <GameArt id={game.slug} className="min-h-0 w-full flex-1" />
            <span className="press flex shrink-0 items-center gap-2 rounded-full glass px-5 py-3 text-sm font-semibold group-hover:bg-surface-2">
              {game.playable ? (
                <>
                  <Play className="size-4 fill-current" /> Tap to play
                </>
              ) : (
                <>
                  <Clock className="size-4" /> Not playable yet
                </>
              )}
            </span>
          </div>
          {category && (
            <div className="absolute top-0 inset-x-0 flex items-center p-4 pt-[max(4rem,calc(env(safe-area-inset-top)+3rem))] md:pt-4">
              <span className="rounded-md glass px-2 py-1 text-xs font-medium">{category}</span>
            </div>
          )}
        </BoardLink>

        {/* Info */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0 scrim-bottom">
          <div className="pointer-events-auto space-y-3 p-4 pr-20 md:pr-4">
            <div>
              <h2 className="text-2xl font-semibold">
                {/* The title opens the game's page: its details, scores and comments. */}
                <Link to="/games/$id" params={{ id: game.slug }} className="hover:underline">
                  {game.title}
                </Link>
              </h2>
              {game.tagline && <p className="text-sm text-muted-foreground">{game.tagline}</p>}
            </div>
            <div className="flex gap-2">
              {game.playable ? (
                <>
                  <Button asChild variant="play" size="lg" className="flex-1">
                    <Link to="/play/$id" params={{ id: game.slug }} search={{ start: true }}>
                      <Play className="fill-current" /> Tap to play
                    </Link>
                  </Button>
                  {/* Sized to its label, so Tap to play keeps the width. */}
                  <Button variant="glass" size="lg" className="px-4" onClick={() => setHowTo(true)}>
                    <BookOpen /> Rules
                  </Button>
                </>
              ) : (
                <Button asChild variant="play" size="lg" className="flex-1">
                  <Link to="/games/$id" params={{ id: game.slug }}>
                    <Info /> Details
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Action rail. Counts are measured per game; a count the server has not
          reported yet is omitted rather than zeroed. */}
      <div className="absolute right-3 bottom-44 flex flex-col gap-4 md:static md:ml-4 md:self-end md:pb-6">
        <Action
          icon={Heart}
          label="Like"
          count={engagement.likeCount}
          active={engagement.liked}
          onClick={() => void guarded(() => engagement.toggleLike())}
        />
        <Action
          icon={MessageCircle}
          label="Comments"
          count={engagement.commentCount}
          onClick={() => setComments(true)}
        />
        <Action
          icon={Bookmark}
          label="Save"
          active={engagement.saved}
          onClick={() => void guarded(() => engagement.toggleSave())}
        />
        <Action icon={Trophy} label="Leaderboard" to={{ id: game.slug }} />
        <Action icon={Share2} label="Share" onClick={() => setShare(true)} />
      </div>

      <HowToPlaySheet open={howTo} onOpenChange={setHowTo} game={game} />
      <CommentsSheet
        open={comments}
        onOpenChange={setComments}
        gameId={engagement.gameId}
        gameSlug={game.slug}
        count={engagement.commentCount}
      />
      <ShareSheet
        open={share}
        onOpenChange={setShare}
        title={game.title}
        path={`/games/${game.slug}`}
      />
    </article>
  );
}

export function FeedSkeleton() {
  return (
    <div
      className="flex h-dvh items-center justify-center md:py-6"
      aria-busy="true"
      aria-label="Loading feed"
    >
      <div className="relative h-full w-full max-w-[460px] animate-pulse bg-surface md:rounded-2xl">
        <div className="absolute bottom-24 left-4 right-20 space-y-3">
          <div className="h-3 w-28 rounded bg-surface-2" />
          <div className="h-6 w-48 rounded bg-surface-2" />
          <div className="h-3 w-56 rounded bg-surface-2" />
          <div className="h-12 w-full rounded-lg bg-surface-2" />
        </div>
      </div>
    </div>
  );
}

/**
 * The board: a playable game starts at once (Tap to play), an unplayable one
 * opens its page.
 */
function BoardLink({ game, children }: { game: Game; children: React.ReactNode }) {
  const className = "group relative flex-1 bg-surface";
  return game.playable ? (
    <Link
      to="/play/$id"
      params={{ id: game.slug }}
      search={{ start: true }}
      className={className}
      aria-label={`Play ${game.title}`}
    >
      {children}
    </Link>
  ) : (
    <Link
      to="/games/$id"
      params={{ id: game.slug }}
      className={className}
      aria-label={`View ${game.title}`}
    >
      {children}
    </Link>
  );
}
