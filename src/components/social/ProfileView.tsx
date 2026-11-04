import { Link } from "@tanstack/react-router";
import {
  Activity,
  Award,
  Clock,
  Globe,
  Lock,
  MoreHorizontal,
  Settings,
  Share2,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
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
import { points } from "@/lib/format";

import { t, msg } from "@/lib/settings/language";
const tabs = [
  msg("Best scores"),
  msg("Activity"),
  msg("Saved"),
  msg("Recent"),
  msg("Achievements"),
] as const;

type TabName = (typeof tabs)[number];

const tabIcons: Record<string, LucideIcon> = {
  "Best scores": Trophy,
  Activity,
  Saved: Lock,
  Recent: Clock,
  Achievements: Award,
};

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
  stats?: { followers?: number; following?: number };
  /** True while the counts are still being read. */
  statsLoading?: boolean;
  /** A failed count read, shown as text with an optional retry. */
  statsError?: string;
  onRetryStats?: () => void;
};

/** A small, stable hash, so a player's banner is the same on every visit. */
function hashOf(text: string): number {
  let hash = 2166136261;
  for (const char of text) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
}

const BOARD_COLUMNS = 40;
const BOARD_ROWS = 10;
const BOARD_CELL = 10;

/**
 * A game board that belongs to one player: which tiles are lit, and in what
 * colour, comes from the username. Nothing here is a measurement of anything, so
 * it is decoration only and hidden from assistive technology.
 */
function PlayerBoard({ username }: { username: string }) {
  const { hue, cells } = useMemo(() => {
    let state = hashOf(username);
    const next = () => {
      state = Math.imul(state ^ (state >>> 15), state | 1);
      state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
      return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
    };
    const base = next() * 360;
    const lit: Array<{ x: number; y: number; opacity: number; accent: boolean }> = [];
    for (let y = 0; y < BOARD_ROWS; y += 1) {
      for (let x = 0; x < BOARD_COLUMNS; x += 1) {
        // Tiles thin out towards the left, where the picture and name sit.
        const chance = 0.1 + (x / BOARD_COLUMNS) * 0.5;
        if (next() < chance) {
          lit.push({ x, y, opacity: 0.2 + next() * 0.7, accent: next() < 0.18 });
        }
      }
    }
    return { hue: base, cells: lit };
  }, [username]);

  return (
    <svg
      aria-hidden
      className="absolute inset-0 size-full"
      viewBox={`0 0 ${BOARD_COLUMNS * BOARD_CELL} ${BOARD_ROWS * BOARD_CELL}`}
      preserveAspectRatio="xMidYMid slice"
      style={{ background: `oklch(0.3 0.06 ${hue})` }}
      data-testid="player-board"
    >
      {cells.map((cell) => (
        <rect
          key={`${cell.x}-${cell.y}`}
          x={cell.x * BOARD_CELL + 1}
          y={cell.y * BOARD_CELL + 1}
          width={BOARD_CELL - 2}
          height={BOARD_CELL - 2}
          rx={2}
          fill={`oklch(0.72 0.16 ${cell.accent ? hue + 60 : hue})`}
          opacity={cell.opacity}
        />
      ))}
    </svg>
  );
}

function BestScores({
  state,
  self,
  username,
}: {
  state: ScoreList;
  self?: boolean;
  username: string;
}) {
  if (state.status === "loading") return <ListSkeleton rows={4} avatar={false} />;
  if (state.status === "hidden") {
    return (
      <EmptyState
        icon={Lock}
        title={t("Scores are hidden")}
        body={t("@{username} doesn't show scores on this profile.", { username })}
      />
    );
  }
  if (state.status === "error") {
    return (
      <ErrorState
        title={self ? t("Couldn't load your scores") : t("Couldn't load these scores")}
        body={state.error ?? t("Try again in a moment.")}
        onRetry={state.retry}
      />
    );
  }
  const entries = state.entries ?? [];
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title={t("No scores yet")}
        body={
          self
            ? t("A score appears here after a run is verified and saved.")
            : t("@{username} has no verified scores yet.", { username })
        }
      />
    );
  }
  const podium = entries.slice(0, 3);
  const others = entries.slice(3);
  return (
    <div className="mx-4 space-y-3 md:mx-0">
      <ol
        aria-label={t("Top scores")}
        className={cn(
          "grid gap-2",
          podium.length === 1 ? "grid-cols-1" : podium.length === 2 ? "grid-cols-2" : "grid-cols-3",
        )}
      >
        {podium.map((entry, i) => (
          <li
            key={`${entry.game?.slug ?? "game"}-${i}`}
            className={cn(
              "flex min-w-0 flex-col justify-between gap-3 rounded-xl p-3",
              i === 0 ? "bg-primary/15 ring-1 ring-primary/40" : "bg-surface",
            )}
          >
            <span
              className={cn(
                "flex items-center gap-1 text-xs font-medium",
                i === 0 ? "text-primary" : "text-muted-foreground",
              )}
            >
              {i === 0 && <Trophy className="size-3.5" aria-hidden />}
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-lg font-semibold tabular">{points(entry.score)}</span>
              <span className="line-clamp-2 text-xs">
                <GameName game={entry.game} />
              </span>
            </span>
          </li>
        ))}
      </ol>
      {others.length > 0 && (
        <ol start={4} className="divide-y divide-border overflow-hidden rounded-xl bg-surface">
          {others.map((entry, i) => (
            <li
              key={`${entry.game?.slug ?? "game"}-${i}`}
              className="flex items-center gap-3 px-4 py-3"
            >
              <span className="w-5 shrink-0 text-xs text-muted-foreground tabular">{i + 4}</span>
              <span className="min-w-0 flex-1 truncate text-sm">
                <GameName game={entry.game} />
              </span>
              <span className="font-semibold tabular">{points(entry.score)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function GameName({ game }: { game: Game | null }) {
  return game ? (
    <Link to="/games/$id" params={{ id: game.slug }} className="hover:underline">
      {game.title}
    </Link>
  ) : (
    <span className="text-muted-foreground">{t("A game")}</span>
  );
}

function RecentGames({
  state,
  self,
  username,
}: {
  state: GameList;
  self?: boolean;
  username: string;
}) {
  if (state.status === "loading") return <ListSkeleton rows={4} avatar={false} />;
  if (state.status === "hidden") {
    return (
      <EmptyState
        icon={Lock}
        title={t("Recent games are hidden")}
        body={t("@{username} doesn't show recently played games.", { username })}
      />
    );
  }
  if (state.status === "error") {
    return (
      <ErrorState
        title={t("Couldn't load recently played games")}
        body={state.error ?? t("Try again in a moment.")}
        onRetry={state.retry}
      />
    );
  }
  const games = state.games ?? [];
  if (games.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title={t("No games played yet")}
        body={
          self
            ? t("A game appears here after a scored run is saved. Guest runs are not saved.")
            : t("@{username} hasn't played any scored games yet.", { username })
        }
      />
    );
  }
  return (
    <ul className="mx-4 divide-y divide-border overflow-hidden rounded-xl bg-surface md:mx-0">
      {games.map((game) => (
        <li key={game.slug} className="flex items-center gap-3 px-4 py-3 text-sm">
          <Link
            to="/games/$id"
            params={{ id: game.slug }}
            className="min-w-0 flex-1 truncate hover:underline"
          >
            {game.title}
          </Link>
          {game.category?.name && (
            <span className="shrink-0 text-xs text-muted-foreground">{game.category.name}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

type ScoreList = {
  status: "anonymous" | "loading" | "ready" | "error" | "hidden";
  entries?: Array<{ game: Game | null; score: number }>;
  error?: string;
  retry?: () => void;
};

type GameList = {
  status: "anonymous" | "loading" | "ready" | "error" | "hidden";
  games?: Game[];
  error?: string;
  retry?: () => void;
};

/**
 * Tabs that always fit: one equal column each, never a scroller. A scrolling
 * row could be dragged in both directions on a phone, because `overflow-x: auto`
 * makes the other axis scrollable too and the tabs' overlap gave it room to move.
 */
function ProfileTabs({
  names,
  active,
  onSelect,
}: {
  names: readonly TabName[];
  active: TabName;
  onSelect: (name: TabName) => void;
}) {
  const index = names.indexOf(active);
  return (
    <div
      className="relative mx-4 mt-6 grid border-b border-border md:mx-0"
      style={{ gridTemplateColumns: `repeat(${names.length}, minmax(0, 1fr))` }}
      role="tablist"
    >
      {names.map((name) => {
        const Icon = tabIcons[name]!;
        return (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={active === name}
            onClick={() => onSelect(name)}
            className={cn(
              "flex min-w-0 flex-col items-center gap-1 px-0.5 pb-2.5 text-center text-[11px] leading-tight transition-colors md:flex-row md:justify-center md:gap-1.5 md:text-sm",
              active === name ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {t(name)}
          </button>
        );
      })}
      <span
        aria-hidden
        className="absolute -bottom-px left-0 h-0.5 rounded-full bg-primary transition-transform duration-200 motion-reduce:transition-none"
        style={{
          width: `${100 / names.length}%`,
          transform: `translateX(${Math.max(index, 0) * 100}%)`,
        }}
      />
    </div>
  );
}

export function ProfileView({
  user,
  self,
  loading,
  fallback,
  visibility,
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
  /** The player's privacy choices. Undefined until they have been read. */
  visibility?: { isPrivate: boolean; showScores: boolean };
  /** The player's best score per game, from saved score rows. */
  bestScores?: ScoreList;
  /** The player's games, newest first, from saved score rows. */
  recentlyPlayed?: GameList;
}) {
  const skeleton = loading ?? false;
  const [tab, setTab] = useState<TabName>("Best scores");
  const [share, setShare] = useState(false);
  // A visitor to a private profile gets the name and picture, and the scores
  // only if the player chose to show them.
  const restricted = !self && visibility?.isPrivate === true;
  // Activity and Saved describe whoever is signed in, so they are never offered
  // on somebody else's profile.
  const visible: readonly TabName[] = self
    ? tabs
    : restricted
      ? visibility.showScores
        ? ["Best scores"]
        : []
      : tabs.filter((name) => name !== "Activity" && name !== "Saved");
  const active = visible.includes(tab) ? tab : (visible[0] ?? "Best scores");
  const gamesScored = bestScores?.status === "ready" ? bestScores.entries?.length : undefined;

  async function block() {
    try {
      const { blockUsername } = await import("@/lib/settings/blocked");
      await blockUsername(user.username);
      toast.success(t("Blocked @{username}", { username: user.username }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Couldn't block this account."));
    }
  }

  return (
    <Page>
      <PageHeader
        back={!self}
        // The signed-in header is the display name, which is unknown until the
        // profile arrives; "Your profile" is what the tab and the page title say.
        title={self ? user.name || t("Your profile") : `@${user.username}`}
        actions={
          <div className="flex">
            {user.username !== "" && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("Share profile")}
                onClick={() => setShare(true)}
              >
                <Share2 />
              </Button>
            )}
            {self ? (
              <Button asChild variant="ghost" size="icon" aria-label={t("Settings")}>
                <Link to="/settings">
                  <Settings />
                </Link>
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t("More")}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() =>
                      toast(
                        t(
                          "Reporting is reviewed by moderators. Open an issue to report this account.",
                        ),
                      )
                    }
                  >
                    {t("Report")}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onClick={() => void block()}>
                    {t("Block")}
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
          {skeleton ? (
            <div>
              <Skeleton className="h-28 w-full rounded-none md:h-36 md:rounded-2xl" />
              <div className="-mt-12 px-4 md:px-6">
                <Skeleton className="size-24 rounded-full" />
                <Skeleton className="mt-3 h-4 w-32" />
                <Skeleton className="mt-2 h-3 w-48" />
              </div>
            </div>
          ) : (
            <div className="enter">
              <div className="relative h-28 overflow-hidden md:h-36 md:rounded-2xl">
                <PlayerBoard username={user.username} />
              </div>
              <div className="px-4 md:px-6">
                <div className="-mt-12 flex items-end justify-between gap-3">
                  <Avatar
                    name={user.username}
                    src={user.avatarSrc}
                    size="xl"
                    zoomable
                    className="relative ring-4 ring-background"
                  />
                  <div className="flex flex-wrap justify-end gap-2 pb-1">
                    {self ? (
                      <>
                        <Button asChild variant="secondary" size="sm">
                          <Link to="/settings/$section" params={{ section: "profile" }}>
                            {t("Edit profile")}
                          </Link>
                        </Button>
                        <Button asChild variant="secondary" size="sm">
                          <Link to="/likes">{t("Likes")}</Link>
                        </Button>
                      </>
                    ) : (
                      <>
                        <FollowButton
                          userId={user.userId}
                          username={user.username}
                          initial={user.isFollowing}
                          size="sm"
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => toast(t("Direct messages are not implemented."))}
                        >
                          {t("Message")}
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <p className="mt-3 text-lg font-semibold">{user.name}</p>
                <p className="text-sm text-muted-foreground">
                  <UserName username={user.username} verified={user.verified} />
                </p>

                {visibility && (self || restricted) && (
                  <VisibilityChip self={self} visibility={visibility} />
                )}

                {!restricted && user.bio && <p className="mt-2 max-w-md text-sm">{user.bio}</p>}

                {!restricted && (user.stats !== undefined || user.statsLoading) && (
                  <div className="mt-4 grid auto-cols-fr grid-flow-col divide-x divide-border rounded-xl bg-surface py-3">
                    <Stat
                      value={user.stats?.followers ?? "—"}
                      label={t("Followers")}
                      conn={{ username: user.username, tab: "followers" }}
                    />
                    <Stat
                      value={user.stats?.following ?? "—"}
                      label={t("Following")}
                      conn={{ username: user.username, tab: "following" }}
                    />
                    {gamesScored !== undefined && (
                      <Stat value={gamesScored} label={t("Games played")} />
                    )}
                  </div>
                )}
                {!restricted && user.statsError && (
                  <p className="mt-2 text-xs text-muted-foreground" role="status">
                    {t("Couldn't load follower counts.")}{" "}
                    {user.onRetryStats && (
                      <button
                        type="button"
                        className="font-medium text-foreground underline underline-offset-4"
                        onClick={user.onRetryStats}
                      >
                        {t("Retry")}
                      </button>
                    )}
                  </p>
                )}
              </div>
            </div>
          )}

          {visible.length > 1 && <ProfileTabs names={visible} active={active} onSelect={setTab} />}

          <div className="pt-6">
            {skeleton ? (
              <GridSkeleton count={4} />
            ) : visible.length === 0 ? (
              <EmptyState
                icon={Lock}
                title={t("This profile is private")}
                body={t("@{username} has chosen to keep this profile private.", {
                  username: user.username,
                })}
              />
            ) : (
              <>
                {active === "Best scores" &&
                  (bestScores ? (
                    <BestScores state={bestScores} self={self} username={user.username} />
                  ) : (
                    <EmptyState
                      title={t("Best scores live on each game's board")}
                      body={t("Open a game's leaderboard to see verified scores for this account.")}
                    />
                  ))}
                {active === "Activity" && (
                  <EmptyState
                    icon={Activity}
                    title={t("Activity has its own page")}
                    body={t(
                      "Recent plays, likes, comments and saves are listed together on the Activity page.",
                    )}
                    action={
                      <Button asChild variant="secondary">
                        <Link to="/activity">{t("View activity")}</Link>
                      </Button>
                    }
                  />
                )}
                {active === "Saved" && (
                  <EmptyState
                    title={t("Saved games have their own page")}
                    body={t("Everything you saved is listed on the Saved page.")}
                    action={
                      <Button asChild variant="secondary">
                        <Link to="/saved">{t("View saved games")}</Link>
                      </Button>
                    }
                  />
                )}
                {active === "Recent" &&
                  (recentlyPlayed ? (
                    <RecentGames state={recentlyPlayed} self={self} username={user.username} />
                  ) : (
                    <EmptyState
                      title={t("Recent games live on their own page")}
                      body={t(
                        "Games with a saved score are listed newest first on Recently played.",
                      )}
                      action={
                        <Button asChild variant="secondary">
                          <Link to="/recent">{t("View recently played")}</Link>
                        </Button>
                      }
                    />
                  ))}
                {active === "Achievements" && (
                  <EmptyState
                    icon={Award}
                    title={t("No achievements yet")}
                    body={t(
                      "Achievements are not recorded yet, so nothing is shown rather than a sample set.",
                    )}
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

/**
 * Says who can see this profile. On your own profile it is the way to change it;
 * a visitor to a private profile sees why there is so little here.
 */
function VisibilityChip({
  self,
  visibility,
}: {
  self?: boolean;
  visibility: { isPrivate: boolean; showScores: boolean };
}) {
  const Icon = visibility.isPrivate ? Lock : Globe;
  const label = visibility.isPrivate ? t("Private profile") : t("Public profile");
  const className =
    "mt-2 inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-xs text-muted-foreground";
  if (!self) {
    return (
      <p className={className}>
        <Icon className="size-3" aria-hidden />
        {label}
      </p>
    );
  }
  return (
    <Link
      to="/settings/$section"
      params={{ section: "privacy" }}
      className={cn(className, "press hover:text-foreground")}
    >
      <Icon className="size-3" aria-hidden />
      {label} · {visibility.showScores ? t("Scores shown") : t("Scores hidden")}
    </Link>
  );
}
