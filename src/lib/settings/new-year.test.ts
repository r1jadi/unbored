import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NEW_YEAR_BOOT_SCRIPT, restoreNewYearTheme, useNewYearTheme } from "./new-year";

const KEY = "unbored-new-year-theme";
const on = () => document.documentElement.classList.contains("theme-new-year");
const runBootScript = () => new Function(NEW_YEAR_BOOT_SCRIPT)();

afterEach(() => {
  localStorage.clear();
  document.documentElement.className = "dark";
});

describe("New Year's theme", () => {
  for (const [name, apply] of [
    ["boot script", runBootScript],
    ["restoreNewYearTheme", restoreNewYearTheme],
  ] as const) {
    it(`${name}: off by default`, () => {
      apply();
      expect(on()).toBe(false);
    });

    it(`${name}: on when saved`, () => {
      localStorage.setItem(KEY, "on");
      apply();
      expect(on()).toBe(true);
    });
  }

  it("the switch applies and persists, and turning it off clears both", () => {
    const { result } = renderHook(() => useNewYearTheme());
    expect(result.current[0]).toBe(false);

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(on()).toBe(true);
    expect(localStorage.getItem(KEY)).toBe("on");

    act(() => result.current[1](false));
    expect(on()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
