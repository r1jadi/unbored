import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";

import { describeNotification } from "@/lib/notifications/store";
import { authErrorMessage } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("notification copy never invents actors", () => {
  it("describes each kind without a fixture name", () => {
    const now = new Date().toISOString();
    expect(
      describeNotification({ id: "1", kind: "follow", payload: {}, readAt: null, createdAt: now }),
    ).toBe("started following you");
    expect(
      describeNotification({
        id: "2",
        kind: "follow",
        payload: { username: "nora.k", text: "started following you" },
        readAt: null,
        createdAt: now,
      }),
    ).toBe("started following you");
  });
});

describe("login errors stay specific", () => {
  it("keeps the server message for HTTP responses", () => {
    const err = new ApiError("Confirm your email address, then sign in.", {
      code: "forbidden",
      status: 403,
    });
    expect(authErrorMessage(err)).toBe("Confirm your email address, then sign in.");
  });

  it("keeps the network message only for transport failures", () => {
    const err = new ApiError("Could not reach the server.", { code: "network_error" });
    expect(authErrorMessage(err)).toBe("Could not reach the server.");
  });
});

describe("no production mock imports remain", () => {
  const roots = ["src/routes", "src/components", "src/lib"];

  function files(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) out.push(...files(full));
      else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
    }
    return out;
  }

  it("no production module imports @/lib/mock", () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of files(root)) {
        if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
        const source = readFileSync(file, "utf8");
        if (source.includes("@/lib/mock") || source.includes("lib/admin-mock")) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no hardcoded unread badge or fixture identity remains in AppShell", () => {
    const source = readFileSync("src/components/layout/AppShell.tsx", "utf8");
    expect(source).not.toContain("@/lib/mock");
    expect(source).not.toContain("filter((n) => n.unread)");
  });

  it("verify-email no longer asks for a six-digit code", () => {
    const source = readFileSync("src/routes/verify-email.tsx", "utf8");
    expect(source).not.toContain("6-digit");
    expect(source).not.toContain("InputOTP");
    expect(source.toLowerCase()).toContain("link");
  });

  it("settings account no longer hardcodes the previous identity", () => {
    const source = readFileSync("src/routes/settings.$section.tsx", "utf8");
    expect(source).not.toContain("r•••@mail.com");
    expect(source).not.toContain("rijad");
    expect(source).not.toContain("Rijad Halili");
  });
});
