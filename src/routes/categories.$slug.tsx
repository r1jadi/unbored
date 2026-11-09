import { createFileRoute } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { EmptyState } from "@/components/common";
import { DEFAULT_PAGE_SIZE, titleFromSlug, useCategories } from "@/lib/games/catalog";
import { requireCategory } from "@/lib/games/catalog-exists";
import { breadcrumbJsonLd, seo } from "@/lib/seo";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/categories/$slug")({
  // Server only: an unknown slug is answered with a 404 status, not a 200 shell.
  loader: ({ params }) => requireCategory(params.slug),
  head: ({ params, match }) => {
    if (match.status === "notFound") {
      return seo(t("Category not found"), t("No such category."), { indexable: false });
    }
    const title = titleFromSlug(params.slug);
    return seo(title, t("Play the best {n} games on Unbored.", { n: title.toLowerCase() }), {
      jsonLd: breadcrumbJsonLd([
        { name: t("Categories"), path: "/categories" },
        { name: title, path: `/categories/${params.slug}` },
      ]),
    });
  },
  component: CategoryPage,
  notFoundComponent: CategoryNotFound,
});

function CategoryNotFound() {
  const { slug } = Route.useParams();
  return (
    <GameListPage title={titleFromSlug(slug)} subtitle={t("No such category.")}>
      <EmptyState
        title={t("Category not found")}
        body={t("That category does not exist. Browse every category from the Categories page.")}
      />
    </GameListPage>
  );
}

/**
 * One category's games.
 *
 * The heading uses the API's own name once it has loaded, and falls back to a
 * rendering of the slug before then — never to a hard-coded list of category
 * names.
 *
 * A slug that names no category shows an explicit "not found" state rather than
 * the whole catalogue. The prototype did the opposite (it fell back to every
 * game), which publishes the same content under unlimited URLs.
 */
function CategoryPage() {
  const { slug } = Route.useParams();
  const categories = useCategories();
  const known =
    categories.status === "ready" ? categories.items.find((c) => c.slug === slug) : undefined;

  // Only decide once the category list has arrived: before that, "unknown" would
  // just mean "not loaded".
  if (categories.status === "ready" && !known) return <CategoryNotFound />;

  return (
    <GameListPage
      title={known?.name ?? titleFromSlug(slug)}
      subtitle={known?.description ?? t("Browse games in this category.")}
      query={{ category: slug, limit: DEFAULT_PAGE_SIZE }}
      empty={{
        title: t("Nothing in this category yet"),
        body: t("No game has been published here yet."),
      }}
      ranked
    />
  );
}
