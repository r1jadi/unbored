import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import {
  AdminListStates,
  AdminPage,
  AdminTable,
  MobileRow,
  SectionCard,
  StatusBadge,
  type Column,
} from "@/components/admin/ui";
import { useAdminCategories, type AdminCategory } from "@/lib/admin/api";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/admin/categories")({
  head: () => ({
    meta: [{ title: t("Categories — Unbored admin") }, { name: "robots", content: "noindex" }],
  }),
  component: CategoriesAdmin,
});

/**
 * The catalogue's categories, with the counts the database keeps.
 *
 * Two numbers, and they mean different things: `publishedGames` is what a player
 * can open, `totalGames` includes drafts and archived games. Both are counted, so
 * a category with no games says 0 rather than nothing.
 *
 * There is no create, rename or delete here, and none is invented: the schema has
 * no admin write path for categories, so this screen only reports them.
 */
export function CategoriesAdmin() {
  const categories = useAdminCategories();

  const columns: Column<AdminCategory>[] = [
    {
      key: "name",
      head: t("Category"),
      className: "min-w-52",
      cell: (c) => (
        <div className="min-w-0">
          <Link
            to="/categories/$slug"
            params={{ slug: c.slug }}
            className="block truncate text-sm font-medium hover:underline"
          >
            {c.name}
          </Link>
          <span className="block truncate text-xs text-muted-foreground">{c.slug}</span>
        </div>
      ),
    },
    {
      key: "description",
      head: t("Description"),
      className: "min-w-64",
      cell: (c) => (
        <span className="line-clamp-2 text-sm text-muted-foreground">{c.description ?? "—"}</span>
      ),
    },
    {
      key: "published",
      head: t("Published games"),
      className: "text-right",
      cell: (c) => <span className="font-mono text-sm tabular">{c.publishedGames}</span>,
    },
    {
      key: "total",
      head: t("All games"),
      className: "text-right",
      cell: (c) => (
        <span className="font-mono text-sm text-muted-foreground tabular">{c.totalGames}</span>
      ),
    },
    {
      key: "order",
      head: t("Order"),
      className: "text-right",
      cell: (c) => <span className="font-mono text-sm tabular">{c.sortOrder}</span>,
    },
    {
      key: "link",
      head: "",
      className: "w-12 text-right",
      cell: (c) => (
        <Link
          to="/categories/$slug"
          params={{ slug: c.slug }}
          aria-label={t("Open {name} in the catalogue", { name: c.name })}
          className="inline-flex text-muted-foreground hover:text-foreground"
        >
          <ArrowUpRight className="size-4" />
        </Link>
      ),
    },
  ];

  return (
    <AdminPage
      title={t("Categories")}
      subtitle={t(
        "The catalogue's categories and how many games each one holds. Read-only: categories are part of the catalogue schema.",
      )}
    >
      {categories.status === "error" ? (
        <SectionCard>
          <AdminListStates
            state="error"
            onRetry={categories.retry}
            emptyTitle=""
            emptyBody={categories.error.message}
          />
        </SectionCard>
      ) : categories.status === "loading" ? (
        <AdminListStates state="loading" emptyTitle="" rows={6} />
      ) : categories.data.items.length === 0 ? (
        <SectionCard>
          <AdminListStates
            state="ready"
            emptyTitle={t("No categories")}
            emptyBody={t("The catalogue has no categories yet.")}
          />
        </SectionCard>
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={categories.data.items}
            rowKey={(c) => c.slug}
            mobileRow={(c) => (
              <MobileRow>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t("{publishedGames} published · {totalGames} total", {
                      publishedGames: c.publishedGames,
                      totalGames: c.totalGames,
                    })}
                  </span>
                </span>
                <StatusBadge tone="muted">{c.slug}</StatusBadge>
              </MobileRow>
            )}
          />
          <p className="pt-3 text-xs text-muted-foreground">
            {t("{length} categories, counted from the games table.", {
              length: categories.data.items.length,
            })}
          </p>
        </>
      )}
    </AdminPage>
  );
}
