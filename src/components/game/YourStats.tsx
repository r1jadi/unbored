import { Link } from "@tanstack/react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth/session";
import { fmtDate } from "@/lib/format";
import { useMyGameStats } from "@/lib/games/saved-runs";
import { StreakNote } from "@/components/game/StreakNote";

/**
 * The signed-in player's own record for one game: runs played, best score,
 * total points, rank and when they last played, all from verified scores.
 *
 * A guest sees what signing in keeps instead. A failed read shows nothing
 * rather than zeros, because a zero would be a measurement and nothing was
 * measured.
 */
export function YourStats({ slug }: { slug: string }) {
  const auth = useAuth();
  const stats = useMyGameStats(slug);

  if (auth.status !== "authenticated") {
    return (
      <section className="mt-4 rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold">Your stats</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <Link to="/login" search={{ redirect: `/games/${slug}` }} className="underline">
            Sign in
          </Link>{" "}
          to keep your scores, your stats and any run you leave unfinished.
        </p>
      </section>
    );
  }

  if (stats.isPending) {
    return <Skeleton className="mt-4 h-24 rounded-xl" />;
  }

  if (stats.isError || !stats.data) return null;

  const { runs, bestScore, totalScore, rank, lastPlayedAt } = stats.data;

  return (
    <section className="mt-4 rounded-xl border border-border p-4" aria-label="Your stats">
      <h2 className="text-sm font-semibold">Your stats</h2>
      {runs === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          No runs yet. Your scores and stats, and any run you leave unfinished, are kept on your
          account.
        </p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          {(
            [
              // Exact numbers: this is the player's own record, not a feed count.
              ["Best", bestScore === null ? "—" : bestScore.toLocaleString()],
              ["Rank", rank === null ? "—" : `#${rank.toLocaleString()}`],
              ["Runs", runs.toLocaleString()],
              ["Total points", totalScore.toLocaleString()],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-lg bg-surface p-2">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <StreakNote slug={slug} className="mt-3 flex justify-start text-left" />
      {lastPlayedAt && (
        <p className="mt-2 text-xs text-muted-foreground">Last played {fmtDate(lastPlayedAt)}</p>
      )}
    </section>
  );
}
