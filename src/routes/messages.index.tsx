import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Bell, ChevronRight, Gamepad2, MessageCircle, PenSquare, Swords } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState, ListSkeleton, Page, UserAvatar } from "@/components/common";
import { InboxHeader } from "@/components/layout/SceneHeader";
import { PlayerPicker } from "@/components/social/PlayerPicker";
import { SwipeRow } from "@/components/social/SwipeRow";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAgo } from "@/lib/admin/api";
import { useShareTargets } from "@/lib/messages/share";
import { sharedGameSlug } from "@/lib/messages/shared-links";
import { CALLOUT_BODY, useInbox, type InboxEntry } from "@/lib/messages/store";
import { describeNotification, useNotifications, useUnreadCount } from "@/lib/notifications/store";
import { seo } from "@/lib/seo";
import { t } from "@/lib/settings/language";
import { getSessionUserId } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/messages/")({
  head: () => seo(t("Inbox"), t("Your direct messages on Unbored.")),
  component: Messages,
});

/**
 * The Inbox: chats, with notifications one tap away at the top, as on TikTok. The tab in
 * the navigation opens this, and a chat or the notifications list is one step further.
 */
function Messages() {
  const { state, retry, deleteChat } = useInbox();
  const [composing, setComposing] = useState(false);
  const navigate = useNavigate();
  const title = t("Inbox");

  if (state.status === "anonymous") {
    return (
      <Page>
        <InboxHeader title={title} />
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

  const unreadBy = new Map(
    state.status === "ready"
      ? state.entries.map((entry) => [entry.otherId, entry.unreadCount > 0])
      : [],
  );

  return (
    <Page>
      <InboxHeader
        title={title}
        unread={
          state.status === "ready"
            ? state.entries.reduce((total, entry) => total + entry.unreadCount, 0)
            : undefined
        }
        actions={
          <button
            type="button"
            className="inbox-compose press"
            aria-label={t("New message")}
            onClick={() => setComposing(true)}
          >
            <PenSquare className="size-5" aria-hidden />
          </button>
        }
      />

      <NotificationsCard />
      <FriendsStrip unreadBy={unreadBy} />

      <h2 className="px-4 pt-5 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase md:px-0">
        {t("Chats")}
      </h2>
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
          <ul className="space-y-0.5 px-2 md:px-0">
            {state.entries.map((entry) => (
              <InboxRow
                key={entry.conversationId}
                entry={entry}
                onDelete={() => {
                  deleteChat(entry.conversationId).catch(() => {
                    toast.error(t("Couldn't delete this chat. Try again."));
                  });
                }}
              />
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

/** The way to the notifications list, saying what is waiting there. */
function NotificationsCard() {
  const unread = useUnreadCount();
  const notifications = useNotifications();
  const count = unread.status === "ready" ? unread.count : 0;
  const latest = notifications.status === "ready" ? notifications.items[0] : undefined;
  const actor =
    latest && typeof latest.payload["username"] === "string"
      ? `@${latest.payload["username"]} `
      : "";

  return (
    <div className="px-4 md:px-0">
      <Link
        to="/notifications"
        className={cn(
          "press group relative flex items-center gap-3 overflow-hidden rounded-2xl border p-3",
          count > 0 ? "dm-card-glow border-primary/40" : "border-border bg-surface",
        )}
      >
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full",
            count > 0 ? "dm-gradient text-primary-foreground" : "bg-surface-2",
          )}
        >
          <Bell className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{t("Notifications")}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {latest
              ? `${actor}${describeNotification(latest)}`
              : t("Follows, comments and new games")}
          </span>
        </span>
        {count > 0 && (
          <span
            className="dm-gradient flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-2 text-xs font-bold text-primary-foreground tabular"
            aria-label={t("{count} unread", { count })}
          >
            {count >= 100 ? "99+" : count}
          </span>
        )}
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    </div>
  );
}

/** Friends and recent chats, one tap from a conversation. */
function FriendsStrip({ unreadBy }: { unreadBy: Map<string, boolean> }) {
  const { targets, loading } = useShareTargets(true);
  if (!loading && targets.length === 0) return null;

  return (
    <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pt-4 pb-1 md:px-0">
      {loading && targets.length === 0
        ? [0, 1, 2, 3].map((key) => (
            <span key={key} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
              <Skeleton className="size-14 rounded-full" />
              <Skeleton className="h-3 w-12" />
            </span>
          ))
        : targets.map((target) => (
            <Link
              key={target.id}
              to="/messages/$username"
              params={{ username: target.username }}
              className="press flex w-16 shrink-0 flex-col items-center gap-1.5"
            >
              <AvatarRing active={unreadBy.get(target.id) === true}>
                <UserAvatar username={target.username} path={target.avatarPath} size="lg" />
              </AvatarRing>
              <span className="w-full truncate text-center text-xs">
                {target.displayName || target.username}
              </span>
            </Link>
          ))}
    </div>
  );
}

/** Lights up around someone with something unread. */
function AvatarRing({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-full p-[2px]",
        active ? "dm-gradient" : "bg-transparent",
      )}
    >
      <span className="inline-flex rounded-full bg-background p-[2px]">{children}</span>
    </span>
  );
}

function Preview({ entry, mine }: { entry: InboxEntry; mine: boolean }) {
  if (entry.lastBody === CALLOUT_BODY) {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-primary">
        <Swords className="size-3.5 shrink-0" aria-hidden />
        {t("Callout")}
      </span>
    );
  }
  if (sharedGameSlug(entry.lastBody)) {
    return (
      <span className="inline-flex items-center gap-1">
        <Gamepad2 className="size-3.5 shrink-0" aria-hidden />
        {mine ? t("You shared a game") : t("Shared a game")}
      </span>
    );
  }
  return <>{mine ? t("You: {body}", { body: entry.lastBody }) : entry.lastBody}</>;
}

function InboxRow({ entry, onDelete }: { entry: InboxEntry; onDelete: () => void }) {
  const unread = entry.unreadCount > 0;
  const mine = entry.lastSenderId === getSessionUserId();
  return (
    <SwipeRow
      className="enter rounded-2xl"
      deleteLabel={t("Delete chat with @{username}", { username: entry.username })}
      confirmSwipe
      confirm={{
        title: t("Delete this chat?"),
        body: t("It disappears for you only. @{username} keeps their copy.", {
          username: entry.username,
        }),
      }}
      onDelete={onDelete}
    >
      <Link
        to="/messages/$username"
        params={{ username: entry.username }}
        className="flex items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors hover:bg-surface [@media(pointer:fine)]:pr-12"
      >
        <AvatarRing active={unread}>
          <UserAvatar username={entry.username} path={entry.avatarPath} />
        </AvatarRing>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("truncate text-sm", unread ? "font-bold" : "font-medium")}>
              {entry.displayName || `@${entry.username}`}
            </span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {formatAgo(entry.lastAt)}
            </span>
          </span>
          <span
            className={cn(
              "block truncate text-sm",
              unread ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            <Preview entry={entry} mine={mine} />
          </span>
        </span>
        {unread && (
          <span
            className="dm-gradient flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-primary-foreground tabular"
            aria-label={t("{count} unread", { count: entry.unreadCount })}
          >
            {entry.unreadCount >= 100 ? "99+" : entry.unreadCount}
          </span>
        )}
      </Link>
    </SwipeRow>
  );
}
