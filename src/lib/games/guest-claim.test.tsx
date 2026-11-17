import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

const apiFetch = vi.fn();
let accessToken: string | undefined;

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getAccessToken: () => accessToken,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <a href="#" onClick={onClick}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/games/catalog", () => ({
  useGame: () => ({ status: "ready", game: { title: "Whittle" }, retry: () => undefined }),
  titleFromSlug: (slug: string) => slug,
}));

const claim = await import("./guest-claim");
const { RunEndActions } = await import("@/components/game/RunEndActions");

const SESSION = "cccccccc-1111-4111-8111-cccccccccccc";
const run = { sessionId: SESSION, gameSlug: "whittle", score: 124, finishedAt: Date.now() };

beforeEach(() => {
  localStorage.clear();
  claim.resetGuestClaimForTests();
  apiFetch.mockReset();
  accessToken = undefined;
});

afterEach(() => {
  localStorage.clear();
});

describe("the end screen's guest offer", () => {
  it("offers to save the run the guest just finished, and keeps it when they go to sign up", () => {
    act(() => claim.noteGuestRun({ ...run, finishedAt: Date.now() }));
    render(<RunEndActions slug="whittle" ranked={false} onRestart={() => undefined} />);

    expect(screen.getByText("Save your score of 1,240")).toBeInTheDocument();
    expect(claim.heldGuestRun()).toBeNull();

    fireEvent.click(screen.getByText("Sign up and save"));
    expect(claim.heldGuestRun()?.sessionId).toBe(SESSION);
  });

  it("talks about the next run when this one can't be saved", () => {
    render(<RunEndActions slug="whittle" ranked={false} onRestart={() => undefined} />);
    expect(screen.getByText("Guest runs aren't ranked")).toBeInTheDocument();
    expect(screen.queryByText(/Save your score/)).toBeNull();
  });

  it("doesn't offer another game's run", () => {
    act(() => claim.noteGuestRun({ ...run, gameSlug: "stack-10", finishedAt: Date.now() }));
    render(<RunEndActions slug="whittle" ranked={false} onRestart={() => undefined} />);
    expect(screen.queryByText(/Save your score/)).toBeNull();
  });

  it("isn't shown for a ranked run", () => {
    act(() => claim.noteGuestRun({ ...run, finishedAt: Date.now() }));
    render(<RunEndActions slug="whittle" ranked onRestart={() => undefined} />);
    expect(screen.queryByText(/Save your score/)).toBeNull();
  });
});

describe("claiming a held run", () => {
  it("waits for an account", async () => {
    claim.holdGuestRun(run);
    await expect(claim.claimHeldGuestRun()).resolves.toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(claim.heldGuestRun()).not.toBeNull();
  });

  it("sends only the run id, as the signed-in player, and forgets it once saved", async () => {
    accessToken = "token";
    claim.holdGuestRun(run);
    apiFetch.mockResolvedValue({
      sessionId: SESSION,
      gameSlug: "whittle",
      score: 124,
      personalBest: 124,
      rank: 3,
      duplicate: false,
    });

    const outcome = await claim.claimHeldGuestRun();

    expect(outcome).toMatchObject({ kind: "saved", run: { score: 124, rank: 3 } });
    const [path, options] = apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(`/sessions/${SESSION}/claim`);
    expect(options).toMatchObject({ method: "POST", token: "token" });
    expect(options["body"]).toBeUndefined();
    expect(claim.heldGuestRun()).toBeNull();
  });

  it("forgets a run the server won't save, and says why", async () => {
    accessToken = "token";
    claim.holdGuestRun(run);
    apiFetch.mockRejectedValue(
      new ApiError("already", {
        status: 409,
        details: [{ field: "sessionID", rule: "already_played" }],
      }),
    );
    await expect(claim.claimHeldGuestRun()).resolves.toEqual({
      kind: "already-played",
      gameSlug: "whittle",
    });
    expect(claim.heldGuestRun()).toBeNull();

    claim.holdGuestRun(run);
    apiFetch.mockRejectedValue(new ApiError("gone", { status: 404 }));
    await expect(claim.claimHeldGuestRun()).resolves.toEqual({ kind: "gone", gameSlug: "whittle" });
    expect(claim.heldGuestRun()).toBeNull();
  });

  it("keeps the run for later when the API can't answer", async () => {
    accessToken = "token";
    claim.holdGuestRun(run);
    apiFetch.mockRejectedValue(new ApiError("down", { status: 503 }));
    await expect(claim.claimHeldGuestRun()).resolves.toEqual({ kind: "later" });
    expect(claim.heldGuestRun()?.sessionId).toBe(SESSION);
  });

  it("drops a run older than the server's claim window", () => {
    claim.holdGuestRun({ ...run, finishedAt: Date.now() - claim.GUEST_CLAIM_WINDOW_MS - 1 });
    expect(claim.heldGuestRun()).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});
