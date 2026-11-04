import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ScrollStrip } from "@/components/game/ScrollStrip";

// jsdom has no PointerEvent, and without one a fired event loses its `pointerType`
// and coordinates, which are what the strip reads.
class TestPointerEvent extends MouseEvent {
  pointerType: string;
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? "";
    this.pointerId = init.pointerId ?? 0;
  }
}

beforeAll(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** jsdom has no layout, so the sizes a browser would measure are stated here. */
function setSizes(element: HTMLElement, sizes: { clientWidth: number; scrollWidth: number }) {
  Object.defineProperty(element, "clientWidth", { configurable: true, value: sizes.clientWidth });
  Object.defineProperty(element, "scrollWidth", { configurable: true, value: sizes.scrollWidth });
}

function renderStrip(onChip = vi.fn()) {
  render(
    <ScrollStrip>
      <button onClick={onChip}>Decant</button>
    </ScrollStrip>,
  );
  return { strip: screen.getByTestId("scroll-strip"), chip: screen.getByText("Decant"), onChip };
}

function press(target: Element, clientX: number, pointerType = "mouse") {
  fireEvent.pointerDown(target, { clientX, button: 0, pointerType, pointerId: 1 });
}

describe("the chip strip", () => {
  it("scrolls when dragged with a mouse, and does not open the chip it lands on", () => {
    const { strip, chip, onChip } = renderStrip();
    strip.scrollLeft = 200;

    press(chip, 300);
    fireEvent.pointerMove(chip, { clientX: 220, pointerType: "mouse" });
    fireEvent.pointerUp(chip, { clientX: 220, pointerType: "mouse" });
    fireEvent.click(chip);

    expect(strip.scrollLeft).toBe(280);
    expect(onChip).not.toHaveBeenCalled();
  });

  it("still opens a chip on a plain click, even with a little hand movement", () => {
    const { strip, chip, onChip } = renderStrip();

    press(chip, 300);
    fireEvent.pointerMove(chip, { clientX: 302, pointerType: "mouse" });
    fireEvent.pointerUp(chip, { clientX: 302, pointerType: "mouse" });
    fireEvent.click(chip);

    expect(strip.scrollLeft).toBe(0);
    expect(onChip).toHaveBeenCalledTimes(1);
  });

  it("opens the next chip after a drag: only the drag's own click is dropped", () => {
    const { chip, onChip } = renderStrip();

    press(chip, 300);
    fireEvent.pointerMove(chip, { clientX: 200, pointerType: "mouse" });
    fireEvent.pointerUp(chip, { clientX: 200, pointerType: "mouse" });
    fireEvent.click(chip);
    press(chip, 200);
    fireEvent.pointerUp(chip, { clientX: 200, pointerType: "mouse" });
    fireEvent.click(chip);

    expect(onChip).toHaveBeenCalledTimes(1);
  });

  it("does not swallow a later Enter when a drag is released off the strip", async () => {
    const { chip, onChip } = renderStrip();

    press(chip, 300);
    fireEvent.pointerMove(chip, { clientX: 200, pointerType: "mouse" });
    fireEvent.pointerUp(chip, { clientX: 200, pointerType: "mouse" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(chip);

    expect(onChip).toHaveBeenCalledTimes(1);
  });

  it("leaves touch to the browser's own swipe", () => {
    const { strip, chip } = renderStrip();
    strip.scrollLeft = 200;

    press(chip, 300, "touch");
    fireEvent.pointerMove(chip, { clientX: 100, pointerType: "touch" });

    expect(strip.scrollLeft).toBe(200);
  });

  it("offers an arrow only towards the side with more to see", () => {
    const { strip } = renderStrip();
    expect(screen.queryByRole("button", { name: "Scroll right" })).toBeNull();

    setSizes(strip, { clientWidth: 400, scrollWidth: 1000 });
    fireEvent.scroll(strip);
    expect(screen.getByRole("button", { name: "Scroll right" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Scroll left" })).toBeNull();

    strip.scrollLeft = 600;
    fireEvent.scroll(strip);
    expect(screen.getByRole("button", { name: "Scroll left" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Scroll right" })).toBeNull();
  });

  it("moves most of a screen per arrow press", () => {
    const { strip } = renderStrip();
    setSizes(strip, { clientWidth: 400, scrollWidth: 1000 });
    fireEvent.scroll(strip);
    const scrollBy = vi.fn();
    strip.scrollBy = scrollBy as typeof strip.scrollBy;

    fireEvent.click(screen.getByRole("button", { name: "Scroll right" }));

    expect(scrollBy.mock.calls[0]?.[0]).toMatchObject({ left: 280 });
  });
});
