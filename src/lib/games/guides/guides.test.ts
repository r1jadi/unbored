import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GAME_GUIDES } from "@/lib/games/guides";

/** The game pages the sitemap offers to search engines. */
function sitemapGameSlugs(): string[] {
  const sitemap = readFileSync(join(__dirname, "../../../../public/sitemap.xml"), "utf8");
  return [...sitemap.matchAll(/\/games\/([a-z0-9-]+)</g)].map((match) => match[1]!);
}

describe("game guides", () => {
  it("cover every game page in the sitemap", () => {
    expect(sitemapGameSlugs().filter((slug) => !(slug in GAME_GUIDES))).toEqual([]);
  });

  it("each have an introduction, tips and questions", () => {
    for (const [slug, guide] of Object.entries(GAME_GUIDES)) {
      expect(guide.about.length, slug).toBeGreaterThanOrEqual(2);
      expect(guide.tips.length, slug).toBeGreaterThanOrEqual(3);
      expect(guide.faq.length, slug).toBeGreaterThanOrEqual(2);
    }
  });
});
