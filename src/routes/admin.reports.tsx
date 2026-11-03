import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Eye, RotateCcw, ShieldCheck, X } from "lucide-react";
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
  SectionCard,
  StatCard,
  StatusBadge,
  statusTone,
  type Column,
  type BadgeTone,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import {
  ADMIN_LIMIT,
  asApiError,
  formatAgo,
  formatStamp,
  moderateReport,
  useAdminModerationLog,
  useAdminOverview,
  useAdminReports,
  type AdminModerationEntry,
  type AdminReport,
  type ReportStatus,
} from "@/lib/admin/api";

import { t, msg } from "@/lib/settings/language";
export const Route = createFileRoute("/admin/reports")({
  head: () => ({
    meta: [{ title: t("Reports — Unbored admin") }, { name: "robots", content: "noindex" }],
  }),
  component: ReportsAdmin,
});

const statusOptions = [
  { value: "", label: msg("All reports") },
  { value: "open", label: msg("Open") },
  { value: "reviewing", label: msg("Being reviewed") },
  { value: "resolved", label: msg("Resolved") },
  { value: "dismissed", label: msg("Dismissed") },
];

/** The decision a moderator is about to record, and the dialog it needs. */
type Pending =
  | { report: AdminReport; status: ReportStatus; prompt: false }
  | { report: AdminReport; status: ReportStatus; prompt: true }
  | null;

const targetTone: Record<AdminReport["targetKind"], BadgeTone> = {
  game: "info",
  comment: "muted",
  profile: "primary",
};

/**
 * The moderation queue, and the trail of what has already been decided.
 *
 * Both sections are reads of the database: the queue is the `reports` table
 * filtered by status, and the log below it is `moderation_actions`, which is
 * written in the same transaction as every decision taken here or on the games,
 * comments and accounts screens.
 */
export function ReportsAdmin() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const reports = useAdminReports({
    status: status ? (status as ReportStatus) : undefined,
    limit: ADMIN_LIMIT,
    offset: page * ADMIN_LIMIT,
  });
  const overview = useAdminOverview();

  const [logPage, setLogPage] = useState(0);
  const log = useAdminModerationLog({ limit: ADMIN_LIMIT, offset: logPage * ADMIN_LIMIT });

  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = reports.status === "ready" ? reports.data.items : [];
  const hasMore = reports.status === "ready" ? reports.data.hasMore : false;

  const decide = (report: AdminReport, next: ReportStatus, reason?: string) => {
    setBusy(report.id);
    moderateReport(report.id, next, reason)
      .then((result) => {
        toast.success(t("Report is now {n}.", { n: result.status ?? next }));
        reports.retry();
        log.retry();
      })
      .catch((error: unknown) => toast.error(asApiError(error).message))
      .finally(() => setBusy(null));
  };

  const logColumns: Column<AdminModerationEntry>[] = [
    {
      key: "when",
      head: t("When"),
      className: "w-40",
      cell: (entry) => (
        <span className="text-xs text-muted-foreground">{formatStamp(entry.createdAt) ?? "—"}</span>
      ),
    },
    {
      key: "moderator",
      head: t("Moderator"),
      cell: (entry) => <span className="text-sm">@{entry.moderatorUsername}</span>,
    },
    {
      key: "action",
      head: t("Action"),
      cell: (entry) => <StatusBadge tone="muted">{entry.action.replace(/_/g, " ")}</StatusBadge>,
    },
    {
      key: "target",
      head: t("Target"),
      cell: (entry) => (
        <span className="text-sm text-muted-foreground">
          {entry.targetKind} ·{" "}
          <span className="font-mono text-xs">{entry.targetId.slice(0, 8)}</span>
        </span>
      ),
    },
    {
      key: "reason",
      head: t("Reason"),
      className: "min-w-64",
      cell: (entry) => (
        <span className="line-clamp-2 text-sm text-muted-foreground">{entry.reason ?? "—"}</span>
      ),
    },
  ];

  return (
    <AdminPage
      title={t("Reports")}
      subtitle={t(
        "Player reports and the decisions recorded against them. Both lists are the database's.",
      )}
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard
          label={t("Open")}
          value={overview.status === "ready" ? String(overview.data.openReports) : "—"}
          tone={overview.status === "ready" && overview.data.openReports > 0 ? "warning" : "muted"}
        />
        <StatCard
          label={t("Being reviewed")}
          value={overview.status === "ready" ? String(overview.data.reviewingReports) : "—"}
        />
        <StatCard
          label={t("Hidden comments")}
          value={overview.status === "ready" ? String(overview.data.hiddenComments) : "—"}
          delta={
            overview.status === "ready"
              ? t("{comments} comments in total", { comments: overview.data.comments })
              : undefined
          }
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterSelect
          label={t("Report status")}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(0);
          }}
          options={statusOptions}
        />
      </div>

      {reports.status === "error" ? (
        <SectionCard>
          <AdminListStates
            state="error"
            onRetry={reports.retry}
            emptyTitle=""
            emptyBody={reports.error.message}
          />
        </SectionCard>
      ) : reports.status === "loading" ? (
        <AdminListStates state="loading" emptyTitle="" rows={6} />
      ) : rows.length === 0 ? (
        <SectionCard>
          <AdminListStates
            state="ready"
            emptyTitle={status ? t("Nothing with that status") : t("No reports")}
            emptyBody={
              status
                ? t("Choose another status, or clear the filter.")
                : t(
                    "No player has reported anything. New reports appear here the moment they are filed.",
                  )
            }
          />
        </SectionCard>
      ) : (
        <>
          <ul className="space-y-3">
            {rows.map((report) => (
              <li key={report.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={statusTone(report.status)}>{report.status}</StatusBadge>
                      <StatusBadge tone={targetTone[report.targetKind]}>
                        {report.targetKind}
                      </StatusBadge>
                      <span className="text-sm font-medium">
                        {report.targetLabel ?? report.targetDetail ?? t("(deleted content)")}
                      </span>
                    </div>
                    <p className="mt-2 text-sm">
                      <span className="font-medium">{report.reason}</span>
                      {report.details && (
                        <span className="text-muted-foreground"> — {report.details}</span>
                      )}
                    </p>
                    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {t("Reported by")}{" "}
                        <span className="font-medium">@{report.reporterUsername}</span>
                      </span>
                      <span>
                        {t("Filed")} {formatAgo(report.createdAt) ?? "—"}
                      </span>
                      {report.resolvedByUsername && (
                        <span>
                          {t("Decided by")}{" "}
                          <span className="font-medium">@{report.resolvedByUsername}</span>
                          {report.resolvedAt ? ` · ${formatAgo(report.resolvedAt)}` : ""}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {report.targetKind === "game" && report.targetDetail && (
                      <Button asChild variant="secondary" size="sm">
                        {/* targetDetail is the game's slug: the API resolves the target
                            so the dashboard does not have to join three tables. */}
                        <Link to="/games/$id" params={{ id: report.targetDetail }}>
                          <ArrowUpRight />
                          {t("Open game")}
                        </Link>
                      </Button>
                    )}
                    {report.status === "open" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy === report.id}
                        onClick={() => decide(report, "reviewing")}
                      >
                        <Eye />
                        {t("Start review")}
                      </Button>
                    )}
                    {report.status !== "resolved" && (
                      <Button
                        size="sm"
                        disabled={busy === report.id}
                        onClick={() => setPending({ report, status: "resolved", prompt: true })}
                      >
                        <ShieldCheck />
                        {t("Resolve")}
                      </Button>
                    )}
                    {report.status !== "dismissed" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === report.id}
                        onClick={() => setPending({ report, status: "dismissed", prompt: true })}
                      >
                        <X />
                        {t("Dismiss")}
                      </Button>
                    )}
                    {report.status !== "open" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === report.id}
                        onClick={() => setPending({ report, status: "open", prompt: false })}
                      >
                        <RotateCcw />
                        {t("Reopen")}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <OffsetPager
            page={page}
            setPage={setPage}
            perPage={ADMIN_LIMIT}
            rows={rows.length}
            hasMore={hasMore}
            label="reports"
          />
        </>
      )}

      <SectionCard
        title={t("Decisions recorded")}
        className="mt-5"
        bodyClassName="p-0"
        action={
          <span className="text-xs text-muted-foreground">
            {t("Every moderation action, newest first")}
          </span>
        }
      >
        {log.status === "error" ? (
          <AdminListStates
            state="error"
            onRetry={log.retry}
            emptyTitle=""
            emptyBody={log.error.message}
          />
        ) : log.status === "loading" ? (
          <AdminListStates state="loading" emptyTitle="" rows={5} />
        ) : log.data.items.length === 0 ? (
          <AdminListStates
            state="ready"
            emptyTitle={t("No decisions yet")}
            emptyBody={t(
              "Approving a game, resolving a report, hiding a comment or suspending an account is recorded here with the moderator's name.",
            )}
          />
        ) : (
          <>
            <AdminTable
              columns={logColumns}
              rows={log.data.items}
              rowKey={(entry) => entry.id}
              mobileRow={(entry) => (
                <MobileRow>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {entry.action.replace(/_/g, " ")}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      @{entry.moderatorUsername} · {entry.targetKind} ·{" "}
                      {formatStamp(entry.createdAt) ?? "—"}
                    </span>
                    {entry.reason && (
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {entry.reason}
                      </span>
                    )}
                  </span>
                </MobileRow>
              )}
            />
            <div className="px-4 pb-2">
              <OffsetPager
                page={logPage}
                setPage={setLogPage}
                perPage={ADMIN_LIMIT}
                rows={log.data.items.length}
                hasMore={log.data.hasMore}
                label="decisions"
              />
            </div>
          </>
        )}
      </SectionCard>

      <PromptDialog
        open={pending?.prompt === true}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.status === "resolved" ? t("Resolve this report") : t("Dismiss this report")}
        description={
          pending
            ? t("The decision is stored with your username, and the reason is kept with it.")
            : undefined
        }
        label={t("Reason for the decision")}
        placeholder={
          pending?.status === "resolved"
            ? t("What was done about it?")
            : t("Why is no action needed?")
        }
        confirmLabel={pending?.status === "resolved" ? t("Resolve") : t("Dismiss")}
        destructive={pending?.status === "dismissed"}
        onConfirm={(reason) => {
          if (pending) decide(pending.report, pending.status, reason);
          setPending(null);
        }}
      />
    </AdminPage>
  );
}
