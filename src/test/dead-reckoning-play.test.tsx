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

import { DeadReckoningRuntime } from "@/components/game/DeadReckoningRuntime";
import { clearSession } from "@/lib/auth/session";
import { createRun, nearest, puzzleOf, roundView } from "@/lib/games/dead-reckoning";
import { ROUNDS } from "@/lib/games/dead-reckoning-bank";
import { RunProgressContext, type RunProgressReporter } from "@/lib/games/run-progress";
import { resetLanguageForTests } from "@/lib/settings/language";

/**
 * Dead Reckoning on screen, driven through the real API client against a stubbed
 * server, inside a play screen that listens for run progress as the real one does.
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

function typeAnswer(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: /Your answer|Your guess/ }), {
    target: { value: text },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearSession();
  resetLanguageForTests();
});

describe("Dead Reckoning on screen", () => {
  it("plays a perfect day, round by round, and submits it", async () => {
    const puzzle = puzzleOf(createRun(DAY));
    const spy = mockServer("dead-reckoning", "dead-reckoning@1", 800);
    await renderGame(DeadReckoningRuntime, "dead-reckoning");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole("button", { name: "Play today's seven" }));
    for (let i = 0; i < ROUNDS; i += 1) {
      await screen.findByText(`Round ${i + 1} of ${ROUNDS}`);
      const view = roundView(puzzle, i);
      if (view.category) {
        const best = nearest(view)[0]!;
        typeAnswer(best.name);
        fireEvent.click(screen.getByRole("option", { name: best.name }));
      } else {
        typeAnswer(view.target.toLocaleString("en-US"));
      }
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
      if (i < ROUNDS - 1) {
        expect(await screen.findByText("Dialed")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Next round" }));
      }
    }
    await waitFor(() => expect(submitted(spy).score).toBe(800));
    expect(submitted(spy).actions).toHaveLength(ROUNDS);
  });

  it("scores nothing for a round the clock runs out on", async () => {
    const spy = mockServer("dead-reckoning", "dead-reckoning@1", 0);
    await renderGame(DeadReckoningRuntime, "dead-reckoning");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole("button", { name: "Play today's seven" }));
    await screen.findByText(`Round 1 of ${ROUNDS}`);
    await act(async () => {
      vi.advanceTimersByTime(30_500);
    });
    expect(await screen.findByText("Time's up")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "End run" }));
    await waitFor(() => expect(submitted(spy)).toMatchObject({ actions: [0], score: 0 }));
  });
});
