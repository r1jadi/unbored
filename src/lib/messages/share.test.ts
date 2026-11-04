import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ userId: "me" as string | undefined }));

vi.mock("@/lib/auth/session", () => ({
  getAccessToken: () => "token",
  getAuthState: () => ({ status: "authenticated", session: { userId: auth.userId } }),
  getSessionUserId: () => auth.userId,
  rotateRefusedSession: vi.fn(),
  subscribe: () => () => undefined,
}));
vi.mock("@/lib/messages/realtime", () => ({
  isLive: () => false,
  joinTypingChannel: vi.fn(),
  startRealtime: vi.fn(),
  subscribeLive: () => () => undefined,
  subscribeSignals: () => () => undefined,
}));
vi.mock("@/lib/seo", () => ({ SITE_URL: "https://unbored.lol" }));

const follows = vi.hoisted(() => ({
  listFollowees: vi.fn(),
  listFollowers: vi.fn(),
  fetchProfilesByIds: vi.fn(),
}));
vi.mock("@/lib/social/follows", () => follows);

const store = vi.hoisted(() => ({ fetchInbox: vi.fn() }));
vi.mock("@/lib/messages/store", () => store);

import { fetchShareTargets } from "@/lib/messages/share";
import { ownPath, sharedGameSlug } from "@/lib/messages/shared-links";

const profile = (id: string) => ({
  id,
  username: id,
  display_name: id.toUpperCase(),
  bio: null,
  avatar_path: null,
});
const chat = (id: string) => ({
  otherId: id,
  username: id,
  displayName: id.toUpperCase(),
  avatarPath: null,
});

describe("a shared game in a chat", () => {
  it("is a message that is only a link to one of our games", () => {
    expect(sharedGameSlug("https://unbored.lol/games/decant")).toBe("decant");
    expect(sharedGameSlug("  https://unbored.lol/games/decant/  ")).toBe("decant");
  });

  it("leaves everything else as text", () => {
    expect(sharedGameSlug("play https://unbored.lol/games/decant now")).toBeNull();
    expect(sharedGameSlug("https://unbored.lol/u/rijad")).toBeNull();
    expect(sharedGameSlug("just text")).toBeNull();
  });

  it("is never someone else's site dressed up as one of our games", () => {
    expect(sharedGameSlug("https://evil.example/games/decant")).toBeNull();
    expect(sharedGameSlug("https://unbored.lol.evil.example/games/decant")).toBeNull();
    expect(ownPath("javascript:alert(1)")).toBeNull();
  });
});

describe("who the share sheet offers", () => {
  beforeEach(() => {
    auth.userId = "me";
    vi.clearAllMocks();
    store.fetchInbox.mockResolvedValue([]);
    follows.listFollowees.mockResolvedValue([]);
    follows.listFollowers.mockResolvedValue([]);
    follows.fetchProfilesByIds.mockImplementation(async (ids: string[]) => ids.map(profile));
  });

  it("is nobody for a visitor", async () => {
    auth.userId = undefined;
    await expect(fetchShareTargets()).resolves.toEqual([]);
    expect(store.fetchInbox).not.toHaveBeenCalled();
  });

  it("puts recent chats first, then friends, with nobody twice", async () => {
    store.fetchInbox.mockResolvedValue([chat("recent"), chat("both")]);
    follows.listFollowees.mockResolvedValue(["both", "friend", "onlyifollow"]);
    follows.listFollowers.mockResolvedValue(["both", "friend", "onlyfollowsme"]);
    const targets = await fetchShareTargets();
    expect(targets.map((t) => t.id)).toEqual(["recent", "both", "friend"]);
  });

  it("still offers friends when the inbox can't be read", async () => {
    store.fetchInbox.mockRejectedValue(new Error("down"));
    follows.listFollowees.mockResolvedValue(["friend"]);
    follows.listFollowers.mockResolvedValue(["friend"]);
    const targets = await fetchShareTargets();
    expect(targets.map((t) => t.id)).toEqual(["friend"]);
  });

  it("still offers recent chats when the follow graph can't be read", async () => {
    store.fetchInbox.mockResolvedValue([chat("recent")]);
    follows.listFollowers.mockRejectedValue(new Error("down"));
    const targets = await fetchShareTargets();
    expect(targets.map((t) => t.id)).toEqual(["recent"]);
  });
});
