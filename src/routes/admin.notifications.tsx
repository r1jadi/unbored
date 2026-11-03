import { createFileRoute, Link } from "@tanstack/react-router";
import { Bell, Inbox } from "lucide-react";
import { AdminPage, SectionCard, UnavailablePanel } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/admin/notifications")({
  head: () => ({
    meta: [{ title: t("Notifications — Unbored admin") }, { name: "robots", content: "noindex" }],
  }),
  component: NotificationsAdmin,
});

/**
 * The inbox is real; campaigns are not, and the difference matters here.
 *
 * `public.notifications` holds one row per player per event — that is what the
 * player-facing inbox reads and what the platform writes when something happens
 * to somebody. What the prototype showed was something else entirely: audiences,
 * scheduled sends, drafts, "delivered 412,890 · 46% opened". None of those
 * numbers could be computed from this schema, and a moderator cannot compose a
 * broadcast that has no table to land in, so this screen composes nothing.
 */
export function NotificationsAdmin() {
  return (
    <AdminPage
      title={t("Notifications")}
      subtitle={t("Messages sent to players, and the campaigns that produce them.")}
    >
      <SectionCard bodyClassName="p-0">
        <UnavailablePanel
          icon={Bell}
          title={t("Broadcast campaigns are not implemented")}
          body={t(
            "Players do have a real inbox: the platform writes a row for each player when something happens to them. An operator-composed campaign — an audience, a schedule, a delivery count — has no schema behind it.",
          )}
          points={[
            "The notifications table is per-player: kind, payload, read time. It records what a player was told, not what was sent to an audience.",
            "There is no campaign, audience, draft or schedule row, and no delivery or open metric in the database, so those counters would be invented.",
            "Sending from this screen would therefore write nothing at all — which is why there is nothing to send with.",
          ]}
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/notifications">
                <Inbox />
                {t("Open your own inbox")}
              </Link>
            </Button>
          }
        />
      </SectionCard>
    </AdminPage>
  );
}
