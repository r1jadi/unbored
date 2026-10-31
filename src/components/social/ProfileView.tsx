import { Link } from "@tanstack/react-router";
import { Award, Lock, MoreHorizontal, Settings, Share2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Avatar,
  EmptyState,
  ErrorState,
  FollowButton,
  GridSkeleton,
  ListSkeleton,
  Page,
  PageHeader,
  Stat,
  UserName,
} from "@/components/common";
import type { Game } from "@/lib/games/catalog";
import { ShareSheet } from "@/components/social/Sheets";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const tabs = ["Best scores", "Activity", "Saved", "Recent", "Achievements"] as const;

/**
 * The identity this view draws.
 *
 * It is deliberately not the API's `Profile`: one view renders both the
 * signed-in user (from `services/users`) and another player's public page, and
 * only these fields are common to both.
 */
export type ProfileHeader = {
  username: string;
  name: string;
  bio?: string;
  verified?: boolean;
  userId?: string;
  isFollowing?: boolean;
  /** Public URL of the profile picture. Absent renders the account's initials. */
  avatarSrc?: string;
  /**
   * Real counts from the follow graph. A member that is `undefined` renders an
   * em dash, never a zero: an unread value and a measured zero are different
   * answers, and only one of them belongs on screen before the read lands.
   */
  stats?: { followers?: number; following?: number; played?: number };
  /** True while the counts are still being read. */
  statsLoading?: boolean;
  /** A failed count read, shown as text with an optional retry. */
  statsError?: string;
  onRetryStats?: () => void;
  /** When the played count is unknown, hide it rather than showing zero. */
  hidePlayed?: boolean;
};

function BestScores({ state }: { state: ScoreList }) {
  if (state.status === "loading") return <ListSkeleton rows={4} avatar={false} />;
  if (state.status === "error") {
    return (
      <ErrorState
        title="Couldn't load your scores"
        body={state.error ?? "Try again in a moment."}
        onRetry={state.retry}
      />
    );
  }
  const entries = state.entries ?? [];
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No scores yet"
        body="A score appears here after a run is verified and saved."
      />
    );
  }
  return (
    <ul className="mx-4 divide-y divide-border overflow-hidden rounded-xl bg-surface md:mx-0">
      {entries.map((entry, i) => (
        <li
          key={`${entry.game?.slug ?? "game"}-${i}`}
          className="flex items-center gap-3 px-4 py-3"
        >
          <span className="min-w-0 flex-1 truncate text-sm">
            {entry.game ? (
              <Link to="/games/$id" params={{ id: entry.game.slug }} className="hover:underline">
                {entry.game.title}
              </Link>
            ) : (
              <span className="text-muted-foreground">A game</span>
            )}
          </span>
          <span className="font-semibold tabular">{entry.score}</span>
        </li>
      ))}
    </ul>
  );
}

function RecentGames({ state }: { state: GameList }) {
  if (state.status === "loading") return <ListSkeleton rows={4} avatar={false} />;
  if (state.status === "error") {
    return (
      <ErrorState
        title="Couldn't load recently played games"
        body={state.error ?? "Try again in a moment."}
        onRetry={state.retry}
      />
    );
  }
  const games = state.games ?? [];
  if (games.length === 0) {
    return (
      <EmptyState
        title="No games played yet"
        body="A game appears here after a scored run is saved. Guest runs are not saved."
      />
    );
  }
  return (
    <ul className="mx-4 divide-y divide-border overflow-hidden rounded-xl bg-surface md:mx-0">
      {games.map((game) => (
        <li key={game.slug} className="px-4 py-3 text-sm">
          <Link to="/games/$id" params={{ id: game.slug }} className="hover:underline">
            {game.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

type ScoreList = {
  status: "anonymous" | "loading" | "ready" | "error";
  entries?: Array<{ game: Game | null; score: number }>;
  error?: string;
  retry?: () => void;
};

type GameList = {
  status: "anonymous" | "loading" | "ready" | "error";
  games?: Game[];
  error?: string;
  retry?: () => void;
};

export function ProfileView({
  user,
  self,
  loading,
  fallback,
  bestScores,
  recentlyPlayed,
}: {
  user: ProfileHeader;
  self?: boolean;
  /**
   * Whether the identity is still being fetched. Callers pass their own state;
   * when omitted the view renders content directly (no simulated loading).
   */
  loading?: boolean;
  /**
   * Drawn instead of the profile body when there is nothing to show yet — signed
   * out, no profile row, or a failed read. The header stays, so the page keeps
   * its shape and the way out (settings, sign in) is always reachable.
   */
  fallback?: ReactNode;
  /** The caller's own best score per game, from saved score rows. */
  bestScores?: ScoreList;
  /** The caller's own games, newest first, from saved score rows. */
  recentlyPlayed?: GameList;
}) {
  const skeleton = loading ?? false;
  const [tab, setTab] = useState<(typeof tabs)[number]>("Best scores");
  const [share, setShare] = useState(false);
  const visible = self ? tabs : tabs.filter((t) => t !== "Saved");

  async function block() {
    try {
      const { blockUsername } = await import("@/lib/settings/blocked");
      await blockUsername(user.username);
      toast.success(`Blocked @${user.username}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't block this account.");
    }
  }

  return (
    <Page>
      <PageHeader
        back={!self}
        // The signed-in header is the display name, which is unknown until the
        // profile arrives; "Your profile" is what the tab and the page title say.
        title={self ? user.name || "Your profile" : `@${user.username}`}
        actions={
          <div className="flex">
            {user.username !== "" && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Share profile"
                onClick={() => setShare(true)}
              >
                <Share2 />
              </Button>
            )}
            {self ? (
              <Button asChild variant="ghost" size="icon" aria-label="Settings">
                <Link to="/settings">
                  <Settings />
                </Link>
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="More">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() =>
                      toast(
                        "Reporting is reviewed by moderators. Open an issue to report this account.",
                      )
                    }
                  >
                    Report
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onClick={() => void block()}>
                    Block
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        }
      />
      {fallback ? (
        <div className="px-4 md:px-0">{fallback}</div>
      ) : (
        <>
          <div className="px-4 md:px-0">
            {skeleton ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <Skeleton className="size-24 rounded-full" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            ) : (
              <div className="enter flex flex-col items-center text-center md:flex-row md:items-start md:gap-6 md:text-left">
                <Avatar name={user.username} src={user.avatarSrc} size="xl" />
                <div className="mt-3 flex-1 md:mt-1">
                  <p className="text-lg font-semibold">{user.name}</p>
                  <p className="text-sm text-muted-foreground">
                    <UserName username={user.username} verified={user.verified} />
                  </p>
                  {user.bio && <p className="mt-2 max-w-sm text-sm">{user.bio}</p>}
                  {(user.stats !== undefined || user.statsLoading) && (
                    <div className="mt-4 flex justify-center gap-8 md:justify-start">
                      <Stat
                        value={user.stats?.followers ?? "—"}
                        label="Followers"
                        conn={{ username: user.username, tab: "followers" }}
                      />
                      <Stat
                        value={user.stats?.following ?? "—"}
                        label="Following"
                        conn={{ username: user.username, tab: "following" }}
                      />
                      {!user.hidePlayed && user.stats?.played !== undefined && (
                        <Stat value={user.stats.played} label="Games played" />
                      )}
                    </div>
                  )}
                  {user.statsError && (
                    <p className="mt-2 text-xs text-muted-foreground" role="status">
                      Couldn't load follower counts.{" "}
                      {user.onRetryStats && (
                        <button
                          type="button"
                          className="font-medium text-foreground underline underline-offset-4"
                          onClick={user.onRetryStats}
                        >
                          Retry
                        </button>
                      )}
                    </p>
                  )}
                  <div className="mt-4 flex justify-center gap-2 md:justify-start">
                    {self ? (
                      <>
                        <Button asChild variant="secondary">
                          <Link to="/settings/$section" params={{ section: "profile" }}>
                            Edit profile
                          </Link>
                        </Button>
                        <Button asChild variant="secondary">
                          <Link to="/likes">Likes</Link>
                        </Button>
                      </>
                    ) : (
                      <>
                        <FollowButton
                          userId={user.userId}
                          username={user.username}
                          initial={user.isFollowing}
                          size="default"
                        />
                        <Button
                          variant="secondary"
                          onClick={() => toast("Direct messages are not implemented.")}
                        >
                          Message
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div
            className="no-scrollbar mt-8 flex gap-6 overflow-x-auto border-b border-border px-4 text-sm md:px-0"
            role="tablist"
          >
            {visible.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "-mb-px shrink-0 border-b-2 pb-2.5",
                  tab === t
                    ? "border-foreground font-medium"
                    : "border-transparent text-muted-foreground",
                )}
              >
                {t === "Saved" && <Lock className="mr-1 inline size-3" />}
                {t}
              </button>
            ))}
          </div>

          <div className="pt-6">
            {skeleton ? (
              <GridSkeleton count={4} />
            ) : (
              <>
                {tab === "Best scores" &&
                  (bestScores ? (
                    <BestScores state={bestScores} />
                  ) : (
                    <EmptyState
                      title="Best scores live on each game's board"
                      body="Open a game's leaderboard to see verified scores for this account."
                    />
                  ))}
                {tab === "Activity" && (
                  <EmptyState
                    title="Activity has its own page"
                    body="Recent plays, likes, comments and saves are listed together on the Activity page."
                    action={
                      <Button asChild variant="secondary">
                        <Link to="/activity">View activity</Link>
                      </Button>
                    }
                  />
                )}
                {tab === "Saved" && (
                  <EmptyState
                    title="Saved games have their own page"
                    body="Everything you saved is listed on the Saved page."
                    action={
                      <Button asChild variant="secondary">
                        <Link to="/saved">View saved games</Link>
                      </Button>
                    }
                  />
                )}
                {tab === "Recent" &&
                  (recentlyPlayed ? (
                    <RecentGames state={recentlyPlayed} />
                  ) : (
                    <EmptyState
                      title="Recent games live on their own page"
                      body="Games with a saved score are listed newest first on Recently played."
                      action={
                        <Button asChild variant="secondary">
                          <Link to="/recent">View recently played</Link>
                        </Button>
                      }
                    />
                  ))}
                {tab === "Achievements" && (
                  <EmptyState
                    icon={Award}
                    title="No achievements yet"
                    body="Achievements are not recorded yet, so nothing is shown rather than a sample set."
                  />
                )}
              </>
            )}
          </div>
          <ShareSheet
            open={share}
            onOpenChange={setShare}
            title={`@${user.username}`}
            path={`/u/${user.username}`}
          />
        </>
      )}
    </Page>
  );
}
