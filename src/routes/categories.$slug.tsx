import { createFileRoute } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { EmptyState } from "@/components/common";
import { DEFAULT_PAGE_SIZE, titleFromSlug, useCategories } from "@/lib/games/catalog";
import { loadCategory } from "@/lib/games/catalog-exists";
import { categoryGuideFor } from "@/lib/games/category-guides";
import { breadcrumbJsonLd, metaDescription, seo } from "@/lib/seo";

import { currentLanguage, t } from "@/lib/settings/language";
export const Route = createFileRoute("/categories/$slug")({
  // Server only: an unknown slug is answered with a 404 status, not a 200 shell,
  // and a known one brings its name and description into the HTML.
  loader: ({ params }) => loadCategory(params.slug),
  head: ({ params, match, loaderData }) => {
    if (match.status === "notFound") {
      return seo(t("Category not found"), t("No such category."), { indexable: false });
    }
    const category = loaderData?.category;
    const title = category?.name ?? titleFromSlug(params.slug);
    const generic = t("Play the best {n} games on Unbored.", { n: title.toLowerCase() });
    return seo(title, metaDescription([category?.description, generic]) ?? generic, {
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
  // What the server read, until the browser's own list arrives: the same name and
  // description, so a crawler sees them and the heading does not change.
  const { category: served } = Route.useLoaderData();
  const known =
    categories.status === "ready" ? categories.items.find((c) => c.slug === slug) : served;

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
      footer={<CategoryIntro slug={slug} />}
    />
  );
}

/** The category's introduction, for English readers (it is written in English). */
function CategoryIntro({ slug }: { slug: string }) {
  const guide = currentLanguage() === "en" ? categoryGuideFor(slug) : null;
  if (!guide) return null;
  return (
    <section aria-labelledby="category-about" className="max-w-2xl">
      <h2 id="category-about" className="text-base font-semibold">
        {guide.heading}
      </h2>
      {guide.paragraphs.map((paragraph) => (
        <p key={paragraph} className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {paragraph}
        </p>
      ))}
    </section>
  );
}
