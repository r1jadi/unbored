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

import { t, msg } from "@/lib/settings/language";
export const Route = createFileRoute("/admin/analytics")({
  head: () => ({
    meta: [{ title: t("Analytics — Unbored admin") }, { name: "robots", content: "noindex" }],
  }),
  component: AnalyticsAdmin,
});

const windows = [
  { value: "7", label: msg("Last 7 days") },
  { value: "28", label: msg("Last 28 days") },
  { value: "90", label: msg("Last 90 days") },
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
    { key: "runs", label: t("Runs"), color: "var(--chart-1)" },
    { key: "players", label: t("Players"), color: "var(--chart-2)" },
    { key: "scores", label: t("Scores"), color: "var(--chart-3)" },
    { key: "signups", label: t("Signups"), color: "var(--chart-4)" },
  ];

  const gameColumns: Column<AdminAnalyticsGame>[] = [
    {
      key: "game",
      head: t("Game"),
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
      head: t("Runs"),
      className: "text-right",
      cell: (g) => <span className="font-mono text-sm tabular">{fmt(g.runs)}</span>,
    },
    {
      key: "players",
      head: t("Players"),
      className: "text-right",
      cell: (g) => <span className="font-mono text-sm tabular">{fmt(g.players)}</span>,
    },
    {
      key: "best",
      head: t("Best score"),
      className: "text-right",
      cell: (g) => <span className="font-mono text-sm tabular">{fmt(g.bestScore)}</span>,
    },
  ];

  const playerColumns: Column<AdminTopPlayer>[] = [
    {
      key: "player",
      head: t("Player"),
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
      head: t("Best score"),
      className: "text-right",
      cell: (p) => (
        <span className="font-mono text-sm font-semibold tabular">{fmt(p.bestScore)}</span>
      ),
    },
    {
      key: "scores",
      head: t("Scores"),
      className: "text-right",
      cell: (p) => <span className="font-mono text-sm tabular">{fmt(p.scores)}</span>,
    },
    {
      key: "last",
      head: t("Last score"),
      cell: (p) => (
        <span className="text-xs text-muted-foreground">{formatAgo(p.lastScoredAt) ?? "—"}</span>
      ),
    },
  ];

  const avgRun = data ? formatSeconds(data.avgRunSeconds) : null;

  return (
    <AdminPage
      title={t("Analytics")}
      subtitle={t(
        "Activity measured from recorded rows: play sessions, verified scores, accounts and comments.",
      )}
      actions={
        <FilterSelect
          label={t("Window")}
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
              label={t("New accounts · {days}d", { days })}
              value={loading ? "—" : fmt(data!.newUsers)}
              delta={
                loading
                  ? undefined
                  : t("{totalUsers} accounts in total", { totalUsers: fmt(data!.totalUsers) })
              }
            />
            <StatCard
              label={t("Runs · {days}d", { days })}
              value={loading ? "—" : fmt(data!.runs)}
              delta={
                loading ? undefined : t("{players} players played", { players: fmt(data!.players) })
              }
            />
            <StatCard
              label={t("Scores · {days}d", { days })}
              value={loading ? "—" : fmt(data!.scores)}
            />
            <StatCard
              label={t("Average run")}
              value={loading ? "—" : (avgRun ?? t("not measured yet"))}
              tone={!loading && avgRun === null ? "warning" : "muted"}
              delta={
                !loading && avgRun === null
                  ? t("no run has been completed in this window")
                  : undefined
              }
            />
            <StatCard
              label={t("Comments · {days}d", { days })}
              value={loading ? "—" : fmt(data!.comments)}
            />
            <StatCard
              label={t("Players in the window")}
              value={loading ? "—" : fmt(data!.players)}
              delta={loading ? undefined : t("distinct accounts that started a run")}
            />
          </div>

          <SectionCard
            title={t("Daily activity · last {n} days", { n: data?.days ?? days })}
            bodyClassName="p-4"
          >
            {loading ? (
              <Skeleton className="h-56 w-full rounded-xl md:h-64" />
            ) : series.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                {t("Nothing has been recorded in this window yet.")}
              </p>
            ) : (
              <>
                <TrendArea data={series} series={chartSeries} />
                <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{t("Runs: {runs}", { runs: fmt(data!.runs) })}</span>
                  <span>{t("Scores: {scores}", { scores: fmt(data!.scores) })}</span>
                  <span>{t("Signups: {newUsers}", { newUsers: fmt(data!.newUsers) })}</span>
                  <span>{t("Players: {players}", { players: fmt(data!.players) })}</span>
                </p>
              </>
            )}
          </SectionCard>

          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard title={t("Most played · {days} days", { days })} bodyClassName="p-0">
              {loading ? (
                <AdminListStates state="loading" emptyTitle="" rows={5} />
              ) : data!.topGames.length === 0 ? (
                <AdminListStates
                  state="ready"
                  emptyTitle={t("No runs in this window")}
                  emptyBody={t("A game appears here once somebody has played it.")}
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
                          {t("{runs} runs · {players} players", {
                            runs: fmt(g.runs),
                            players: fmt(g.players),
                          })}
                        </span>
                      </span>
                      <span className="font-mono text-sm tabular">{fmt(g.bestScore)}</span>
                    </MobileRow>
                  )}
                />
              )}
            </SectionCard>

            <SectionCard title={t("Top players · {days} days", { days })} bodyClassName="p-0">
              {loading ? (
                <AdminListStates state="loading" emptyTitle="" rows={5} />
              ) : data!.topPlayers.length === 0 ? (
                <AdminListStates
                  state="ready"
                  emptyTitle={t("No scores in this window")}
                  emptyBody={t("A player appears here once a run of theirs has been verified.")}
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
                          {fmt(p.scores)} {t("scores ·")} {formatAgo(p.lastScoredAt) ?? "—"}
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
            {t(
              "Figures cover the selected window and come from the same query as the chart above. Nothing on this page is projected, estimated or sampled.",
            )}
          </p>
        </div>
      )}
    </AdminPage>
  );
}
