import { Ban, Flag } from "lucide-react";
import { ReportDialog } from "@/components/social/ReportDialog";
import { blockUsername } from "@/lib/settings/blocked";
import { usePlatformSettings } from "@/lib/platform-settings";
import { Check, Link2, Loader2, Mail, Reply, Search, Send, Share2, Trash2, X } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Avatar, ErrorState, UserAvatar } from "@/components/common";
import { PlayerPicker } from "@/components/social/PlayerPicker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getSessionUserId, useAuth } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/client";
import { fmt, fmtDate } from "@/lib/format";
import { useShareTargets, type ShareTarget } from "@/lib/messages/share";
import { refusal, sendMessage } from "@/lib/messages/store";
import { absoluteUrl } from "@/lib/seo";
import { MAX_COMMENT_LENGTH, useComments, type GameComment } from "@/lib/social/engagement";
import type { PublicProfile } from "@/lib/social/follows";
import { avatarUrl, getProfileState } from "@/lib/users/profile";

import { t } from "@/lib/settings/language";
/**
 * The comment thread for one game.
 *
 * Rows come from `public.comments` through the Data API; RLS decides which
 * rows the caller may see (visible rows, plus their own hidden ones for the
 * author and everything for staff), so the list is what the caller may see and
 * never a filtered mock of it. Posting validates before sending — empty and
 * over-long bodies never reach the database — and the CHECK constraint stays
 * the authority behind it. Bodies render as plain text, so no markup a caller
 * typed can execute.
 *
 * Replies sit one level deep under the comment they answer: the reply control
 * appears on top-level comments only, matching what the database accepts.
 */
export function CommentsSheet({
  open,
  onOpenChange,
  gameId,
  count,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The game's uuid. Threads are addressed by id; slugs resolve in the hook's caller. */
  gameId: string | null;
  gameSlug: string;
  /**
   * The measured total, when the caller already has one. The sheet re-reads it
   * with the thread, so the header never shows a count the list contradicts.
   */
  count?: number | null;
}) {
  const auth = useAuth();
  // Signing in from here returns to the page the sheet was opened on — the feed
  // or the game page — not always the game page.
  const here = useRouterState({ select: (s) => s.location.href });
  const profile = getProfileState();
  const avatar = profile.status === "ready" ? avatarUrl(profile.profile) : undefined;
  const name = profile.status === "ready" ? profile.profile.username : "";
  const myId = auth.status === "authenticated" ? auth.session.userId : null;
  const thread = useComments(open ? (gameId ?? undefined) : undefined);
  const [draft, setDraft] = useState("");
  const [postError, setPostError] = useState<string>();
  const [replyTo, setReplyTo] = useState<GameComment | null>(null);
  const [reporting, setReporting] = useState<GameComment | null>(null);
  const platform = usePlatformSettings();
  const input = useRef<HTMLInputElement>(null);

  // Top-level comments in order, each with its replies. A reply whose parent is
  // not in the list (hidden or removed) is not shown on its own.
  const threads = useMemo(() => {
    const replies = new Map<string, GameComment[]>();
    for (const item of thread.items) {
      if (item.parentId === null) continue;
      const list = replies.get(item.parentId) ?? [];
      list.push(item);
      replies.set(item.parentId, list);
    }
    return thread.items
      .filter((item) => item.parentId === null)
      .map((item) => ({ comment: item, replies: replies.get(item.id) ?? [] }));
  }, [thread.items]);

  // A reply target that has since been deleted is dropped.
  const activeReply = replyTo && thread.items.some((i) => i.id === replyTo.id) ? replyTo : null;

  const total = thread.count ?? count ?? null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (thread.posting) return;
    setPostError(undefined);
    try {
      await thread.post(draft, activeReply?.id);
      setDraft("");
      setReplyTo(null);
    } catch (error) {
      setPostError(error instanceof ApiError ? error.message : t("Couldn't post the comment."));
    }
  }

  async function blockAuthor(comment: GameComment) {
    if (!comment.author) return;
    try {
      await blockUsername(comment.author.username);
      toast.success(t("Blocked @{username}", { username: comment.author.username }));
      thread.retry();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Couldn't block this account."));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {reporting && (
        <ReportDialog
          open
          onOpenChange={(next) => {
            if (!next) setReporting(null);
          }}
          kind="comment"
          targetId={reporting.id}
          subject={t("this comment")}
        />
      )}
      <SheetContent
        side="bottom"
        className="mx-auto flex h-[78dvh] max-w-xl flex-col rounded-t-2xl border-glass-border p-0"
      >
        <SheetHeader className="border-b border-border px-4 py-3 text-center">
          <SheetTitle className="text-sm">
            {total === null
              ? t("Comments")
              : t("{total} comment{n}", { total: fmt(total), n: total === 1 ? "" : "s" })}
          </SheetTitle>
          <SheetDescription className="sr-only">{t("Comments on this game")}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {thread.loading ? (
            <div className="space-y-3" aria-busy="true" aria-label={t("Loading comments")}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3">
                  <div className="size-8 shrink-0 animate-pulse rounded-full bg-surface-2" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-24 animate-pulse rounded bg-surface-2" />
                    <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
                  </div>
                </div>
              ))}
            </div>
          ) : thread.error ? (
            <ErrorState
              title={t("Couldn't load comments")}
              body={thread.error}
              onRetry={thread.retry}
            />
          ) : thread.items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
              <p className="font-medium">{t("No comments yet")}</p>
              <p className="text-sm text-muted-foreground">
                {auth.status === "authenticated"
                  ? t("Start the conversation below.")
                  : t("Sign in to start the conversation.")}
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {threads.map(({ comment, replies }) => (
                <CommentRow
                  key={comment.id}
                  comment={comment}
                  mine={myId !== null && comment.authorId === myId}
                  onDelete={() => thread.remove(comment.id)}
                  onReport={myId !== null ? () => setReporting(comment) : undefined}
                  onBlock={myId !== null ? () => void blockAuthor(comment) : undefined}
                  onReply={
                    auth.status === "authenticated"
                      ? () => {
                          setReplyTo(comment);
                          input.current?.focus();
                        }
                      : undefined
                  }
                >
                  {replies.length > 0 && (
                    <ul className="mt-3 space-y-3" aria-label={t("Replies")}>
                      {replies.map((reply) => (
                        <CommentRow
                          key={reply.id}
                          comment={reply}
                          mine={myId !== null && reply.authorId === myId}
                          onDelete={() => thread.remove(reply.id)}
                          onReport={myId !== null ? () => setReporting(reply) : undefined}
                          onBlock={myId !== null ? () => void blockAuthor(reply) : undefined}
                        />
                      ))}
                    </ul>
                  )}
                </CommentRow>
              ))}
            </ul>
          )}
        </div>
        {!platform.commentsEnabled ? (
          <div className="safe-bottom border-t border-border p-3 text-center">
            <p className="text-sm text-muted-foreground">{t("New comments are paused for now.")}</p>
          </div>
        ) : auth.status === "authenticated" ? (
          <form className="safe-bottom border-t border-border p-3" onSubmit={(e) => void submit(e)}>
            {activeReply && (
              <div className="mb-2 flex items-center justify-between rounded-full bg-surface-2 px-3 py-1 text-xs text-muted-foreground">
                <span className="truncate">
                  {t("Replying to")}{" "}
                  {activeReply.author ? `@${activeReply.author.username}` : t("a player")}
                </span>
                <button
                  type="button"
                  aria-label={t("Cancel reply")}
                  className="ml-2 shrink-0 hover:text-foreground"
                  onClick={() => setReplyTo(null)}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}
            <Label htmlFor="comment" className="sr-only">
              {activeReply ? t("Write a reply") : t("Add a comment")}
            </Label>
            <div className="flex items-center gap-2">
              <Avatar name={name} src={avatar} size="sm" />
              <input
                id="comment"
                ref={input}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={activeReply ? t("Add a reply…") : t("Add a comment…")}
                maxLength={MAX_COMMENT_LENGTH + 1}
                aria-describedby={postError ? "comment-error" : undefined}
                className="h-10 flex-1 rounded-full bg-surface-2 px-4 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                type="submit"
                size="icon"
                aria-label={activeReply ? t("Post reply") : t("Post comment")}
                disabled={thread.posting || draft.trim() === ""}
                className="rounded-full"
              >
                <Send />
              </Button>
            </div>
            {postError && (
              <p id="comment-error" role="alert" className="mt-2 px-2 text-xs text-destructive">
                {postError}
              </p>
            )}
          </form>
        ) : (
          <div className="safe-bottom border-t border-border p-3 text-center">
            <p className="text-sm text-muted-foreground">
              <Link
                to="/login"
                search={{ redirect: here }}
                className="font-medium text-foreground underline underline-offset-4"
              >
                {t("Log in")}
              </Link>{" "}
              {t("to join the conversation.")}
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CommentRow({
  comment,
  mine,
  onDelete,
  onReply,
  onReport,
  onBlock,
  children,
}: {
  comment: GameComment;
  mine: boolean;
  onDelete: () => Promise<void>;
  /** Present for a signed-in viewer; only offered on someone else's comment. */
  onReport?: () => void;
  onBlock?: () => void;
  /** Present on top-level comments of a signed-in viewer only. */
  onReply?: () => void;
  /** The nested replies, rendered under the body. */
  children?: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const date = fmtDate(comment.createdAt);
  const edited = comment.editedAt && comment.editedAt !== comment.createdAt;
  // The author arrives attached to the comment by `fetchComments`, with the
  // same `avatar_path` field the profile page reads. A comment whose author row
  // could not be read keeps its row and falls back to the initials avatar rather
  // than disappearing.
  const author = comment.author;

  return (
    <li className="flex gap-3">
      {author ? (
        <Link
          to="/u/$username"
          params={{ username: author.username }}
          aria-label={t("View @{username}'s profile", { username: author.username })}
          className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <UserAvatar username={author.username} path={author.avatar_path} size="sm" />
        </Link>
      ) : (
        <Avatar name="" size="sm" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {author ? (
            <Link
              to="/u/$username"
              params={{ username: author.username }}
              className="text-sm font-medium hover:underline hover:underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              @{author.username}
            </Link>
          ) : (
            <span className="text-sm font-medium">{t("A player")}</span>
          )}
          {date && <span className="text-xs text-muted-foreground">{date}</span>}
          {edited && <span className="text-xs text-muted-foreground">{t("· edited")}</span>}
        </div>
        <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">{comment.body}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          {onReply && (
            <button
              type="button"
              aria-label={t("Reply to {n}", { n: author ? `@${author.username}` : "this comment" })}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={onReply}
            >
              <Reply className="size-3.5" />
              {t("Reply")}
            </button>
          )}
          {!mine && onReport && (
            <button
              type="button"
              aria-label={t("Report comment")}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={onReport}
            >
              <Flag className="size-3.5" />
              {t("Report")}
            </button>
          )}
          {!mine && onBlock && author && (
            <button
              type="button"
              aria-label={t("Block @{username}", { username: author.username })}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
              onClick={onBlock}
            >
              <Ban className="size-3.5" />
              {t("Block")}
            </button>
          )}
          {mine && (
            <div>
              {confirming ? (
                <span className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{t("Delete this comment?")}</span>
                  <button
                    type="button"
                    disabled={busy}
                    className="font-medium text-destructive underline underline-offset-4 disabled:opacity-50"
                    onClick={() => {
                      setBusy(true);
                      void onDelete()
                        .catch(() => {
                          toast.error(t("Couldn't delete the comment."));
                        })
                        .finally(() => {
                          setBusy(false);
                          setConfirming(false);
                        });
                    }}
                  >
                    {t("Delete")}
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground underline underline-offset-4"
                    onClick={() => setConfirming(false)}
                  >
                    {t("Keep")}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={t("Delete comment")}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirming(true)}
                >
                  <Trash2 className="size-3.5" />
                  {t("Delete")}
                </button>
              )}
            </div>
          )}
        </div>
        {children}
      </div>
    </li>
  );
}

/** One person in the share sheet's row: a tap sends straight away, as on TikTok. */
function ShareTargetButton({
  target,
  state,
  onSend,
}: {
  target: Pick<ShareTarget, "username" | "displayName" | "avatarPath">;
  state: "idle" | "sending" | "sent";
  onSend: () => void;
}) {
  const name = target.displayName || target.username;
  return (
    <button
      type="button"
      disabled={state !== "idle"}
      onClick={onSend}
      aria-label={
        state === "sent"
          ? t("Sent to @{username}", { username: target.username })
          : t("Send to @{username}", { username: target.username })
      }
      className="press flex w-16 shrink-0 flex-col items-center gap-1.5"
    >
      <span className="relative">
        <UserAvatar username={target.username} path={target.avatarPath} size="lg" />
        {state !== "idle" && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
            {state === "sending" ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : (
              <Check className="size-6 text-primary" aria-hidden />
            )}
          </span>
        )}
      </span>
      <span className="w-full truncate text-center text-xs">
        {state === "sent" ? t("Sent") : name}
      </span>
    </button>
  );
}

/** A round option under the row of people. */
function ShareOption({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Link2;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press flex w-16 shrink-0 flex-col items-center gap-1.5"
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-surface-2">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="w-full text-center text-xs">{label}</span>
    </button>
  );
}

/**
 * Sharing is a link: the canonical URL, built from the stable slug through the same
 * helper the metadata uses. Sending it to someone is an ordinary direct message, which a
 * chat draws as a card when it is a game. Copying reports success only when the
 * clipboard write actually succeeded, and the native sheet is used where the platform
 * offers one.
 */
export function ShareSheet({
  open,
  onOpenChange,
  title,
  path,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  /** The app route being shared (`/games/<slug>`, `/u/<username>`). The link
   * is the canonical absolute URL for it, not the current location. */
  path: string;
}) {
  const url = absoluteUrl(path);
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const auth = useAuth();
  const signedIn = auth.status === "authenticated";
  const [picking, setPicking] = useState(false);
  const { targets, loading } = useShareTargets(open && signedIn);
  // Who it has gone to, by account, while this sheet is open. Sending twice is a tap away
  // otherwise, and a friend doesn't need the same game twice.
  const [sends, setSends] = useState<Record<string, "sending" | "sent">>({});
  // Someone found through search isn't in the row yet, and should appear there as sent.
  const [picked, setPicked] = useState<ShareTarget[]>([]);
  const people = [...picked, ...targets.filter((t) => !picked.some((p) => p.id === t.id))];

  useEffect(() => {
    if (open) return;
    setSends({});
    setPicked([]);
  }, [open]);

  async function sendTo(id: string, username: string): Promise<void> {
    setSends((current) => ({ ...current, [id]: "sending" }));
    const forget = () =>
      setSends((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    try {
      const { outcome } = await sendMessage(id, url, crypto.randomUUID());
      if (outcome === "sent") {
        setSends((current) => ({ ...current, [id]: "sent" }));
        toast.success(t("Sent to @{username}", { username }));
      } else {
        forget();
        toast.error(refusal(outcome));
      }
    } catch (error) {
      forget();
      toast.error(error instanceof ApiError ? error.message : t("Couldn't send your message."));
    }
  }

  function pick(profile: PublicProfile): void {
    setPicking(false);
    setPicked((current) =>
      current.some((p) => p.id === profile.id)
        ? current
        : [
            {
              id: profile.id,
              username: profile.username,
              displayName: profile.display_name,
              avatarPath: profile.avatar_path,
            },
            ...current,
          ],
    );
    if (!sends[profile.id]) void sendTo(profile.id, profile.username);
  }

  async function copyLink(): Promise<void> {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      toast.success(t("Link copied"));
    } catch {
      toast.error(t("Couldn't copy the link."));
    }
  }

  async function systemShare(): Promise<void> {
    if (typeof navigator.share !== "function") {
      await copyLink();
      return;
    }
    try {
      await navigator.share({ title, url });
    } catch (error) {
      // Dismissing the sheet is not a failure; anything else is reported, with
      // the clipboard as the fallback only when it actually works.
      if (error instanceof DOMException && error.name === "AbortError") return;
      await copyLink();
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="mx-auto max-w-xl rounded-t-2xl border-glass-border pb-8"
        >
          <SheetHeader>
            <SheetTitle>{t("Share {title}", { title })}</SheetTitle>
            <SheetDescription>
              {t("Send it to a friend, or share it somewhere else.")}
            </SheetDescription>
          </SheetHeader>

          <section aria-label={t("Send to")} className="px-6 pt-2">
            <h3 className="pb-2 text-xs font-medium text-muted-foreground">{t("Send to")}</h3>
            {signedIn ? (
              <div className="no-scrollbar -mx-6 flex gap-3 overflow-x-auto px-6 py-1">
                <ShareOption icon={Search} label={t("Search")} onClick={() => setPicking(true)} />
                {loading &&
                  people.length === 0 &&
                  [0, 1, 2].map((key) => (
                    <span key={key} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
                      <Skeleton className="size-14 rounded-full" />
                      <Skeleton className="h-3 w-12" />
                    </span>
                  ))}
                {people.map((target) => (
                  <ShareTargetButton
                    key={target.id}
                    target={target}
                    state={sends[target.id] ?? "idle"}
                    onSend={() => void sendTo(target.id, target.username)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                <Link
                  to="/login"
                  search={{ redirect: currentPath }}
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  {t("Log in")}
                </Link>{" "}
                {t("to send this to a friend.")}
              </p>
            )}
            {signedIn && !loading && people.length === 0 && (
              <p className="pt-2 text-xs text-muted-foreground">
                {t("Friends you follow back show up here. Search to find someone.")}
              </p>
            )}
          </section>

          <section aria-label={t("Share to")} className="px-6 pt-4">
            <h3 className="pb-2 text-xs font-medium text-muted-foreground">{t("Share to")}</h3>
            <div className="no-scrollbar -mx-6 flex gap-3 overflow-x-auto px-6 py-1">
              <ShareOption icon={Link2} label={t("Copy link")} onClick={() => void copyLink()} />
              <ShareOption
                icon={Mail}
                label={t("Email")}
                onClick={() => {
                  window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`;
                }}
              />
              <ShareOption
                icon={Share2}
                label={t("More options")}
                onClick={() => void systemShare()}
              />
            </div>
          </section>
        </SheetContent>
      </Sheet>
      <PlayerPicker
        open={picking}
        onOpenChange={setPicking}
        title={t("Send to a player")}
        onPick={pick}
      />
    </>
  );
}
