import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/components/game/previews/DecantPreview";
import { GRIDBURST_PREVIEW_BEATS } from "@/components/game/previews/GridburstPreview";
import "@/components/game/previews/UpdraftPreview";
import { GamePreview } from "@/components/game/previews/GamePreview";

/**
 * The feed mounts every card at once, so a preview must only load as its card
 * comes near and only move while it is on screen, and must stand still for anyone
 * who asked for less motion.
 */

let observers: FakeObserver[] = [];

class FakeObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }
  observe() {}
  disconnect() {}
  report(ratio: number) {
    this.callback(
      [{ intersectionRatio: ratio, isIntersecting: ratio > 0 } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

/** Reports the card this much on screen, and lets a preview it brings in finish loading. */
async function scrollTo(ratio: number) {
  await act(async () => {
    observers.forEach((observer) => observer.report(ratio));
    await vi.dynamicImportSettled();
  });
}

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matches && query.includes("prefers-reduced-motion"),
  }));
}

/** How many cells of the preview are the tray piece on its way to the board. */
function movingZLayers() {
  return screen.getByTestId("gridburst-preview").querySelectorAll(".z-10").length;
}

beforeEach(() => {
  observers = [];
  vi.useFakeTimers();
  localStorage.clear();
  stubReducedMotion(false);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GamePreview", () => {
  it("shows the still art until the card comes near", () => {
    render(<GamePreview id="gridburst" />);
    expect(screen.queryByTestId("gridburst-preview")).toBeNull();
  });

  it("loads near the screen but waits on its first frame until it is in view", async () => {
    render(<GamePreview id="gridburst" />);
    await scrollTo(0.1);
    expect(screen.getByTestId("gridburst-preview")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(10_000));
    expect(movingZLayers()).toBe(0);
  });

  it("plays while on screen and goes back to the start when scrolled away", async () => {
    render(<GamePreview id="gridburst" />);
    await scrollTo(1);
    act(() => void vi.advanceTimersByTime(GRIDBURST_PREVIEW_BEATS[0].ms));
    expect(movingZLayers()).toBe(1);

    await scrollTo(0.1);
    expect(movingZLayers()).toBe(0);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(movingZLayers()).toBe(0);
  });

  it("starts the loop over after its last beat", async () => {
    render(<GamePreview id="gridburst" />);
    await scrollTo(1);
    for (const beat of GRIDBURST_PREVIEW_BEATS) {
      act(() => void vi.advanceTimersByTime(beat.ms));
    }
    act(() => void vi.advanceTimersByTime(GRIDBURST_PREVIEW_BEATS[0].ms));
    expect(movingZLayers()).toBe(1);
  });

  it("shows the still art when the OS asks for less motion", async () => {
    stubReducedMotion(true);
    render(<GamePreview id="gridburst" />);
    await scrollTo(1);
    expect(screen.queryByTestId("gridburst-preview")).toBeNull();
  });

  it("shows the still art when the player saved reduce motion", async () => {
    localStorage.setItem("unbored-accessibility", JSON.stringify({ reduceMotion: true }));
    render(<GamePreview id="updraft" />);
    await scrollTo(1);
    expect(screen.queryByTestId("updraft-preview")).toBeNull();
  });

  it("lets a player's saved choice to keep motion override the OS", async () => {
    stubReducedMotion(true);
    localStorage.setItem("unbored-accessibility", JSON.stringify({ reduceMotion: false }));
    render(<GamePreview id="decant" />);
    await scrollTo(1);
    expect(screen.getByTestId("decant-preview")).toBeTruthy();
  });

  it("shows the still art for a game with no preview yet", () => {
    const { container } = render(<GamePreview id="a-game-published-tomorrow" />);
    expect(container.querySelector("[data-testid$='-preview']")).toBeNull();
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("doesn't treat a built-in object key as a game", () => {
    const { container } = render(<GamePreview id="constructor" />);
    expect(container.firstElementChild).toBeTruthy();
  });

  it("stands still where IntersectionObserver is missing", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<GamePreview id="gridburst" />);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.queryByTestId("gridburst-preview")).toBeNull();
  });
});
