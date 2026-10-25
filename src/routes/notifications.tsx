import { createFileRoute, Link } from "@tanstack/react-router";
import { Bell, Heart, MessageCircle, Settings, Trophy, UserPlus, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmptyState, ErrorState, ListSkeleton, Page, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  describeNotification,
  openInbox,
  useNotifications,
  type AppNotification,
} from "@/lib/notifications/store";
import { seo } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { formatAgo } from "@/lib/admin/api";

export const Route = createFileRoute("/notifications")({
  head: () => seo("Notifications", "Follows, comments, likes and score updates."),
  component: Notifications,
});

const icon: Record<AppNotification["kind"], typeof Bell> = {
  like: Heart,
  follow: UserPlus,
  comment: MessageCircle,
  score: Zap,
  moderation: Trophy,
  system: Bell,
};

const filters = ["All", "Scores", "Social", "Comments"] as const;

function matchesFilter(item: AppNotification, filter: (typeof filters)[number]): boolean {
  switch (filter) {
    case "All":
      return true;
    case "Scores":
      return item.kind === "score";
    case "Social":
      return item.kind === "follow" || item.kind === "like";
    case "Comments":
      return item.kind === "comment";
    default:
      return true;
  }
}

/**
 * Real inbox: rows from `public.notifications` for the signed-in user. Guests
 * get a sign-in prompt, an empty inbox gets a clean empty state, and a failure
 * gets a retry — never fixture rows and never another user's count.
 *
 * Opening the inbox reads it: once the rows have loaded, every unread one is
 * marked read and the badge in the navigation clears. The rows that were new
 * keep their dot for the rest of this visit, so the player can still see what
 * arrived; the next visit shows them as read.
 */
function Notifications() {
  const state = useNotifications();
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const opened = useRef(false);
  const hasUnread = state.status === "ready" && state.items.some((item) => !item.readAt);

  useEffect(() => {
    if (!hasUnread || opened.current) return;
    opened.current = true;
    // A failure leaves the rows unread on the server; the badge reads the real
    // count again, and the next visit tries once more.
    openInbox().catch(() => {
      opened.current = false;
    });
  }, [hasUnread]);

  if (state.status === "anonymous") {
    return (
      <Page>
        <PageHeader title="Notifications" />
        <EmptyState
          icon={Bell}
          title="Sign in to see notifications"
          body="Follows, comments and score updates show up here once you're signed in."
          action={
            <Button asChild>
              <Link to="/login" search={{ redirect: "/notifications" }}>
                Log in
              </Link>
            </Button>
          }
        />
      </Page>
    );
  }

  if (state.status === "loading") {
    return (
      <Page>
        <PageHeader title="Notifications" />
        <ListSkeleton />
      </Page>
    );
  }

  if (state.status === "error") {
    return (
      <Page>
        <PageHeader title="Notifications" />
        <ErrorState
          title="Couldn't load notifications"
          body={state.error.message}
          onRetry={state.retry}
        />
      </Page>
    );
  }

  const list = state.items.filter((item) => matchesFilter(item, filter));
  const fresh = state.items.filter((item) => !item.readAt).length;

  return (
    <Page>
      <PageHeader
        title="Notifications"
        subtitle={fresh > 0 ? `${fresh} new` : undefined}
        actions={
          <Button asChild variant="ghost" size="icon" aria-label="Notification settings">
            <Link to="/settings/$section" params={{ section: "notifications" }}>
              <Settings />
            </Link>
          </Button>
        }
      />
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-2 md:px-0">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={cn(
              "press shrink-0 rounded-full px-3.5 py-1.5 text-sm",
              filter === f
                ? "bg-foreground font-medium text-background"
                : "bg-surface text-muted-foreground",
            )}
          >
            {f}
          </button>
        ))}
        <Link
          to="/activity"
          className="ml-auto shrink-0 self-center text-sm text-muted-foreground hover:text-foreground"
        >
          Your activity
        </Link>
      </div>
      {list.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="You're all caught up"
          body="New follows, comments and score updates show up here."
        />
      ) : (
        <ul>
          {list.map((item) => {
            const Icon = icon[item.kind];
            const actor =
              typeof item.payload["username"] === "string"
                ? (item.payload["username"] as string)
                : undefined;
            const game =
              typeof item.payload["game"] === "string"
                ? (item.payload["game"] as string)
                : undefined;
            return (
              <li
                key={item.id}
                className={cn(
                  "enter flex items-center gap-3 px-4 py-3 md:rounded-lg md:px-3",
                  !item.readAt && "bg-surface",
                )}
              >
                <div className="relative">
                  <span className="flex size-10 items-center justify-center rounded-full bg-surface-2">
                    <Icon className="size-4" />
                  </span>
                </div>
                <p className="min-w-0 flex-1 text-sm">
                  {actor && (
                    <Link to="/u/$username" params={{ username: actor }} className="font-medium">
                      @{actor}{" "}
                    </Link>
                  )}
                  <span className={actor ? "text-muted-foreground" : ""}>
                    {describeNotification(item)}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {formatAgo(item.createdAt) ?? "recently"}
                  </span>
                </p>
                {game && (
                  <Button asChild size="sm" variant="secondary">
                    <Link to="/games/$id" params={{ id: game }}>
                      Open
                    </Link>
                  </Button>
                )}
                {!item.readAt && (
                  <span className="size-2 rounded-full bg-primary" aria-label="New" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
