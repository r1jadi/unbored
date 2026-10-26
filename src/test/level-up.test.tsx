import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { levelUpTiming, useLevelUp } from "@/lib/games/level-up";
import { MemoryFlashRuntime } from "@/components/game/MemoryFlashRuntime";
import { OneMoveRuntime } from "@/components/game/OneMoveRuntime";
import { clearSession } from "@/lib/auth/session";

/**
 * The beat between two levels.
 *
 * A solved level shows what was solved, what it earned and what comes next, and
 * keeps the next board locked until the beat is over; a bigger board gets a note.
 * The play tests run with the beat off, so these turn it on with short lengths
 * and wait it out with the screen's own announcements.
 */

const BEAT_MS = 120;
const NOTE_MS = 240;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubSession(gameSlug: string, rulesVersion: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/complete")
        ? jsonResponse({})
        : jsonResponse(
            {
              id: "12121212-1111-4111-8111-121212121212",
              gameSlug,
              rulesVersion,
              seed: "1",
              tileCount: 4096,
              startedAt: "2026-10-26T12:00:00.000Z",
              expiresAt: "2026-10-27T00:00:00.000Z",
              ranked: false,
            },
            201,
          ),
    ),
  );
}

async function renderInRouter(node: ReactNode) {
  const root = createRootRoute();
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/", component: () => <>{node}</> }),
    createRoute({ getParentRoute: () => root, path: "/games/$id", component: () => <p>Game</p> }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
  });
}

/** One Move's board cell at an index, addressed by the row and column it names. */
function oneMoveCell(index: number, size: number) {
  const row = Math.floor(index / size) + 1;
  const column = (index % size) + 1;
  return screen.getByRole("button", { name: new RegExp(`^Row ${row} column ${column},`) });
}

/** Waits until the beat has gone. */
async function beatOver() {
  await vi.waitFor(() => expect(screen.queryByRole("status")).toBeNull(), { timeout: 2000 });
}

beforeEach(() => {
  levelUpTiming.ms = BEAT_MS;
  levelUpTiming.noteMs = NOTE_MS;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("a solved level", () => {
  it("says what was solved, what it earned and what is next, then moves on", async () => {
    stubSession("one-move", "one-move@2");
    await renderInRouter(<OneMoveRuntime slug="one-move" title="One Move" />);
    fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
    await screen.findByRole("group", { name: "Board 1, 3 by 3" });

    // Board one wins on cell 7.
    fireEvent.click(oneMoveCell(7, 3));

    const beat = await screen.findByRole("status");
    expect(beat).toHaveTextContent("Board 1 solved");
    expect(beat).toHaveTextContent("+10");
    expect(beat).toHaveTextContent("Next: Board 2 · 3×3");
    // A tap meant for the old board cannot land on the new one.
    expect(oneMoveCell(8, 3)).toBeDisabled();

    await beatOver();
    expect(oneMoveCell(8, 3)).toBeEnabled();
  });

  it("adds a note when the next board is bigger, and holds it a little longer", async () => {
    stubSession("one-move", "one-move@2");
    await renderInRouter(<OneMoveRuntime slug="one-move" title="One Move" />);
    fireEvent.click(await screen.findByRole("button", { name: "Start run" }));
    await screen.findByRole("group", { name: "Board 1, 3 by 3" });

    // Seed 1's first four boards win on 7, 8, 7, 7; board five is 4×4.
    for (const cell of [7, 8, 7]) {
      fireEvent.click(oneMoveCell(cell, 3));
      expect(screen.getByRole("status")).not.toHaveTextContent("from here");
      await beatOver();
    }
    fireEvent.click(oneMoveCell(7, 3));

    const beat = screen.getByRole("status");
    expect(beat).toHaveTextContent("Next: Board 5 · 4×4");
    expect(beat).toHaveTextContent("Boards are 4×4 from here.");
    await new Promise((resolve) => setTimeout(resolve, BEAT_MS + 40));
    // Past the ordinary beat, the note is still up to be read.
    expect(screen.getByRole("status")).toBeInTheDocument();
    await beatOver();
  });

  it("holds Memory Flash's next pattern until the beat is over", async () => {
    stubSession("memory-flash", "memory-flash@2");
    await renderInRouter(<MemoryFlashRuntime slug="memory-flash" title="Memory Flash" />);
    await screen.findByText("Your turn — 1 more cell in this pattern.", undefined, {
      timeout: 4000,
    });

    // Round one lights cell 9 (index 8); rebuilding it solves the round.
    fireEvent.click(screen.getByRole("button", { name: /^Cell 9,/ }));
    await screen.findByRole("status");

    // Nothing of round two's pattern is lit under the beat: its exposure would be
    // spent where the player cannot see it.
    const lit = () =>
      screen
        .getAllByRole("button", { name: /^Cell \d+,/ })
        .filter((cell) => cell.className.includes("bg-foreground"));
    expect(lit()).toHaveLength(0);

    await beatOver();
    // Then the pattern shows, two cells for round two.
    await vi.waitFor(() => expect(lit()).toHaveLength(2), { timeout: 2000 });
  });
});

describe("useLevelUp", () => {
  it("shows nothing for a board that mounts on a later level", () => {
    const hook = renderHook(() => useLevelUp(5, 40, BEAT_MS));
    expect(hook.result.current).toBeNull();
  });

  it("reports the level solved and the points it earned", async () => {
    const hook = renderHook(({ level, score }) => useLevelUp(level, score, BEAT_MS), {
      initialProps: { level: 1, score: 0 },
    });
    hook.rerender({ level: 1, score: 30 });
    hook.rerender({ level: 2, score: 50 });
    expect(hook.result.current).toEqual({ solved: 1, gained: 50 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, BEAT_MS + 40));
    });
    expect(hook.result.current).toBeNull();
  });

  it("is off when its length is zero", () => {
    const hook = renderHook(({ level }) => useLevelUp(level, 0, 0), {
      initialProps: { level: 1 },
    });
    hook.rerender({ level: 2 });
    expect(hook.result.current).toBeNull();
  });
});
