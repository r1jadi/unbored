import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeepCutRuntime } from "@/components/game/DeepCutRuntime";
import { clearSession } from "@/lib/auth/session";
import { resetLanguageForTests } from "@/lib/settings/language";

/**
 * Deep Cut on screen, driven through the real API client against a stubbed server:
 * questions arrive one at a time, every verdict is the server's, and the daily run
 * is completed with the matched answers' ids.
 */

const SESSION = "abababab-4444-4444-8444-abababababab";
const PRACTICE = "cdcdcdcd-5555-4555-8555-cdcdcdcdcdcd";

const PROMPTS = ["Name a US state", "Name a cheese", "Name a fruit"];

function question(runId: string, position: number, mode = "daily") {
  return {
    outcome: "shown",
    runId,
    mode,
    day: mode === "daily" ? 20771 : null,
    position,
    total: 7,
    category: "Geography",
    prompt: PROMPTS[position % PROMPTS.length],
    seconds: 25,
    remainingMs: 25_000,
    settled: null,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Handler = (url: string, init?: RequestInit) => Response;

function mockFetch(handler: Handler) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function dailyServer(): Handler {
  return (url, init) => {
    if (url.endsWith("/sessions")) {
      return jsonResponse(
        {
          id: SESSION,
          gameSlug: "deep-cut",
          rulesVersion: "deep-cut@1",
          seed: "20771",
          tileCount: 7,
          startedAt: "2026-11-14T09:00:00.000Z",
          expiresAt: "2026-11-14T11:00:00.000Z",
          ranked: false,
        },
        201,
      );
    }
    if (/questions\/\d\/check$/.test(url)) {
      const typed = JSON.parse(String(init?.body ?? "{}")).answer as string;
      if (typed === "Delawhere") {
        return jsonResponse({ outcome: "checked", result: "invalid", suggestions: ["Delware"] });
      }
      return jsonResponse({
        outcome: "checked",
        result: typed === "Carrot" ? "invalid" : "valid",
        suggestions: typed === "Carrot" ? [] : undefined,
      });
    }
    const answer = /questions\/(\d)\/answer$/.exec(url);
    if (answer) {
      const typed = JSON.parse(String(init?.body ?? "{}")).answer as string;
      const position = Number(answer[1]);
      return jsonResponse({
        outcome: "scored",
        turn:
          typed === "Delware"
            ? {
                position,
                verdict: "correct",
                answer: typed,
                canonical: "Delaware",
                answerId: 412,
                tier: 5,
                points: 80,
                sharePercent: 2,
                commonAnswer: "California",
                deepestAnswers: null,
              }
            : {
                position,
                verdict: "wrong",
                answer: typed,
                canonical: null,
                answerId: 0,
                tier: null,
                points: 0,
                sharePercent: null,
                commonAnswer: "Cheddar",
                deepestAnswers: null,
              },
      });
    }
    const reveal = /questions\/(\d)$/.exec(url);
    if (reveal) return jsonResponse(question(SESSION, Number(reveal[1])));
    if (url.includes("/complete")) {
      return jsonResponse({
        sessionId: SESSION,
        gameSlug: "deep-cut",
        score: 8,
        clearedColumns: 1,
        tilesPlaced: 2,
        durationMs: 30_000,
        ranked: false,
        recordedAt: "2026-11-14T09:01:00.000Z",
        personalBest: null,
        rank: null,
        duplicate: false,
      });
    }
    return jsonResponse({ code: "not_found", message: "Not found" }, 404);
  };
}

async function renderRuntime() {
  const root = createRootRoute();
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => <DeepCutRuntime slug="deep-cut" title="Deep Cut" />,
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

function answer(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  clearSession();
  resetLanguageForTests();
});

describe("the daily dive", () => {
  it("deals questions one at a time, shows the server's verdict, and submits the answer ids", async () => {
    const spy = mockFetch(dailyServer());
    await renderRuntime();

    // Nothing is asked of the server until Start.
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dive into today's seven" }));

    expect(await screen.findByRole("heading", { name: "Name a US state" })).toBeInTheDocument();
    const startBody = JSON.parse(String(spy.mock.calls[0]?.[1]?.body));
    expect(startBody.rulesVersion).toBe("deep-cut@1");

    answer("Delware");
    expect(await screen.findByText("+80")).toBeInTheDocument();
    expect(screen.getByText("Counted as Delaware.")).toBeInTheDocument();
    expect(screen.getByText("Most people say California.")).toBeInTheDocument();
    expect(screen.getByText("2% of divers gave this answer.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Next question/ }));
    expect(await screen.findByRole("heading", { name: "Name a cheese" })).toBeInTheDocument();

    // Surface early: the open question is sent as a 0.
    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    fireEvent.click(await screen.findByRole("button", { name: "End run" }));

    await waitFor(() =>
      expect(spy.mock.calls.some((call) => String(call[0]).includes("/complete"))).toBe(true),
    );
    const completion = spy.mock.calls.find((call) => String(call[0]).includes("/complete"));
    const body = JSON.parse(String(completion?.[1]?.body));
    expect(body.progress).toEqual({ rulesVersion: "deep-cut@1", actions: [412, 0] });
    expect(body.score).toBe(8);

    expect(await screen.findByText("Snorkeler")).toBeInTheDocument();
  });

  it("turns down an invalid answer before it is submitted, so it can be changed", async () => {
    const spy = mockFetch(dailyServer());
    await renderRuntime();
    fireEvent.click(screen.getByRole("button", { name: "Dive into today's seven" }));
    await screen.findByRole("heading", { name: "Name a US state" });

    answer("Carrot");
    expect(await screen.findByText("Not a valid answer. Try another.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Your answer" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByRole("button", { name: "Submit answer" })).toBeDisabled();
    expect(spy.mock.calls.some((call) => String(call[0]).endsWith("/answer"))).toBe(false);

    // Typing again clears the warning; a valid answer goes in.
    answer("Delware");
    expect(await screen.findByText("+80")).toBeInTheDocument();
    const sent = spy.mock.calls.filter((call) => String(call[0]).endsWith("/answer"));
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0]?.[1]?.body))).toEqual({ answer: "Delware" });
  });

  it("suggests what an invalid answer may have meant, and sends a suggestion on a tap", async () => {
    const spy = mockFetch(dailyServer());
    await renderRuntime();
    fireEvent.click(screen.getByRole("button", { name: "Dive into today's seven" }));
    await screen.findByRole("heading", { name: "Name a US state" });

    answer("Delawhere");
    expect(await screen.findByText("Did you mean:")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delware" }));

    expect(await screen.findByText("+80")).toBeInTheDocument();
    const sent = spy.mock.calls.filter((call) => String(call[0]).endsWith("/answer"));
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0]?.[1]?.body))).toEqual({ answer: "Delware" });
  });

  it("does not submit an answer already turned down when the clock runs out", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = mockFetch(dailyServer());
    await renderRuntime();
    fireEvent.click(screen.getByRole("button", { name: "Dive into today's seven" }));
    await screen.findByRole("heading", { name: "Name a US state" });

    answer("Carrot");
    await screen.findByText("Not a valid answer. Try another.");
    await act(async () => {
      vi.advanceTimersByTime(26_000);
    });
    await waitFor(() =>
      expect(spy.mock.calls.some((call) => String(call[0]).endsWith("/answer"))).toBe(true),
    );
    const sent = spy.mock.calls.find((call) => String(call[0]).endsWith("/answer"));
    expect(JSON.parse(String(sent?.[1]?.body))).toEqual({ answer: "" });
  });

  it("submits whatever is typed when the clock runs out", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = mockFetch(dailyServer());
    await renderRuntime();
    fireEvent.click(screen.getByRole("button", { name: "Dive into today's seven" }));
    await screen.findByRole("heading", { name: "Name a US state" });

    fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), {
      target: { value: "Ontario" },
    });
    await act(async () => {
      vi.advanceTimersByTime(26_000);
    });

    await waitFor(() =>
      expect(spy.mock.calls.some((call) => String(call[0]).endsWith("/questions/0/answer"))).toBe(
        true,
      ),
    );
    const sent = spy.mock.calls.find((call) => String(call[0]).endsWith("/answer"));
    expect(JSON.parse(String(sent?.[1]?.body))).toEqual({ answer: "Ontario" });
    expect(await screen.findByText("Not a valid answer")).toBeInTheDocument();
  });

  it("says when today's dive is done, and offers practice", async () => {
    mockFetch((url) =>
      url.endsWith("/sessions")
        ? jsonResponse(
            { code: "conflict", message: "You've already played today's challenge." },
            409,
          )
        : jsonResponse({}, 404),
    );
    await renderRuntime();
    fireEvent.click(screen.getByRole("button", { name: "Dive into today's seven" }));
    expect(await screen.findByText("You've done today's dive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unlimited/ })).toBeInTheDocument();
  });
});

describe("practice", () => {
  it("plays Unlimited without a session and totals it on the server", async () => {
    const spy = mockFetch((url) => {
      if (url.endsWith("/deep-cut/practice")) {
        return jsonResponse({ outcome: "started", runId: PRACTICE, mode: "unlimited", swapped: 0 });
      }
      const dealt = /questions\/(\d)$/.exec(url);
      if (dealt) return jsonResponse(question(PRACTICE, Number(dealt[1]), "unlimited"));
      if (url.endsWith("/questions/0/answer")) {
        return jsonResponse({
          outcome: "scored",
          turn: {
            position: 0,
            verdict: "correct",
            answer: "Wyoming",
            canonical: "Wyoming",
            answerId: 9,
            tier: 4,
            points: 60,
            sharePercent: null,
            commonAnswer: "California",
            deepestAnswers: "Delaware",
          },
        });
      }
      if (url.endsWith("/summary")) {
        return jsonResponse({
          outcome: "finished",
          points: 60,
          turns: [
            {
              position: 0,
              verdict: "correct",
              answer: "Wyoming",
              canonical: "Wyoming",
              answerId: 9,
              tier: 4,
              points: 60,
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    await renderRuntime();
    fireEvent.click(screen.getByRole("button", { name: /Unlimited/ }));
    await screen.findByRole("heading", { name: "Name a US state" });
    answer("Wyoming");
    expect(await screen.findByText("Deepest answers: Delaware.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Next question/ }));
    await screen.findByRole("heading", { name: "Name a cheese" });
    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    fireEvent.click(await screen.findByRole("button", { name: "End run" }));

    expect(await screen.findByText("Wyoming")).toBeInTheDocument();
    expect(spy.mock.calls.some((call) => String(call[0]).includes("/sessions"))).toBe(false);
  });
});
