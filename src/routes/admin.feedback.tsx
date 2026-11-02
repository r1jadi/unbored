import { createFileRoute } from "@tanstack/react-router";
import { Bug, Heart, Lightbulb, Mail, MessageCircle, type LucideIcon } from "lucide-react";
import { useState } from "react";
import {
  AdminListStates,
  AdminPage,
  AdminTable,
  FilterSelect,
  MobileRow,
  OffsetPager,
  SearchField,
  SectionCard,
  StatusBadge,
  Toolbar,
  useDebounced,
  type Column,
} from "@/components/admin/ui";
import { UserAvatar } from "@/components/common";
import {
  ADMIN_LIMIT,
  formatAgo,
  useAdminFeedback,
  type AdminFeedback,
  type FeedbackCategory,
} from "@/lib/admin/api";

export const Route = createFileRoute("/admin/feedback")({
  head: () => ({
    meta: [{ title: "Feedback — Unbored admin" }, { name: "robots", content: "noindex" }],
  }),
  component: FeedbackAdmin,
});

const categoryOptions = [
  { value: "all", label: "All feedback" },
  { value: "idea", label: "Ideas" },
  { value: "bug", label: "Something broke" },
  { value: "praise", label: "Kind words" },
  { value: "other", label: "Something else" },
];

const categories: Record<FeedbackCategory, { label: string; icon: LucideIcon }> = {
  idea: { label: "Idea", icon: Lightbulb },
  bug: { label: "Something broke", icon: Bug },
  praise: { label: "Kind words", icon: Heart },
  other: { label: "Something else", icon: MessageCircle },
};

const moods: Record<number, string> = {
  1: "😣 Rough",
  2: "😕 Meh",
  3: "😐 Okay",
  4: "🙂 Good",
  5: "🤩 Love it",
};

function CategoryLabel({ category }: { category: FeedbackCategory }) {
  const { label, icon: Icon } = categories[category];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Icon className="size-3.5 text-muted-foreground" aria-hidden />
      {label}
    </span>
  );
}

/**
 * What players send from Settings → Send feedback, newest first.
 *
 * Read through `admin_feedback_directory`, which checks the caller's staff role in
 * the database on every request. Each row is also mailed to the team inbox; the
 * badge says whether that copy went out.
 */
export function FeedbackAdmin() {
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const term = useDebounced(q.trim());

  const feedback = useAdminFeedback({
    category: category === "all" ? undefined : (category as FeedbackCategory),
    q: term || undefined,
    limit: ADMIN_LIMIT,
    offset: page * ADMIN_LIMIT,
  });

  const rows = feedback.status === "ready" ? feedback.data.items : [];
  const hasMore = feedback.status === "ready" ? feedback.data.hasMore : false;

  const columns: Column<AdminFeedback>[] = [
    {
      key: "message",
      head: "Feedback",
      className: "min-w-96",
      cell: (f) => (
        <div className="min-w-0">
          <p className="text-sm break-words whitespace-pre-wrap">{f.message}</p>
          {f.context && (
            <p className="mt-1 truncate text-xs text-muted-foreground" title={f.context}>
              {f.context}
            </p>
          )}
        </div>
      ),
    },
    { key: "kind", head: "Kind", cell: (f) => <CategoryLabel category={f.category} /> },
    {
      key: "mood",
      head: "Mood",
      cell: (f) => <span className="text-sm whitespace-nowrap">{moods[f.mood] ?? f.mood}</span>,
    },
    {
      key: "from",
      head: "From",
      cell: (f) => (
        <span className="flex items-center gap-2">
          <UserAvatar username={f.senderUsername} size="sm" />
          <span className="truncate text-sm">@{f.senderUsername}</span>
        </span>
      ),
    },
    {
      key: "when",
      head: "Sent",
      cell: (f) => (
        <span className="text-xs text-muted-foreground">{formatAgo(f.createdAt) ?? "—"}</span>
      ),
    },
    {
      key: "email",
      head: "Team inbox",
      cell: (f) => (
        <StatusBadge tone={f.emailedAt ? "success" : "warning"}>
          {f.emailedAt ? "emailed" : "pending"}
        </StatusBadge>
      ),
    },
  ];

  return (
    <AdminPage
      title="Feedback"
      subtitle="Ideas, bugs and kind words from Settings → Send feedback. Each one is also emailed to the team inbox."
    >
      <Toolbar>
        <SearchField
          value={q}
          onChange={(value) => {
            setQ(value);
            setPage(0);
          }}
          label="Search feedback"
          placeholder="Search the text"
        />
        <FilterSelect
          label="Kind of feedback"
          value={category}
          onChange={(value) => {
            setCategory(value);
            setPage(0);
          }}
          options={categoryOptions}
        />
      </Toolbar>

      {feedback.status === "error" ? (
        <SectionCard>
          <AdminListStates
            state="error"
            onRetry={feedback.retry}
            emptyTitle=""
            emptyBody={feedback.error.message}
          />
        </SectionCard>
      ) : feedback.status === "loading" ? (
        <AdminListStates state="loading" emptyTitle="" rows={8} />
      ) : rows.length === 0 ? (
        <SectionCard>
          <AdminListStates
            state="ready"
            emptyTitle={term ? "No feedback matches that" : "No feedback yet"}
            emptyBody={
              term ? "Try a different search." : "Nothing has been sent from the feedback page."
            }
          />
        </SectionCard>
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={rows}
            rowKey={(f) => f.id}
            mobileRow={(f) => (
              <MobileRow>
                <UserAvatar username={f.senderUsername} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm break-words whitespace-pre-wrap">{f.message}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    @{f.senderUsername} · {categories[f.category].label} · {moods[f.mood] ?? f.mood}{" "}
                    · {formatAgo(f.createdAt) ?? "—"}
                  </span>
                </span>
                {f.emailedAt && (
                  <Mail className="size-4 text-muted-foreground" aria-label="Emailed" />
                )}
              </MobileRow>
            )}
          />
          <OffsetPager
            page={page}
            setPage={setPage}
            perPage={ADMIN_LIMIT}
            rows={rows.length}
            hasMore={hasMore}
            label="feedback"
          />
        </>
      )}
    </AdminPage>
  );
}
