import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Swords, Trophy, UserPlus } from "lucide-react";

import { UserAvatar } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/session";
import { getQueryClient } from "@/lib/query";
import { t } from "@/lib/settings/language";
import { fetchProfileByUsername, listFollowees, useFollowState } from "@/lib/social/follows";

/**
 * The top of a game page opened from a shared result: the score to beat, and who
 * set it when the link names them. Following them is one tap; once you follow each
 * other, the same spot offers a callout, which is friends-only.
 */
export function BeatBanner({
  score,
  from,
  title,
}: {
  score: number;
  from?: string;
  title: string;
}) {
  const auth = useAuth();
  const myId = auth.status === "authenticated" ? auth.session.userId : undefined;
  const sender = useQuery(
    {
      queryKey: ["beat-sender", from],
      queryFn: () => fetchProfileByUsername(from!),
      enabled: !!from,
      staleTime: 5 * 60_000,
      retry: false,
    },
    getQueryClient(),
  );
  const profile = sender.data ?? null;
  const isSelf = !!profile && profile.id === myId;
  const follow = useFollowState(profile && myId && !isSelf ? profile.id : undefined);
  // Whether they follow you back: a callout needs both.
  const followsBack = useQuery(
    {
      queryKey: ["follows-me", profile?.id, myId],
      queryFn: async () => (await listFollowees(profile!.id)).includes(myId!),
      enabled: !!profile && !!myId && !isSelf,
      staleTime: 60_000,
      retry: false,
    },
    getQueryClient(),
  );
  const friends = follow.following && followsBack.data === true;
  const shown = score.toLocaleString();

  return (
    <div className="mx-4 mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-primary/10 p-3 text-sm md:mx-0">
      {profile ? (
        <UserAvatar username={profile.username} path={profile.avatar_path} size="sm" />
      ) : (
        <Trophy className="size-5 shrink-0 text-primary" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        {profile && !isSelf
          ? t("@{username} scored {score} in {title}. Can you beat it?", {
              username: profile.username,
              score: shown,
              title,
            })
          : t("Someone scored {score} in {title}. Can you beat it?", { score: shown, title })}
      </span>
      {profile &&
        myId &&
        !isSelf &&
        !follow.loading &&
        (friends ? (
          <Button asChild size="sm" variant="secondary">
            <Link to="/messages/$username" params={{ username: profile.username }}>
              <Swords />
              {t("Call out @{username}", { username: profile.username })}
            </Link>
          </Button>
        ) : (
          !follow.following && (
            <Button
              size="sm"
              variant="secondary"
              disabled={follow.busy}
              onClick={() => void follow.toggle()}
            >
              <UserPlus />
              {t("Follow")}
            </Button>
          )
        ))}
    </div>
  );
}
