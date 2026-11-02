import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { EmptyState, ErrorState, ListSkeleton, Page } from "@/components/common";
import { FeedTabs } from "@/components/game/Feed";
import { GameRow } from "@/components/game/GameCard";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { subscribe as subscribeToAuth, useAuth } from "@/lib/auth/session";
import { catalogErrorMessage } from "@/lib/games/catalog";
import { useFollowingFeed } from "@/lib/games/following";
import { listFollowees } from "@/lib/social/follows";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/following")({
  head: () => seo("Following", "Games played and made by people you follow."),
  component: Following,
});

/**
 * The Following feed: published creator games of followed accounts, served by
 * `GET /api/v1/games/following` for the verified caller with cursor
 * pagination. It is never the For You catalogue under another heading:
 * - follows nobody → discovery empty state;
 * - follows accounts with no published creator games → accurate empty state;
 * - follow-list failure vs feed failure → distinct errors with distinct retries.
 */
function Following() {
  const [authTick, setAuthTick] = useState(0);
  const [followeeCount, setFolloweeCount] = useState<number | undefined>(undefined);
  const [followError, setFollowError] = useState<string>();

  useEffect(() => subscribeToAuth(() => setAuthTick((n) => n + 1)), []);

  const auth = useAuth();

  useEffect(() => {
    if (auth.status !== "authenticated") {
      setFolloweeCount(undefined);
      setFollowError(undefined);
      return;
    }
    let cancelled = false;
    setFollowError(undefined);
    listFollowees(auth.session.userId)
      .then((ids) => {
        if (!cancelled) setFolloweeCount(ids.length);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFollowError(error instanceof Error ? error.message : "Couldn't load follows.");
          setFolloweeCount(0);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, authTick]);

  if (auth.status !== "authenticated") {
    return (
      <FollowingPage>
        <EmptyState
          icon={Users}
          title="Sign in to follow creators"
          body="Following keeps the games of people you follow in one place."
          action={
            <Button asChild>
              <Link to="/login" search={{ redirect: "/following" }}>
                Log in
              </Link>
            </Button>
          }
        />
      </FollowingPage>
    );
  }

  if (followeeCount === undefined) {
    return (
      <FollowingPage>
        <ListSkeleton rows={4} avatar={false} />
      </FollowingPage>
    );
  }

  if (followError) {
    return (
      <FollowingPage>
        <ErrorState
          title="Couldn't load follows"
          body={followError}
          onRetry={() => setAuthTick((n) => n + 1)}
        />
      </FollowingPage>
    );
  }

  if (followeeCount === 0) {
    return (
      <FollowingPage>
        <EmptyState
          icon={Users}
          title="You're not following anyone yet"
          body="Find creators in Search or on a game page, then follow them to build this feed."
          action={
            <Button asChild variant="secondary">
              <Link to="/search">Discover creators</Link>
            </Button>
          }
        />
      </FollowingPage>
    );
  }

  return <FollowingGames />;
}

function FollowingGames() {
  const feed = useFollowingFeed({ limit: 20 });

  if (feed.status === "anonymous") {
    return (
      <FollowingPage>
        <EmptyState
          icon={Users}
          title="Sign in to follow creators"
          body="Following keeps the games of people you follow in one place."
          action={
            <Button asChild>
              <Link to="/login" search={{ redirect: "/following" }}>
                Log in
              </Link>
            </Button>
          }
        />
      </FollowingPage>
    );
  }

  if (feed.status === "loading") {
    return (
      <FollowingPage>
        <ListSkeleton rows={4} avatar={false} />
      </FollowingPage>
    );
  }

  if (feed.status === "error" && feed.items.length === 0) {
    return (
      <FollowingPage>
        <ErrorState
          title="Couldn't load the following feed"
          body={catalogErrorMessage(feed.error)}
          onRetry={feed.retry}
        />
      </FollowingPage>
    );
  }

  if (feed.status === "ready" && feed.items.length === 0) {
    return (
      <FollowingPage>
        <EmptyState
          icon={Users}
          title="No published games yet"
          body="The creators you follow haven't published any games. Check back later."
        />
      </FollowingPage>
    );
  }

  const items = feed.items;
  const failedMore = feed.status === "error" && items.length > 0;

  return (
    <FollowingPage>
      <div>
        {items.map((game) => (
          <GameRow key={game.slug} game={game} />
        ))}
      </div>
      {failedMore && (
        <ErrorState
          title="Couldn't load more games"
          body={catalogErrorMessage(feed.error)}
          onRetry={() => void feed.loadMore()}
        />
      )}
      {!failedMore && feed.status === "ready" && feed.hasMore && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => void feed.loadMore()}>
            Load more
          </Button>
        </div>
      )}
      {!failedMore && feed.status === "loading-more" && <ListSkeleton rows={2} avatar={false} />}
    </FollowingPage>
  );
}

/** The pill toggle stays pinned above every state of this feed. */
function FollowingPage({ children }: { children: ReactNode }) {
  return (
    <>
      <FeedTabs tab="following" />
      <Page className="pt-[calc(4.25rem+env(safe-area-inset-top))] md:pt-24">{children}</Page>
    </>
  );
}
