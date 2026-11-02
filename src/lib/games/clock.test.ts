import { describe, expect, it } from "vitest";

import { clockTaperPercent, taperedBonusMs } from "@/lib/games/clock";

describe("the tapered clock", () => {
  it("is generous for the first boards and halves from board eight", () => {
    expect([1, 2, 3, 4, 7, 8, 50].map(clockTaperPercent)).toEqual([120, 110, 100, 90, 60, 50, 50]);
  });

  it("keeps whole milliseconds, as the verifier's integer arithmetic does", () => {
    expect(taperedBonusMs(15_000, 1)).toBe(18_000);
    expect(taperedBonusMs(25_000, 2)).toBe(27_500);
    expect(taperedBonusMs(35_000, 9)).toBe(17_500);
  });
});
