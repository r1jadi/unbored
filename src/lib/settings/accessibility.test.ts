import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACCESSIBILITY_BOOT_SCRIPT,
  motionIsReduced,
  restoreAccessibility,
  useAccessibility,
} from "./accessibility";

/**
 * A saved preference has to hold from the first paint on any route, not only once
 * the settings screen has been opened. Two pieces of code do that, the boot script
 * and `restoreAccessibility`, so each case here is run through both.
 */

const KEY = "unbored-accessibility";
const LEGACY_KEY = "onemore-accessibility";

type Classes = { motion: boolean; text: boolean; contrast: boolean };

function classes(): Classes {
  const list = document.documentElement.classList;
  return {
    motion: list.contains("a11y-reduce-motion"),
    text: list.contains("a11y-larger-text"),
    contrast: list.contains("a11y-contrast"),
  };
}

function stubOsReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matches && query.includes("prefers-reduced-motion"),
  }));
}

function clearClasses() {
  document.documentElement.className = "dark";
}

const runBootScript = () => new Function(ACCESSIBILITY_BOOT_SCRIPT)();
const OFF = { motion: false, text: false, contrast: false };

const CASES: {
  name: string;
  os: boolean;
  saved?: [string, string];
  expected: Classes;
}[] = [
  {
    name: "every saved preference",
    os: false,
    saved: [KEY, JSON.stringify({ reduceMotion: true, largerText: true, increaseContrast: true })],
    expected: { motion: true, text: true, contrast: true },
  },
  {
    name: "one saved preference",
    os: false,
    saved: [KEY, JSON.stringify({ largerText: true })],
    expected: { ...OFF, text: true },
  },
  {
    name: "a saved choice to keep motion, over the OS",
    os: true,
    saved: [KEY, JSON.stringify({ reduceMotion: false })],
    expected: OFF,
  },
  {
    name: "a choice saved before the rename",
    os: false,
    saved: [LEGACY_KEY, JSON.stringify({ increaseContrast: true })],
    expected: { ...OFF, contrast: true },
  },
  { name: "the OS setting, with no choice saved", os: true, expected: { ...OFF, motion: true } },
  { name: "nothing saved and nothing asked for", os: false, expected: OFF },
  { name: "a value that isn't JSON", os: false, saved: [KEY, "{nope"], expected: OFF },
  { name: "a value that isn't an object", os: false, saved: [KEY, "null"], expected: OFF },
];

beforeEach(() => {
  localStorage.clear();
  clearClasses();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearClasses();
});

describe("useAccessibility", () => {
  it("shows the saved preferences without disturbing what is applied", () => {
    stubOsReducedMotion(false);
    localStorage.setItem(KEY, JSON.stringify({ reduceMotion: true, largerText: true }));
    restoreAccessibility();

    const { result } = renderHook(() => useAccessibility());

    expect(result.current.prefs).toEqual({
      reduceMotion: true,
      largerText: true,
      increaseContrast: false,
    });
    expect(classes()).toEqual({ motion: true, text: true, contrast: false });
  });

  it("shows the OS setting until the player chooses", () => {
    stubOsReducedMotion(true);
    const { result } = renderHook(() => useAccessibility());
    expect(result.current.prefs.reduceMotion).toBe(true);
  });

  it("applies and saves a change at once", () => {
    stubOsReducedMotion(false);
    const { result } = renderHook(() => useAccessibility());
    act(() =>
      result.current.setPrefs({ reduceMotion: false, largerText: true, increaseContrast: false }),
    );
    expect(classes()).toEqual({ ...OFF, text: true });
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({ largerText: true });
  });
});

describe("restoring accessibility preferences", () => {
  for (const { name, os, saved, expected } of CASES) {
    it(`applies ${name}, the same from the boot script and the app`, () => {
      stubOsReducedMotion(os);
      if (saved) localStorage.setItem(saved[0], saved[1]);

      runBootScript();
      expect(classes()).toEqual(expected);

      clearClasses();
      restoreAccessibility();
      expect(classes()).toEqual(expected);
    });
  }

  it("leaves the theme class alone", () => {
    stubOsReducedMotion(true);
    runBootScript();
    restoreAccessibility();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("clears a preference that has been turned off", () => {
    stubOsReducedMotion(false);
    document.documentElement.classList.add("a11y-larger-text");
    localStorage.setItem(KEY, JSON.stringify({ largerText: false }));
    runBootScript();
    expect(classes().text).toBe(false);
  });

  it("never lets the boot script throw into the page", () => {
    vi.stubGlobal("matchMedia", () => {
      throw new Error("not available");
    });
    expect(runBootScript).not.toThrow();
    expect(classes()).toEqual(OFF);
  });

  it("falls back to the defaults where matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    restoreAccessibility();
    expect(classes()).toEqual(OFF);
    expect(motionIsReduced()).toBe(false);
  });
});
