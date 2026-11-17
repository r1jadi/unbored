import { Link, type LinkProps } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { formatAgo } from "@/lib/admin/api";
import { t } from "@/lib/settings/language";
import { cn } from "@/lib/utils";

export type NotificationCardAction = {
  label: string;
  /** Spoken in place of the label, when the label alone is ambiguous ("Play" what?). */
  ariaLabel?: string;
  icon?: LucideIcon;
  /** `play` is the bright game button; everything else is the quiet one. */
  variant?: "play" | "secondary";
  to: LinkProps["to"];
  params?: LinkProps["params"];
  search?: LinkProps["search"];
};

/**
 * The one shape every notification in the inbox takes, whether Unbored sent it by
 * itself (a new game, a follow, a reply) or an administrator wrote it: a picture, a
 * label with an icon and the time, a headline, an optional short line, and a button.
 * While it is unread it has the brand ring, a shine crosses it once, and a dot says so.
 */
export function NotificationCard({
  art,
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  headline,
  detail,
  createdAt,
  unread,
  action,
}: {
  art: ReactNode;
  eyebrow: string;
  eyebrowIcon: LucideIcon;
  headline: ReactNode;
  detail?: string | null;
  createdAt: string | null;
  unread: boolean;
  action?: NotificationCardAction | null;
}) {
  const ActionIcon = action?.icon;
  return (
    <div
      className={cn(
        "enter relative overflow-hidden rounded-2xl bg-surface p-3 ring-1 ring-inset",
        unread ? "new-game-shine ring-primary/50" : "ring-border",
      )}
    >
      <div className="relative flex items-center gap-3">
        <div className="shrink-0">{art}</div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-xs font-medium text-primary">
            <EyebrowIcon className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{eyebrow}</span>
            <span className="shrink-0 font-normal text-muted-foreground">
              {" "}
              · {formatAgo(createdAt) ?? t("recently")}
            </span>
            {unread && (
              <span
                className="ml-0.5 size-1.5 shrink-0 rounded-full bg-primary"
                aria-label={t("New")}
              />
            )}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-balance">{headline}</p>
          {detail && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground" title={detail}>
              {detail}
            </p>
          )}
        </div>
        {action && (
          <Button asChild size="sm" variant={action.variant ?? "secondary"} className="shrink-0">
            <Link
              to={action.to}
              params={action.params}
              search={action.search}
              aria-label={action.ariaLabel}
            >
              {ActionIcon && (
                <ActionIcon
                  className={action.variant === "play" ? "fill-current" : undefined}
                  aria-hidden
                />
              )}
              {action.label}
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

/** The picture for a notification with no game: the label's icon on a tile. */
export function IconArt({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-20 items-center justify-center rounded-xl bg-surface-2 text-primary">
      <Icon className="size-8" aria-hidden />
    </span>
  );
}
