import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ClipboardCheck,
  Flag,
  Gamepad2,
  Play,
  Timer,
  Users,
} from "lucide-react";
import { TrendArea } from "@/components/admin/charts";
import { AdminPage, SectionCard, StatCard, StatusBadge, statusTone } from "@/components/admin/ui";
import { ErrorState, ListSkeleton, UserAvatar } from "@/components/common";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatAgo,
  formatSeconds,
  useAdminOverview,
  useAdminSystemServices,
} from "@/lib/admin/api";
import { fmt } from "@/lib/format";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [{ title: "Admin overview — Unbored" }, { name: "robots", content: "noindex" }],
  }),
  component: Overview,
});

const kindIcon = {
  moderation: Flag,
  game: Gamepad2,
  score: Activity,
} as const;

/**
 * The dashboard, on the API's real numbers.
 *
 * Every figure below is a count of persisted rows, and every one that cannot be
 * computed is shown as such: `avgRunSeconds` is null until a run has been
 * completed, and the card says "not measured yet" instead of "0s". There is no
 * comparison against a previous period, because the API does not compute one —
 * an invented "+3.1%" is indistinguishable from a measured one.
 */
export function Overview() {
  const overview = useAdminOverview();
  const services = useAdminSystemServices();

  if (overview.status === "error") {
    return (
      <AdminPage title="Overview" subtitle="Platform health, moderation queue and activity.">
        <SectionCard>
          <ErrorState onRetry={overview.retry} body={overview.error.message} />
        </SectionCard>
      </AdminPage>
    );
  }

  const data = overview.status === "ready" ? overview.data : undefined;
  const loading = overview.status === "loading";
  const avgSession = data ? formatSeconds(data.avgRunSeconds) : null;

  const stats = [
    { label: "Accounts", value: data ? fmt(data.totalUsers) : "—", icon: Users },
    {
      label: "Active today",
      value: data ? fmt(data.activeUsers) : "—",
      hint: data ? "started a run in 24h" : undefined,
      icon: Activity,
    },
    {
      label: "Games",
      value: data ? String(data.games) : "—",
      hint: data ? `${data.publishedGames} published · ${data.playableGames} playable` : undefined,
      icon: Gamepad2,
    },
    {
      label: "Games played",
      value: data ? fmt(data.gamesPlayed) : "—",
      hint: data ? `${fmt(data.runsOpen)} runs in progress` : undefined,
      icon: Play,
    },
    {
      label: "Avg run",
      value: avgSession ?? "not measured yet",
      hint: data && data.runsMeasured > 0 ? `over ${fmt(data.runsMeasured)} runs` : undefined,
      icon: Timer,
    },
    {
      label: "Open reports",
      value: data ? String(data.openReports) : "—",
      hint: data ? `${data.reviewingReports} being reviewed` : undefined,
      icon: Flag,
    },
  ];

  const queue = [
    {
      to: "/admin/reports",
      label: "Open reports",
      value: data?.openReports,
      hint: data ? `${data.reviewingReports} in review` : "loading",
      icon: Flag,
      tone: "warning" as const,
    },
    {
      to: "/admin/review",
      label: "Games in review",
      value: data?.pendingReview,
      hint: "waiting for a decision",
      icon: ClipboardCheck,
      tone: "info" as const,
    },
    {
      to: "/admin/comments",
      label: "Hidden comments",
      value: data?.hiddenComments,
      hint: data ? `${fmt(data.comments)} written in total` : "loading",
      icon: AlertTriangle,
      tone: "destructive" as const,
    },
  ];

  return (
    <AdminPage
      title="Overview"
      subtitle="Platform health, moderation queue and real activity."
      actions={
        <button
          type="button"
          onClick={overview.retry}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Refresh
        </button>
      }
    >
      <div className="space-y-4 md:space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {loading
            ? Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-[104px] rounded-xl" />
              ))
            : stats.map((st) => (
                <StatCard
                  key={st.label}
                  label={st.label}
                  value={st.value}
                  delta={st.hint}
                  icon={st.icon}
                />
              ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <SectionCard
            title="Activity over time"
            className="lg:col-span-2"
            action={
              <span className="text-xs text-muted-foreground">Last 14 days · completed runs</span>
            }
          >
            {loading ? (
              <Skeleton className="h-56 w-full md:h-64" />
            ) : data && data.series.some((point) => point.runs > 0) ? (
              <TrendArea
                data={data.series.map((point) => ({ day: point.day, runs: point.runs }))}
                series={[{ key: "runs", label: "Completed runs", color: "var(--chart-1)" }]}
              />
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">
                No run has been completed yet. This fills in from recorded runs.
              </p>
            )}
          </SectionCard>

          <SectionCard title="Moderation queue" bodyClassName="p-0">
            <ul className="divide-y divide-border">
              {queue.map((q) => (
                <li key={q.label}>
                  <Link
                    to={q.to}
                    className="press flex items-center gap-3 px-4 py-4 hover:bg-surface-2"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                      <q.icon className="size-4 text-muted-foreground" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{q.label}</span>
                      <span className="block text-xs text-muted-foreground">{q.hint}</span>
                    </span>
                    {q.value === undefined ? null : (
                      <StatusBadge tone={q.tone}>{q.value}</StatusBadge>
                    )}
                    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <SectionCard title="Recent activity" className="lg:col-span-2" bodyClassName="p-0">
            {loading ? (
              <ListSkeleton rows={5} />
            ) : data && data.activity.length > 0 ? (
              <ul className="divide-y divide-border">
                {data.activity.slice(0, 6).map((a, i) => {
                  const Icon = kindIcon[a.kind];
                  return (
                    <li
                      key={`${a.kind}-${a.at}-${i}`}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <UserAvatar username={a.actor} size="sm" />
                      <p className="min-w-0 flex-1 text-sm">
                        <span className="font-medium">@{a.actor}</span>{" "}
                        <span className="text-muted-foreground">{a.action}</span>{" "}
                        {a.href ? (
                          <Link to={a.href} className="font-medium hover:underline">
                            {a.subject}
                          </Link>
                        ) : (
                          <span className="font-medium">{a.subject}</span>
                        )}
                        <span className="text-muted-foreground"> · {formatAgo(a.at)}</span>
                      </p>
                      <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                Nothing has happened yet: a decision, a published game or a verified score appears
                here.
              </p>
            )}
          </SectionCard>

          <SectionCard title="Most played games" bodyClassName="p-4">
            {loading ? (
              <ListSkeleton rows={5} avatar={false} />
            ) : data && data.topGames.length > 0 ? (
              <ul className="space-y-4">
                {data.topGames.slice(0, 5).map((g) => (
                  <li key={g.slug}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <Link to="/admin/games" className="truncate font-medium hover:underline">
                        {g.title}
                      </Link>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular">
                        {fmt(g.runs)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(g.runs / data.topGames[0].runs) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
                <li>
                  <Link
                    to="/admin/analytics"
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Full analytics →
                  </Link>
                </li>
              </ul>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No game has been finished yet.
              </p>
            )}
          </SectionCard>
        </div>

        <SectionCard title="Platform services" bodyClassName="p-0">
          {services.status === "loading" ? (
            <ListSkeleton rows={6} avatar={false} />
          ) : services.status === "error" ? (
            <ErrorState onRetry={services.retry} body={services.error.message} />
          ) : (
            <>
              <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                {services.data.note}
              </p>
              <ul className="divide-y divide-border">
                {services.data.items.map((svc) => (
                  <li
                    key={svc.name}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
                  >
                    <span className="min-w-40 flex-1 text-sm font-medium">{svc.name}</span>
                    <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground lg:block">
                      {svc.note}
                    </span>
                    <StatusBadge tone={statusTone("muted")}>not measured</StatusBadge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>
      </div>
    </AdminPage>
  );
}
