import { afterEach, describe, expect, it, vi } from "vitest";

import { categoryExists, gameExists, serverApiBase } from "./catalog-exists";

function answer(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("serverApiBase", () => {
  it("uses an absolute base as it is", () => {
    expect(serverApiBase("https://api.example.com/api/v1", "https://unbored.lol", true)).toBe(
      "https://api.example.com/api/v1",
    );
  });

  it("resolves a relative base against the canonical site, in production only", () => {
    expect(serverApiBase("/api/v1", "https://unbored.lol", true)).toBe(
      "https://unbored.lol/api/v1",
    );
    expect(serverApiBase("/api/v1", "https://unbored.lol", false)).toBeUndefined();
  });
});

const BASE = "https://unbored.test/api/v1";

describe("gameExists", () => {
  it("is false only for a 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(404)));
    expect(await gameExists("nope", BASE)).toBe(false);
  });

  it("fails open on success, a server error or no answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(200)));
    expect(await gameExists("sudoku", BASE)).toBe(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(503)));
    expect(await gameExists("sudoku", BASE)).toBe(true);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    expect(await gameExists("sudoku", BASE)).toBe(true);
  });

  it("asks nothing, and assumes the game exists, with no base to ask", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await gameExists("nope", "")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("escapes the slug", async () => {
    const fetchMock = vi.fn().mockResolvedValue(answer(200));
    vi.stubGlobal("fetch", fetchMock);
    await gameExists("a/b?c", BASE);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/games\/a%2Fb%3Fc$/);
  });
});

describe("categoryExists", () => {
  const list = { items: [{ slug: "puzzle" }, { slug: "logic" }] };

  it("finds a listed category and rejects an unlisted one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => answer(200, list)),
    );
    expect(await categoryExists("puzzle", BASE)).toBe(true);
    expect(await categoryExists("nope", BASE)).toBe(false);
  });

  it("fails open on an error, an empty list or an unexpected shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(500)));
    expect(await categoryExists("nope", BASE)).toBe(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(200, { items: [] })));
    expect(await categoryExists("nope", BASE)).toBe(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(200, { nothing: true })));
    expect(await categoryExists("nope", BASE)).toBe(true);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await categoryExists("nope", BASE)).toBe(true);
  });
});
