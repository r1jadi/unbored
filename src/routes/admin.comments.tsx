import { createFileRoute, Link } from "@tanstack/react-router";
import { EyeOff, MessageSquare, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AdminListStates,
  AdminPage,
  AdminTable,
  FilterSelect,
  MobileRow,
  OffsetPager,
  PromptDialog,
  SearchField,
  SectionCard,
  StatusBadge,
  Toolbar,
  useDebounced,
  type Column,
} from "@/components/admin/ui";
import { UserAvatar } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  ADMIN_LIMIT,
  asApiError,
  formatAgo,
  moderateComment,
  useAdminComments,
  useAdminOverview,
  type AdminComment,
  type CommentState,
} from "@/lib/admin/api";
import { fmt } from "@/lib/format";

export const Route = createFileRoute("/admin/comments")({
  head: () => ({
    meta: [{ title: "Comments — Unbored admin" }, { name: "robots", content: "noindex" }],
  }),
  component: CommentsAdmin,
});

const stateOptions = [
  { value: "all", label: "All comments" },
  { value: "visible", label: "Visible" },
  { value: "hidden", label: "Hidden" },
];

/** A hide or restore waiting on its reason. */
type Pending = { comment: AdminComment; hidden: boolean } | null;

/**
 * Every comment, including the hidden ones.
 *
 * A hide is a database write: `admin_set_comment_hidden` sets the flag and writes
 * the audit row in one transaction, so the list refreshes from the source rather
 * than from local state that could drift from it.
 */
export function CommentsAdmin() {
  const [state, setState] = useState<CommentState>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const term = useDebounced(q.trim());

  const comments = useAdminComments({
    state,
    q: term || undefined,
    limit: ADMIN_LIMIT,
    offset: page * ADMIN_LIMIT,
  });
  const overview = useAdminOverview();

  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = comments.status === "ready" ? comments.data.items : [];
  const hasMore = comments.status === "ready" ? comments.data.hasMore : false;

  const decide = (comment: AdminComment, hidden: boolean, reason?: string) => {
    setBusy(comment.id);
    moderateComment(comment.id, hidden, reason)
      .then((result) => {
        toast.success(result.hidden ? "Comment hidden." : "Comment restored.");
        comments.retry();
        overview.retry();
      })
      .catch((error: unknown) => toast.error(asApiError(error).message))
      .finally(() => setBusy(null));
  };

  const columns: Column<AdminComment>[] = [
    {
      key: "comment",
      head: "Comment",
      className: "min-w-80",
      cell: (c) => (
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm">{c.body}</p>
          {c.isReply && (
            <span className="mt-1 inline-block text-xs text-muted-foreground">reply</span>
          )}
        </div>
      ),
    },
    {
      key: "author",
      head: "Author",
      cell: (c) => (
        <span className="flex items-center gap-2">
          <UserAvatar username={c.authorUsername} size="sm" />
          <span className="truncate text-sm">@{c.authorUsername}</span>
        </span>
      ),
    },
    {
      key: "game",
      head: "On",
      cell: (c) => (
        <Link
          to="/games/$id"
          params={{ id: c.gameSlug }}
          className="truncate text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          {c.gameTitle}
        </Link>
      ),
    },
    {
      key: "engagement",
      head: "Likes / reports",
      className: "text-right",
      cell: (c) => (
        <span className="font-mono text-sm tabular">
          {fmt(c.likes)} / {c.reports > 0 ? fmt(c.reports) : "0"}
        </span>
      ),
    },
    {
      key: "when",
      head: "Posted",
      cell: (c) => (
        <span className="text-xs text-muted-foreground">{formatAgo(c.createdAt) ?? "—"}</span>
      ),
    },
    {
      key: "state",
      head: "State",
      cell: (c) => (
        <StatusBadge tone={c.isHidden ? "destructive" : "success"}>
          {c.isHidden ? "hidden" : "visible"}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      head: "",
      className: "w-36 text-right",
      cell: (c) => (
        <Button
          variant={c.isHidden ? "secondary" : "ghost"}
          size="sm"
          disabled={busy === c.id}
          onClick={() => setPending({ comment: c, hidden: !c.isHidden })}
        >
          {c.isHidden ? <Undo2 /> : <EyeOff />}
          {c.isHidden ? "Restore" : "Hide"}
        </Button>
      ),
    },
  ];

  return (
    <AdminPage
      title="Comments"
      subtitle={
        overview.status === "ready"
          ? `${fmt(overview.data.comments)} comments · ${fmt(overview.data.hiddenComments)} hidden. Hiding a comment keeps it in the database and hides it from players.`
          : "Every comment, including hidden ones."
      }
    >
      <Toolbar>
        <SearchField
          value={q}
          onChange={(value) => {
            setQ(value);
            setPage(0);
          }}
          label="Search comments"
          placeholder="Search the text"
        />
        <FilterSelect
          label="Comment state"
          value={state}
          onChange={(value) => {
            setState(value as CommentState);
            setPage(0);
          }}
          options={stateOptions}
        />
      </Toolbar>

      {comments.status === "error" ? (
        <SectionCard>
          <AdminListStates
            state="error"
            onRetry={comments.retry}
            emptyTitle=""
            emptyBody={comments.error.message}
          />
        </SectionCard>
      ) : comments.status === "loading" ? (
        <AdminListStates state="loading" emptyTitle="" rows={8} />
      ) : rows.length === 0 ? (
        <SectionCard>
          <AdminListStates
            state="ready"
            emptyTitle={
              term
                ? "No comment matches that"
                : state === "hidden"
                  ? "Nothing is hidden"
                  : "No comments"
            }
            emptyBody={
              term
                ? "Try a different search."
                : state === "hidden"
                  ? "No comment has been hidden."
                  : "Players have not commented yet."
            }
          />
        </SectionCard>
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={rows}
            rowKey={(c) => c.id}
            mobileRow={(c) => (
              <MobileRow>
                <UserAvatar username={c.authorUsername} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{c.body}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    @{c.authorUsername} · {c.gameTitle} · {formatAgo(c.createdAt) ?? "—"}
                  </span>
                </span>
                <StatusBadge tone={c.isHidden ? "destructive" : "success"}>
                  {c.isHidden ? "hidden" : "visible"}
                </StatusBadge>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={c.isHidden ? "Restore comment" : "Hide comment"}
                  disabled={busy === c.id}
                  onClick={() => setPending({ comment: c, hidden: !c.isHidden })}
                >
                  {c.isHidden ? <Undo2 /> : <EyeOff />}
                </Button>
              </MobileRow>
            )}
          />
          <OffsetPager
            page={page}
            setPage={setPage}
            perPage={ADMIN_LIMIT}
            rows={rows.length}
            hasMore={hasMore}
            label="comments"
          />
        </>
      )}

      <PromptDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.hidden ? "Hide this comment" : "Restore this comment"}
        description={
          pending ? (
            <>
              <span className="flex items-center gap-2">
                <MessageSquare className="size-4 shrink-0" />
                <span className="line-clamp-2">{pending.comment.body}</span>
              </span>
              <span className="mt-2 block">
                {pending.hidden
                  ? "It stays in the database and disappears from the game page. The reason is stored with the decision."
                  : "It becomes visible again on the game page. The reason is stored with the decision."}
              </span>
            </>
          ) : undefined
        }
        label="Reason"
        confirmLabel={pending?.hidden ? "Hide" : "Restore"}
        destructive={pending?.hidden}
        onConfirm={(reason) => {
          if (pending) decide(pending.comment, pending.hidden, reason);
          setPending(null);
        }}
      />
    </AdminPage>
  );
}
