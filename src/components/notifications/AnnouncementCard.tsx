import { GameArt } from "@/components/game/GameArt";
import {
  IconArt,
  NotificationCard,
  type NotificationCardAction,
} from "@/components/notifications/NotificationCard";
import { ANNOUNCEMENT_ACTIONS, ANNOUNCEMENT_STYLES } from "@/lib/notifications/announcement-styles";
import type { Announcement } from "@/lib/notifications/store";
import { t } from "@/lib/settings/language";

/**
 * An administrator's announcement, drawn exactly like the notifications Unbored sends
 * by itself. The admin console shows the same component as a preview, so what the
 * administrator sees is what every player gets.
 */
export function AnnouncementCard({
  announcement: a,
  createdAt,
  unread,
}: {
  announcement: Announcement;
  createdAt: string | null;
  unread: boolean;
}) {
  const style = ANNOUNCEMENT_STYLES[a.style];
  let action: NotificationCardAction | null = null;
  if (a.action === "play" && a.game) {
    action = {
      label: t("Play"),
      ariaLabel: t("Play {game}", { game: a.gameTitle ?? a.title }),
      icon: ANNOUNCEMENT_ACTIONS.play.icon,
      variant: "play",
      to: "/play/$id",
      params: { id: a.game },
      search: { start: true },
    };
  } else if (a.action && a.action !== "play" && a.link) {
    action = {
      label: t(ANNOUNCEMENT_ACTIONS[a.action].label),
      // Any path inside the app; the router can't type a path written by an administrator.
      to: a.link as NotificationCardAction["to"],
    };
  }
  return (
    <NotificationCard
      art={
        a.game ? (
          <GameArt id={a.game} className="size-20 rounded-xl" />
        ) : (
          <IconArt icon={style.icon} />
        )
      }
      eyebrow={t(style.label)}
      eyebrowIcon={style.icon}
      headline={a.title}
      detail={a.body}
      createdAt={createdAt}
      unread={unread}
      action={action}
    />
  );
}
