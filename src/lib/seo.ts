/**
 * Single source of truth for search/social metadata.
 *
 * Public/private indexing is decided here and mirrored in `public/robots.txt`
 * and `public/sitemap.xml`. The rule is an allowlist: a path is indexable only
 * when it is explicitly listed as public, so a new route is private until
 * someone opts it in.
 *
 * The canonical origin comes from `VITE_PUBLIC_SITE_URL`, so moving to a custom
 * domain is an environment change, not a code change.
 */

const DEFAULT_SITE_URL = "https://unbored.lol";

export const SITE_NAME = "Unbored";
export const SITE_DESCRIPTION = "Swipe through short, playable games. Play, score, and swipe on.";

function resolveSiteUrl(): string {
  const raw = (import.meta.env?.["VITE_PUBLIC_SITE_URL"] as string | undefined)?.trim() ?? "";
  if (raw === "") return DEFAULT_SITE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return DEFAULT_SITE_URL;
    return url.origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

/** Canonical origin, without a trailing slash. */
export const SITE_URL = resolveSiteUrl();

/** A square brand icon is the placeholder social image until a 1200x630 asset exists. */
export const DEFAULT_OG_IMAGE = `${SITE_URL}/icon-512.png`;

/** Absolute URL for a route path. */
export function absoluteUrl(path: string): string {
  if (path === "" || path === "/") return `${SITE_URL}/`;
  return `${SITE_URL}/${path.replace(/^\/+/, "")}`;
}

/** Routes that may be crawled and appear in the sitemap. */
const INDEXABLE_PATHS = new Set([
  "/",
  "/explore",
  "/popular",
  "/new",
  "/trending",
  "/recent",
  "/categories",
  "/leaderboards",
  "/welcome",
  "/login",
  "/signup",
  "/privacy",
  "/terms",
]);

const INDEXABLE_PATTERNS = [/^\/categories\/[a-z0-9-]+$/, /^\/games\/[a-z0-9-]+$/];

/**
 * Whether a pathname may be indexed. Account, admin, play, search and other
 * personalised screens return false and are served with `noindex, nofollow`.
 */
export function isIndexable(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (INDEXABLE_PATHS.has(path)) return true;
  return INDEXABLE_PATTERNS.some((pattern) => pattern.test(path));
}

/** Normalises a pathname: no query string, no trailing slash (except root). */
export function normalizePath(pathname: string): string {
  const path = (pathname.split(/[?#]/)[0] ?? "/").trim();
  if (path === "" || path === "/") return "/";
  return path.replace(/\/+$/, "").toLowerCase();
}

type MetaEntry = Record<string, string>;

/** Minimal shape of a head script entry (React would wrap it in a <script> tag). */
export type HeadScript = { type: string; children: string };

export type SeoOptions = {
  /** Force `noindex, nofollow` even for a public path, or opt a private one in. */
  indexable?: boolean;
  /** Override the social image (absolute URL or site-relative path). */
  image?: string;
  /** Open Graph object type. Defaults to `website`. */
  type?: "website" | "article" | "video.other" | "profile";
  /** One or more JSON-LD documents describing this page. */
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
};

/**
 * Page metadata. The canonical link and `robots` directive are added once at
 * the root route from the matched pathname, so pages only describe themselves.
 */
export function seo(title: string, description: string, options: SeoOptions = {}) {
  const fullTitle = `${title} — ${SITE_NAME}`;
  const image = options.image ? absoluteOrSiteRelative(options.image) : DEFAULT_OG_IMAGE;

  const meta: MetaEntry[] = [
    { title: fullTitle },
    { name: "description", content: description },
    { property: "og:title", content: fullTitle },
    { property: "og:description", content: description },
    { property: "og:type", content: options.type ?? "website" },
    { property: "og:image", content: image },
    { property: "og:image:alt", content: `${SITE_NAME} — ${title}` },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: fullTitle },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ];

  if (options.indexable === false) {
    meta.push({ name: "robots", content: "noindex, nofollow" });
  }

  return {
    meta,
    scripts: options.jsonLd ? jsonLdScripts(options.jsonLd) : undefined,
  };
}

/** Root-level metadata derived from the matched pathname. */
export function rootSeo(pathname: string) {
  const path = normalizePath(pathname);
  const indexable = isIndexable(path);
  const url = absoluteUrl(path);

  const meta: MetaEntry[] = [
    { property: "og:url", content: url },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: "en_US" },
  ];
  if (!indexable) {
    meta.push({ name: "robots", content: "noindex, nofollow" });
  }

  const links = [
    { rel: "canonical", href: url },
    // Feed the app itself; sitemap.xml is the crawler-facing index of public routes.
    ...(indexable ? [{ rel: "alternate", type: "application/xml", href: "/sitemap.xml" }] : []),
  ];

  return {
    meta,
    links,
    scripts: indexable ? jsonLdScripts([websiteJsonLd(), organizationJsonLd()]) : undefined,
  };
}

function absoluteOrSiteRelative(value: string): string {
  return /^https?:\/\//i.test(value) ? value : absoluteUrl(value);
}

export function jsonLdScripts(
  data: Record<string, unknown> | Array<Record<string, unknown>>,
): Array<HeadScript> {
  const documents = Array.isArray(data) ? data : [data];
  return documents.map((document) => ({
    type: "application/ld+json",
    children: JSON.stringify(document),
  }));
}

/** Structured data for the site itself, including the internal search action. */
export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: absoluteUrl("/"),
    inLanguage: "en",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: absoluteUrl("/search?q={search_term_string}"),
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: absoluteUrl("/"),
    logo: DEFAULT_OG_IMAGE,
  };
}

/**
 * Structured data for a game detail page.
 *
 * `description` and `category` are optional because they come from the catalogue
 * API, which document metadata is built before: a route's `head` has the URL, not
 * the record. An omitted property is better than a guessed one — schema.org reads
 * a description as the game's own text.
 */
export function videoGameJsonLd(game: {
  id: string;
  title: string;
  description?: string;
  category?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: game.title,
    ...(game.description ? { description: game.description } : {}),
    url: absoluteUrl(`/games/${game.id}`),
    applicationCategory: "Game",
    gamePlatform: "Web browser",
    operatingSystem: "Any",
    inLanguage: "en",
    ...(game.category ? { genre: game.category } : {}),
  };
}

/** Structured data for a breadcrumb trail. */
export function breadcrumbJsonLd(trail: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}
