import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DailyStreak } from "@/lib/games/streaks";

const data = vi.hoisted(() => ({ value: null as DailyStreak | null }));

vi.mock("@/lib/games/streaks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/games/streaks")>();
  return { ...actual, useMyDailyStreak: () => ({ data: data.value }) };
});

const { DailyStreakChip } = await import("./DailyStreakChip");
const { dailyStreakStatus } = await import("@/lib/games/streaks");

const streak = (over: Partial<DailyStreak>): DailyStreak => ({
  streak: 12,
  lastPlayedOn: "2026-11-10",
  today: "2026-11-11",
  freezes: 0,
  ...over,
});

afterEach(() => {
  data.value = null;
});

describe("the daily streak", () => {
  it("is owed until today's game, done after it, and nothing without a streak", () => {
    expect(dailyStreakStatus(streak({}))).toBe("owed");
    expect(dailyStreakStatus(streak({ lastPlayedOn: "2026-11-11" }))).toBe("done");
    expect(dailyStreakStatus(streak({ streak: 0 }))).toBe("none");
  });

  it("shows nothing for a guest or a player with no streak", () => {
    const { container, rerender } = render(<DailyStreakChip />);
    expect(container).toBeEmptyDOMElement();
    data.value = streak({ streak: 0 });
    rerender(<DailyStreakChip />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the days, says today is still owed, and explains freezes on a tap", async () => {
    data.value = streak({ freezes: 2 });
    render(<DailyStreakChip />);

    const chip = screen.getByRole("button", {
      name: "12-day streak. Play one game today to keep it.",
    });
    expect(chip).toHaveTextContent("12");

    fireEvent.click(chip);
    expect(await screen.findByText("Play any game today to keep it going.")).toBeInTheDocument();
    expect(screen.getByText("2 freezes saved: they cover 2 more missed days.")).toBeInTheDocument();
  });

  it("is plain once today's game is in", () => {
    data.value = streak({ lastPlayedOn: "2026-11-11" });
    render(<DailyStreakChip />);
    expect(screen.getByRole("button", { name: "12-day streak" })).toBeInTheDocument();
  });
});
