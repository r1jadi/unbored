import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { describeNotification, type AppNotification } from "@/lib/notifications/store";
import { vapidKeyBytes } from "@/lib/notifications/push";

function note(kind: AppNotification["kind"], payload: Record<string, unknown>): AppNotification {
  return { id: "n", kind, payload, readAt: null, createdAt: "2026-11-04T00:00:00Z" };
}

describe("how the inbox words a notification", () => {
  it("names the game a score was beaten on", () => {
    expect(describeNotification(note("score", { game_title: "Decant" }))).toBe(
      "beat your score on Decant",
    );
    expect(describeNotification(note("score", {}))).toBe("beat your score");
  });

  it("tells a reply from a comment on your game", () => {
    expect(describeNotification(note("comment", { reason: "reply", game_title: "Decant" }))).toBe(
      "replied to your comment on Decant",
    );
    expect(
      describeNotification(note("comment", { reason: "game_comment", game_title: "Decant" })),
    ).toBe("commented on Decant");
  });

  it("no longer says a comment was on a score: comments are on games", () => {
    expect(describeNotification(note("comment", {}))).toBe("commented on your game");
  });

  it("words older follow rows itself, so they can be translated", () => {
    expect(describeNotification(note("follow", { text: "an English sentence" }))).toBe(
      "started following you",
    );
  });

  it("still shows the text of a message written for the player", () => {
    expect(describeNotification(note("moderation", { text: "Your comment was hidden." }))).toBe(
      "Your comment was hidden.",
    );
  });
});

describe("the VAPID key", () => {
  it("decodes base64url to the raw bytes the browser asks for", () => {
    expect([...vapidKeyBytes("AQIDBA")]).toEqual([1, 2, 3, 4]);
    expect([...vapidKeyBytes("-_-_")]).toEqual([251, 255, 191]);
  });
});

/** Runs the real `public/sw.js` against a stand-in for the worker's environment. */
function loadWorker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const showNotification = vi.fn(() => Promise.resolve());
  const subscribe = vi.fn(() => Promise.resolve());
  const clients = {
    matchAll: vi.fn(() => Promise.resolve([] as unknown[])),
    openWindow: vi.fn(() => Promise.resolve()),
  };
  const fakeSelf = {
    addEventListener: (name: string, listener: (event: unknown) => void) =>
      listeners.set(name, listener),
    registration: { showNotification, pushManager: { subscribe } },
    clients,
    location: { origin: "https://unbored.lol" },
    skipWaiting: vi.fn(),
  };
  const source = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
  new Function("self", "caches", source)(fakeSelf, {});

  async function fire(name: string, event: Record<string, unknown>) {
    const pending: Array<Promise<unknown>> = [];
    listeners.get(name)!({
      ...event,
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    await Promise.all(pending);
  }
  return { fire, showNotification, clients, subscribe };
}

describe("the service worker", () => {
  let worker: ReturnType<typeof loadWorker>;
  const pushOf = (message: unknown) => ({ data: { json: () => message } });

  beforeEach(() => {
    worker = loadWorker();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows what the server sent", async () => {
    await worker.fire(
      "push",
      pushOf({ title: "New follower", body: "@rijad", url: "/u/rijad", tag: "follow" }),
    );

    expect(worker.showNotification).toHaveBeenCalledWith(
      "New follower",
      expect.objectContaining({ body: "@rijad", tag: "follow", data: { url: "/u/rijad" } }),
    );
  });

  it("still shows a notification when a message can't be read: browsers require one", async () => {
    await worker.fire("push", {
      data: {
        json: () => {
          throw new Error("not JSON");
        },
      },
    });

    expect(worker.showNotification).toHaveBeenCalledWith(
      "Unbored",
      expect.objectContaining({ data: { url: "/notifications" } }),
    );
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example",
    "javascript:alert(1)",
    42,
  ])("never opens another site from a notification: %s", async (url) => {
    await worker.fire("push", pushOf({ title: "x", url }));

    expect(worker.showNotification).toHaveBeenCalledWith(
      "x",
      expect.objectContaining({ data: { url: "/notifications" } }),
    );
  });

  it("opens the page in a new window when the app isn't open", async () => {
    const close = vi.fn();
    await worker.fire("notificationclick", {
      notification: { close, data: { url: "/games/decant" } },
    });

    expect(close).toHaveBeenCalled();
    expect(worker.clients.openWindow).toHaveBeenCalledWith("/games/decant");
  });

  it("reuses an open tab of the app, but not another site's", async () => {
    const mine = { url: "https://unbored.lol/", focus: vi.fn(), navigate: vi.fn() };
    const other = { url: "https://other.example/", focus: vi.fn(), navigate: vi.fn() };
    worker.clients.matchAll.mockResolvedValue([other, mine]);

    await worker.fire("notificationclick", {
      notification: { close: vi.fn(), data: { url: "/games/decant" } },
    });

    expect(other.focus).not.toHaveBeenCalled();
    expect(mine.focus).toHaveBeenCalled();
    expect(mine.navigate).toHaveBeenCalledWith("/games/decant");
    expect(worker.clients.openWindow).not.toHaveBeenCalled();
  });
});
