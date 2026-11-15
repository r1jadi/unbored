import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SpeedBonusEstimate } from "@/components/game/SpeedMeter";

afterEach(() => {
  vi.useRealTimers();
});

describe("SpeedBonusEstimate", () => {
  it("shows the bonus the run would get now, and the total with it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    // 50 points, par 60s, 15s in: 45s of 60s ahead is a bonus of 37 (floored).
    render(<SpeedBonusEstimate startedAt={85_000} score={50} solvedParMs={60_000} running />);
    expect(screen.getByText("+370 speed bonus")).toBeInTheDocument();
    expect(screen.getByText(/if you end now · 870 total/)).toBeInTheDocument();
  });

  it("shows nothing at par or slower, or before a board is solved", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { container, rerender } = render(
      <SpeedBonusEstimate startedAt={0} score={50} solvedParMs={60_000} running />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<SpeedBonusEstimate startedAt={99_000} score={0} solvedParMs={0} running />);
    expect(container).toBeEmptyDOMElement();
  });
});
