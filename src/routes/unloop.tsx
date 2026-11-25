import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { UnloopViewer, type UnloopChannel } from "@/components/unloop/UnloopViewer";
import { seo } from "@/lib/seo";
import { t } from "@/lib/settings/language";
import { isUnloopCategory } from "@/lib/unloop/categories";

const VIDEO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type UnloopSearch = { c?: Exclude<UnloopChannel, "all">; v?: string };

export const Route = createFileRoute("/unloop")({
  // `c` is the channel; `v` is a shared loop to open on.
  validateSearch: (search: Record<string, unknown>): UnloopSearch => {
    const out: UnloopSearch = {};
    if (search["c"] === "saved" || isUnloopCategory(search["c"])) out.c = search["c"];
    if (typeof search["v"] === "string" && VIDEO_ID.test(search["v"]))
      out.v = search["v"].toLowerCase();
    return out;
  },
  head: () =>
    seo(
      t("Unloop"),
      t("Short loops from the Unbored crew: highlights, how-tos and speedruns. Swipe, like, save."),
    ),
  component: UnloopScreen,
});

/**
 * Unloop — Unbored's short videos. A destination of its own: the For You feed
 * stays games only, and nothing here is a game.
 */
function UnloopScreen() {
  const { c, v } = Route.useSearch();
  const navigate = useNavigate();
  // A shared loop opens first on this visit only; the address goes back to the
  // channel, so a reload starts the channel from the top.
  const [first, setFirst] = useState(v);
  useEffect(() => {
    if (v) void navigate({ to: "/unloop", search: c ? { c } : {}, replace: true });
  }, [v, c, navigate]);

  const onChannel = useCallback(
    (next: UnloopChannel) => {
      setFirst(undefined);
      void navigate({ to: "/unloop", search: next === "all" ? {} : { c: next }, replace: true });
    },
    [navigate],
  );

  return <UnloopViewer channel={c ?? "all"} first={first} onChannel={onChannel} />;
}
