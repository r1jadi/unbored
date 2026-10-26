import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Bookmark, Clock, Heart, MessageCircle, Play, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState, Page, PageHeader, Section } from "@/components/common";
import { GameArt } from "@/components/game/GameArt";
import { GameCard } from "@/components/game/GameCard";
import { LeaderboardList } from "@/components/game/Leaderboard";
import { YourStats } from "@/components/game/YourStats";
import { CommentsSheet, ShareSheet } from "@/components/social/Sheets";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { fmt, fmtDate } from "@/lib/format";
import {
  categoryName,
  catalogErrorMessage,
  titleFromSlug,
  useGame,
  useGames,
  type Game,
} from "@/lib/games/catalog";
import { useGameEngagement } from "@/lib/social/engagement";
import { useDocumentTitle } from "@/lib/document-title";
import { prefetchGamePage } from "@/lib/prefetch";
import { breadcrumbJsonLd, seo, videoGameJsonLd } from "@/lib/seo";

export const Route = createFileRoute("/games/$id")({
  loader: ({ context, params }) => prefetchGamePage(context.queryClient, params.id),
  // Document metadata is built before the record arrives, so the title comes from
  // the URL. It is the same title the API will report, and nothing is claimed
  // that is not known: no description, no category, no metrics.
  head: ({ params }) => {
    const title = titleFromSlug(params.id);
    return seo(title, `${title} on Unbored.`, {
      type: "video.other",
      jsonLd: [
        videoGameJsonLd({ id: params.id, title }),
        breadcrumbJsonLd([
          { name: "Explore", path: "/explore" },
          { name: title, path: `/games/${params.id}` },
        ]),
      ],
    });
  },
  component: GameDetails,
});

function GameDetails() {
  const { id } = Route.useParams();
  const state = useGame(id);
  useDocumentTitle(
    state.status === "ready"
      ? state.game.title
      : state.status === "missing"
        ? "Game not found"
        : undefined,
  );

  if (state.status === "loading") {
    return (
      <Page className="max-w-5xl pb-40 md:pb-12">
        <PageHeader back title={titleFromSlug(id)} />
        <Skeleton className="aspect-square w-full md:rounded-2xl" />
      </Page>
    );
  }

  if (state.status === "missing") {
    return (
      <Page className="max-w-5xl">
        <PageHeader back title="Game not found" />
        <EmptyState
          title="No such game"
          body="This game is not in the catalogue. It may not be published, or the link may be wrong."
          action={
            <Button asChild variant="secondary">
              <Link to="/explore">Browse games</Link>
            </Button>
          }
        />
      </Page>
    );
  }

  if (state.status === "error") {
    return (
      <Page className="max-w-5xl">
        <PageHeader back title={titleFromSlug(id)} />
        <ErrorState
          title="Couldn't load this game"
          body={catalogErrorMessage(state.error)}
          onRetry={state.retry}
        />
      </Page>
    );
  }

  return <Detail game={state.game} />;
}

function Detail({ game }: { game: Game }) {
  const [comments, setComments] = useState(false);
  const [share, setShare] = useState(false);
  const nav = useNavigate();
  const engagement = useGameEngagement(game.slug);

  const category = categoryName(game);
  const published = fmtDate(game.publishedAt);

  // Liking and saving need an account. Anonymous visitors are sent to sign in
  // with a redirect back to this game, instead of watching a toggle that
  // cannot persist.
  async function guarded(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError && error.code === "unauthorized") {
        nav({ to: "/login", search: { redirect: `/games/${game.slug}` } });
        return;
      }
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    }
  }

  return (
    <Page className="max-w-5xl pb-40 md:pb-12">
      <PageHeader back title={game.title} />
      <div className="md:grid md:grid-cols-[minmax(0,1fr)_340px] md:gap-8">
        <div>
          <GameArt
            id={game.slug}
            className="aspect-square w-full border-glass-border md:rounded-2xl md:border"
          />
          <div className="px-4 pt-4 md:px-0">
            {game.isOfficial && (
              <p className="text-sm font-medium text-muted-foreground">Unbored</p>
            )}
            {game.tagline && <p className="mt-1 text-lg font-medium">{game.tagline}</p>}
            {game.description && <p className="mt-3 text-muted-foreground">{game.description}</p>}

            {/* The cells the API can actually fill. `plays` is a real count of
                completed runs, counted in the database; the prototype's "Avg
                session" came from fixtures and is gone rather than zeroed,
                because a zero is a measurement and nothing was measured. */}
            <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-surface p-3 text-center">
              {(
                [
                  ["Plays", String(game.plays)],
                  ["Category", category ?? "—"],
                  ["Published", published ?? "—"],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular">{value}</dd>
                </div>
              ))}
            </dl>

            {game.instructions && (
              <section className="mt-4 rounded-xl border border-border p-4">
                <h2 className="text-sm font-semibold">How to play</h2>
                <p className="mt-1 text-sm text-muted-foreground">{game.instructions}</p>
              </section>
            )}

            <YourStats slug={game.slug} />

            <div className="mt-4 flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                aria-pressed={engagement.liked}
                onClick={() => void guarded(() => engagement.toggleLike())}
              >
                <Heart className={engagement.liked ? "fill-primary text-primary" : ""} />
                Like
                {engagement.likeCount !== null && engagement.likeCount > 0 && (
                  <span className="tabular text-muted-foreground">{fmt(engagement.likeCount)}</span>
                )}
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setComments(true)}>
                <MessageCircle />
                Comments
                {engagement.commentCount !== null && engagement.commentCount > 0 && (
                  <span className="tabular text-muted-foreground">
                    {fmt(engagement.commentCount)}
                  </span>
                )}
              </Button>
              <Button
                variant="secondary"
                size="icon"
                aria-label="Save"
                aria-pressed={engagement.saved}
                onClick={() => void guarded(() => engagement.toggleSave())}
              >
                <Bookmark className={engagement.saved ? "fill-primary text-primary" : ""} />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                aria-label="Share"
                onClick={() => setShare(true)}
              >
                <Share2 />
              </Button>
            </div>
          </div>
        </div>

        <aside className="md:sticky md:top-8 md:self-start">
          <div className="hidden rounded-2xl border border-border bg-surface p-4 md:block">
            <p className="text-xs text-muted-foreground">Availability</p>
            <p className="flex items-center gap-2 text-lg font-semibold">
              {game.playable ? (
                "Playable"
              ) : (
                <>
                  <Clock className="size-4" /> Not playable yet
                </>
              )}
            </p>
            {game.playable ? (
              <Button asChild variant="play" size="xl" className="mt-4 w-full">
                <Link to="/play/$id" params={{ id: game.slug }} search={{ start: true }}>
                  <Play className="fill-current" />
                  Play
                </Link>
              </Button>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                This game has no runtime yet, so there is nothing to start. It is listed because it
                is part of the catalogue.
              </p>
            )}
          </div>
          <Section
            title="Top scores"
            action={
              <Link
                to="/leaderboards/$id"
                params={{ id: game.slug }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Full board
              </Link>
            }
          >
            <LeaderboardList gameSlug={game.slug} limit={5} />
          </Section>
        </aside>
      </div>

      <MoreLikeThis game={game} />

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-background p-3 md:hidden">
        {game.playable ? (
          <Button asChild variant="play" size="lg" className="w-full">
            <Link to="/play/$id" params={{ id: game.slug }} search={{ start: true }}>
              <Play className="fill-current" />
              Play {game.title}
            </Link>
          </Button>
        ) : (
          <Button variant="secondary" size="lg" className="w-full" disabled>
            <Clock />
            Not playable yet
          </Button>
        )}
      </div>

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
    </Page>
  );
}

/**
 * Other games in the same category.
 *
 * It comes from the catalogue rather than the page's own game list, so it is
 * genuinely "more like this" — same category — and not simply whichever four
 * games happened to follow in a fixture array. A separate component so its
 * request is only made once a category is known.
 */
function MoreLikeThis({ game }: { game: Game }) {
  const category = game.category?.slug;

  if (!category) return null;
  return <SameCategory category={category} exclude={game.slug} />;
}

function SameCategory({ category, exclude }: { category: string; exclude: string }) {
  const { status, items } = useGames({ category, limit: 5 });
  const related = items.filter((g) => g.slug !== exclude).slice(0, 4);

  if (status !== "ready") return null;

  return (
    <Section title="More like this">
      {related.length === 0 ? (
        <div className="px-4 md:px-0">
          <EmptyState
            title="Nothing else here yet"
            body="This is the only game in its category so far."
          />
        </div>
      ) : (
        <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 md:grid md:grid-cols-4 md:px-0">
          {related.map((other) => (
            <GameCard key={other.slug} game={other} className="w-36 shrink-0 md:w-auto" />
          ))}
        </div>
      )}
    </Section>
  );
}
