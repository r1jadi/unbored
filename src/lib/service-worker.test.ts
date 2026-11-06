import { describe, expect, it } from "vitest";

import { warmIsDue } from "@/lib/service-worker";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("warmIsDue", () => {
  it("warms a device that has never warmed", () => {
    expect(warmIsDue(Date.now(), "build-a", null)).toBe(true);
  });

  it("leaves the same build alone for a week", () => {
    expect(warmIsDue(2 * DAY, "build-a", "build-a")).toBe(false);
    expect(warmIsDue(6 * DAY, "build-a", "build-a")).toBe(false);
    expect(warmIsDue(7 * DAY, "build-a", "build-a")).toBe(true);
  });

  it("warms after a deploy, because kept pages name the old build's files", () => {
    expect(warmIsDue(2 * DAY, "build-b", "build-a")).toBe(true);
  });

  it("never warms twice in a day, however often the site deploys", () => {
    expect(warmIsDue(23 * HOUR, "build-b", "build-a")).toBe(false);
  });

  it("doesn't treat an unreadable build as a deploy", () => {
    expect(warmIsDue(2 * DAY, null, "build-a")).toBe(false);
  });
});
