import { afterEach, describe, expect, it, vi } from "vitest";

import { dayNumber, localDayNumber, msUntilLocalMidnight } from "@/lib/games/crossword";
import { deviceTimeZone } from "@/lib/time-zone";

const HOUR = 3_600_000;

describe("the player's day", () => {
  it("is the date on the device, which is the day the server gives them", () => {
    const moment = new Date(2026, 10, 4, 23, 30).getTime();
    const next = new Date(2026, 10, 5, 0, 30).getTime();

    expect(localDayNumber(next)).toBe(localDayNumber(moment) + 1);
  });

  it("does not change until the device's own midnight", () => {
    expect(localDayNumber(new Date(2026, 10, 4, 0, 0).getTime())).toBe(
      localDayNumber(new Date(2026, 10, 4, 23, 59).getTime()),
    );
  });

  it("counts from the same place as the UTC day, so puzzles line up", () => {
    // A date's number is the same whichever zone it is read in.
    expect(localDayNumber(new Date(2026, 10, 4, 12).getTime())).toBe(
      dayNumber(Date.UTC(2026, 10, 4, 12)),
    );
  });
});

describe("the wait for the next puzzle", () => {
  it("counts to midnight on the device", () => {
    expect(msUntilLocalMidnight(new Date(2026, 10, 4, 21, 13).getTime())).toBe(
      2 * HOUR + 47 * 60_000,
    );
  });

  it("is never negative or zero while the day is running", () => {
    expect(msUntilLocalMidnight(new Date(2026, 10, 4, 23, 59, 59).getTime())).toBeGreaterThan(0);
  });
});

describe("the device's time zone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is what the browser reports", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () => ({ timeZone: "Europe/Tirane" }),
    } as Intl.DateTimeFormat);

    expect(deviceTimeZone()).toBe("Europe/Tirane");
  });

  it("falls back to UTC when the browser can't say", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("unsupported");
    });

    expect(deviceTimeZone()).toBe("UTC");
  });
});
