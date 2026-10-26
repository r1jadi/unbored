import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { OneMoveRuntime } from "@/components/game/OneMoveRuntime";
import { YourStats } from "@/components/game/YourStats";
import { clearSession, signIn } from "@/lib/auth/session";
import { getQueryClient } from "@/lib/query";

/**
 * Saved progress for signed-in players.
 *
 * A signed-in player's live run is saved to their account as they play; opening
 * the game again offers to continue it, or to start over (which ends the saved
 * run and keeps its score). Guests are never offered either. The game page shows
 * the player's own stats.
 *
 * One Move on seed 1: board one wins on cell 7, so a saved run of `[7]` is
 * board two with 10 points.
 */

const testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";
const supabaseBase = "https://project.supabase.co";
const SAVED_SESSION = "78787878-1111-4111-8111-787878787878";
const NEW_SESSION = "78787878-2222-4222-8222-787878787878";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Options = { saved?: number[] | null; stats?: object };

/** The gateway and the Supabase Data API, with the progress functions. */
function stubBackend({ saved = null, stats }: Options = {}) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/v1/auth/sign-in")) {
      return jsonResponse({
        session: { userId: testUserID, role: "user", email: "player@example.com" },
        tokens: {
          accessToken: "access-token-1",
          refreshToken: "refresh-token-1",
          tokenType: "bearer",
          expiresIn: 3600,
        },
        user: { id: testUserID, email: "player@example.com", emailConfirmed: true },
      });
    }
    if (url.startsWith(`${supabaseBase}/rest/v1/rpc/saved_run`)) {
      return jsonResponse(
        saved
          ? [
              {
                session_id: SAVED_SESSION,
                game_slug: "one-move",
                rules_version: "one-move@2",
                seed: "1",
                started_at: "2026-10-26T11:00:00.000Z",
                expires_at: "2026-10-26T23:00:00.000Z",
                actions: saved,
                played_ms: 42_000,
                saved_at: "2026-10-26T11:05:00.000Z",
              },
            ]
          : [],
      );
    }
    if (url.startsWith(`${supabaseBase}/rest/v1/rpc/save_run_progress`)) {
      return jsonResponse("saved");
    }
    if (url.startsWith(`${supabaseBase}/rest/v1/rpc/my_game_stats`)) {
      return jsonResponse(stats ? [stats] : []);
    }
    if (url.includes("/complete")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return jsonResponse({
        sessionId: url.includes(SAVED_SESSION) ? SAVED_SESSION : NEW_SESSION,
        gameSlug: "one-move",
        score: body.score,
        clearedColumns: 1,
        tilesPlaced: body.progress?.actions?.length ?? 0,
        durationMs: body.durationMs,
        ranked: true,
        recordedAt: "2026-10-26T12:00:00.000Z",
        personalBest: body.score,
        rank: 1,
        duplicate: false,
      });
    }
    if (url.endsWith("/api/v1/sessions")) {
      return jsonResponse(
        {
          id: NEW_SESSION,
          gameSlug: "one-move",
          rulesVersion: "one-move@2",
          seed: "1",
          tileCount: 4096,
          startedAt: "2026-10-26T12:00:00.000Z",
          expiresAt: "2026-10-27T00:00:00.000Z",
          ranked: true,
        },
        201,
      );
    }
    return jsonResponse([]);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function calls(spy: ReturnType<typeof stubBackend>, match: string) {
  return spy.mock.calls.filter((call) => String(call[0]).includes(match));
}

async function renderAt(node: ReactNode) {
  const root = createRootRoute();
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/", component: () => <>{node}</> }),
    createRoute({ getParentRoute: () => root, path: "/games/$id", component: () => <p>Game</p> }),
    createRoute({ getParentRoute: () => root, path: "/login", component: () => <p>Log in</p> }),
    createRoute({
      getParentRoute: () => root,
      path: "/leaderboards/$id",
      component: () => <p>Board</p>,
    }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={getQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await act(async () => {
    await router.load();
  });
}

function cell(index: number, size: number) {
  const row = Math.floor(index / size) + 1;
  const column = (index % size) + 1;
  return screen.getByRole("button", { name: new RegExp(`^Row ${row} column ${column},`) });
}

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("an unfinished run", () => {
  it("is offered to continue, and continues on the same board with the same score", async () => {
    const spy = stubBackend({ saved: [7] });
    await signIn("player@example.com", "correct-horse");
    await renderAt(<OneMoveRuntime slug="one-move" title="One Move" autoStart />);

    expect(
      await screen.findByRole("heading", { name: "Pick up where you left off?" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Board 2")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    // Nothing was replaced behind the player's back.
    expect(calls(spy, "/api/v1/sessions")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /Continue run/ }));

    expect(await screen.findByRole("group", { name: "Board 2, 3 by 3" })).toBeInTheDocument();
    expect(screen.getByText("Score").closest("dl")?.querySelector("dd")?.textContent).toBe("10");
    expect(calls(spy, "/api/v1/sessions")).toHaveLength(0);
  });

  it("is submitted as it was left when the player starts a new run, keeping its score", async () => {
    const spy = stubBackend({ saved: [7] });
    await signIn("player@example.com", "correct-horse");
    await renderAt(<OneMoveRuntime slug="one-move" title="One Move" autoStart />);

    await screen.findByRole("heading", { name: "Pick up where you left off?" });
    expect(screen.getByText(/ends this one and keeps its score of 10/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /New run/ }));

    await screen.findByRole("group", { name: "Board 1, 3 by 3" });
    const completion = calls(spy, `/sessions/${SAVED_SESSION}/complete`)[0];
    const body = JSON.parse(String(completion?.[1]?.body ?? "{}"));
    expect(body.progress.actions).toEqual([7]);
    expect(body.score).toBe(10);
    expect(body.durationMs).toBe(42_000);
    // The saved run is submitted before the new session closes it.
    const order = spy.mock.calls.map((call) => String(call[0]));
    expect(order.findIndex((u) => u.includes("/complete"))).toBeLessThan(
      order.findIndex((u) => u.endsWith("/api/v1/sessions")),
    );
  });

  it("is saved to the account while a signed-in player plays", async () => {
    const spy = stubBackend();
    await signIn("player@example.com", "correct-horse");
    await renderAt(<OneMoveRuntime slug="one-move" title="One Move" autoStart />);
    await screen.findByRole("group", { name: "Board 1, 3 by 3" });

    fireEvent.click(cell(7, 3));

    await waitFor(() => expect(calls(spy, "rpc/save_run_progress")).toHaveLength(1), {
      timeout: 4000,
    });
    const save = JSON.parse(String(calls(spy, "rpc/save_run_progress")[0][1]?.body ?? "{}"));
    expect(save).toMatchObject({ p_session_id: NEW_SESSION, p_actions: [7] });
    expect(save.p_played_ms).toBeGreaterThanOrEqual(0);
  });

  it("is never looked for, or saved, for a guest", async () => {
    const spy = stubBackend({ saved: [7] });
    await renderAt(<OneMoveRuntime slug="one-move" title="One Move" autoStart />);
    await screen.findByRole("group", { name: "Board 1, 3 by 3" });

    fireEvent.click(cell(7, 3));
    await new Promise((resolve) => setTimeout(resolve, 1800));

    expect(calls(spy, "rpc/saved_run")).toHaveLength(0);
    expect(calls(spy, "rpc/save_run_progress")).toHaveLength(0);
  });
});

describe("your stats", () => {
  it("shows a signed-in player's runs, best, rank and total for the game", async () => {
    stubBackend({
      stats: {
        runs: 12,
        best_score: 340,
        total_score: 2150,
        rank: 4,
        last_played_at: "2026-10-25T18:00:00.000Z",
      },
    });
    await signIn("player@example.com", "correct-horse");
    await renderAt(<YourStats slug="one-move" />);

    const stats = await screen.findByRole("region", { name: "Your stats" });
    expect(stats).toHaveTextContent("340");
    expect(stats).toHaveTextContent("#4");
    expect(stats).toHaveTextContent("12");
    expect(stats).toHaveTextContent("2,150");
    expect(stats).toHaveTextContent(/Last played/);
  });

  it("tells a guest what signing in keeps", async () => {
    stubBackend();
    await renderAt(<YourStats slug="one-move" />);

    expect(
      screen.getByText(/to keep your scores, your stats and any run you leave unfinished/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?redirect=%2Fgames%2Fone-move",
    );
  });
});
