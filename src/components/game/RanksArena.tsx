import { Link } from "@tanstack/react-router";
import { Crown } from "lucide-react";
import type { CSSProperties } from "react";

import { UserAvatar } from "@/components/common";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile } from "@/lib/users/profile";
import { t } from "@/lib/settings/language";
import { cn } from "@/lib/utils";

/** One player's place, already ranked and worded by the board it came from. */
export type ArenaRow = {
  rank: number;
  username: string | null;
  value: number;
  detail?: string;
};

/** Staggering stops here, so a long board doesn't keep arriving for seconds. */
const STAGGER_ROWS = 12;

/** Podium seats by finishing order: first in the middle, second left, third right. */
const SEATS = [2, 1, 3];

function name(username: string | null): string {
  return username ? `@${username}` : t("A former player");
}

/**
 * Metal is only for the real top three. A Following board keeps global ranks, so its
 * podium can hold a #7, who stands on it without a medal rather than claiming one.
 */
function tierOf(rank: number): string {
  return rank >= 1 && rank <= 3 ? String(rank) : "none";
}

function ProfileLink({
  username,
  className,
  children,
}: {
  username: string | null;
  className: string;
  children: React.ReactNode;
}) {
  if (!username) return <div className={className}>{children}</div>;
  return (
    <Link
      to="/u/$username"
      params={{ username }}
      aria-label={t("View @{username}'s profile", { username })}
      className={className}
    >
      {children}
    </Link>
  );
}

function Podium({ rows, myName }: { rows: ArenaRow[]; myName?: string }) {
  return (
    <div className="ranks-stage">
      <span aria-hidden className="ranks-beam ranks-beam-left" />
      <span aria-hidden className="ranks-beam ranks-beam-right" />
      <ol className="relative grid grid-cols-3 items-end gap-1.5 px-3 md:gap-3 md:px-6">
        {rows.map((row, index) => {
          const mine = row.username !== null && row.username === myName;
          return (
            <li
              key={`${row.rank}-${row.username}`}
              className="ranks-place"
              data-seat={index + 1}
              data-tier={tierOf(row.rank)}
              style={{ gridColumn: SEATS[index], gridRow: 1 }}
            >
              <ProfileLink username={row.username} className="ranks-place-link press">
                <span className="ranks-contender">
                  {row.rank === 1 && (
                    <Crown aria-hidden className="ranks-crown" fill="currentColor" />
                  )}
                  <span className="ranks-medal">
                    <UserAvatar
                      username={row.username ?? undefined}
                      size="lg"
                      className={cn(
                        "ring-0",
                        index === 0 ? "size-[4.5rem] md:size-24" : "size-14 md:size-[4.5rem]",
                      )}
                    />
                  </span>
                </span>
                <span className="mt-1.5 flex w-full min-w-0 flex-col items-center px-0.5 text-center">
                  <span className="w-full truncate text-xs font-semibold md:text-sm">
                    {name(row.username)}
                  </span>
                  {mine && <span className="ranks-you-tag">{t("You")}</span>}
                  {row.detail && (
                    <span className="truncate text-[11px] text-muted-foreground">{row.detail}</span>
                  )}
                </span>
                <span className="ranks-pedestal">
                  <span className="ranks-pedestal-value tabular">{row.value}</span>
                  <span className="ranks-pedestal-rank tabular">{row.rank}</span>
                </span>
              </ProfileLink>
            </li>
          );
        })}
        {/* A seat nobody holds yet is an invitation, so it stands empty rather than hidden. */}
        {[0, 1, 2].slice(rows.length).map((index) => (
          <li
            key={index}
            aria-hidden
            className="ranks-place ranks-place-open"
            data-seat={index + 1}
            style={{ gridColumn: SEATS[index], gridRow: 1 }}
          >
            <span className="ranks-pedestal">
              <span className="ranks-pedestal-rank">?</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Ladder({ rows, myName, start }: { rows: ArenaRow[]; myName?: string; start: number }) {
  return (
    <ol start={start} className="mt-4 space-y-1.5 px-4 md:px-0">
      {rows.map((row, index) => {
        const mine = row.username !== null && row.username === myName;
        return (
          <li
            key={`${row.rank}-${row.username}`}
            className="ranks-rung-enter"
            style={{ "--rung": Math.min(index, STAGGER_ROWS) } as CSSProperties}
          >
            <ProfileLink
              username={row.username}
              className={cn("ranks-rung", mine && "ranks-rung-mine")}
            >
              <span className="ranks-rung-rank tabular">{row.rank}</span>
              <UserAvatar username={row.username ?? undefined} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{name(row.username)}</span>
                  {mine && <span className="ranks-you-tag">{t("You")}</span>}
                </span>
                {row.detail && (
                  <span className="block text-xs text-muted-foreground">{row.detail}</span>
                )}
              </span>
              <span className="font-mono text-sm font-bold tabular">{row.value}</span>
            </ProfileLink>
          </li>
        );
      })}
    </ol>
  );
}

/** The player's own place, held in view when it is further down than the page reaches. */
export function RanksYouBar({ rank, value }: { rank: number; value: number }) {
  return (
    <Link to="/profile" aria-label={t("View your profile")} className="ranks-you-bar press">
      <span className="ranks-rung-rank tabular">{rank}</span>
      <span className="flex-1 text-sm font-semibold">{t("You")}</span>
      <span className="font-mono text-sm font-bold tabular">{value}</span>
    </Link>
  );
}

/** A board's rows: the top three on the podium, and everyone else on the ladder below. */
export function RanksArena({ rows }: { rows: ArenaRow[] }) {
  const profile = useProfile();
  const myName = profile.status === "ready" ? profile.profile.username : undefined;
  return (
    <div>
      <Podium rows={rows.slice(0, 3)} myName={myName} />
      {rows.length > 3 && <Ladder rows={rows.slice(3)} myName={myName} start={4} />}
    </div>
  );
}

export function RanksSkeleton() {
  return (
    <div aria-busy="true" aria-label={t("Loading")}>
      <div className="grid grid-cols-3 items-end gap-1.5 px-3 md:gap-3 md:px-6">
        <Skeleton className="h-36 rounded-t-2xl" />
        <Skeleton className="h-48 rounded-t-2xl" />
        <Skeleton className="h-28 rounded-t-2xl" />
      </div>
      <div className="mt-4 space-y-1.5 px-4 md:px-0">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-14 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
