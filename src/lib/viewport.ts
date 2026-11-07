import { useEffect } from "react";

/** Inputs that take typed text, and so bring up a phone's on-screen keyboard. */
const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function takesText(element: EventTarget | null): boolean {
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) {
    return !NON_TEXT_INPUTS.has(element.type) && !element.readOnly && !element.disabled;
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/**
 * Keeps the on-screen keyboard visible to CSS, on `<html>`, without re-rendering.
 *
 * A phone's keyboard doesn't resize the page; it covers it, and only the visual
 * viewport shrinks. Bars pinned to the bottom then sit under the keyboard or, on some
 * iOS versions, stacked on top of it, between the text field and the keys.
 *
 * - `--viewport-top` and `--viewport-height` are the box that is actually visible,
 *   for a screen that has to fit it exactly (a chat thread, whose composer belongs
 *   right on top of the keyboard). Left unset while pinch-zoomed, so CSS falls back.
 * - `data-keyboard="open"` is set while a text field has focus on a touch screen
 *   (the `keyboard-open:` variant), so the bottom navigation can step aside and
 *   home-indicator padding the keyboard already covers can go.
 */
export function useKeyboardViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const touch = window.matchMedia("(pointer: coarse)");

    const measure = () => {
      if (!viewport || Math.abs(viewport.scale - 1) > 0.01) {
        root.style.removeProperty("--viewport-top");
        root.style.removeProperty("--viewport-height");
        return;
      }
      root.style.setProperty("--viewport-top", `${viewport.offsetTop}px`);
      root.style.setProperty("--viewport-height", `${viewport.height}px`);
    };
    const keyboard = (open: boolean) => {
      if (open && touch.matches) root.setAttribute("data-keyboard", "open");
      else root.removeAttribute("data-keyboard");
    };
    const onFocusIn = (event: FocusEvent) => keyboard(takesText(event.target));
    // Where focus goes next: moving between two fields keeps the keyboard up.
    const onFocusOut = (event: FocusEvent) => keyboard(takesText(event.relatedTarget));

    measure();
    keyboard(takesText(document.activeElement));
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      root.style.removeProperty("--viewport-top");
      root.style.removeProperty("--viewport-height");
      root.removeAttribute("data-keyboard");
    };
  }, []);
}
