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

import { BallparkRuntime } from "@/components/game/BallparkRuntime";
import { OnlyOnceRuntime } from "@/components/game/OnlyOnceRuntime";
import { TeeTimeRuntime } from "@/components/game/TeeTimeRuntime";
import { TonUpRuntime } from "@/components/game/TonUpRuntime";
import { clearSession } from "@/lib/auth/session";
import { createRun as ballparkRun, productOf } from "@/lib/games/ballpark";
import { createRun as onlyOnceRun, kindOf, puzzleOf } from "@/lib/games/only-once";
import { RunProgressContext, type RunProgressReporter } from "@/lib/games/run-progress";
import { categoryOf, createRun as tonUpRun } from "@/lib/games/ton-up";
import { resetLanguageForTests } from "@/lib/settings/language";

/**
 * The four daily games on screen, driven through the real API client against a
 * stubbed server, inside a play screen that listens for run progress the way the
 * real one does (a reporter that sets state, so an unstable end-run callback would
 * loop forever). Each run is played to its end and the submission checked.
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

describe("Ton Up on screen", () => {
  it("throws three darts to a ton and submits them", async () => {
    const category = categoryOf(tonUpRun(DAY));
    const values = category.answers.map((a) => a.value);
    let darts: number[] = [];
    for (let a = 0; a < values.length && !darts.length; a += 1) {
      for (let b = a + 1; b < values.length && !darts.length; b += 1) {
        const c = values.findIndex((v, i) => i > b && values[a]! + values[b]! + v === 100);
        if (c > 0) darts = [a, b, c];
      }
    }
    const spy = mockServer("ton-up", "ton-up@1", 125);
    await renderGame(TonUpRuntime, "ton-up");
    fireEvent.click(screen.getByRole("button", { name: "Play today's category" }));
    await screen.findByText(category.title);
    for (const index of darts) {
      typeAnswer(category.answers[index]!.name);
      fireEvent.click(screen.getByRole("button", { name: "Throw" }));
    }
    expect(await screen.findByText("1250")).toBeInTheDocument();
    expect(submitted(spy)).toMatchObject({ actions: darts, score: 125 });
  });
});

describe("Ballpark on screen", () => {
  it("closes in on the price and submits the guesses", async () => {
    const price = productOf(ballparkRun(DAY)).cents;
    const spy = mockServer("ballpark", "ballpark@1", 50);
    await renderGame(BallparkRuntime, "ballpark");
    fireEvent.click(screen.getByRole("button", { name: "Play today's product" }));
    await screen.findByText(productOf(ballparkRun(DAY)).name);
    typeAnswer(String((price * 3) / 100));
    fireEvent.click(screen.getByRole("button", { name: "Guess" }));
    expect(await screen.findByText("5 left.")).toBeInTheDocument();
    typeAnswer((price / 100).toFixed(2));
    fireEvent.click(screen.getByRole("button", { name: "Guess" }));
    expect(await screen.findByText("500")).toBeInTheDocument();
    expect(submitted(spy)).toMatchObject({ actions: [price * 3, price], score: 50 });
  });
});

describe("Only Once on screen", () => {
  it("takes an answer, turns down a reuse, and ends when the clock runs out", async () => {
    const run = onlyOnceRun(DAY);
    const kind = kindOf(run);
    const [first, second] = puzzleOf(run).questions;
    const id = first!.answers.find((a) => second!.answers.includes(a)) ?? first!.answers[0]!;
    const spy = mockServer("only-once", "only-once@1", 10);
    await renderGame(OnlyOnceRuntime, "only-once");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole("button", { name: "Play today's seven" }));
    await screen.findByText(first!.text);
    typeAnswer(kind.entities[id]!.name);
    fireEvent.click(screen.getByRole("option", { name: kind.entities[id]!.name }));
    await screen.findByText(second!.text);
    typeAnswer(kind.entities[id]!.name);
    fireEvent.click(screen.getByRole("option", { name: kind.entities[id]!.name }));
    expect(screen.getByText(`You've already used ${kind.entities[id]!.name}.`)).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(28_000);
    });
    await waitFor(() => expect(submitted(spy)).toMatchObject({ actions: [id], score: 10 }));
  });
});

describe("Tee Time on screen", () => {
  it("hits a shot with the meter and submits the round when it is ended", async () => {
    const spy = mockServer("tee-time", "tee-time@1", 0);
    await renderGame(TeeTimeRuntime, "tee-time");
    fireEvent.click(screen.getByRole("button", { name: "Tee off" }));
    await screen.findByRole("button", { name: "Swing" });
    fireEvent.click(screen.getByRole("button", { name: "Swing" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop!" }));
    await waitFor(() => expect(screen.getByText(/stroke 2|Next hole/)).toBeInTheDocument(), {
      timeout: 3000,
    });
    fireEvent.click(screen.getByRole("button", { name: "End round" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "End round" }));
    await waitFor(() => expect(submitted(spy).actions).toHaveLength(1));
  });
});
