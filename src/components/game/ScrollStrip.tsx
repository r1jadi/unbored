import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { t } from "@/lib/settings/language";
import { cn } from "@/lib/utils";

/** How far a mouse has to move before a press counts as a drag and not a click. */
const DRAG_THRESHOLD_PX = 5;
/** How much of the visible width one arrow press moves, so a chip stays in view. */
const ARROW_STEP = 0.7;

function motionReduced(): boolean {
  return (
    document.documentElement.classList.contains("a11y-reduce-motion") ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * A sideways row of chips that works with any pointer. A phone swipes it natively,
 * but a mouse can't swipe, and with the scrollbar hidden it had no way to move at
 * all. So a mouse can drag it, and it gets arrows while there is more to see.
 *
 * The selected chip (`aria-current="page"`, which the router's `Link` sets) is
 * centred on load and on each change, because picking a game rebuilds the page and
 * would otherwise leave the chip you just picked off-screen.
 */
export function ScrollStrip({ children, className }: { children: ReactNode; className?: string }) {
  const strip = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const drag = useRef<{ x: number; scrollLeft: number; moved: boolean; pointer: number } | null>(
    null,
  );
  // Set when a drag ends, and read by the click the browser fires straight after,
  // so letting go over a chip doesn't open it.
  const justDragged = useRef(false);

  const measure = useCallback(() => {
    const element = strip.current;
    if (!element) return;
    const left = element.scrollLeft > 1;
    const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    setMore((current) =>
      current.left === left && current.right === right ? current : { left, right },
    );
  }, []);

  useEffect(() => {
    const element = strip.current;
    if (!element) return;

    const centreSelected = () => {
      const selected = element.querySelector<HTMLElement>('[aria-current="page"]');
      if (!selected) return;
      const box = element.getBoundingClientRect();
      const chip = selected.getBoundingClientRect();
      element.scrollLeft += chip.left + chip.width / 2 - (box.left + box.width / 2);
    };

    centreSelected();
    measure();

    // The chips arrive after the catalogue loads and the window can be resized, and
    // neither fires a scroll event.
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(element);
    const chips = new MutationObserver(() => {
      centreSelected();
      measure();
    });
    chips.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-current"],
    });
    return () => {
      resize?.disconnect();
      chips.disconnect();
    };
  }, [measure]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    // Touch and pens already scroll natively.
    if (event.pointerType !== "mouse" || event.button !== 0 || !strip.current) return;
    justDragged.current = false;
    drag.current = {
      x: event.clientX,
      scrollLeft: strip.current.scrollLeft,
      moved: false,
      pointer: event.pointerId,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    const element = strip.current;
    if (!current || !element) return;
    const distance = event.clientX - current.x;
    if (!current.moved) {
      if (Math.abs(distance) < DRAG_THRESHOLD_PX) return;
      // Only now, because capturing on press would retarget a plain click away from
      // the chip it landed on.
      current.moved = true;
      element.setPointerCapture?.(current.pointer);
    }
    element.scrollLeft = current.scrollLeft - distance;
  }

  function endDrag() {
    justDragged.current = drag.current?.moved === true;
    drag.current = null;
    // The click arrives in this same task, if at all: a drag released off the strip
    // has none, and must not swallow a later Enter on a chip.
    setTimeout(() => {
      justDragged.current = false;
    }, 0);
  }

  function step(direction: -1 | 1) {
    const element = strip.current;
    if (!element) return;
    element.scrollBy({
      left: direction * element.clientWidth * ARROW_STEP,
      behavior: motionReduced() ? "auto" : "smooth",
    });
  }

  return (
    <div className="relative">
      <div
        ref={strip}
        data-testid="scroll-strip"
        className={cn(
          "no-scrollbar flex overflow-x-auto [@media(pointer:fine)]:cursor-grab [@media(pointer:fine)]:active:cursor-grabbing",
          className,
        )}
        onScroll={measure}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        // A link is draggable by default, and the browser's own drag would end ours.
        onDragStart={(event) => event.preventDefault()}
        onClickCapture={(event) => {
          if (!justDragged.current) return;
          justDragged.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {children}
      </div>
      {more.left && <StripArrow side="left" onClick={() => step(-1)} />}
      {more.right && <StripArrow side="right" onClick={() => step(1)} />}
    </div>
  );
}

/** Only where there is a mouse: a phone swipes, and its screen has less room. */
function StripArrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-0 hidden h-[calc(100%-1rem)] w-16 items-center [@media(pointer:fine)]:flex",
        side === "left"
          ? "left-0 justify-start bg-linear-to-r from-background to-transparent"
          : "right-0 justify-end bg-linear-to-l from-background to-transparent",
      )}
    >
      <button
        type="button"
        aria-label={side === "left" ? t("Scroll left") : t("Scroll right")}
        onClick={onClick}
        className="press pointer-events-auto flex size-8 items-center justify-center rounded-full bg-surface-2 text-foreground ring-1 ring-border hover:bg-accent"
      >
        <Icon className="size-4" aria-hidden />
      </button>
    </div>
  );
}
