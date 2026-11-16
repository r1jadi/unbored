import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCallback, useState, type ComponentType, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HoneycombRuntime } from "@/components/game/HoneycombRuntime";
import { ThenAndNowRuntime } from "@/components/game/ThenAndNowRuntime";
import { clearSession } from "@/lib/auth/session";
import {
  createRun as honeycombRun,
  puzzleOf as honeycombPuzzle,
  usesAllSeven,
  wordPoints,
} from "@/lib/games/honeycomb";
import { RunProgressContext, type RunProgressReporter } from "@/lib/games/run-progress";
import {
  createRun as thenAndNowRun,
  encode,
  puzzleOf as thenAndNowPuzzle,
  startOrder,
} from "@/lib/games/then-and-now";
import { resetLanguageForTests } from "@/lib/settings/language";
import { points } from "@/lib/format";

/**
 * Then & Now and Honeycomb on screen, driven through the real API client against a
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

describe("Then & Now on screen", () => {
  it("swaps events into order, locks them in, and submits the tries", async () => {
    const puzzle = thenAndNowPuzzle(thenAndNowRun(DAY));
    const start = startOrder(DAY);
    const spy = mockServer("then-and-now", "then-and-now@1", 120);
    await renderGame(ThenAndNowRuntime, "then-and-now");
    fireEvent.click(screen.getByRole("button", { name: "Play today's timeline" }));
    await screen.findByText(puzzle.theme);

    // Selection-sort the board with taps: for each place, swap the right event in.
    const order = [...start];
    for (let place = 0; place < 6; place += 1) {
      const from = order.indexOf(place);
      if (from === place) continue;
      fireEvent.click(
        screen.getByRole("button", {
          name: new RegExp(escape(puzzle.events[order[place]!]!.text)),
        }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: new RegExp(escape(puzzle.events[place]!.text)) }),
      );
      [order[place], order[from]] = [order[from]!, order[place]!];
    }
    fireEvent.click(screen.getByRole("button", { name: "Submit order" }));

    await screen.findByText("Perfect timeline!", undefined, { timeout: 15_000 });
    expect(screen.getByText("1200")).toBeInTheDocument();
    expect(submitted(spy)).toMatchObject({ actions: [encode([0, 1, 2, 3, 4, 5])], score: 120 });
  }, 30_000);

  it("locks only the events in place and will not take the same order twice", async () => {
    mockServer("then-and-now", "then-and-now@1", 0);
    const puzzle = thenAndNowPuzzle(thenAndNowRun(DAY));
    const placed = startOrder(DAY).filter((id, p) => id === p).length;
    await renderGame(ThenAndNowRuntime, "then-and-now");
    fireEvent.click(screen.getByRole("button", { name: "Play today's timeline" }));
    await screen.findByText(puzzle.theme);
    fireEvent.click(screen.getByRole("button", { name: "Submit order" }));
    expect(await screen.findByText(`${placed} of 6 in place. Swap the rest.`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit order" }));
    expect(screen.getByText("You've already tried that order.")).toBeInTheDocument();
    expect(screen.getByLabelText("3 tries left")).toBeInTheDocument();
  });
});

describe("Honeycomb on screen", () => {
  it("takes words by tapping and typing, turns down bad ones, and submits the words found", async () => {
    const puzzle = honeycombPuzzle(honeycombRun(DAY));
    const allId = puzzle.words.findIndex((w) => usesAllSeven(puzzle, w));
    const other = puzzle.words.findIndex((w, i) => i !== allId);
    const score =
      wordPoints(puzzle, puzzle.words[allId]!) + wordPoints(puzzle, puzzle.words[other]!);
    const spy = mockServer("honeycomb", "honeycomb@1", score);
    await renderGame(HoneycombRuntime, "honeycomb");
    fireEvent.click(screen.getByRole("button", { name: "Play today's letters" }));
    await screen.findByRole("group", { name: "Letters" });

    // Tapped on the hive.
    for (const ch of puzzle.words[allId]!) {
      fireEvent.click(screen.getByRole("button", { name: ch.toUpperCase() }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    expect(await screen.findByText(/^All seven! \+\d+$/)).toBeInTheDocument();

    // Typed on a keyboard.
    for (const ch of puzzle.words[other]!) fireEvent.keyDown(window, { key: ch });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(
      await screen.findByText(`+${points(wordPoints(puzzle, puzzle.words[other]!))}`),
    ).toBeInTheDocument();

    for (const ch of puzzle.words[other]!) fireEvent.keyDown(window, { key: ch });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(await screen.findByText("Already found.")).toBeInTheDocument();
    for (const ch of puzzle.letters.slice(1, 4)) fireEvent.keyDown(window, { key: ch });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(await screen.findByText("Too short: four letters at least.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /I'm done/ }));
    await waitFor(() => expect(submitted(spy)).toMatchObject({ actions: [allId, other], score }), {
      timeout: 15_000,
    });
  }, 30_000);
});

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
