import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { FeedItem, FeedSkeleton } from "./FeedItem";
import { EmptyState, ErrorState } from "@/components/common";
import { DailyStreakChip } from "@/components/game/DailyStreakChip";
import { LogoMark } from "@/components/layout/Logo";
import { requestFeedRefresh, useFeedRefresh } from "@/lib/feed-refresh";
import { catalogErrorMessage, type Game } from "@/lib/games/catalog";
import { cn } from "@/lib/utils";

import { t } from "@/lib/settings/language";
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
  landOn,
  lead,
  empty = {
    title: t("Nothing here yet"),
    body: t("As soon as games are published they show up in this feed."),
  },
}: {
  tab: "for-you" | "following";
  items: Game[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Reads the feed again: a tap on Home or For You while already here. */
  onRefresh?: () => void;
  /** The slug of the game to open on, rather than the first. */
  landOn?: string;
  /** A slide before the games, like For You's "Continue" card. */
  lead?: ReactNode;
  empty?: { title: string; body?: string };
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const landing = useRef(landOn);
  const stopLanding = () => {
    landing.current = undefined;
  };

  // Home or For You tapped while already on this feed: back to the first game,
  // and a fresh read of the list behind it.
  useFeedRefresh(() => {
    stopLanding();
    scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
    onRefresh?.();
  });

  // Before paint, so the first card never shows on the way to this one. It stays
  // on this card until the player moves: finishing a game changes its place in
  // the order, and that fresh order can arrive a moment after the cached one. A
  // game no longer in the feed leaves the player at the top.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !landing.current) return;
    const card = [...element.children].find(
      (child) => child instanceof HTMLElement && child.dataset["game"] === landing.current,
    );
    if (card instanceof HTMLElement) element.scrollTop = card.offsetTop;
  }, [items]);

  return (
    <div className="relative">
      <FeedTabs tab={tab} />
      <div
        ref={scroller}
        data-feed-scroller
        onPointerDown={stopLanding}
        onWheel={stopLanding}
        onKeyDown={stopLanding}
        className="no-scrollbar h-dvh snap-y snap-mandatory overflow-y-auto overscroll-contain"
      >
        {loading ? (
          <FeedSkeleton />
        ) : error ? (
          <div className="flex h-dvh items-center justify-center">
            <ErrorState
              title={t("Couldn't load the feed")}
              body={catalogErrorMessage(error)}
              onRetry={onRetry}
            />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-dvh items-center justify-center">
            <EmptyState title={empty.title} body={empty.body} />
          </div>
        ) : (
          <>
            {lead}
            {items.map((game) => (
              <FeedItem key={game.slug} game={game} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** The fixed For You / Following pill, shared so it persists across both feeds. */
export function FeedTabs({ tab }: { tab: "for-you" | "following" }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-20 md:left-60 lg:left-64">
      <div className="pointer-events-auto mx-auto flex max-w-[460px] items-center justify-between px-4 pt-[calc(0.75rem+var(--safe-top))] md:pt-9">
        {/* Equal sides keep the pill centred whatever the streak's width. */}
        <div className="flex flex-1 items-center gap-2">
          {/* The narrowest phones give the logo's room to the streak. */}
          <LogoMark className="size-6 max-[379px]:hidden md:hidden" />
          <DailyStreakChip />
        </div>
        <nav className="flex gap-1 rounded-full glass p-1" aria-label={t("Feed")}>
          {(
            [
              ["/", t("For You"), "for-you"],
              ["/following", t("Following"), "following"],
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
                tab === key ? "bg-foreground text-background font-medium" : "text-muted-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-1 justify-end">
          <Link
            to="/search"
            aria-label={t("Search")}
            className="press flex size-9 items-center justify-center rounded-full glass md:invisible"
          >
            <Search className="size-[18px]" />
          </Link>
        </div>
      </div>
    </div>
  );
}
