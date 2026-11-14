/**
 * The reveal's dive, as numbers: where the diver is in the water column and what
 * the depth counter reads, `elapsed` ms into a dive to a tier.
 */

import { TIERS, type Tier } from "@/lib/games/deep-cut";

/** The depth each tier reaches, in metres: the gauge's labels, as numbers. */
export const TIER_METRES: Record<Tier, number> = {
  1: 0,
  2: 10,
  3: 40,
  4: 200,
  5: 1000,
  6: 4000,
};

/** How long the dive takes to reach the abyss; shallower dives take less. */
export const DIVE_MS = 2200;

/** Where a tier's band sits in the column, 0 (top) to 1 (bottom): its middle. */
export function bandCentre(tier: Tier): number {
  return (tier - 0.5) / TIERS.length;
}

const easeOut = (x: number) => 1 - (1 - x) ** 3;

/**
 * Where the diver is `elapsed` ms into a dive to `tier`, as a share of the
 * column (0 = the surface) and in metres. Metres follow the tiers' own scale —
 * each band covers its tier's depths — so the counter reads 1,000 m as the diver
 * reaches the middle of Midnight.
 */
export function diveAt(tier: Tier, elapsed: number): { share: number; metres: number } {
  const target = bandCentre(tier);
  const duration = Math.max(600, DIVE_MS * (target / bandCentre(6)));
  const progress = easeOut(Math.min(1, Math.max(0, elapsed / duration)));
  // The diver starts just under the surface line, at the top of the first band.
  const start = 0.04;
  const share = start + (target - start) * progress;
  // Metres: interpolate between the tiers whose band centres bracket `share`.
  const position = share * TIERS.length + 0.5; // 1 at tier 1's centre, 6 at tier 6's
  const below = Math.min(6, Math.max(1, Math.floor(position))) as Tier;
  const above = Math.min(6, below + 1) as Tier;
  const within = Math.min(1, Math.max(0, position - below));
  const metres =
    position <= 1
      ? 0
      : Math.round(TIER_METRES[below] + (TIER_METRES[above] - TIER_METRES[below]) * within);
  return { share, metres: progress >= 1 ? TIER_METRES[tier] : metres };
}
