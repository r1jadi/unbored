import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GuessworkRuntime } from "@/components/game/GuessworkRuntime";
import { clearSession } from "@/lib/auth/session";
import { GJEJE_ANSWERS, GUESSWORK_ANSWERS } from "@/lib/games/guesswork-bank";
import { answerForDay, encodeGuess, lettersOf } from "@/lib/games/guesswork";
import { resetLanguageForTests } from "@/lib/settings/language";

/**
 * Guesswork on screen, driven through the real API client against a stubbed server.
 * The session's seed is the day; the day's word comes from the bank. In Albanian
 * the same screen asks for `gjeje@1` and plays Albanian words.
 */

const DAY = 20766;
const ENGLISH = answerForDay(DAY, GUESSWORK_ANSWERS);
const ALBANIAN = answerForDay(DAY, GJEJE_ANSWERS);

function sessionPayload(rulesVersion: string) {
  return {
    id: "abababab-3333-4333-8333-abababababab",
    gameSlug: "guesswork",
    rulesVersion,
    seed: String(DAY),
    tileCount: 6,
    startedAt: "2026-11-09T09:00:00.000Z",
    expiresAt: "2026-11-09T11:00:00.000Z",
    ranked: false,
  };
}

function resultPayload() {
  return {
    sessionId: "abababab-3333-4333-8333-abababababab",
    gameSlug: "guesswork",
    // Deliberately not the client's number: the screen must show the verified one.
    score: 40,
    clearedColumns: 1,
    tilesPlaced: 2,
    durationMs: 60_000,
    ranked: false,
    recordedAt: "2026-11-09T09:01:00.000Z",
    personalBest: null,
    rank: null,
    duplicate: false,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function mockPlayback(rulesVersion = "guesswork@1") {
  return mockFetch((url) =>
    url.includes("/complete")
      ? jsonResponse(resultPayload())
      : jsonResponse(sessionPayload(rulesVersion), 201),
  );
}

async function renderRuntime() {
  const root = createRootRoute();
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => <GuessworkRuntime slug="guesswork" title="Guesswork" />,
    }),
    createRoute({ getParentRoute: () => root, path: "/games/$id", component: () => <p>Game</p> }),
    createRoute({
      getParentRoute: () => root,
      path: "/leaderboards/$id",
      component: () => <p>Board</p>,
    }),
    createRoute({ getParentRoute: () => root, path: "/login", component: () => <p>Sign in</p> }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
  });
  return router;
}

function keyboard() {
  return screen.getByRole("group", { name: /Keyboard|Tastier/ });
}

/** Types a word on the on-screen keyboard and presses Enter. */
function play(word: string, enter: RegExp = /^Enter$/) {
  for (const letter of lettersOf(word)) {
    fireEvent.click(
      within(keyboard()).getByRole("button", { name: new RegExp(`^${letter}(,|$)`) }),
    );
  }
  fireEvent.click(within(keyboard()).getByRole("button", { name: enter }));
}

function completionBody(spy: ReturnType<typeof mockFetch>) {
  const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
  return JSON.parse(String(completion?.[1]?.body ?? "{}"));
}

/** A listed word that is not the answer and shares no letter position with it. */
function otherWord(answer: string, pool: readonly string[]): string {
  return pool.find((word) => word !== answer)!;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
  window.localStorage.removeItem("unbored-language");
  resetLanguageForTests();
});

describe("in English", () => {
  it("asks for a session only on Start, under guesswork@1", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    expect(screen.getByRole("heading", { name: "Today's word" })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Play today's word" }));
    await screen.findByRole("group", { name: "Guesses" });
    const session = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(session?.[1]?.body ?? "{}"))).toMatchObject({
      gameSlug: "guesswork",
      rulesVersion: "guesswork@1",
    });
    expect(within(keyboard()).getByRole("button", { name: /^W/ })).toBeInTheDocument();
  });

  it("refuses a word not in the list, without spending a guess", async () => {
    mockPlayback();
    await renderRuntime();
    fireEvent.click(screen.getByRole("button", { name: "Play today's word" }));
    await screen.findByRole("group", { name: "Guesses" });

    play("QQQQQ");
    expect(screen.getByText("QQQQQ isn't in the word list.")).toBeInTheDocument();
    expect(screen.getByText("Guess 1 of 6")).toBeInTheDocument();
  });

  it("marks a guess, solves on the second, and submits both", async () => {
    const spy = mockPlayback();
    await renderRuntime();
    fireEvent.click(screen.getByRole("button", { name: "Play today's word" }));
    await screen.findByRole("group", { name: "Guesses" });

    const first = otherWord(ENGLISH, GUESSWORK_ANSWERS);
    play(first);
    expect(screen.getByLabelText(new RegExp(`^Guess 1: ${first[0]} `))).toBeInTheDocument();
    expect(screen.getByText("Guess 2 of 6")).toBeInTheDocument();

    play(ENGLISH);
    await screen.findByText("Solved in 2 of 6");
    expect(completionBody(spy)).toMatchObject({
      progress: {
        rulesVersion: "guesswork@1",
        actions: [encodeGuess(first), encodeGuess(ENGLISH)],
      },
      score: 50,
    });
    // The verified number, not the client's.
    expect(screen.getByText("400")).toBeInTheDocument();
  });

  it("says so when today's word is already played", async () => {
    mockFetch(() =>
      jsonResponse({ error: { code: "conflict", message: "Already played today." } }, 409),
    );
    await renderRuntime();
    fireEvent.click(screen.getByRole("button", { name: "Play today's word" }));
    await screen.findByText("You've played today's word");
  });
});

describe("in Albanian", () => {
  it("plays Gjeje: gjeje@1, Albanian keys and Albanian words", async () => {
    window.localStorage.setItem("unbored-language", "sq");
    resetLanguageForTests();
    const spy = mockPlayback("gjeje@1");
    await renderRuntime();

    fireEvent.click(screen.getByRole("button", { name: "Luaj fjalën e ditës" }));
    await waitFor(() => expect(keyboard()).toBeInTheDocument());
    const session = spy.mock.calls.find((call) => String(call[0]).endsWith("/api/v1/sessions"));
    expect(JSON.parse(String(session?.[1]?.body ?? "{}"))).toMatchObject({
      rulesVersion: "gjeje@1",
    });
    expect(within(keyboard()).getByRole("button", { name: /^Ç/ })).toBeInTheDocument();
    expect(within(keyboard()).getByRole("button", { name: /^Ë/ })).toBeInTheDocument();
    expect(within(keyboard()).queryByRole("button", { name: /^W/ })).not.toBeInTheDocument();

    play(ALBANIAN, /^Dërgo$/);
    await screen.findByText("U gjet në 1 nga 6");
    expect(completionBody(spy)).toMatchObject({
      progress: { rulesVersion: "gjeje@1", actions: [encodeGuess(ALBANIAN)] },
      score: 60,
    });
  });
});
