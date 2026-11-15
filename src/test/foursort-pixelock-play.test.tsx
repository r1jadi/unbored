import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCallback, useState, type ComponentType, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FoursortRuntime } from "@/components/game/FoursortRuntime";
import { PixelockRuntime } from "@/components/game/PixelockRuntime";
import { clearSession } from "@/lib/auth/session";
import { createRun as foursortRun, groupMask, maskOf, puzzleOf } from "@/lib/games/foursort";
import {
  CELLS,
  code,
  createRun as pixelockRun,
  FILL,
  inkCount,
  inked,
  pictureOf,
} from "@/lib/games/pixelock";
import { RunProgressContext, type RunProgressReporter } from "@/lib/games/run-progress";
import { resetLanguageForTests } from "@/lib/settings/language";

/**
 * Foursort and Pixelock on screen, driven through the real API client against a
 * stubbed server, inside a play screen that listens for run progress the way the
 * real one does. Each run is played to its end and the submission checked.
 */

const DAY = 20406;
const SESSION_ID = "cdcdcdcd-4444-4444-8444-cdcdcdcdcdcd";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A stubbed server for one game: today's session, then the verified run. */
function mockServer(slug: string, rulesVersion: string, verified: number) {
  // `init` is declared so the recorded calls carry the request body.
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    const url = String(input);
    if (url.includes("/complete")) {
      return jsonResponse({
        sessionId: SESSION_ID,
        gameSlug: slug,
        score: verified,
        clearedColumns: 0,
        tilesPlaced: 0,
        durationMs: 30_000,
        ranked: false,
        recordedAt: "2026-11-14T09:01:00.000Z",
        personalBest: null,
        rank: null,
        duplicate: false,
      });
    }
    return jsonResponse(
      {
        id: SESSION_ID,
        gameSlug: slug,
        rulesVersion,
        seed: String(DAY),
        tileCount: 9,
        startedAt: "2026-11-14T09:00:00.000Z",
        expiresAt: "2026-11-14T11:00:00.000Z",
        ranked: false,
      },
      201,
    );
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** The submission the runtime sent, as the server received it. */
function submitted(spy: ReturnType<typeof mockServer>) {
  const call = spy.mock.calls.find(([input]) => String(input).includes("/complete"));
  const init = call?.[1] as RequestInit | undefined;
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    score?: number;
    progress?: { actions: number[] };
  };
  return { actions: body.progress?.actions ?? [], score: body.score };
}

/** A play screen's progress listener: it keeps the report in state, as the real one does. */
function ProgressHost({ children }: { children: ReactNode }) {
  const [, setReport] = useState<unknown>(null);
  const reporter = useCallback<RunProgressReporter>(
    (active, endRun) => setReport({ active, endRun }),
    [],
  );
  return <RunProgressContext.Provider value={reporter}>{children}</RunProgressContext.Provider>;
}

async function renderGame(Runtime: ComponentType<{ slug: string; title: string }>, slug: string) {
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/",
        component: () => (
          <ProgressHost>
            <Runtime slug={slug} title={slug} />
          </ProgressHost>
        ),
      }),
      createRoute({ getParentRoute: () => root, path: "/games/$id", component: () => <p>Game</p> }),
      createRoute({
        getParentRoute: () => root,
        path: "/leaderboards/$id",
        component: () => <p>Board</p>,
      }),
      createRoute({ getParentRoute: () => root, path: "/login", component: () => <p>Sign in</p> }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearSession();
  resetLanguageForTests();
});

describe("Foursort on screen", () => {
  it("says one away, then sorts all four groups and submits the guesses", async () => {
    const puzzle = puzzleOf(foursortRun(DAY));
    const word = (id: number) => puzzle.groups[Math.floor(id / 4)]!.words[id % 4]!;
    const pick = (ids: number[]) => {
      for (const id of ids) fireEvent.click(screen.getByRole("button", { name: word(id) }));
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    };
    const spy = mockServer("foursort", "foursort@1", 90);
    await renderGame(FoursortRuntime, "foursort");
    fireEvent.click(screen.getByRole("button", { name: "Play today's words" }));
    await screen.findByText("Make four groups of four.");

    pick([0, 1, 2, 4]);
    expect(await screen.findByText("One away…")).toBeInTheDocument();
    // Still picked after a miss: deselect, then sort every group.
    fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
    for (const g of [0, 1, 2, 3]) pick([4 * g, 4 * g + 1, 4 * g + 2, 4 * g + 3]);

    // The board's own counter shows the score too, until the result replaces it.
    await screen.findByText("Sorted with 1 mistake", undefined, { timeout: 15_000 });
    expect(screen.getByText("900")).toBeInTheDocument();
    expect(submitted(spy)).toMatchObject({
      actions: [maskOf([0, 1, 2, 4]), groupMask(0), groupMask(1), groupMask(2), groupMask(3)],
      score: 90,
    });
  }, 30_000);

  it("will not take the same four twice", async () => {
    mockServer("foursort", "foursort@1", 0);
    const puzzle = puzzleOf(foursortRun(DAY));
    const word = (id: number) => puzzle.groups[Math.floor(id / 4)]!.words[id % 4]!;
    await renderGame(FoursortRuntime, "foursort");
    fireEvent.click(screen.getByRole("button", { name: "Play today's words" }));
    await screen.findByText("Make four groups of four.");
    for (const id of [0, 4, 8, 12]) fireEvent.click(screen.getByRole("button", { name: word(id) }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Not a group.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByText("You've already tried those four.")).toBeInTheDocument();
    expect(screen.getByLabelText("3 mistakes left")).toBeInTheDocument();
  });
});

describe("Pixelock on screen", () => {
  it("costs a life for a wrong cell, then draws the picture and submits the moves", async () => {
    const picture = pictureOf(pixelockRun(DAY));
    const ink = Array.from({ length: CELLS }, (_, i) => i).filter((i) => inked(picture, i));
    const blank = Array.from({ length: CELLS }, (_, i) => i).find((i) => !inked(picture, i))!;
    const score = inkCount(picture) + 50 + 50;
    const spy = mockServer("pixelock", "pixelock@1", score);
    await renderGame(PixelockRuntime, "pixelock");
    fireEvent.click(screen.getByRole("button", { name: "Play today's picture" }));
    const cell = (i: number) =>
      screen.getByRole("button", { name: `Row ${Math.floor(i / 10) + 1}, column ${(i % 10) + 1}` });
    await waitFor(() => expect(cell(0)).toBeInTheDocument());

    fireEvent.pointerDown(cell(blank));
    fireEvent.pointerUp(cell(blank));
    expect(await screen.findByText("That cell is blank — a life lost.")).toBeInTheDocument();
    expect(screen.getByLabelText("2 lives left")).toBeInTheDocument();

    for (const i of ink) {
      fireEvent.pointerDown(cell(i));
      fireEvent.pointerUp(cell(i));
    }
    await screen.findByText(/You drew the/, undefined, { timeout: 15_000 });
    expect(screen.getByText(String(score * 10))).toBeInTheDocument();
    expect(submitted(spy)).toMatchObject({
      actions: [code(blank, FILL), ...ink.map((i) => code(i, FILL))],
      score,
    });
  }, 60_000);

  it("crosses out with the cross tool and saves a run that is stopped", async () => {
    const picture = pictureOf(pixelockRun(DAY));
    const blank = Array.from({ length: CELLS }, (_, i) => i).find((i) => !inked(picture, i))!;
    const spy = mockServer("pixelock", "pixelock@1", 0);
    await renderGame(PixelockRuntime, "pixelock");
    fireEvent.click(screen.getByRole("button", { name: "Play today's picture" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Cross out" }));
    const target = screen.getByRole("button", {
      name: `Row ${Math.floor(blank / 10) + 1}, column ${(blank % 10) + 1}`,
    });
    fireEvent.pointerDown(target);
    fireEvent.pointerUp(target);
    fireEvent.click(await screen.findByRole("button", { name: /Stop here/ }));
    await waitFor(() =>
      expect(submitted(spy)).toMatchObject({ actions: [blank * 2 + 1], score: 0 }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    void within;
  });
});
