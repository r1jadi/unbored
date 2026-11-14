import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearSession, signIn } from "@/lib/auth/session";
import { DeepCutAdmin } from "@/routes/admin.deep-cut";

const ME = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const salak = {
  questionId: 4,
  questionSlug: "fruit",
  category: "Food",
  prompt: "Name a fruit",
  key: "salak",
  sample: "Salak",
  verdict: "pending",
  reviewer: null,
  seen: 3,
  firstSeen: "2026-11-14T09:00:00Z",
  reviewedAt: null,
  answerId: null,
  answerName: null,
  answerTier: null,
};

const answers = [
  { id: 1, canonical: "Apple", tier: 1, source: "curated", spellings: 2, given: 40 },
  { id: 2, canonical: "Snake fruit", tier: 5, source: "curated", spellings: 1, given: 1 },
];

type Call = { url: string; method: string; body: unknown };

function stubBackend() {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/auth/sign-in")) {
        return json({
          session: { userId: ME, role: "admin", email: "admin@example.com" },
          tokens: { accessToken: "access-token-1", refreshToken: "r", expiresIn: 3600 },
        });
      }
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.includes("/admin/deep-cut/reviews")) {
        return json({ items: [salak], hasMore: false });
      }
      if (url.includes("/admin/deep-cut/questions/4/answers")) return json({ items: answers });
      if (url.includes("/admin/deep-cut/questions/4/reviews/salak")) {
        return json({
          questionId: 4,
          key: "salak",
          previousVerdict: "pending",
          verdict: "accepted",
        });
      }
      if (url.includes("/admin/deep-cut/answers/1")) {
        return json({ answerId: 1, previousTier: 1, tier: 2 });
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

describe("the Deep Cut review queue", () => {
  it("lists pending answers and files one under an existing answer", async () => {
    const calls = stubBackend();
    await signIn("admin@example.com", "correct-horse");
    render(<DeepCutAdmin />);

    expect((await screen.findAllByText("Salak")).length).toBeGreaterThan(0);
    expect(calls[0].url).toContain("verdict=pending");
    expect(screen.getAllByText("3 players").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Rule" })[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Does “Salak” count?")).toBeInTheDocument();
    await within(dialog).findByText("Snake fruit");

    fireEvent.change(within(dialog).getByRole("combobox", { name: "Which answer" }), {
      target: { value: "2" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept it" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toContain("/admin/deep-cut/questions/4/reviews/salak");
    expect(put.body).toEqual({ verdict: "accepted", canonical: "Snake fruit", tier: 5 });
  });

  it("re-tiers an answer from the dialog", async () => {
    const calls = stubBackend();
    await signIn("admin@example.com", "correct-horse");
    render(<DeepCutAdmin />);

    fireEvent.click((await screen.findAllByRole("button", { name: "Rule" }))[0]!);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Apple");
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Tier for Apple" }), {
      target: { value: "2" },
    });

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toContain("/admin/deep-cut/answers/1");
    expect(patch.body).toEqual({ tier: 2 });
  });
});
