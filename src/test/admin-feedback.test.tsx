import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchAdminFeedback } from "@/lib/admin/api";
import { clearSession, signIn } from "@/lib/auth/session";

const ME = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function row(n: number) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    mood: 4,
    category: "idea",
    message: `Idea number ${n}`,
    context: null,
    senderUsername: "nora",
    emailedAt: n % 2 === 0 ? "2026-11-27T10:00:00Z" : null,
    createdAt: "2026-11-27T09:00:00Z",
  };
}

/** Gateway sign-in plus an admin API stub for the staff-only feedback list. */
function stubBackend(list: (url: string) => Response) {
  const calls: Array<{ url: string; auth: string | null }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/auth/sign-in")) {
        return json({
          session: { userId: ME, role: "admin", email: "admin@example.com" },
          tokens: {
            accessToken: "access-token-1",
            refreshToken: "refresh-token-1",
            expiresIn: 3600,
          },
        });
      }
      if (url.includes("/api/v1/admin/feedback")) {
        calls.push({ url, auth: new Headers(init?.headers).get("Authorization") });
        return list(url);
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return calls;
}

beforeEach(() => clearSession());
afterEach(() => {
  vi.unstubAllGlobals();
  clearSession();
});

describe("the admin feedback list", () => {
  it("reads through the staff API with the caller's own token and maps the rows", async () => {
    const calls = stubBackend(() => json({ items: [row(1), row(2)], hasMore: false }));
    await signIn("admin@example.com", "correct-horse");

    const page = await fetchAdminFeedback({ category: "idea", q: "idea", limit: 50, offset: 100 });

    expect(calls).toHaveLength(1);
    expect(calls[0].auth).toBe("Bearer access-token-1");
    expect(calls[0].url).toContain("category=idea");
    expect(calls[0].url).toContain("q=idea");
    expect(calls[0].url).toContain("limit=50");
    expect(calls[0].url).toContain("offset=100");
    expect(page.hasMore).toBe(false);
    expect(page.items[0]).toMatchObject({
      message: "Idea number 1",
      senderUsername: "nora",
      emailedAt: null,
    });
    expect(page.items[1].emailedAt).toBe("2026-11-27T10:00:00Z");
  });

  it("reports a further page when the database returns the extra row", async () => {
    stubBackend(() => json({ items: [row(1), row(2)], hasMore: true }));
    await signIn("admin@example.com", "correct-horse");

    const page = await fetchAdminFeedback({ limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
  });

  it("answers a player's refusal as a forbidden error, not an empty list", async () => {
    stubBackend(() => json({ error: { code: "forbidden", message: "staff only" } }, 403));
    await signIn("admin@example.com", "correct-horse");

    await expect(fetchAdminFeedback()).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("needs a signed-in caller", async () => {
    stubBackend(() => json([]));
    await expect(fetchAdminFeedback()).rejects.toMatchObject({ status: 401 });
  });
});
