import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { TrendArea } from "@/components/admin/charts";
import {
  AdminListStates,
  AdminPage,
  AdminTable,
  FilterSelect,
  MobileRow,
  SectionCard,
  StatCard,
  Toolbar,
  type Column,
} from "@/components/admin/ui";
import { UserAvatar } from "@/components/common";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatAgo,
  formatSeconds,
  useAdminAnalytics,
  type AdminAnalyticsGame,
  type AdminTopPlayer,
} from "@/lib/admin/api";
import { fmt } from "@/lib/format";

export const Route = createFileRoute("/admin/analytics")({
  head: () => ({
    meta: [{ title: "Analytics — Unbored admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AnalyticsAdmin,
});

const windows = [
  { value: "7", label: "Last 7 days" },
  { value: "28", label: "Last 28 days" },
  { value: "90", label: "Last 90 days" },
];

/**
 * Activity over a window, measured from rows the platform already keeps.
 *
 * The chart plots the API's own daily series — one point per day, with the days
 * the database returned rather than a gap-filled range invented here. Every total
 * beside it is that series' sum, so the number and the picture cannot disagree.
 */
export function AnalyticsAdmin() {
  const [days, setDays] = useState("28");
  const analytics = useAdminAnalytics(Number(days));

  const data = analytics.status === "ready" ? analytics.data : undefined;
  const loading = analytics.status === "loading";

  const series =
    data?.series.map((point) => ({
      day: point.day,
      runs: point.runs,
      scores: point.scores,
      signups: point.signups,
      players: point.players,
    })) ?? [];

  const chartSeries = [
    { key: "runs", label: "Runs", color: "var(--chart-1)" },
    { key: "players", label: "Players", color: "var(--chart-2)" },
    { key: "scores", label: "Scores", color: "var(--chart-3)" },
    { key: "signups", label: "Signups", color: "var(--chart-4)" },
  ];

  const gameColumns: Column<AdminAnalyticsGame>[] = [
    {
      key: "game",
      head: "Game",
      className: "min-w-56",
      cell: (g) => (
        <Link
          to="/games/$id"
          params={{ id: g.slug }}
          className="truncate text-sm font-medium hover:underline"
        >
          {g.title}
        </Link>
      ),
    },
    {
      key: "runs",
      head: "Runs",
      className: "text-right",
      cell: (g) => <span className="font-mono text-sm tabular">{fmt(g.runs)}</span>,
    },
    {
      key: "players",
      head: "Players",
      className: "text-right",
      cell: (g) => <span className="font-mono text-sm tabular">{fmt(g.players)}</span>,
    },
    {
      key: "best",
      head: "Best score",
      className: "text-right",
      cell: (g) => <span className="font-mono text-sm tabular">{fmt(g.bestScore)}</span>,
    },
  ];

  const playerColumns: Column<AdminTopPlayer>[] = [
    {
      key: "player",
      head: "Player",
      className: "min-w-48",
      cell: (p) => (
        <span className="flex min-w-0 items-center gap-3">
          <UserAvatar username={p.username} size="sm" />
          <span className="truncate text-sm font-medium">@{p.username}</span>
        </span>
      ),
    },
    {
      key: "best",
      head: "Best score",
      className: "text-right",
      cell: (p) => (
        <span className="font-mono text-sm font-semibold tabular">{fmt(p.bestScore)}</span>
      ),
    },
    {
      key: "scores",
      head: "Scores",
      className: "text-right",
      cell: (p) => <span className="font-mono text-sm tabular">{fmt(p.scores)}</span>,
    },
    {
      key: "last",
      head: "Last score",
      cell: (p) => (
        <span className="text-xs text-muted-foreground">{formatAgo(p.lastScoredAt) ?? "—"}</span>
      ),
    },
  ];

  const avgRun = data ? formatSeconds(data.avgRunSeconds) : null;

  return (
    <AdminPage
      title="Analytics"
      subtitle="Activity measured from recorded rows: play sessions, verified scores, accounts and comments."
      actions={
        <FilterSelect
          label="Window"
          value={days}
          onChange={setDays}
          options={windows}
          className="h-9"
        />
      }
    >
      {analytics.status === "error" ? (
        <SectionCard>
          <AdminListStates
            state="error"
            onRetry={analytics.retry}
            emptyTitle=""
            emptyBody={analytics.error.message}
          />
        </SectionCard>
      ) : (
        <div className="space-y-4 md:space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label={`New accounts · ${days}d`}
              value={loading ? "—" : fmt(data!.newUsers)}
              delta={loading ? undefined : `${fmt(data!.totalUsers)} accounts in total`}
            />
            <StatCard
              label={`Runs · ${days}d`}
              value={loading ? "—" : fmt(data!.runs)}
              delta={loading ? undefined : `${fmt(data!.players)} players played`}
            />
            <StatCard label={`Scores · ${days}d`} value={loading ? "—" : fmt(data!.scores)} />
            <StatCard
              label="Average run"
              value={loading ? "—" : (avgRun ?? "not measured yet")}
              tone={!loading && avgRun === null ? "warning" : "muted"}
              delta={
                !loading && avgRun === null ? "no run has been completed in this window" : undefined
              }
            />
            <StatCard label={`Comments · ${days}d`} value={loading ? "—" : fmt(data!.comments)} />
            <StatCard
              label="Players in the window"
              value={loading ? "—" : fmt(data!.players)}
              delta={loading ? undefined : "distinct accounts that started a run"}
            />
          </div>

          <SectionCard
            title={`Daily activity · last ${data?.days ?? days} days`}
            bodyClassName="p-4"
          >
            {loading ? (
              <Skeleton className="h-56 w-full rounded-xl md:h-64" />
            ) : series.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                Nothing has been recorded in this window yet.
              </p>
            ) : (
              <>
                <TrendArea data={series} series={chartSeries} />
                <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Runs: {fmt(data!.runs)}</span>
                  <span>Scores: {fmt(data!.scores)}</span>
                  <span>Signups: {fmt(data!.newUsers)}</span>
                  <span>Players: {fmt(data!.players)}</span>
                </p>
              </>
            )}
          </SectionCard>

          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard title={`Most played · ${days} days`} bodyClassName="p-0">
              {loading ? (
                <AdminListStates state="loading" emptyTitle="" rows={5} />
              ) : data!.topGames.length === 0 ? (
                <AdminListStates
                  state="ready"
                  emptyTitle="No runs in this window"
                  emptyBody="A game appears here once somebody has played it."
                />
              ) : (
                <AdminTable
                  columns={gameColumns}
                  rows={data!.topGames}
                  rowKey={(g) => g.slug}
                  mobileRow={(g) => (
                    <MobileRow>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{g.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {fmt(g.runs)} runs · {fmt(g.players)} players
                        </span>
                      </span>
                      <span className="font-mono text-sm tabular">{fmt(g.bestScore)}</span>
                    </MobileRow>
                  )}
                />
              )}
            </SectionCard>

            <SectionCard title={`Top players · ${days} days`} bodyClassName="p-0">
              {loading ? (
                <AdminListStates state="loading" emptyTitle="" rows={5} />
              ) : data!.topPlayers.length === 0 ? (
                <AdminListStates
                  state="ready"
                  emptyTitle="No scores in this window"
                  emptyBody="A player appears here once a run of theirs has been verified."
                />
              ) : (
                <AdminTable
                  columns={playerColumns}
                  rows={data!.topPlayers}
                  rowKey={(p) => p.username}
                  mobileRow={(p) => (
                    <MobileRow>
                      <UserAvatar username={p.username} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">@{p.username}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {fmt(p.scores)} scores · {formatAgo(p.lastScoredAt) ?? "—"}
                        </span>
                      </span>
                      <span className="font-mono text-sm font-semibold tabular">
                        {fmt(p.bestScore)}
                      </span>
                    </MobileRow>
                  )}
                />
              )}
            </SectionCard>
          </div>

          <p className="text-xs text-muted-foreground">
            Figures cover the selected window and come from the same query as the chart above.
            Nothing on this page is projected, estimated or sampled.
          </p>
        </div>
      )}
    </AdminPage>
  );
}
