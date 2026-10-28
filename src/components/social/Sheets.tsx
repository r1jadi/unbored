import { Link2, Mail, MessageCircle, Send, Trash2 } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Avatar, ErrorState, UserAvatar } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/client";
import { fmt, fmtDate } from "@/lib/format";
import { absoluteUrl } from "@/lib/seo";
import { MAX_COMMENT_LENGTH, useComments, type GameComment } from "@/lib/social/engagement";
import { avatarUrl, getProfileState } from "@/lib/users/profile";

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

  const total = thread.count ?? count ?? null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (thread.posting) return;
    setPostError(undefined);
    try {
      await thread.post(draft);
      setDraft("");
    } catch (error) {
      setPostError(error instanceof ApiError ? error.message : "Couldn't post the comment.");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto flex h-[78dvh] max-w-xl flex-col rounded-t-2xl border-glass-border p-0"
      >
        <SheetHeader className="border-b border-border px-4 py-3 text-center">
          <SheetTitle className="text-sm">
            {total === null ? "Comments" : `${fmt(total)} comment${total === 1 ? "" : "s"}`}
          </SheetTitle>
          <SheetDescription className="sr-only">Comments on this game</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {thread.loading ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading comments">
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
            <ErrorState title="Couldn't load comments" body={thread.error} onRetry={thread.retry} />
          ) : thread.items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
              <p className="font-medium">No comments yet</p>
              <p className="text-sm text-muted-foreground">
                {auth.status === "authenticated"
                  ? "Start the conversation below."
                  : "Sign in to start the conversation."}
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {thread.items.map((comment) => (
                <CommentRow
                  key={comment.id}
                  comment={comment}
                  mine={myId !== null && comment.authorId === myId}
                  onDelete={() => thread.remove(comment.id)}
                />
              ))}
            </ul>
          )}
        </div>
        {auth.status === "authenticated" ? (
          <form className="safe-bottom border-t border-border p-3" onSubmit={(e) => void submit(e)}>
            <Label htmlFor="comment" className="sr-only">
              Add a comment
            </Label>
            <div className="flex items-center gap-2">
              <Avatar name={name} src={avatar} size="sm" />
              <input
                id="comment"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add a comment…"
                maxLength={MAX_COMMENT_LENGTH + 1}
                aria-describedby={postError ? "comment-error" : undefined}
                className="h-10 flex-1 rounded-full bg-surface-2 px-4 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                type="submit"
                size="icon"
                aria-label="Post comment"
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
                Log in
              </Link>{" "}
              to join the conversation.
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
}: {
  comment: GameComment;
  mine: boolean;
  onDelete: () => Promise<void>;
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
          aria-label={`View @${author.username}'s profile`}
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
            <span className="text-sm font-medium">A player</span>
          )}
          {date && <span className="text-xs text-muted-foreground">{date}</span>}
          {edited && <span className="text-xs text-muted-foreground">· edited</span>}
        </div>
        <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">{comment.body}</p>
        {mine && (
          <div className="mt-1">
            {confirming ? (
              <span className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Delete this comment?</span>
                <button
                  type="button"
                  disabled={busy}
                  className="font-medium text-destructive underline underline-offset-4 disabled:opacity-50"
                  onClick={() => {
                    setBusy(true);
                    void onDelete()
                      .catch(() => {
                        toast.error("Couldn't delete the comment.");
                      })
                      .finally(() => {
                        setBusy(false);
                        setConfirming(false);
                      });
                  }}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="text-muted-foreground underline underline-offset-4"
                  onClick={() => setConfirming(false)}
                >
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                aria-label="Delete comment"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="size-3.5" />
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Sharing is a link, not a backend write: the canonical game URL, built from
 * the stable slug through the same helper the metadata uses. Copying reports
 * success only when the clipboard write actually succeeded, and the native
 * sheet is used where the platform offers one.
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

  async function copyLink(): Promise<void> {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link.");
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-xl rounded-t-2xl border-glass-border pb-8"
      >
        <SheetHeader>
          <SheetTitle>Share {title}</SheetTitle>
          <SheetDescription>Copy a link or use your device share sheet.</SheetDescription>
        </SheetHeader>
        <div className="grid grid-cols-3 gap-2 px-4 pt-2">
          <Button
            variant="secondary"
            className="h-16 flex-col gap-1 text-xs"
            onClick={() => void copyLink()}
          >
            <Link2 />
            Copy link
          </Button>
          <Button
            variant="secondary"
            className="h-16 flex-col gap-1 text-xs"
            onClick={() => toast("Direct messages are not implemented.")}
          >
            <MessageCircle />
            Message
          </Button>
          <Button
            variant="secondary"
            className="h-16 flex-col gap-1 text-xs"
            onClick={() => {
              window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`;
            }}
          >
            <Mail />
            Email
          </Button>
        </div>
        <div className="px-4 pt-3">
          <Button className="w-full" variant="outline" onClick={() => void systemShare()}>
            More options
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
