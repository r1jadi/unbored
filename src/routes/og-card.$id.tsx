import { createFileRoute, notFound } from "@tanstack/react-router";

import { GameArt } from "@/components/game/GameArt";
import { LogoMark } from "@/components/layout/Logo";
import { titleFromSlug, useGame } from "@/lib/games/catalog";
import { seo, SITE_URL } from "@/lib/seo";

/**
 * A game's link preview, drawn at 1200×630 for `scripts/generate-og-images.mjs` to
 * screenshot into `public/og/<slug>.png`. It is the game's own artwork beside its
 * name, so a shared link looks like the game rather than a generic icon.
 *
 * Development only: production has the PNGs, and this page answers "not found".
 */
export const Route = createFileRoute("/og-card/$id")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  head: ({ params }) => seo(titleFromSlug(params.id), "", { indexable: false }),
  component: OgCard,
});

function OgCard() {
  const { id } = Route.useParams();
  const state = useGame(id);
  const title = state.status === "ready" ? state.game.title : titleFromSlug(id);
  const tagline = state.status === "ready" ? state.game.tagline : null;
  const host = new URL(SITE_URL).host;

  return (
    <div
      className="flex overflow-hidden bg-background text-foreground"
      style={{ width: 1200, height: 630 }}
      data-og-ready={state.status === "ready" ? "true" : undefined}
    >
      <GameArt id={id} className="size-[630px] shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col justify-between p-14">
        <div className="flex items-center gap-3">
          <LogoMark className="size-12" />
          <span className="text-3xl font-semibold tracking-tight">Unbored</span>
        </div>
        <div>
          <h1 className="text-7xl leading-[1.05] font-semibold tracking-tight">{title}</h1>
          {tagline && <p className="mt-5 text-3xl leading-snug text-muted-foreground">{tagline}</p>}
        </div>
        <p className="text-2xl font-medium text-primary">Play free at {host}</p>
      </div>
    </div>
  );
}
