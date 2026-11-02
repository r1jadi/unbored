import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FeedbackForm } from "@/components/settings/FeedbackForm";
import { clearSession, signIn } from "@/lib/auth/session";
import { sendFeedback } from "@/lib/feedback";

const ME = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Gateway sign-in plus a Data API stub that records feedback inserts. */
function stubBackend(feedbackStatus = 201) {
  const inserts: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/auth/sign-in")) {
        return json({
          session: { userId: ME, role: "user", email: "player@example.com" },
          tokens: {
            accessToken: "access-token-1",
            refreshToken: "refresh-token-1",
            expiresIn: 3600,
          },
        });
      }
      if (url.includes("/rest/v1/feedback")) {
        if (feedbackStatus >= 400) {
          return json({ code: "23514", message: "feedback rate limit" }, feedbackStatus);
        }
        inserts.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(null, { status: 201 });
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return inserts;
}

/**
 * The form inside a router: before the session is known it can show a link to
 * the sign-in page, and a link needs a router even when the test never follows it.
 */
async function renderForm() {
  const root = createRootRoute();
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/", component: () => <FeedbackForm /> }),
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
}

beforeEach(() => {
  clearSession();
  // Radix Switch measures itself; jsdom has no ResizeObserver.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearSession();
});

describe("sendFeedback", () => {
  it("refuses to send without a signed-in account", async () => {
    stubBackend();
    await expect(
      sendFeedback({ mood: 4, category: "idea", message: "More games!", includeDevice: false }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("validates the message before it reaches the database", async () => {
    const inserts = stubBackend();
    await signIn("player@example.com", "correct-horse");
    await expect(
      sendFeedback({ mood: 4, category: "idea", message: "  ", includeDevice: false }),
    ).rejects.toMatchObject({ code: "bad_request" });
    await expect(
      sendFeedback({ mood: 4, category: "idea", message: "x".repeat(2001), includeDevice: false }),
    ).rejects.toMatchObject({ code: "bad_request" });
    expect(inserts).toHaveLength(0);
  });

  it("attributes the row to the verified caller and omits the device note on request", async () => {
    const inserts = stubBackend();
    await signIn("player@example.com", "correct-horse");
    await sendFeedback({
      mood: 5,
      category: "praise",
      message: "  Love it  ",
      includeDevice: false,
    });
    expect(inserts).toEqual([
      { user_id: ME, mood: 5, category: "praise", message: "Love it", context: null },
    ]);
  });
});

describe("FeedbackForm", () => {
  it("needs a mood and a message, then sends and thanks the player", async () => {
    const inserts = stubBackend();
    await signIn("player@example.com", "correct-horse");
    await renderForm();

    const send = screen.getByRole("button", { name: "Send feedback" });
    expect(send).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Something broke" }));
    fireEvent.change(screen.getByLabelText("Your note"), {
      target: { value: "The feed jumps when I swipe" },
    });
    expect(send).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Meh" }));
    expect(send).toBeEnabled();
    fireEvent.click(send);

    await waitFor(() => expect(screen.getByText("Thank you!")).toBeInTheDocument());
    expect(inserts[0]).toMatchObject({
      user_id: ME,
      mood: 2,
      category: "bug",
      message: "The feed jumps when I swipe",
    });
    expect(typeof inserts[0]?.["context"]).toBe("string");

    fireEvent.click(screen.getByRole("button", { name: "Send another" }));
    expect(screen.getByLabelText("Your note")).toHaveValue("");
  });

  it("shows the refusal and keeps the note when sending fails", async () => {
    stubBackend(400);
    await signIn("player@example.com", "correct-horse");
    await renderForm();

    fireEvent.click(screen.getByRole("radio", { name: "Good" }));
    fireEvent.change(screen.getByLabelText("Your note"), { target: { value: "Nice work" } });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/try again/i));
    expect(screen.getByLabelText("Your note")).toHaveValue("Nice work");
  });
});
