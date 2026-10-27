import { screen } from "@testing-library/react";

/**
 * A button by the accessible name it carries in `aria-label`, matched like
 * `getByRole("button", { name })`.
 *
 * A board test taps dozens of cells, and a role query walks the accessibility
 * tree of every button on the screen each time — slow enough in jsdom to push a
 * full run of a board past the test timeout. Reading `aria-label` directly is a
 * plain selector. A name that does not come from `aria-label` falls back to the
 * role query, so a helper using this never matches less than it did.
 */
export function buttonNamed(name: RegExp | string): HTMLButtonElement {
  const matches = (label: string) => (typeof name === "string" ? label === name : name.test(label));
  for (const button of document.querySelectorAll<HTMLButtonElement>("button[aria-label]")) {
    if (matches(button.getAttribute("aria-label") ?? "")) return button;
  }
  return screen.getByRole("button", { name });
}
