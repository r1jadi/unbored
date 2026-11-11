import { Link } from "@tanstack/react-router";
import { CircleSlash, HelpCircle, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { EmptyState, ErrorState, ListSkeleton, UserAvatar } from "@/components/common";
import { RanksArena, RanksSkeleton, RanksYouBar } from "@/components/game/RanksArena";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/session";
import { FOLLOWING_SCAN, useFollowedUsernames } from "@/lib/social/followed";
import {
  playErrorMessage,
  useLeaderboard,
  type BoardPeriod,
  type BoardScope,
} from "@/lib/games/sessions";
import { useOverallBoard } from "@/lib/games/overall-board";
import { cn } from "@/lib/utils";
import { points } from "@/lib/format";

import { t } from "@/lib/settings/language";
const ROW = "flex items-center gap-3 px-4 py-3.5 md:rounded-lg md:px-2";

/**
 * One board row: a link to the player's profile, or plain when the account is
 * gone and there is no profile to open.
 */
function PlayerRow({ username, children }: { username: string | null; children: ReactNode }) {
  if (!username) return <div className={ROW}>{children}</div>;
  return (
    <Link
      to="/u/$username"
      params={{ username }}
      aria-label={t("View @{username}'s profile", { username })}
      className={cn(ROW, "transition-colors hover:bg-surface active:bg-surface")}
    >
      {children}
    </Link>
  );
}

/**
 * A game's leaderboard.
 *
 * The board is the database's: `/api/v1/games/{slug}/leaderboard` derives it from
 * recorded scores, one row per player at their best, with ties sharing a rank. This
 * component renders that response and nothing else — there is no local ranking, no
 * fixture list and no fallback. The prototype filled this list with seven invented
 * players, which is the most misleading thing the app could show, because a rank
 * looks like a measurement.
 *
 * What each state means, and why they are different screens:
 *
 *   - **empty** — nobody has finished a scored run of this game yet. That is an
 *     answer, so it gets the empty state rather than an error or a zero.
 *   - **error** — the read failed. Retryable, and never silently replaced with a
 *     blank board.
 *   - **following** — the global board narrowed to the caller and the people they
 *     follow. Ranks stay the global ones, so a row never claims a place it does
 *     not hold; see `FollowingBoard`.
 */
export function LeaderboardList({
  gameSlug,
  limit,
  period = "all",
  scope = "global",
  showMe = false,
  arena = false,
}: {
  /** The game's slug. A board only exists for a game. */
  gameSlug?: string;
  limit?: number;
  period?: BoardPeriod;
  scope?: BoardScope;
  showMe?: boolean;
  /** Draws the board as the Ranks page does: a podium, then a ladder. */
  arena?: boolean;
}) {
  // The following board reads the global board itself, so this one is not asked for.
  const state = useLeaderboard(scope === "friends" ? "" : (gameSlug ?? ""), {
    scope,
    period,
    limit,
  });

  if (!gameSlug) {
    return (
      <EmptyState
        icon={CircleSlash}
        title={t("No game selected")}
        body={t("Scores belong to a game, so pick one to see its board.")}
      />
    );
  }

  if (scope === "friends") {
    return <FollowingBoard gameSlug={gameSlug} period={period} arena={arena} />;
  }

  if (state.status === "loading") {
    return arena ? <RanksSkeleton /> : <ListSkeleton rows={limit ?? 7} />;
  }

  if (state.status === "error") {
    return (
      <ErrorState
        title={t("Couldn't load the leaderboard")}
        body={playErrorMessage(state.error)}
        onRetry={state.retry}
      />
    );
  }

  const { entries, me } = state.board;

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={CircleSlash}
        title={period === "all" ? t("No scores yet") : t("No scores in this window")}
        body={t(
          "A score appears here once a run has been verified and saved. Nothing is ranked until then.",
        )}
      />
    );
  }

  // The caller's own row is pinned only when it is below the visible page: showing
  // it twice, or under a rank they do not hold, would be a different claim.
  const lastVisibleRank = entries[entries.length - 1].rank;
  const pinMe = showMe && me !== null && me.rank > lastVisibleRank;

  if (arena) {
    return (
      <div>
        <RanksArena
          rows={entries.map((row) => ({
            rank: row.rank,
            username: row.username || null,
            value: points(row.score),
          }))}
        />
        {pinMe && me && <RanksYouBar rank={me.rank} value={points(me.score)} />}
      </div>
    );
  }

  return (
    <div>
      <ol className="divide-y divide-border">
        {entries.map((row) => (
          <li key={`${row.rank}-${row.username}`} className="enter">
            <PlayerRow username={row.username}>
              <span className="w-6 text-center font-mono text-sm tabular text-muted-foreground">
                {row.rank}
              </span>
              <UserAvatar username={row.username} size="sm" />
              <span className="flex-1 truncate text-sm">
                {row.username ? `@${row.username}` : t("A former player")}
              </span>
              <span className="font-semibold tabular">{points(row.score)}</span>
            </PlayerRow>
          </li>
        ))}
      </ol>
      {pinMe && me && (
        <Link
          to="/profile"
          aria-label={t("View your profile")}
          className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] mt-3 flex items-center gap-3 border-y border-primary/30 bg-surface px-4 py-3 md:bottom-0 md:rounded-lg md:border md:px-2"
        >
          <span className="w-6 text-center font-mono text-sm tabular text-muted-foreground">
            {me.rank}
          </span>
          <span className="flex-1 text-sm font-medium">{t("You")}</span>
          <span className="font-semibold tabular">{points(me.score)}</span>
        </Link>
      )}
    </div>
  );
}

/**
 * You and the people you follow, on one game's board.
 *
 * It is the global board narrowed down, not a separate ranking: each row keeps
 * the rank it holds globally, so "#4" means the same thing on both tabs. Only the
 * top of the global board is looked through, which is where a comparison between
 * friends is interesting.
 */
function FollowingBoard({
  gameSlug,
  period,
  arena,
}: {
  gameSlug: string;
  period: BoardPeriod;
  arena: boolean;
}) {
  const auth = useAuth();
  const userId = auth.status === "authenticated" ? auth.session.userId : undefined;
  const followed = useFollowedUsernames(userId);
  const board = useLeaderboard(userId ? gameSlug : "", {
    scope: "global",
    period,
    limit: FOLLOWING_SCAN,
  });

  const loading = arena ? <RanksSkeleton /> : <ListSkeleton rows={5} />;

  if (auth.status === "restoring") return loading;

  if (!userId) {
    return (
      <EmptyState
        icon={Users}
        title={t("See how the people you follow did")}
        body={t("Sign in, follow a few players, and their scores show up here next to yours.")}
        action={
          <Button asChild variant="secondary">
            <Link to="/login" search={{ redirect: `/leaderboards/${gameSlug}` }}>
              {t("Log in")}
            </Link>
          </Button>
        }
      />
    );
  }

  if (followed.status === "error" || board.status === "error") {
    return (
      <ErrorState
        title={t("Couldn't load the leaderboard")}
        body={board.status === "error" ? playErrorMessage(board.error) : undefined}
        onRetry={() => {
          followed.retry();
          if (board.status === "error") board.retry();
        }}
      />
    );
  }

  if (followed.status === "loading" || board.status === "loading") {
    return loading;
  }

  if (followed.following === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t("You're not following anyone yet")}
        body={t(
          "Follow players from their profiles or from search, and their best scores show up here.",
        )}
        action={
          <Button asChild variant="secondary">
            <Link to="/search">{t("Find people")}</Link>
          </Button>
        }
      />
    );
  }

  const rows = board.board.entries.filter((row) => followed.usernames.has(row.username));

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CircleSlash}
        title={period === "all" ? t("No scores yet") : t("No scores in this window")}
        body={t(
          "Nobody you follow is on this board yet. Their best runs show up here once they're verified.",
        )}
      />
    );
  }

  if (arena) {
    return (
      <RanksArena
        rows={rows.map((row) => ({
          rank: row.rank,
          username: row.username,
          value: points(row.score),
        }))}
      />
    );
  }

  return (
    <ol className="divide-y divide-border">
      {rows.map((row) => (
        <li key={`${row.rank}-${row.username}`} className="enter">
          <PlayerRow username={row.username}>
            <span className="w-6 text-center font-mono text-sm tabular text-muted-foreground">
              {row.rank}
            </span>
            <UserAvatar username={row.username} size="sm" />
            <span className="flex-1 truncate text-sm">@{row.username}</span>
            <span className="font-semibold tabular">{points(row.score)}</span>
          </PlayerRow>
        </li>
      ))}
    </ol>
  );
}

/**
 * The all-games board.
 *
 * Each row is a player's rating: their best score in every game, turned into a
 * percentile of that game's players, summed. The server ranks it; this renders
 * it. The Following tab narrows the same global board to the caller and the
 * people they follow, keeping global ranks, exactly as a game's board does.
 */
export function OverallBoardList({
  period = "all",
  scope = "global",
}: {
  period?: BoardPeriod;
  scope?: BoardScope;
}) {
  const auth = useAuth();
  const userId = auth.status === "authenticated" ? auth.session.userId : undefined;
  const following = scope === "friends";
  const followed = useFollowedUsernames(following ? userId : undefined);
  const state = useOverallBoard({
    period,
    limit: following ? FOLLOWING_SCAN : undefined,
    enabled: !following || userId !== undefined,
  });

  if (following && auth.status === "restoring") return <RanksSkeleton />;

  if (following && !userId) {
    return (
      <EmptyState
        icon={Users}
        title={t("See how the people you follow did")}
        body={t("Sign in, follow a few players, and their ratings show up here next to yours.")}
        action={
          <Button asChild variant="secondary">
            <Link to="/login" search={{ redirect: "/leaderboards" }}>
              {t("Log in")}
            </Link>
          </Button>
        }
      />
    );
  }

  if (state.status === "error" || (following && followed.status === "error")) {
    return (
      <ErrorState
        title={t("Couldn't load the leaderboard")}
        body={state.status === "error" ? playErrorMessage(state.error) : undefined}
        onRetry={() => {
          state.retry();
          if (following) followed.retry();
        }}
      />
    );
  }

  if (state.status === "loading" || (following && followed.status === "loading")) {
    return <RanksSkeleton />;
  }

  const { entries, me, minGames } = state.board;
  const rows =
    following && followed.status === "ready"
      ? entries.filter((row) => followed.usernames.has(row.username))
      : entries;

  const lastVisibleRank = rows.length > 0 ? rows[rows.length - 1].rank : 0;
  const pinMe = !following && me !== null && me.rank !== null && me.rank > lastVisibleRank;
  const gamesLeft = me && me.rank === null ? Math.max(0, minGames - me.games) : 0;

  return (
    <div>
      {gamesLeft > 0 && me && (
        <div className="ranks-progress">
          <span aria-hidden className="ranks-progress-pips">
            {Array.from({ length: minGames }, (_, index) => (
              <span key={index} data-done={index < me.games || undefined} />
            ))}
          </span>
          <p className="text-sm">
            {t("You're rated in")} {me.games} of {minGames} {t("games (")}
            {me.rating} {t("points).")}{" "}
            {gamesLeft === 1
              ? t("Play 1 more game")
              : t("Play {gamesLeft} more games", { gamesLeft })}{" "}
            {t("to get on the board.")}
          </p>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={CircleSlash}
          title={
            following
              ? t("Nobody you follow is ranked yet")
              : period === "all"
                ? t("No one is ranked yet")
                : t("No one is ranked in this window")
          }
          body={t(
            "A player is ranked once they have verified scores in {minGames} different games.",
            { minGames },
          )}
        />
      ) : (
        <RanksArena
          rows={rows.map((row) => ({
            rank: row.rank,
            username: row.username || null,
            value: row.rating,
            detail: row.games === 1 ? t("1 game") : t("{games} games", { games: row.games }),
          }))}
        />
      )}

      {pinMe && me?.rank != null && <RanksYouBar rank={me.rank} value={me.rating} />}

      <details className="ranks-explainer">
        <summary>
          <HelpCircle className="size-3.5" aria-hidden />
          {t("How ratings work")}
        </summary>
        <p>
          {t(
            "Your best score in each game becomes a percentile of everyone who played it, up to 100 per game. Your rating adds them up. Play {minGames} games to get ranked.",
            { minGames },
          )}
        </p>
      </details>
    </div>
  );
}
