import { describe, expect, it } from "vitest";

import { leagueStanding, untilReset } from "./league";

const entries = [
  { rank: 1, username: "global_star", rating: 900, games: 9 },
  { rank: 4, username: "ardit", rating: 300, games: 4 },
  { rank: 7, username: "me", rating: 250, games: 3 },
  { rank: 9, username: "beni", rating: 120, games: 2 },
];
const members = new Set(["me", "ardit", "beni"]);

describe("the weekly league", () => {
  it("ranks you among the people you follow only, and names who is just ahead", () => {
    expect(leagueStanding(entries, members, { rank: 7, rating: 250, games: 3 }, "me")).toEqual({
      size: 3,
      position: 2,
      rating: 250,
      ahead: { username: "ardit", gap: 50 },
    });
  });

  it("counts you before the board ranks you, from your own rating", () => {
    const standing = leagueStanding(
      entries.slice(0, 2),
      members,
      { rank: null, rating: 500, games: 1 },
      "me",
    );
    expect(standing).toMatchObject({ size: 2, position: 1, ahead: null });
  });

  it("puts you below someone you only tie", () => {
    const tied = leagueStanding(entries, members, { rank: 5, rating: 300, games: 3 }, "me");
    expect(tied).toMatchObject({ position: 2, ahead: { username: "ardit", gap: 0 } });
  });

  it("has no standing before you play this week", () => {
    expect(leagueStanding(entries, members, null, "me")).toBeNull();
    expect(leagueStanding(entries, members, { rank: null, rating: 0, games: 0 }, "me")).toBeNull();
  });

  it("resets at Monday 00:00 on this device's clock", () => {
    // Local times, so the test holds in any time zone.
    expect(untilReset(new Date(2026, 10, 11, 12, 0))).toBe("4d 12h"); // Wednesday noon
    expect(untilReset(new Date(2026, 10, 15, 23, 30))).toBe("0h 30m"); // Sunday night
    expect(untilReset(new Date(2026, 10, 16, 0, 0))).toBe("7d 0h"); // just reset
  });
});
