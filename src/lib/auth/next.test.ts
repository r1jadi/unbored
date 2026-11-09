import { describe, expect, it } from "vitest";

import { isSafeNext, sanitizeNext } from "./next";

describe("sanitizeNext", () => {
  it("keeps a path inside the app, with its query and fragment", () => {
    expect(sanitizeNext("/profile")).toBe("/profile");
    expect(sanitizeNext("/games/sudoku?tab=board#top")).toBe("/games/sudoku?tab=board#top");
    expect(sanitizeNext("/messages/some.user-1")).toBe("/messages/some.user-1");
  });

  it("sends anything that is not a path home", () => {
    for (const value of [
      undefined,
      null,
      "",
      42,
      "profile",
      "https://evil.example",
      "javascript:alert(1)",
    ]) {
      expect(sanitizeNext(value)).toBe("/");
    }
  });

  it("refuses the ways a path can name another site", () => {
    for (const value of [
      "//evil.example",
      "/\\evil.example",
      "/\\/evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r/evil.example",
      "/profile\\..\\evil",
    ]) {
      expect(isSafeNext(value)).toBe(false);
    }
  });

  it("refuses an absurdly long destination", () => {
    expect(isSafeNext(`/${"a".repeat(3000)}`)).toBe(false);
  });
});
