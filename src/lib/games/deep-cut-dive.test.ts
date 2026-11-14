import { describe, expect, it } from "vitest";

import { TIERS, type Tier } from "@/lib/games/deep-cut";
import { bandCentre, DIVE_MS, diveAt, TIER_METRES } from "@/lib/games/deep-cut-dive";

describe("the dive", () => {
  it("ends in the middle of the tier's band, reading the tier's depth", () => {
    for (const { tier, depth } of TIERS) {
      const end = diveAt(tier, DIVE_MS * 2);
      expect(end.share).toBeCloseTo(bandCentre(tier));
      expect(end.metres).toBe(TIER_METRES[tier]);
      expect(`${end.metres.toLocaleString("en-US")} m`).toBe(depth);
    }
  });

  it("only ever goes down, and the counter only ever climbs", () => {
    const tier: Tier = 6;
    let last = { share: -1, metres: -1 };
    for (let ms = 0; ms <= DIVE_MS; ms += 50) {
      const now = diveAt(tier, ms);
      expect(now.share).toBeGreaterThanOrEqual(last.share);
      expect(now.metres).toBeGreaterThanOrEqual(last.metres);
      last = now;
    }
  });

  it("starts at the surface", () => {
    expect(diveAt(5, 0)).toEqual({ share: 0.04, metres: 0 });
  });
});
