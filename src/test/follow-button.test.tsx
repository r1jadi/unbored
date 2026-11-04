import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FollowButton } from "@/components/common";
import { clearSession, signIn } from "@/lib/auth/session";

const testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";
const otherUserID = "9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d";

/** The shape `POST /auth/sign-in` answers with, per the contract. */
function sessionPayload() {
  return {
    session: {
      userId: testUserID,
      role: "user",
      email: "player@example.com",
      onboarded: true,
      expiresAt: "2026-10-08T12:00:00.000Z",
    },
    tokens: {
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
      tokenType: "bearer",
      expiresIn: 3600,
    },
    user: {
      id: testUserID,
      email: "player@example.com",
      emailConfirmed: true,
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  };
}

function followRow() {
  return {
    follower_id: testUserID,
    followee_id: otherUserID,
    created_at: "2026-10-15T00:00:00.000Z",
  };
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FollowButton", () => {
  it("shows the stored relationship when the caller has no state to pass", async () => {
    // A profile page renders the button without a follow state; the database
    // has one, and the button must show it.
    mockFetch((url) =>
      url.includes("/auth/sign-in") ? jsonResponse(sessionPayload()) : jsonResponse([followRow()]),
    );
    await signIn("player@example.com", "correct-horse");

    render(<FollowButton userId={otherUserID} username="rival" />);

    expect(await screen.findByRole("button", { name: "Following" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("turns a duplicate-key refusal into Following instead of the old error", async () => {
    // The reported bug: the button believed it was not following, the row
    // already existed, and the insert's primary-key violation was shown to the
    // user as a message that contradicted the button. The state it describes is
    // now adopted instead.
    let reads = 0;
    mockFetch((url, init) => {
      if (url.includes("/auth/sign-in")) return jsonResponse(sessionPayload());
      if ((init?.method ?? "GET") === "POST") {
        return jsonResponse(
          { code: "23505", message: "duplicate key value violates unique constraint" },
          409,
        );
      }
      reads += 1;
      return jsonResponse(reads === 1 ? [] : [followRow()]);
    });
    await signIn("player@example.com", "correct-horse");

    render(<FollowButton userId={otherUserID} />);
    await waitFor(() => expect(reads).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: "Follow" }));

    expect(await screen.findByRole("button", { name: "Following" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a genuine failure visible", async () => {
    mockFetch((url, init) => {
      if (url.includes("/auth/sign-in")) return jsonResponse(sessionPayload());
      if ((init?.method ?? "GET") === "POST") {
        return jsonResponse({ code: "500", message: "The write failed." }, 500);
      }
      return jsonResponse([]);
    });
    await signIn("player@example.com", "correct-horse");

    render(<FollowButton userId={otherUserID} />);

    fireEvent.click(await screen.findByRole("button", { name: "Follow" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't update the follow. Try again.",
    );
    expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument();
  });

  it("asks a signed-out visitor to sign in, without any request", async () => {
    const spy = mockFetch(() => jsonResponse({}));

    render(<FollowButton userId={otherUserID} />);

    fireEvent.click(screen.getByRole("button", { name: "Follow" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in to follow players.");
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not re-read a state the search page just loaded", async () => {
    const spy = mockFetch(() => jsonResponse(sessionPayload()));
    await signIn("player@example.com", "correct-horse");

    render(<FollowButton userId={otherUserID} initial={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));

    expect(await screen.findByRole("button", { name: "Following" })).toBeInTheDocument();
    // The sign-in and the insert: a seeded button performs no pre-read.
    expect(spy).toHaveBeenCalledTimes(2);
    const insert = spy.mock.calls[1];
    expect(new URL(String(insert[0])).searchParams.get("on_conflict")).toBe(
      "follower_id,followee_id",
    );
  });
});
