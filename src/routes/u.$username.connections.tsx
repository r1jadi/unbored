import { createFileRoute, Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import * as z from "zod";
import {
  EmptyState,
  ErrorState,
  FollowButton,
  ListSkeleton,
  Page,
  PageHeader,
  UserAvatar,
  UserName,
} from "@/components/common";
import {
  fetchProfilesByIds,
  listFollowers,
  listFollowees,
  resolveUserId,
} from "@/lib/social/follows";
import type { PublicProfile } from "@/lib/social/follows";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/u/$username/connections")({
  validateSearch: z.object({ tab: z.enum(["followers", "following"]).optional() }),
  head: ({ params }) => ({
    meta: [
      { title: `@${params.username} connections — Unbored` },
      { name: "description", content: `Followers and following of @${params.username}.` },
      { property: "og:title", content: `@${params.username} connections` },
      { property: "og:description", content: `Followers and following of @${params.username}.` },
    ],
  }),
  component: Connections,
});

/** Real follower/following lists from the follow graph. */
function Connections() {
  const { username } = Route.useParams();
  const { tab = "followers" } = Route.useSearch();
  const [list, setList] = useState<PublicProfile[] | undefined>(undefined);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setList(undefined);
    setError(undefined);
    (async () => {
      const userId = await resolveUserId(username);
      if (!userId) throw new Error(`@${username} doesn't exist.`);
      const ids = tab === "followers" ? await listFollowers(userId) : await listFollowees(userId);
      const profiles = await fetchProfilesByIds(ids);
      return profiles;
    })()
      .then((profiles) => {
        if (!cancelled) setList(profiles);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load connections.");
          setList([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [username, tab]);

  return (
    <Page>
      <PageHeader back title={`@${username}`} />
      <div className="flex border-b border-border text-sm" role="tablist">
        {(["followers", "following"] as const).map((t) => (
          <Link
            key={t}
            to="/u/$username/connections"
            params={{ username }}
            search={{ tab: t }}
            role="tab"
            aria-selected={tab === t}
            className={cn(
              "-mb-px flex-1 border-b-2 py-3 text-center capitalize",
              tab === t
                ? "border-foreground font-medium"
                : "border-transparent text-muted-foreground",
            )}
          >
            {t}
          </Link>
        ))}
      </div>
      {list === undefined ? (
        <ListSkeleton />
      ) : error ? (
        <ErrorState
          title="Couldn't load connections"
          body={error}
          onRetry={() => window.location.reload()}
        />
      ) : list.length === 0 ? (
        <EmptyState icon={Users} title="No one here yet" />
      ) : (
        <ul>
          {list.map((u) => (
            <li key={u.username} className="enter flex items-center gap-3 px-4 py-3 md:px-0">
              <Link
                to="/u/$username"
                params={{ username: u.username }}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <UserAvatar username={u.username} path={u.avatar_path} />
                <div className="min-w-0 text-sm">
                  <UserName username={u.username} />
                  <p className="truncate text-xs text-muted-foreground">{u.display_name}</p>
                </div>
              </Link>
              <FollowButton userId={u.id} />
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
