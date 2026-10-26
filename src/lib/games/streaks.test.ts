import { describe, expect, it } from "vitest";

import { streakLine, streakStatus } from "@/lib/games/streaks";

const today = "2026-10-26";

describe("streak status", () => {
  it("is done once today is played", () => {
    const streak = { streak: 4, lastPlayedOn: today, today };
    expect(streakStatus(streak)).toBe("done");
    expect(streakLine(streak)).toBe("4-day streak. Come back tomorrow to keep it going.");
  });

  it("asks for today after a day played yesterday", () => {
    expect(streakStatus({ streak: 1, lastPlayedOn: "2026-10-25", today })).toBe("keep");
  });

  it("is on a rest day after one missed day, and still saveable", () => {
    const streak = { streak: 3, lastPlayedOn: "2026-10-24", today };
    expect(streakStatus(streak)).toBe("rest");
    expect(streakLine(streak)).toMatch(/rest day.*play today to save it/);
  });

  it("is gone after two missed days, or with no streak at all", () => {
    expect(streakStatus({ streak: 0, lastPlayedOn: "2026-10-23", today })).toBe("none");
    expect(streakStatus({ streak: 0, lastPlayedOn: null, today })).toBe("none");
    expect(streakLine({ streak: 0, lastPlayedOn: null, today })).toBeNull();
  });

  it("counts days across a month boundary", () => {
    expect(streakStatus({ streak: 2, lastPlayedOn: "2026-10-31", today: "2026-11-01" })).toBe(
      "keep",
    );
  });
});
