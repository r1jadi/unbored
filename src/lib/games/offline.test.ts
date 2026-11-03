import { afterEach, describe, expect, it, vi } from "vitest";

import { completeRun, startSession } from "@/lib/games/sessions";
import { offlineResultNote } from "@/lib/games/offline";

/**
 * Offline practice: a run issued on the device when the API cannot be reached.
 *
 * What matters is that it can never pass for a score — it is unranked, never
 * submitted, and marked offline — and that only a transport failure falls back:
 * a refusal from the API is still an error.
 */

function setOnline(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("offline practice", () => {
  it("issues an unranked run on the device when the browser is offline", async () => {
    setOnline(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const session = await startSession("stack-10");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(session).toMatchObject({
      gameSlug: "stack-10",
      rulesVersion: "stack-10@2",
      ranked: false,
      offline: true,
    });
    expect(session.id).toMatch(/^offline-/);
    expect(session.seed).toMatch(/^[1-9]\d*$/);
  });

  it("gives the crossword today's puzzle", async () => {
    setOnline(false);
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 3, 15) });
    try {
      const today = String(Math.floor(Date.UTC(2026, 10, 3) / 86_400_000));
      const session = await startSession("crossword", { rulesVersion: "crossword@1" });
      expect(session.seed).toBe(today);
      // Fjalekryqi, the crossword in Albanian, is the same daily puzzle.
      const albanian = await startSession("crossword", { rulesVersion: "fjalekryqi@1" });
      expect(albanian.seed).toBe(today);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back when the API cannot be reached", async () => {
    setOnline(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);

    const session = await startSession("chain", { rulesVersion: "chain@2" });

    expect(session.offline).toBe(true);
    expect(session.ranked).toBe(false);
  });

  it("does not fall back when the API refuses the run", async () => {
    setOnline(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: "not_found", message: "That game is not playable." } }),
            { status: 404, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    await expect(startSession("draft-game")).rejects.toMatchObject({ status: 404 });
  });

  it("finishes an offline run without sending it, as practice", async () => {
    setOnline(false);
    const session = await startSession("chain", { rulesVersion: "chain@2" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await completeRun(
      session.id,
      {
        rulesVersion: "chain@2",
        actions: [1, 2, 3],
        score: 12,
        tapsPlaced: 3,
        roundsCleared: 2,
      } as Parameters<typeof completeRun>[1],
      5000,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      sessionId: session.id,
      gameSlug: "chain",
      score: 12,
      tilesPlaced: 3,
      clearedColumns: 2,
      durationMs: 5000,
      ranked: false,
      personalBest: null,
      rank: null,
      offline: true,
    });
    expect(offlineResultNote()).toMatch(/not verified or saved/);
  });
});
