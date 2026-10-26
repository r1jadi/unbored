import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useRef } from "react";
import { FeedItem, FeedSkeleton } from "./FeedItem";
import { EmptyState, ErrorState } from "@/components/common";
import { LogoMark } from "@/components/layout/Logo";
import { requestFeedRefresh, useFeedRefresh } from "@/lib/feed-refresh";
import { catalogErrorMessage, type Game } from "@/lib/games/catalog";
import { cn } from "@/lib/utils";

/**
 * The swipeable feed.
 *
 * It takes the games it should show rather than reaching for them itself, so the
 * screen that owns a query decides what "For You" and "Following" mean. Each state
 * is drawn explicitly: there is no fallback list, because a feed that quietly
 * shows something else when the API fails is a feed that lies about what is
 * popular.
 */
export function Feed({
  tab,
  items,
  loading = false,
  error,
  onRetry,
  onRefresh,
  empty = {
    title: "Nothing here yet",
    body: "As soon as games are published they show up in this feed.",
  },
}: {
  tab: "for-you" | "following";
  items: Game[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Reads the feed again: a tap on Home or For You while already here. */
  onRefresh?: () => void;
  empty?: { title: string; body?: string };
}) {
  const scroller = useRef<HTMLDivElement>(null);

  // Home or For You tapped while already on this feed: back to the first game,
  // and a fresh read of the list behind it.
  useFeedRefresh(() => {
    scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
    onRefresh?.();
  });

  return (
    <div className="relative">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-20 md:left-60 lg:left-64">
        <div className="pointer-events-auto mx-auto flex max-w-[460px] items-center justify-between px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] md:pt-9">
          <LogoMark className="size-6 md:invisible" />
          <nav className="flex gap-1 rounded-full glass p-1" aria-label="Feed">
            {(
              [
                ["/", "For You", "for-you"],
                ["/following", "Following", "following"],
              ] as const
            ).map(([to, label, key]) => (
              <Link
                key={key}
                to={to}
                onClick={(event) => {
                  if (tab !== key || key !== "for-you") return;
                  event.preventDefault();
                  requestFeedRefresh();
                }}
                className={cn(
                  "press rounded-full px-3.5 py-1.5 text-sm",
                  tab === key
                    ? "bg-foreground text-background font-medium"
                    : "text-muted-foreground",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
          <Link
            to="/search"
            aria-label="Search"
            className="press flex size-9 items-center justify-center rounded-full glass md:invisible"
          >
            <Search className="size-[18px]" />
          </Link>
        </div>
      </div>
      <div
        ref={scroller}
        className="no-scrollbar h-dvh snap-y snap-mandatory overflow-y-auto overscroll-contain"
      >
        {loading ? (
          <FeedSkeleton />
        ) : error ? (
          <div className="flex h-dvh items-center justify-center">
            <ErrorState
              title="Couldn't load the feed"
              body={catalogErrorMessage(error)}
              onRetry={onRetry}
            />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-dvh items-center justify-center">
            <EmptyState title={empty.title} body={empty.body} />
          </div>
        ) : (
          items.map((game) => <FeedItem key={game.slug} game={game} />)
        )}
      </div>
    </div>
  );
}
