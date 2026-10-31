import { createFileRoute, Link } from "@tanstack/react-router";
import { Inbox } from "lucide-react";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  Page,
  PageHeader,
  Section,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { fmt, fmtDate, points } from "@/lib/format";
import { useActivity } from "@/lib/social/engagement";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/activity")({
  head: () => seo("Activity", "Your recent plays, scores, likes and comments."),
  component: Activity,
});

/**
 * Your activity.
 *
 * Every row is read from the database: recent verified scores, liked games,
 * saved games and written comments. An action the visitor did not take never
 * appears — an empty section means nothing happened yet, not that nothing was
 * measured.
 */
function Activity() {
  const feed = useActivity();

  if (feed.status === "anonymous") {
    return (
      <Page>
        <PageHeader back title="Your activity" subtitle="Plays, likes, comments and saves." />
        <EmptyState
          icon={Inbox}
          title="Sign in to see your activity"
          body="Your plays, likes, comments and saves show up here once you sign in."
          action={
            <Button asChild>
              <Link to="/login" search={{ redirect: "/activity" }}>
                Log in
              </Link>
            </Button>
          }
        />
      </Page>
    );
  }

  if (feed.status === "loading") {
    return (
      <Page>
        <PageHeader back title="Your activity" subtitle="Plays, likes, comments and saves." />
        <ListSkeleton rows={4} avatar={false} />
      </Page>
    );
  }

  if (feed.status === "error") {
    return (
      <Page>
        <PageHeader back title="Your activity" subtitle="Plays, likes, comments and saves." />
        <ErrorState title="Couldn't load activity" body={feed.error} onRetry={feed.retry} />
      </Page>
    );
  }

  const { likes, saves, comments, scores } = feed.data;
  const empty =
    likes.length === 0 && saves.length === 0 && comments.length === 0 && scores.length === 0;

  if (empty) {
    return (
      <Page>
        <PageHeader back title="Your activity" subtitle="Plays, likes, comments and saves." />
        <EmptyState
          icon={Inbox}
          title="No activity yet"
          body="Finish a run, like or save a game, or write a comment — it shows up here."
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader back title="Your activity" subtitle="Plays, likes, comments and saves." />
      {scores.length > 0 && (
        <Section title="Recent scores">
          <ul className="mx-4 divide-y divide-border overflow-hidden rounded-xl bg-surface md:mx-0">
            {scores.map((entry, i) => (
              <li
                key={`${entry.game?.slug ?? "game"}-${entry.createdAt}-${i}`}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span className="font-semibold tabular">{fmt(points(entry.score))}</span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {entry.game ? (
                    <Link
                      to="/games/$id"
                      params={{ id: entry.game.slug }}
                      className="hover:underline"
                    >
                      {entry.game.title}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">A game</span>
                  )}
                </span>
                {fmtDate(entry.createdAt) && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {fmtDate(entry.createdAt)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {likes.length > 0 && (
        <Section
          title="Liked games"
          action={
            <Link to="/likes" className="text-sm text-muted-foreground hover:text-foreground">
              View all
            </Link>
          }
        >
          <ul className="mx-4 divide-y divide-border overflow-hidden rounded-xl bg-surface md:mx-0">
            {likes.map((game) => (
              <li key={game.slug} className="px-4 py-3 text-sm">
                <Link to="/games/$id" params={{ id: game.slug }} className="hover:underline">
                  {game.title}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {saves.length > 0 && (
        <Section
          title="Saved games"
          action={
            <Link to="/saved" className="text-sm text-muted-foreground hover:text-foreground">
              View all
            </Link>
          }
        >
          <ul className="mx-4 divide-y divide-border overflow-hidden rounded-xl bg-surface md:mx-0">
            {saves.map((game) => (
              <li key={game.slug} className="px-4 py-3 text-sm">
                <Link to="/games/$id" params={{ id: game.slug }} className="hover:underline">
                  {game.title}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {comments.length > 0 && (
        <Section title="Recent comments">
          <ul className="mx-4 divide-y divide-border overflow-hidden rounded-xl bg-surface md:mx-0">
            {comments.map((comment) => (
              <li key={comment.id} className="px-4 py-3">
                <p className="truncate text-sm">{comment.body}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  on{" "}
                  {comment.gameSlug !== "" ? (
                    <Link
                      to="/games/$id"
                      params={{ id: comment.gameSlug }}
                      className="hover:underline"
                    >
                      {comment.gameTitle}
                    </Link>
                  ) : (
                    comment.gameTitle
                  )}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Page>
  );
}
