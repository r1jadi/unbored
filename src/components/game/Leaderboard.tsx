import { Link } from "@tanstack/react-router";
import { CircleSlash, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { EmptyState, ErrorState, ListSkeleton, UserAvatar } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/session";
import { fetchProfilesByIds, listFollowees } from "@/lib/social/follows";
import {
  playErrorMessage,
  useLeaderboard,
  type BoardPeriod,
  type BoardScope,
} from "@/lib/games/sessions";
import { useOverallBoard } from "@/lib/games/overall-board";
import { cn } from "@/lib/utils";

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
      aria-label={`View @${username}'s profile`}
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
}: {
  /** The game's slug. A board only exists for a game. */
  gameSlug?: string;
  limit?: number;
  period?: BoardPeriod;
  scope?: BoardScope;
  showMe?: boolean;
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
        title="No game selected"
        body="Scores belong to a game, so pick one to see its board."
      />
    );
  }

  if (scope === "friends") {
    return <FollowingBoard gameSlug={gameSlug} period={period} />;
  }

  if (state.status === "loading") return <ListSkeleton rows={limit ?? 7} />;

  if (state.status === "error") {
    return (
      <ErrorState
        title="Couldn't load the leaderboard"
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
        title={period === "all" ? "No scores yet" : "No scores in this window"}
        body="A score appears here once a run has been verified and saved. Nothing is ranked until then."
      />
    );
  }

  // The caller's own row is pinned only when it is below the visible page: showing
  // it twice, or under a rank they do not hold, would be a different claim.
  const lastVisibleRank = entries[entries.length - 1].rank;
  const pinMe = showMe && me !== null && me.rank > lastVisibleRank;

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
                {row.username ? `@${row.username}` : "A former player"}
              </span>
              <span className="font-semibold tabular">{row.score}</span>
            </PlayerRow>
          </li>
        ))}
      </ol>
      {pinMe && me && (
        <Link
          to="/profile"
          aria-label="View your profile"
          className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] mt-3 flex items-center gap-3 border-y border-primary/30 bg-surface px-4 py-3 md:bottom-0 md:rounded-lg md:border md:px-2"
        >
          <span className="w-6 text-center font-mono text-sm tabular text-muted-foreground">
            {me.rank}
          </span>
          <span className="flex-1 text-sm font-medium">You</span>
          <span className="font-semibold tabular">{me.score}</span>
        </Link>
      )}
    </div>
  );
}

/** How many rows of the global board the following view looks through. */
const FOLLOWING_SCAN = 100;

type FollowedState =
  | { status: "loading" }
  | { status: "ready"; usernames: Set<string>; following: number }
  | { status: "error" };

/** The usernames of the signed-in player and everyone they follow. */
function useFollowedUsernames(userId: string | undefined): FollowedState & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<FollowedState>({ status: "loading" });

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setState({ status: "loading" });
    listFollowees(userId)
      .then(async (ids) => {
        const profiles = await fetchProfilesByIds([userId, ...ids]);
        if (cancelled) return;
        setState({
          status: "ready",
          usernames: new Set(profiles.map((profile) => profile.username)),
          following: ids.length,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

/**
 * You and the people you follow, on one game's board.
 *
 * It is the global board narrowed down, not a separate ranking: each row keeps
 * the rank it holds globally, so "#4" means the same thing on both tabs. Only the
 * top of the global board is looked through, which is where a comparison between
 * friends is interesting.
 */
function FollowingBoard({ gameSlug, period }: { gameSlug: string; period: BoardPeriod }) {
  const auth = useAuth();
  const userId = auth.status === "authenticated" ? auth.session.userId : undefined;
  const followed = useFollowedUsernames(userId);
  const board = useLeaderboard(userId ? gameSlug : "", {
    scope: "global",
    period,
    limit: FOLLOWING_SCAN,
  });

  if (auth.status === "restoring") return <ListSkeleton rows={5} />;

  if (!userId) {
    return (
      <EmptyState
        icon={Users}
        title="See how the people you follow did"
        body="Sign in, follow a few players, and their scores show up here next to yours."
        action={
          <Button asChild variant="secondary">
            <Link to="/login" search={{ redirect: `/leaderboards/${gameSlug}` }}>
              Log in
            </Link>
          </Button>
        }
      />
    );
  }

  if (followed.status === "error" || board.status === "error") {
    return (
      <ErrorState
        title="Couldn't load the leaderboard"
        body={board.status === "error" ? playErrorMessage(board.error) : undefined}
        onRetry={() => {
          followed.retry();
          if (board.status === "error") board.retry();
        }}
      />
    );
  }

  if (followed.status === "loading" || board.status === "loading") {
    return <ListSkeleton rows={5} />;
  }

  if (followed.following === 0) {
    return (
      <EmptyState
        icon={Users}
        title="You're not following anyone yet"
        body="Follow players from their profiles or from search, and their best scores show up here."
        action={
          <Button asChild variant="secondary">
            <Link to="/search">Find people</Link>
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
        title={period === "all" ? "No scores yet" : "No scores in this window"}
        body="Nobody you follow is on this board yet. Their best runs show up here once they're verified."
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
            <span className="font-semibold tabular">{row.score}</span>
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

  if (following && auth.status === "restoring") return <ListSkeleton rows={5} />;

  if (following && !userId) {
    return (
      <EmptyState
        icon={Users}
        title="See how the people you follow did"
        body="Sign in, follow a few players, and their ratings show up here next to yours."
        action={
          <Button asChild variant="secondary">
            <Link to="/login" search={{ redirect: "/leaderboards" }}>
              Log in
            </Link>
          </Button>
        }
      />
    );
  }

  if (state.status === "error" || (following && followed.status === "error")) {
    return (
      <ErrorState
        title="Couldn't load the leaderboard"
        body={state.status === "error" ? playErrorMessage(state.error) : undefined}
        onRetry={() => {
          state.retry();
          if (following) followed.retry();
        }}
      />
    );
  }

  if (state.status === "loading" || (following && followed.status === "loading")) {
    return <ListSkeleton rows={7} />;
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
      <p className="px-4 pb-3 text-xs text-muted-foreground md:px-2">
        Your best score in each game becomes a percentile of everyone who played it, up to 100 per
        game. Your rating adds them up. Play {minGames} games to get ranked.
      </p>

      {gamesLeft > 0 && me && (
        <div className="mx-4 mb-3 rounded-lg border border-primary/30 bg-surface px-3 py-2.5 text-sm md:mx-2">
          You're rated in {me.games} of {minGames} games ({me.rating} points).{" "}
          {gamesLeft === 1 ? "Play 1 more game" : `Play ${gamesLeft} more games`} to get on the
          board.
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={CircleSlash}
          title={
            following
              ? "Nobody you follow is ranked yet"
              : period === "all"
                ? "No one is ranked yet"
                : "No one is ranked in this window"
          }
          body={`A player is ranked once they have verified scores in ${minGames} different games.`}
        />
      ) : (
        <ol className="divide-y divide-border">
          {rows.map((row) => (
            <li key={`${row.rank}-${row.username}`} className="enter">
              <PlayerRow username={row.username}>
                <span className="w-6 text-center font-mono text-sm tabular text-muted-foreground">
                  {row.rank}
                </span>
                <UserAvatar username={row.username} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {row.username ? `@${row.username}` : "A former player"}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {row.games === 1 ? "1 game" : `${row.games} games`}
                  </span>
                </span>
                <span className="font-semibold tabular">{row.rating}</span>
              </PlayerRow>
            </li>
          ))}
        </ol>
      )}

      {pinMe && me && (
        <Link
          to="/profile"
          aria-label="View your profile"
          className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] mt-3 flex items-center gap-3 border-y border-primary/30 bg-surface px-4 py-3 md:bottom-0 md:rounded-lg md:border md:px-2"
        >
          <span className="w-6 text-center font-mono text-sm tabular text-muted-foreground">
            {me.rank}
          </span>
          <span className="flex-1 text-sm font-medium">You</span>
          <span className="font-semibold tabular">{me.rating}</span>
        </Link>
      )}
    </div>
  );
}
