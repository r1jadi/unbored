import { createFileRoute, Link } from "@tanstack/react-router";
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
  Toolbar,
  useDebounced,
  type Column,
} from "@/components/admin/ui";
import { UserAvatar } from "@/components/common";
import {
  ADMIN_LIMIT,
  ADMIN_MAX_LIMIT,
  formatAgo,
  formatStamp,
  useAdminGames,
  useAdminScores,
  type AdminScore,
} from "@/lib/admin/api";
import { fmt } from "@/lib/format";

export const Route = createFileRoute("/admin/leaderboards")({
  head: () => ({
    meta: [{ title: "Scores — Unbored admin" }, { name: "robots", content: "noindex" }],
  }),
  component: ScoresAdmin,
});

/**
 * Recorded scores, with the game and the player each belongs to.
 *
 * Every row here exists because a session was issued, a run was submitted and the
 * server replayed it: there is no other way a score can be written, which is what
 * makes this list a ledger rather than a leaderboard somebody typed in. The list
 * is ordered by the database and read a page at a time.
 */
export function ScoresAdmin() {
  const [game, setGame] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const term = useDebounced(q.trim());

  const scores = useAdminScores({
    game: game || undefined,
    q: term || undefined,
    limit: ADMIN_LIMIT,
    offset: page * ADMIN_LIMIT,
  });

  // The filter's options are the catalogue's own games, so a slug can only be one
  // the database holds. One request, capped at the API's maximum page size.
  const games = useAdminGames({ limit: ADMIN_MAX_LIMIT });
  const gameOptions = [
    { value: "", label: "All games" },
    ...(games.status === "ready"
      ? games.data.items.map((g) => ({ value: g.slug, label: g.title }))
      : []),
  ];

  const rows = scores.status === "ready" ? scores.data.items : [];
  const hasMore = scores.status === "ready" ? scores.data.hasMore : false;

  const columns: Column<AdminScore>[] = [
    {
      key: "player",
      head: "Player",
      className: "min-w-48",
      cell: (s) => (
        <span className="flex min-w-0 items-center gap-3">
          <UserAvatar username={s.username} size="sm" />
          <span className="truncate text-sm font-medium">@{s.username}</span>
        </span>
      ),
    },
    {
      key: "score",
      head: "Score",
      className: "text-right",
      cell: (s) => <span className="font-mono text-sm font-semibold tabular">{fmt(s.score)}</span>,
    },
    {
      key: "game",
      head: "Game",
      cell: (s) => (
        <Link
          to="/games/$id"
          params={{ id: s.gameSlug }}
          className="truncate text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          {s.gameTitle}
        </Link>
      ),
    },
    {
      key: "session",
      head: "Session started",
      cell: (s) => (
        <span className="text-xs text-muted-foreground">
          {formatStamp(s.sessionStartedAt) ?? "—"}
        </span>
      ),
    },
    {
      key: "recorded",
      head: "Recorded",
      cell: (s) => (
        <span className="text-xs text-muted-foreground">{formatAgo(s.createdAt) ?? "—"}</span>
      ),
    },
  ];

  return (
    <AdminPage
      title="Scores"
      subtitle="Verified scores only. A row exists because a finished run was replayed against the rules of its session."
    >
      <Toolbar>
        <SearchField
          value={q}
          onChange={(value) => {
            setQ(value);
            setPage(0);
          }}
          label="Search players"
          placeholder="Search a username"
        />
        <FilterSelect
          label="Game"
          value={game}
          onChange={(value) => {
            setGame(value);
            setPage(0);
          }}
          options={gameOptions}
        />
      </Toolbar>

      {scores.status === "error" ? (
        <SectionCard>
          <AdminListStates
            state="error"
            onRetry={scores.retry}
            emptyTitle=""
            emptyBody={scores.error.message}
          />
        </SectionCard>
      ) : scores.status === "loading" ? (
        <AdminListStates state="loading" emptyTitle="" rows={8} />
      ) : rows.length === 0 ? (
        <SectionCard>
          <AdminListStates
            state="ready"
            emptyTitle={game || term ? "No score matches" : "No scores recorded"}
            emptyBody={
              game || term
                ? "Clear the filters to see every recorded score."
                : "A score appears here when a run has been finished and verified."
            }
          />
        </SectionCard>
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={rows}
            rowKey={(s) => s.id}
            mobileRow={(s) => (
              <MobileRow>
                <UserAvatar username={s.username} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">@{s.username}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {s.gameTitle} · {formatAgo(s.createdAt) ?? "—"}
                  </span>
                </span>
                <span className="font-mono text-sm font-semibold tabular">{fmt(s.score)}</span>
              </MobileRow>
            )}
          />
          <OffsetPager
            page={page}
            setPage={setPage}
            perPage={ADMIN_LIMIT}
            rows={rows.length}
            hasMore={hasMore}
            label="scores"
          />
        </>
      )}
    </AdminPage>
  );
}
