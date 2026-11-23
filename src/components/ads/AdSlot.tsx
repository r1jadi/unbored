import { useEffect, useRef, useState } from "react";

import { ADSENSE_CLIENT } from "@/lib/ads";
import { t } from "@/lib/settings/language";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * The ad units, by where they sit. Each is an AdSense ad unit id (AdSense →
 * Ads → By ad unit), set at build time. A unit with no id renders nothing, so
 * the slots can ship before the units exist.
 */
const SLOTS = {
  /** Under a game's guide on `/games/<slug>`. */
  game: import.meta.env?.["VITE_ADSENSE_SLOT_GAME"] as string | undefined,
  /** Under the introduction on `/categories/<slug>`. */
  category: import.meta.env?.["VITE_ADSENSE_SLOT_CATEGORY"] as string | undefined,
} as const;

export type AdPlacement = keyof typeof SLOTS;

/**
 * One responsive display ad, placed by hand on a content page.
 *
 * Only ever put it on pages with content of their own (the game and category
 * pages), below that content and away from anything a player taps: Google's
 * policies forbid ads on screens without content and placements that invite
 * accidental clicks. It is labelled "Advertisement", as Google allows.
 *
 * It renders after hydration only. The server never outputs it, because the
 * AdSense script fills the `<ins>` in place, which React must not find changed
 * when it hydrates. The `<ins>` is new on every mount, so each page a visitor
 * opens asks for its own ad.
 */
export function AdSlot({ placement, className }: { placement: AdPlacement; className?: string }) {
  const slot = SLOTS[placement]?.trim();
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLModElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || !slot || !ref.current || ref.current.dataset["adsbygoogleStatus"]) return;
    try {
      (window.adsbygoogle = window.adsbygoogle ?? []).push({});
    } catch {
      // A blocked or failed ad leaves an empty box; nothing else depends on it.
    }
  }, [mounted, slot]);

  if (!slot || !mounted) return null;

  return (
    <aside aria-label={t("Advertisement")} className={className}>
      <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {t("Advertisement")}
      </p>
      <ins
        ref={ref}
        className="adsbygoogle block"
        style={{ display: "block" }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
