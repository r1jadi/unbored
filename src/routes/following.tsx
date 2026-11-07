import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ErrorState, ListSkeleton, Page } from "@/components/common";
import { CreatorsComingSoon } from "@/components/game/CreatorsComingSoon";
import { FeedTabs } from "@/components/game/Feed";
import { GameRow } from "@/components/game/GameCard";
import { Button } from "@/components/ui/button";
import { subscribe as subscribeToAuth, useAuth } from "@/lib/auth/session";
import { catalogErrorMessage } from "@/lib/games/catalog";
import { useFollowingFeed } from "@/lib/games/following";
import { listFollowees } from "@/lib/social/follows";
import { seo } from "@/lib/seo";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/following")({
  head: () => seo(t("Following"), t("Player-made games are on the way to Unbored.")),
  component: Following,
});

/**
 * The Following feed: published creator games of followed accounts, served by
 * `GET /api/v1/games/following` for the verified caller with cursor
 * pagination. It is never the For You catalogue under another heading:
 * - signed out, follows nobody, or no creator games → coming soon, because players
 *   can't publish games yet, so none of these is something to fix right now;
 * - follow-list failure vs feed failure → distinct errors with distinct retries.
 *
 * The feed itself stays wired, so games appear here as soon as they exist.
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
          setFollowError(error instanceof Error ? error.message : t("Couldn't load follows."));
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
        <CreatorsComingSoon />
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
          title={t("Couldn't load follows")}
          body={followError}
          onRetry={() => setAuthTick((n) => n + 1)}
        />
      </FollowingPage>
    );
  }

  if (followeeCount === 0) {
    return (
      <FollowingPage>
        <CreatorsComingSoon />
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
        <CreatorsComingSoon />
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
          title={t("Couldn't load the following feed")}
          body={catalogErrorMessage(feed.error)}
          onRetry={feed.retry}
        />
      </FollowingPage>
    );
  }

  if (feed.status === "ready" && feed.items.length === 0) {
    return (
      <FollowingPage>
        <CreatorsComingSoon />
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
          title={t("Couldn't load more games")}
          body={catalogErrorMessage(feed.error)}
          onRetry={() => void feed.loadMore()}
        />
      )}
      {!failedMore && feed.status === "ready" && feed.hasMore && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => void feed.loadMore()}>
            {t("Load more")}
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
      <Page className="pt-[calc(4.25rem+var(--safe-top))] md:pt-24">{children}</Page>
    </>
  );
}
