import { beforeEach, describe, expect, it } from "vitest";

import { shouldWelcome, welcomeKey } from "@/lib/users/welcome";
import type { Profile } from "@/lib/users/profile";

const NOW = Date.parse("2026-10-28T12:00:00Z");

function profile(createdAt: string): Profile {
  return {
    id: "user-1",
    username: "player",
    displayName: "Player",
    role: "user",
    createdAt,
    updatedAt: createdAt,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("shouldWelcome", () => {
  it("welcomes an account created moments ago", () => {
    expect(shouldWelcome(profile("2026-10-28T11:58:00Z"), window.localStorage, NOW)).toBe(true);
  });

  it("does not welcome an account that is days old", () => {
    expect(shouldWelcome(profile("2026-10-20T12:00:00Z"), window.localStorage, NOW)).toBe(false);
  });

  it("plays once per account", () => {
    window.localStorage.setItem(welcomeKey("user-1"), "seen");
    expect(shouldWelcome(profile("2026-10-28T11:58:00Z"), window.localStorage, NOW)).toBe(false);
  });

  it("stays quiet when the seen marker cannot be stored", () => {
    expect(shouldWelcome(profile("2026-10-28T11:58:00Z"), undefined, NOW)).toBe(false);
  });
});
