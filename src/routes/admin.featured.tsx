import { createFileRoute, Link } from "@tanstack/react-router";
import { Gamepad2, Star, Tags } from "lucide-react";
import { AdminPage, SectionCard, UnavailablePanel } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/admin/featured")({
  head: () => ({
    meta: [{ title: t("Featured games — Unbored admin") }, { name: "robots", content: "noindex" }],
  }),
  component: FeaturedAdmin,
});

/**
 * No editorial slots exist yet, and this screen does not pretend otherwise.
 *
 * The prototype listed six featured games with plays and creators and let a
 * moderator reorder them. None of that was real: the schema has no featured table
 * and the catalogue API has no ordering endpoint, so every movement on that page
 * was local state in a browser tab. Rather than show an empty editor, this states
 * what would have to exist first and points at the surfaces that are real.
 */
export function FeaturedAdmin() {
  return (
    <AdminPage
      title={t("Featured games")}
      subtitle={t("Editorial placement in the feed and Explore.")}
    >
      <SectionCard bodyClassName="p-0">
        <UnavailablePanel
          icon={Star}
          title={t("Featured placement is not implemented")}
          body={t(
            "There is nowhere to store an editorial slot and no endpoint that would apply one, so this screen has no games to reorder and no order to save.",
          )}
          points={[
            "The catalogue already orders games from real data — play counts, recency and category — and that ordering is served by the games API.",
            "What is missing is a placement model: a table of slots with an order and the moderator who set it, and a write path that reorders them inside a transaction.",
            "Until that exists, a button on this page could only change what one browser tab shows, which is why there is none.",
          ]}
          action={
            <>
              <Button asChild variant="secondary" size="sm">
                <Link to="/admin/games">
                  <Gamepad2 />
                  {t("Manage games")}
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link to="/admin/categories">
                  <Tags />
                  {t("See categories")}
                </Link>
              </Button>
            </>
          }
        />
      </SectionCard>
    </AdminPage>
  );
}
