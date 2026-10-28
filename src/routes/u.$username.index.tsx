import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common";
import { ProfileView } from "@/components/social/ProfileView";
import { listBlockedIds } from "@/lib/settings/blocked";
import { fetchProfileByUsername, useFollowCounts } from "@/lib/social/follows";
import { Button } from "@/components/ui/button";
import { avatarUrlFromPath } from "@/lib/users/profile";

export const Route = createFileRoute("/u/$username/")({
  head: ({ params }) => ({
    meta: [
      { title: `@${params.username} — Unbored` },
      { name: "description", content: `Scores and games played by @${params.username}.` },
      { property: "og:title", content: `@${params.username} on Unbored` },
      { property: "og:description", content: `Scores and games played by @${params.username}.` },
    ],
  }),
  component: UserProfile,
});

/**
 * Another player's public profile, read from the public projection. No fixture
 * data: a missing account is a not-found state, a blocked account is hidden,
 * and counts come from the real follow graph.
 */
function UserProfile() {
  const { username } = Route.useParams();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; userId: string; name: string; bio?: string; avatarPath?: string }
    | { status: "not-found" }
    | { status: "blocked" }
    | { status: "error"; message: string }
  >({ status: "loading" });

  // Followers/following are read from the graph for the profile that resolved,
  // and re-read after every follow or unfollow (see `useFollowCounts`), so the
  // numbers on screen always describe the same account as the header.
  const counts = useFollowCounts(state.status === "ready" ? state.userId : undefined);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      const profile = await fetchProfileByUsername(username);
      if (cancelled) return;
      if (!profile) {
        setState({ status: "not-found" });
        return;
      }
      const blocked = await listBlockedIds();
      if (!cancelled && blocked.has(profile.id)) {
        setState({ status: "blocked" });
        return;
      }
      if (!cancelled) {
        setState({
          status: "ready",
          userId: profile.id,
          name: profile.display_name,
          bio: profile.bio ?? undefined,
          avatarPath: profile.avatar_path ?? undefined,
        });
      }
    })().catch((error: unknown) => {
      if (!cancelled) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Couldn't load this profile.",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (state.status === "loading") {
    return <ProfileView user={{ username, name: username, statsLoading: true }} loading />;
  }
  if (state.status === "not-found") {
    return (
      <ProfileView
        user={{ username, name: username }}
        fallback={<EmptyState title="Account not found" body={`@${username} doesn't exist.`} />}
      />
    );
  }
  if (state.status === "blocked") {
    return (
      <ProfileView
        user={{ username, name: username }}
        fallback={<EmptyState title="Not available" body="This profile isn't available." />}
      />
    );
  }
  if (state.status === "error") {
    return (
      <ProfileView
        user={{ username, name: username }}
        fallback={
          <ErrorState
            title="Couldn't load this profile"
            body={state.message}
            onRetry={() => window.location.reload()}
          />
        }
      />
    );
  }

  return (
    <ProfileView
      user={{
        username,
        name: state.name,
        bio: state.bio,
        avatarSrc: avatarUrlFromPath(state.avatarPath),
        userId: state.userId,
        stats: counts.counts,
        statsLoading: counts.status === "loading" || counts.status === "idle",
        statsError: counts.error,
        onRetryStats: counts.reload,
        hidePlayed: true,
      }}
    />
  );
}

export function UserProfileRetry() {
  return <Button onClick={() => window.location.reload()}>Retry</Button>;
}
