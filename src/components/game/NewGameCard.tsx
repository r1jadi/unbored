import { Play, Sparkles } from "lucide-react";
import { GameArt } from "@/components/game/GameArt";
import { NotificationCard } from "@/components/notifications/NotificationCard";
import { newGameOf, type AppNotification } from "@/lib/notifications/store";
import { msg, t, translateContent } from "@/lib/settings/language";

const HOOKS = [
  msg("Clear your schedule. {game} just landed."),
  msg("Fresh out of the oven: {game}."),
  msg("Your next high score starts here: {game}."),
  msg("New game, wide-open leaderboard. {game} is up for grabs."),
];

/** The same game always gets the same line, so it doesn't change on a reload. */
function hookFor(slug: string): string {
  let hash = 2166136261;
  for (const char of slug) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  // The high bits: a simple hash's low bits repeat, which gave most games one line.
  return HOOKS[(hash >>> 16) % HOOKS.length]!;
}

/**
 * A new game in the inbox: the one notification that is an invitation, so it looks
 * like one. It shows the game's own art, and a shine crosses it once while it's new.
 * Every other notification takes the same shape (see `NotificationCard`).
 */
export function NewGameCard({ item }: { item: AppNotification }) {
  const game = newGameOf(item);
  if (!game) return null;
  return (
    <NotificationCard
      art={<GameArt id={game.slug} className="size-20 rounded-xl" />}
      eyebrow={t("New game")}
      eyebrowIcon={Sparkles}
      headline={t(hookFor(game.slug), { game: game.title })}
      detail={translateContent(game.tagline)}
      createdAt={item.createdAt}
      unread={!item.readAt}
      action={{
        label: t("Play"),
        ariaLabel: t("Play {game}", { game: game.title }),
        icon: Play,
        variant: "play",
        to: "/play/$id",
        params: { id: game.slug },
        search: { start: true },
      }}
    />
  );
}
