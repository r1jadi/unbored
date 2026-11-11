import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const pushStatus = vi.hoisted(() => ({ value: "off" as string }));
const auth = vi.hoisted(() => ({ status: "authenticated" as string }));

vi.mock("@/lib/notifications/push", () => ({
  readPushStatus: () => Promise.resolve(pushStatus.value),
  enablePush: vi.fn(() => Promise.resolve("on")),
}));
vi.mock("@/lib/auth/session", () => ({ useAuth: () => ({ status: auth.status }) }));

const { askDue, noteGameFinished, startInstallCapture } = await import("./ask");
const { InstallAsk } = await import("@/components/game/InstallAsk");

beforeAll(() => {
  startInstallCapture();
});

afterEach(() => {
  localStorage.clear();
  pushStatus.value = "off";
  auth.status = "authenticated";
});

function finish(games: number) {
  act(() => {
    for (let i = 0; i < games; i += 1) noteGameFinished();
  });
}

describe("when to ask", () => {
  it("never before the third finished game", () => {
    expect(askDue(0, null)).toBe(false);
    expect(askDue(2, null)).toBe(false);
    expect(askDue(3, null)).toBe(true);
  });

  it("a Not now waits ten more games, and a second one is final", () => {
    expect(askDue(12, 3)).toBe(false);
    expect(askDue(13, 3)).toBe(true);
    expect(askDue(500, -1)).toBe(false);
  });
});

describe("the ask on a result screen", () => {
  it("holds the browser's own install bar back on arrival", () => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("shows nothing after two games, and the offer after the third", async () => {
    finish(2);
    const { unmount } = render(<InstallAsk />);
    await act(async () => undefined);
    expect(screen.queryByText("Keep Unbored close")).toBeNull();
    unmount();

    finish(1);
    render(<InstallAsk />);
    expect(await screen.findByText("Keep Unbored close")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on notifications" })).toBeInTheDocument();
  });

  it("offers the browser's install prompt it held back", async () => {
    const prompt = vi.fn(() => Promise.resolve());
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    finish(3);
    render(<InstallAsk />);

    fireEvent.click(await screen.findByRole("button", { name: "Add to Home Screen" }));
    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
  });

  it("doesn't offer push to a guest, who has no account to send to", async () => {
    auth.status = "anonymous";
    finish(3);
    render(<InstallAsk />);
    await act(async () => undefined);
    expect(screen.queryByRole("button", { name: "Turn on notifications" })).toBeNull();
  });

  it("goes away on Not now", async () => {
    finish(3);
    render(<InstallAsk />);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Keep Unbored close")).toBeNull();
  });
});
