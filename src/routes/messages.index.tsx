import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { MessageCircle, PenSquare } from "lucide-react";
import { useState } from "react";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  Page,
  PageHeader,
  UserAvatar,
} from "@/components/common";
import { PlayerPicker } from "@/components/social/PlayerPicker";
import { Button } from "@/components/ui/button";
import { formatAgo } from "@/lib/admin/api";
import { sharedGameSlug } from "@/lib/messages/shared-links";
import { CALLOUT_BODY, useInbox, type InboxEntry } from "@/lib/messages/store";
import { seo } from "@/lib/seo";
import { t } from "@/lib/settings/language";
import { getSessionUserId } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/messages/")({
  head: () => seo(t("Messages"), t("Your direct messages on Unbored.")),
  component: Messages,
});

function Messages() {
  const { state, retry } = useInbox();
  const [composing, setComposing] = useState(false);
  const navigate = useNavigate();
  const title = t("Messages");

  if (state.status === "anonymous") {
    return (
      <Page>
        <PageHeader title={title} />
        <EmptyState
          icon={MessageCircle}
          title={t("Sign in to see your messages")}
          body={t("Chat with other players once you're signed in.")}
          action={
            <Button asChild>
              <Link to="/login" search={{ redirect: "/messages" }}>
                {t("Log in")}
              </Link>
            </Button>
          }
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title={title}
        actions={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("New message")}
            onClick={() => setComposing(true)}
          >
            <PenSquare />
          </Button>
        }
      />
      {state.status === "loading" && <ListSkeleton />}
      {state.status === "error" && (
        <ErrorState title={t("Couldn't load your messages")} body={state.message} onRetry={retry} />
      )}
      {state.status === "ready" &&
        (state.entries.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title={t("No messages yet")}
            body={t("Start a chat from someone's profile, or search for a player.")}
            action={<Button onClick={() => setComposing(true)}>{t("New message")}</Button>}
          />
        ) : (
          <ul className="divide-y divide-border md:space-y-1 md:divide-y-0">
            {state.entries.map((entry) => (
              <InboxRow key={entry.conversationId} entry={entry} />
            ))}
          </ul>
        ))}
      <PlayerPicker
        open={composing}
        onOpenChange={setComposing}
        title={t("New message")}
        onPick={(profile) => {
          setComposing(false);
          void navigate({ to: "/messages/$username", params: { username: profile.username } });
        }}
      />
    </Page>
  );
}

function InboxRow({ entry }: { entry: InboxEntry }) {
  const unread = entry.unreadCount > 0;
  const mine = entry.lastSenderId === getSessionUserId();
  return (
    <li>
      <Link
        to="/messages/$username"
        params={{ username: entry.username }}
        className={cn(
          "press flex items-center gap-3 px-4 py-3 hover:bg-surface md:rounded-lg md:px-3",
          unread && "bg-surface",
        )}
      >
        <UserAvatar username={entry.username} path={entry.avatarPath} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>
              {entry.displayName || `@${entry.username}`}
            </span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {formatAgo(entry.lastAt)}
            </span>
          </span>
          <span
            className={cn(
              "block truncate text-sm",
              unread ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {entry.lastBody === CALLOUT_BODY
              ? `${CALLOUT_BODY} ${t("Callout")}`
              : sharedGameSlug(entry.lastBody)
                ? mine
                  ? t("You shared a game")
                  : t("Shared a game")
                : mine
                  ? t("You: {body}", { body: entry.lastBody })
                  : entry.lastBody}
          </span>
        </span>
        {unread && (
          <span
            className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular"
            aria-label={t("{count} unread", { count: entry.unreadCount })}
          >
            {entry.unreadCount >= 100 ? "99+" : entry.unreadCount}
          </span>
        )}
      </Link>
    </li>
  );
}
