import { describe, expect, it } from "vitest";

import { adsAllowedOn } from "@/lib/ads";

describe("adsAllowedOn", () => {
  it("allows content pages", () => {
    for (const path of [
      "/",
      "/explore",
      "/games/sudoku",
      "/categories/word",
      "/about",
      "/privacy",
    ]) {
      expect(adsAllowedOn(path), path).toBe(true);
    }
  });

  it("refuses game, sign-in, account and private screens", () => {
    for (const path of [
      "/play/sudoku",
      "/results/sudoku",
      "/login",
      "/signup",
      "/delete-account",
      "/settings",
      "/messages",
      "/notifications",
      "/admin",
      "/search",
    ]) {
      expect(adsAllowedOn(path), path).toBe(false);
    }
  });

  it("refuses a content URL whose page is missing or broken", () => {
    expect(adsAllowedOn("/games/no-such-game", true)).toBe(false);
  });
});
