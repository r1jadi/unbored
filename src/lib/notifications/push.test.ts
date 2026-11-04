import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The auth state the code under test sees, changed by each test. */
const auth = {
  state: { status: "authenticated", session: { userId: "user-1" } } as {
    status: string;
    session?: { userId: string };
  },
  listeners: [] as Array<() => void>,
};

const restMutate = vi.fn((..._args: unknown[]) => Promise.resolve(new Response()));

vi.mock("@/lib/auth/session", () => ({
  getAccessToken: () => (auth.state.status === "authenticated" ? "token-1" : undefined),
  getAuthState: () => auth.state,
  subscribe: (listener: () => void) => {
    auth.listeners.push(listener);
    return () => undefined;
  },
}));
vi.mock("@/lib/supabase/rest", () => ({
  restMutate: (...args: unknown[]) => restMutate(...args),
}));
vi.mock("@/lib/config", () => ({
  publicConfig: { push: { vapidPublicKey: "AQIDBA" } },
}));

function subscriptionStub() {
  return {
    endpoint: "https://fcm.googleapis.com/fcm/send/device",
    toJSON: () => ({
      endpoint: "https://fcm.googleapis.com/fcm/send/device",
      keys: { p256dh: "public-key", auth: "secret" },
    }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
}

let existing: ReturnType<typeof subscriptionStub> | null;
let created: ReturnType<typeof subscriptionStub>;
let subscribe: ReturnType<typeof vi.fn>;
let permission: NotificationPermission;
let answer: NotificationPermission;

async function loadPush() {
  vi.resetModules();
  return import("./push");
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  auth.state = { status: "authenticated", session: { userId: "user-1" } };
  auth.listeners = [];
  restMutate.mockReset();
  restMutate.mockImplementation(() => Promise.resolve(new Response()));
  existing = null;
  created = subscriptionStub();
  subscribe = vi.fn(() => Promise.resolve(created));
  permission = "default";
  answer = "granted";

  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal(
    "Notification",
    class {
      static get permission() {
        return permission;
      }
      static requestPermission() {
        return Promise.resolve(answer);
      }
    },
  );
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: { getSubscription: () => Promise.resolve(existing), subscribe },
      }),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reading the status", () => {
  it("is off until this browser has a subscription, then on", async () => {
    const { readPushStatus } = await loadPush();
    expect(await readPushStatus()).toBe("off");

    existing = subscriptionStub();
    expect(await readPushStatus()).toBe("on");
  });

  it("reports a blocked site, because the switch can't fix that", async () => {
    const { readPushStatus } = await loadPush();
    permission = "denied";

    expect(await readPushStatus()).toBe("denied");
  });

  it("asks iPhone players to add the app first, where Safari hides the push APIs", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    );
    vi.stubGlobal("PushManager", undefined);
    const { readPushStatus } = await loadPush();

    expect(await readPushStatus()).toBe("needs-install");
  });
});

describe("turning push on", () => {
  it("subscribes with the VAPID key and tells the server, in this device's language", async () => {
    const { enablePush } = await loadPush();

    expect(await enablePush()).toBe("on");

    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 2, 3, 4]),
    });
    expect(restMutate).toHaveBeenCalledWith("rpc/register_push_subscription", "POST", "token-1", {
      p_endpoint: "https://fcm.googleapis.com/fcm/send/device",
      p_p256dh: "public-key",
      p_auth: "secret",
      p_language: "en",
    });
  });

  it("treats a declined prompt as a choice: nothing is subscribed", async () => {
    const { enablePush } = await loadPush();
    answer = "denied";

    expect(await enablePush()).toBe("denied");
    expect(subscribe).not.toHaveBeenCalled();

    answer = "default";
    expect(await enablePush()).toBe("off");
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("undoes the subscription if the server can't save it", async () => {
    // On in the browser but unknown to the server would look on and never deliver.
    const { enablePush } = await loadPush();
    restMutate.mockImplementation(() => Promise.reject(new Error("down")));

    await expect(enablePush()).rejects.toThrow(/Couldn't turn on/);

    expect(created.unsubscribe).toHaveBeenCalled();
  });

  it("needs an account", async () => {
    const { enablePush } = await loadPush();
    auth.state = { status: "anonymous" };

    await expect(enablePush()).rejects.toThrow(/Sign in/);
    expect(subscribe).not.toHaveBeenCalled();
  });
});

describe("turning push off", () => {
  it("removes it from the server and the browser", async () => {
    const { disablePush } = await loadPush();
    existing = subscriptionStub();

    expect(await disablePush()).toBe("off");

    expect(restMutate).toHaveBeenCalledWith("rpc/unregister_push_subscription", "POST", "token-1", {
      p_endpoint: "https://fcm.googleapis.com/fcm/send/device",
    });
    expect(existing.unsubscribe).toHaveBeenCalled();
  });

  it("still stops notifications when the server can't be reached", async () => {
    const { disablePush } = await loadPush();
    existing = subscriptionStub();
    restMutate.mockImplementation(() => Promise.reject(new Error("down")));

    expect(await disablePush()).toBe("off");

    expect(existing.unsubscribe).toHaveBeenCalled();
  });
});

describe("keeping the device matched to the account", () => {
  it("re-registers on open, and only once per account as tokens refresh", async () => {
    const { startPushSync } = await loadPush();
    existing = subscriptionStub();

    startPushSync();
    await flush();
    expect(restMutate).toHaveBeenCalledTimes(1);

    auth.listeners.forEach((listener) => listener());
    await flush();
    expect(restMutate).toHaveBeenCalledTimes(1);
  });

  it("moves to the next player on a shared browser", async () => {
    const { startPushSync } = await loadPush();
    existing = subscriptionStub();
    startPushSync();
    await flush();

    auth.state = { status: "authenticated", session: { userId: "user-2" } };
    auth.listeners.forEach((listener) => listener());
    await flush();

    expect(restMutate).toHaveBeenCalledTimes(2);
    expect(existing.unsubscribe).not.toHaveBeenCalled();
  });

  it("unsubscribes on sign-out, so the next person doesn't get these notifications", async () => {
    const { startPushSync } = await loadPush();
    existing = subscriptionStub();
    startPushSync();
    await flush();

    auth.state = { status: "anonymous" };
    auth.listeners.forEach((listener) => listener());
    await flush();

    expect(existing.unsubscribe).toHaveBeenCalled();
  });

  it("leaves it alone while a page load hasn't restored the session yet", async () => {
    // Every load starts out anonymous for a moment. Unsubscribing then would turn
    // push off for everyone on every visit.
    auth.state = { status: "anonymous" };
    const { startPushSync } = await loadPush();
    existing = subscriptionStub();

    startPushSync();
    auth.state = { status: "restoring" };
    auth.listeners.forEach((listener) => listener());
    await flush();

    expect(existing.unsubscribe).not.toHaveBeenCalled();
  });
});
