import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AchievementsList } from "@/components/social/AchievementsList";
import { ReportDialog } from "@/components/social/ReportDialog";
import { describeDevice, tokenAssuranceLevel } from "@/lib/auth/security";
import { clearSession, SESSION_STORAGE_KEY, initializeSession } from "@/lib/auth/session";
import type { Game } from "@/lib/games/catalog";
import { pickBySlug, withFeaturedFirst } from "@/lib/games/rankings";
import { playHaptic, setHapticsEnabled } from "@/lib/haptics";
import { announcementOf, type AppNotification } from "@/lib/notifications/store";
import { getQueryClient } from "@/lib/query";
import { playSound } from "@/lib/sound";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function game(slug: string): Game {
  return { slug, title: slug } as Game;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  getQueryClient().clear();
  clearSession();
});

describe("featured and trending orderings", () => {
  const games = [game("a"), game("b"), game("c"), game("d"), game("e")];

  it("picks games in the database's order, and skips any the catalogue doesn't have", () => {
    expect(pickBySlug(games, ["c", "gone", "a"]).map((g) => g.slug)).toEqual(["c", "a"]);
  });

  it("opens the feed with the first few featured games and keeps the rest in order", () => {
    expect(withFeaturedFirst(games, ["e", "c", "a", "b"], 3).map((g) => g.slug)).toEqual([
      "e",
      "c",
      "a",
      "b",
      "d",
    ]);
  });

  it("leaves the feed alone when nothing is featured", () => {
    expect(withFeaturedFirst(games, []).map((g) => g.slug)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("the report dialog", () => {
  const token = "header.payload.signature";

  beforeEach(async () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tokens: {
          accessToken: token,
          refreshToken: "refresh",
          tokenType: "bearer",
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
        session: { userId: "me", role: "user" },
      }),
    );
  });

  function stub() {
    const spy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/auth/session")) {
        return jsonResponse({ userId: "me", role: "user", onboarded: true });
      }
      return jsonResponse("report-id");
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("needs a reason, then files one report with what the player chose", async () => {
    const spy = stub();
    await initializeSession();
    const onOpenChange = vi.fn();
    render(
      <ReportDialog
        open
        onOpenChange={onOpenChange}
        kind="comment"
        targetId="comment-1"
        subject="this comment"
      />,
    );

    const send = screen.getByRole("button", { name: "Send report" });
    expect(send).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Spam or scams" }));
    fireEvent.change(screen.getByLabelText("Anything else? (optional)"), {
      target: { value: " keeps posting links " },
    });
    fireEvent.click(send);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const call = spy.mock.calls.find(([input]) => String(input).includes("rpc/submit_report"));
    expect(JSON.parse(call![1]!.body as string)).toEqual({
      p_target_kind: "comment",
      p_target_id: "comment-1",
      p_reason: "Spam or scams",
      p_details: "keeps posting links",
      p_include_messages: false,
    });
  });

  it("says when a chat's messages will be shared, and asks for them", async () => {
    const spy = stub();
    await initializeSession();
    render(
      <ReportDialog
        open
        onOpenChange={() => {}}
        kind="profile"
        targetId="user-1"
        subject="@nora"
        includeMessages
      />,
    );

    expect(
      screen.getByText("Their last 5 messages in this chat will be shared with the moderators."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Harassment or bullying" }));
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() =>
      expect(spy.mock.calls.some(([i]) => String(i).includes("rpc/submit_report"))).toBe(true),
    );
    const call = spy.mock.calls.find(([input]) => String(input).includes("rpc/submit_report"));
    expect(JSON.parse(call![1]!.body as string).p_include_messages).toBe(true);
  });

  it("keeps the dialog open and explains a refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("/auth/session")
          ? jsonResponse({ userId: "me", role: "user", onboarded: true })
          : jsonResponse({ code: "53400", message: "too many reports today" }, 400),
      ),
    );
    await initializeSession();
    const onOpenChange = vi.fn();
    render(
      <ReportDialog open onOpenChange={onOpenChange} kind="game" targetId="g" subject="Sudoku" />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Cheating" }));
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You've sent a lot of reports today.",
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("achievements", () => {
  function renderList(self: boolean, row: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(row)),
    );
    return render(
      <QueryClientProvider client={getQueryClient()}>
        <AchievementsList userId="user-1" self={self} username="nora" />
      </QueryClientProvider>,
    );
  }

  const counters = {
    visible: true,
    runs: 12,
    games: 2,
    days: 3,
    longest_streak: 2,
    first_places: 0,
    followers: 0,
  };

  it("shows a player what they've earned and how far along the rest are", async () => {
    renderList(true, counters);

    expect(await screen.findByText("Warming up")).toBeInTheDocument();
    expect(screen.getByText("2 of 12 earned")).toBeInTheDocument();
    expect(screen.getByText("Regular")).toBeInTheDocument();
    expect(screen.getByText("12 / 100")).toBeInTheDocument();
  });

  it("shows a visitor only what was earned", async () => {
    renderList(false, counters);

    expect(await screen.findByText("Warming up")).toBeInTheDocument();
    expect(screen.queryByText("Regular")).not.toBeInTheDocument();
  });

  it("says so when the player hides their scores", async () => {
    renderList(false, { visible: false });

    expect(await screen.findByText("Achievements are hidden")).toBeInTheDocument();
  });
});

describe("haptics", () => {
  beforeEach(() => setHapticsEnabled(true));

  it("does nothing where the browser has no vibration", () => {
    expect(() => playHaptic("tap")).not.toThrow();
  });

  it("vibrates a cue, and stops when turned off", () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    try {
      playHaptic("win");
      expect(vibrate).toHaveBeenCalledTimes(1);

      setHapticsEnabled(false);
      vibrate.mockClear();
      playHaptic("win");
      expect(vibrate).not.toHaveBeenCalled();
    } finally {
      delete (navigator as { vibrate?: unknown }).vibrate;
    }
  });

  it("is separate from sound", () => {
    expect(() => playSound("tap")).not.toThrow();
  });
});

describe("security helpers", () => {
  function tokenWith(claims: object): string {
    return `h.${btoa(JSON.stringify(claims))}.s`;
  }

  it("reads the assurance level from a token, and doesn't guess", () => {
    expect(tokenAssuranceLevel(tokenWith({ aal: "aal2" }))).toBe("aal2");
    expect(tokenAssuranceLevel(tokenWith({}))).toBeNull();
    expect(tokenAssuranceLevel("not-a-token")).toBeNull();
    expect(tokenAssuranceLevel(undefined)).toBeNull();
  });

  it("names a device from its user agent", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
      ),
    ).toBe("Chrome on Windows");
    expect(describeDevice(null)).toBe("Unknown device");
  });
});

describe("announcements in the inbox", () => {
  function row(payload: Record<string, unknown>, kind = "system"): AppNotification {
    return { id: "n", kind, payload, readAt: null, createdAt: "" } as unknown as AppNotification;
  }

  it("reads an announcement", () => {
    expect(
      announcementOf(row({ reason: "announcement", title: "T", text: "B", link: "/games/sudoku" })),
    ).toEqual({ title: "T", body: "B", link: "/games/sudoku" });
  });

  it("never follows a link out of the app", () => {
    for (const link of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
      expect(
        announcementOf(row({ reason: "announcement", title: "T", text: "B", link }))?.link,
      ).toBe(null);
    }
  });

  it("ignores every other kind of row", () => {
    expect(announcementOf(row({ reason: "new_game", title: "T", text: "B" }))).toBeNull();
    expect(
      announcementOf(row({ reason: "announcement", title: "T", text: "B" }, "follow")),
    ).toBeNull();
  });
});
