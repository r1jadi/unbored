import { Award, Lock } from "lucide-react";

import { EmptyState, ErrorState } from "@/components/common";
import { ACHIEVEMENTS, useAchievements } from "@/lib/social/achievements";
import { t } from "@/lib/settings/language";
import { cn } from "@/lib/utils";

/** A profile's achievements: earned first, then what's left with its progress. */
export function AchievementsList({
  userId,
  self,
  username,
}: {
  userId: string | undefined;
  self: boolean;
  username: string;
}) {
  const read = useAchievements(userId);

  if (read.isError) {
    return (
      <ErrorState
        title={t("Couldn't load achievements")}
        body={t("Check your connection and try again.")}
        onRetry={() => void read.refetch()}
      />
    );
  }
  if (!userId || read.isPending) {
    return (
      <div className="grid gap-2 sm:grid-cols-2" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-surface" />
        ))}
      </div>
    );
  }
  if (!read.data.visible) {
    return (
      <EmptyState
        icon={Award}
        title={t("Achievements are hidden")}
        body={t("@{username} keeps their scores private.", { username })}
      />
    );
  }

  const { counters } = read.data;
  const rows = ACHIEVEMENTS.map((achievement) => ({
    ...achievement,
    value: counters[achievement.counter],
    earned: counters[achievement.counter] >= achievement.goal,
  }));
  const earned = rows.filter((row) => row.earned);
  // Someone else's unfinished goals aren't interesting, or theirs to share.
  const shown = self ? [...earned, ...rows.filter((row) => !row.earned)] : earned;

  if (shown.length === 0) {
    return (
      <EmptyState
        icon={Award}
        title={t("No achievements yet")}
        body={t("@{username} hasn't earned any achievements yet.", { username })}
      />
    );
  }

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        {t("{earned} of {total} earned", { earned: earned.length, total: rows.length })}
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {shown.map((row) => (
          <li
            key={row.id}
            className={cn(
              "flex items-start gap-3 rounded-xl border border-border bg-surface p-3",
              !row.earned && "opacity-70",
            )}
          >
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full",
                row.earned ? "bg-primary/15 text-primary" : "bg-surface-2 text-muted-foreground",
              )}
            >
              {row.earned ? <Award className="size-5" /> : <Lock className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t(row.title)}</p>
              <p className="text-xs text-muted-foreground">{t(row.description)}</p>
              {!row.earned && (
                <div className="mt-2">
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={row.goal}
                    aria-valuenow={Math.min(row.value, row.goal)}
                    aria-label={t(row.title)}
                    className="h-1.5 overflow-hidden rounded-full bg-surface-2"
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(100, (row.value / row.goal) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground tabular">
                    {Math.min(row.value, row.goal)} / {row.goal}
                  </p>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
