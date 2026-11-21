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

import { AlibiRuntime } from "@/components/game/AlibiRuntime";
import { clearSession } from "@/lib/auth/session";
import { RunProgressContext, type RunProgressReporter } from "@/lib/games/run-progress";
import { resetLanguageForTests } from "@/lib/settings/language";

/**
 * Alibi on screen, driven through the real API client against a stubbed server,
 * inside a play screen that listens for run progress as the real one does.
 *
 * Day 20406 plays The Broken Window: Nora Blake (the witness) is lying, and the
 * almanac (file 2 in the bank) proves it.
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

/** A suspect's card, a closed or an open file: buttons named by what they show. */
const button = (name: RegExp) => screen.getByRole("button", { name });

afterEach(() => {
  vi.unstubAllGlobals();
  clearSession();
  resetLanguageForTests();
});

// Each test clicks through a whole case; under a full parallel run that can take
// longer than the default five seconds.
describe("Alibi on screen", { timeout: 20_000 }, () => {
  it("opens the proof, accuses the liar with it, and submits the solve", async () => {
    const spy = mockServer("alibi", "alibi@1", 92);
    await renderGame(AlibiRuntime, "alibi");
    fireEvent.click(screen.getByRole("button", { name: "Open today's case" }));
    expect(await screen.findByText("The Broken Window")).toBeInTheDocument();

    fireEvent.click(button(/Almanac, 12 December/));
    expect(await screen.findByText(/Sunset: 15:50/)).toBeInTheDocument();

    fireEvent.click(button(/Make an accusation/));
    fireEvent.click(button(/Nora Blake/));
    fireEvent.click(button(/Almanac, 12 December/));
    fireEvent.click(button(/^Accuse$/));

    await waitFor(() => expect(submitted(spy)).toMatchObject({ actions: [2, 8], score: 92 }));
    expect(await screen.findByText("Case closed!")).toBeInTheDocument();
    expect(screen.getByText(/the sun set at 15:50/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Try Powehi/ })).toHaveAttribute(
      "href",
      "https://powehi-case.vercel.app",
    );
  });

  it("closes the case after two wrong accusations and shows who it was", async () => {
    const spy = mockServer("alibi", "alibi@1", 0);
    await renderGame(AlibiRuntime, "alibi");
    fireEvent.click(screen.getByRole("button", { name: "Open today's case" }));
    await screen.findByText("The Broken Window");

    fireEvent.click(button(/Leisure centre training register/));
    await screen.findByText(/R\. Cole: present/);

    fireEvent.click(button(/Make an accusation/));
    fireEvent.click(button(/Gavin Marsh/));
    fireEvent.click(button(/Leisure centre training register/));
    fireEvent.click(button(/^Accuse$/));
    expect(
      await screen.findByText("That doesn't hold up. One accusation left."),
    ).toBeInTheDocument();

    fireEvent.click(button(/Make an accusation/));
    fireEvent.click(button(/Ryan Cole/));
    fireEvent.click(button(/Leisure centre training register/));
    fireEvent.click(button(/^Accuse$/));

    await waitFor(() => expect(submitted(spy)).toMatchObject({ actions: [0, 12, 18], score: 0 }));
    expect(await screen.findByText("The liar got away")).toBeInTheDocument();
    expect(screen.getByText(/Nora Blake · Lives above the café opposite/)).toBeInTheDocument();
  });

  it("asks before closing the case unsolved", async () => {
    const spy = mockServer("alibi", "alibi@1", 0);
    await renderGame(AlibiRuntime, "alibi");
    fireEvent.click(screen.getByRole("button", { name: "Open today's case" }));
    await screen.findByText("The Broken Window");
    fireEvent.click(button(/Close the case/));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close the case" }));
    await waitFor(() => expect(submitted(spy)).toMatchObject({ actions: [], score: 0 }));
  });
});
