import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: { status: "authenticated", session: { userId: "me", role: "user" } } as {
    status: string;
    session?: { userId: string; role: string };
  },
}));

const realtime = vi.hoisted(() => {
  const signals = new Set<(signal: { conversationId: string; kind: string }) => void>();
  const typing = {
    onTyping: undefined as undefined | (() => void),
    sent: 0,
    joined: [] as string[],
  };
  return {
    signals,
    typing,
    isLive: () => true,
    startRealtime: () => undefined,
    subscribeLive: () => () => undefined,
    subscribeSignals: (listener: (signal: { conversationId: string; kind: string }) => void) => {
      signals.add(listener);
      return () => signals.delete(listener);
    },
    joinTypingChannel: (conversationId: string, onTyping: () => void) => {
      typing.joined.push(conversationId);
      typing.onTyping = onTyping;
      return { send: () => (typing.sent += 1), leave: () => undefined };
    },
  };
});

vi.mock("@/lib/auth/session", () => ({
  getAccessToken: () => (auth.state.status === "authenticated" ? "token" : undefined),
  getAuthState: () => auth.state,
  rotateRefusedSession: vi.fn(async () => "refused"),
  subscribe: () => () => undefined,
}));

vi.mock("@/lib/config", () => ({
  publicConfig: { supabase: { url: "https://db.test", publishableKey: "key" } },
}));

vi.mock("@/lib/messages/realtime", () => realtime);

import {
  applyNewestPage,
  fetchMessages,
  mergeMessages,
  useThread,
  useUnreadChats,
  type ChatMessage,
} from "@/lib/messages/store";

function message(id: string, second: number, senderId = "them"): ChatMessage {
  return {
    id,
    senderId,
    body: id,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString(),
  };
}

function row(m: ChatMessage) {
  return { id: m.id, sender_id: m.senderId, body: m.body, created_at: m.createdAt };
}

type Routes = Record<string, (body: Record<string, unknown>) => unknown>;

/** Answers Data API calls by path. An unlisted one fails the way a 500 would. */
function serve(routes: Routes) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace("https://db.test/rest/v1/", "");
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
      calls.push({ path, body });
      const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
      if (!key) return new Response(JSON.stringify({ message: "boom" }), { status: 500 });
      const answer = routes[key]!(body);
      return answer === undefined
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(answer), { status: 200 });
    }),
  );
  return calls;
}

const thread = (over: Record<string, unknown> = {}) => [
  { conversation_id: "c1", can_send: true, their_last_read_at: null, ...over },
];

beforeEach(() => {
  vi.unstubAllGlobals();
  auth.state = { status: "authenticated", session: { userId: "me", role: "user" } };
});

describe("merging messages", () => {
  it("orders by time and takes the server's copy of a repeated id", () => {
    const merged = mergeMessages(
      [message("b", 2), { ...message("a", 1), body: "stale" }],
      [message("a", 1), message("c", 3)],
    );
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(merged[0]!.body).toBe("a");
  });

  const fullPage = (from: number) =>
    Array.from({ length: 50 }, (_, i) => message(`p${i}`, from + i));

  it("keeps earlier pages when a full newest page overlaps them", () => {
    const page = fullPage(10);
    const { messages, truncated } = applyNewestPage([message("old", 1), page[0]!], page);
    expect(messages[0]!.id).toBe("old");
    expect(messages).toHaveLength(51);
    expect(truncated).toBe(false);
  });

  it("drops a message the newest page no longer has: it was unsent", () => {
    const short = applyNewestPage([message("a", 1), message("gone", 2)], [message("a", 1)]);
    expect(short.messages.map((m) => m.id)).toEqual(["a"]);

    const page = fullPage(10);
    const full = applyNewestPage([page[0]!, message("gone", 20)], page);
    expect(full.messages.map((m) => m.id)).not.toContain("gone");
  });

  it("never shows a silent gap when a full page doesn't reach what is held", () => {
    const page = Array.from({ length: 50 }, (_, i) => message(`n${i}`, 100 + i));
    const { messages, truncated } = applyNewestPage([message("old", 1)], page);
    expect(messages.map((m) => m.id)).not.toContain("old");
    expect(truncated).toBe(true);
  });
});

describe("reading", () => {
  it("asks for a page of the conversation, and the page before a message", async () => {
    const calls = serve({ messages: () => [row(message("b", 2)), row(message("a", 1))] });
    const page = await fetchMessages("c1", message("z", 9));
    expect(page.map((m) => m.id)).toEqual(["a", "b"]);
    expect(calls[0]!.path).toContain("conversation_id=eq.c1");
    expect(calls[0]!.path).toContain("created_at=lt.");
    // Never the device's client id: the grant doesn't include it.
    expect(calls[0]!.path).toContain("select=id,sender_id,body,created_at,challenge_id");
  });
});

describe("useThread", () => {
  it("loads the chat and reads an incoming message", async () => {
    const calls = serve({
      "rpc/direct_thread": () => thread(),
      messages: () => [row(message("a", 1))],
      "rpc/mark_conversation_read": () => undefined,
      "rpc/direct_unread_total": () => 0,
    });
    const { result } = renderHook(() => useThread("them"));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state.messages.map((m) => m.id)).toEqual(["a"]);
    await waitFor(() =>
      expect(calls.some((c) => c.path === "rpc/mark_conversation_read")).toBe(true),
    );
  });

  it("doesn't mark a chat read when the only messages are the player's own", async () => {
    const calls = serve({
      "rpc/direct_thread": () => thread(),
      messages: () => [row(message("a", 1, "me"))],
    });
    const { result } = renderHook(() => useThread("them"));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(calls.some((c) => c.path === "rpc/mark_conversation_read")).toBe(false);
  });

  it("shows a message while it sends, then the stored one", async () => {
    const sent = message("stored", 5, "me");
    serve({
      "rpc/direct_thread": () => thread({ conversation_id: null }),
      "rpc/send_direct_message": () => [
        { outcome: "sent", message_id: sent.id, conversation_id: "c1", sent_at: sent.createdAt },
      ],
    });
    const { result } = renderHook(() => useThread("them"));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    act(() => result.current.send("  hello  "));
    expect(result.current.state.pending[0]).toMatchObject({ body: "hello", status: "sending" });

    await waitFor(() => expect(result.current.state.pending).toEqual([]));
    expect(result.current.state.messages[0]).toMatchObject({
      id: "stored",
      body: "hello",
      senderId: "me",
    });
    expect(result.current.state.conversationId).toBe("c1");
  });

  it("retries a failed send with the same client id, so it can't arrive twice", async () => {
    let online = false;
    const ids: unknown[] = [];
    const sent = message("stored", 5, "me");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input.includes("direct_thread")) {
          return new Response(JSON.stringify(thread({ conversation_id: null })));
        }
        ids.push((JSON.parse(init!.body as string) as { p_client_id: string }).p_client_id);
        if (!online) throw new TypeError("offline");
        return new Response(
          JSON.stringify([
            {
              outcome: "sent",
              message_id: sent.id,
              conversation_id: "c1",
              sent_at: sent.createdAt,
            },
          ]),
        );
      }),
    );
    const { result } = renderHook(() => useThread("them"));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    act(() => result.current.send("hello"));
    await waitFor(() => expect(result.current.state.pending[0]?.status).toBe("failed"));

    online = true;
    act(() => result.current.retrySend(result.current.state.pending[0]!.clientId));
    await waitFor(() => expect(result.current.state.pending).toEqual([]));
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("says why a send was refused and closes the composer", async () => {
    serve({
      "rpc/direct_thread": () => thread(),
      messages: () => [],
      "rpc/send_direct_message": () => [
        { outcome: "not_allowed", message_id: null, conversation_id: null, sent_at: null },
      ],
    });
    const { result } = renderHook(() => useThread("them"));
    await waitFor(() => expect(result.current.state.canSend).toBe(true));

    act(() => result.current.send("hello"));
    await waitFor(() => expect(result.current.state.notice).toBeDefined());
    expect(result.current.state.canSend).toBe(false);
    expect(result.current.state.pending[0]?.status).toBe("failed");
  });

  it("refuses to send nothing, or more than the database would take", async () => {
    const calls = serve({ "rpc/direct_thread": () => thread({ conversation_id: null }) });
    const { result } = renderHook(() => useThread("them"));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    act(() => result.current.send("   "));
    act(() => result.current.send("x".repeat(2001)));
    expect(result.current.state.pending).toEqual([]);
    expect(calls.some((c) => c.path === "rpc/send_direct_message")).toBe(false);
  });

  it("reports a failed first read rather than an empty chat", async () => {
    serve({});
    const { result } = renderHook(() => useThread("them"));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
  });
});

describe("live updates", () => {
  const fire = (conversationId = "c1", kind = "message") =>
    act(() => realtime.signals.forEach((listener) => listener({ conversationId, kind })));

  it("shows a new message as soon as the signal arrives, without waiting for a poll", async () => {
    let rows = [row(message("a", 1))];
    serve({
      "rpc/direct_thread": () => thread(),
      messages: () => rows,
      "rpc/mark_conversation_read": () => undefined,
      "rpc/direct_unread_total": () => 0,
    });
    const { result } = renderHook(() => useThread("them"));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    rows = [row(message("b", 2)), row(message("a", 1))];
    fire();
    await waitFor(() => expect(result.current.state.messages.map((m) => m.id)).toEqual(["a", "b"]));
  });

  it("removes a message the other player unsent", async () => {
    let rows = [row(message("b", 2)), row(message("a", 1))];
    serve({
      "rpc/direct_thread": () => thread(),
      messages: () => rows,
      "rpc/mark_conversation_read": () => undefined,
      "rpc/direct_unread_total": () => 0,
    });
    const { result } = renderHook(() => useThread("them"));
    await waitFor(() => expect(result.current.state.messages).toHaveLength(2));

    rows = [row(message("a", 1))];
    fire("c1", "unsend");
    await waitFor(() => expect(result.current.state.messages.map((m) => m.id)).toEqual(["a"]));
  });

  it("unsends at once, and brings the message back if the database refused", async () => {
    const mine = row(message("mine", 1, "me"));
    const calls = serve({
      "rpc/direct_thread": () => thread(),
      messages: () => [mine],
      "rpc/unsend_direct_message": () => false,
      "rpc/direct_unread_total": () => 0,
    });
    const { result } = renderHook(() => useThread("them"));
    await waitFor(() => expect(result.current.state.messages).toHaveLength(1));

    await act(async () => {
      await result.current.unsend("mine");
    });
    expect(calls.find((c) => c.path === "rpc/unsend_direct_message")?.body).toEqual({
      p_message: "mine",
    });
    await waitFor(() => expect(result.current.state.notice).toBeDefined());
    await waitFor(() => expect(result.current.state.messages).toHaveLength(1));
  });

  it("shows typing, and a message arriving ends it", async () => {
    let rows = [row(message("a", 1))];
    serve({
      "rpc/direct_thread": () => thread(),
      messages: () => rows,
      "rpc/mark_conversation_read": () => undefined,
      "rpc/direct_unread_total": () => 0,
    });
    realtime.typing.joined.length = 0;
    const { result } = renderHook(() => useThread("them"));
    await waitFor(() => expect(realtime.typing.joined).toContain("c1"));

    act(() => realtime.typing.onTyping!());
    expect(result.current.state.otherTyping).toBe(true);

    rows = [row(message("b", 2)), row(message("a", 1))];
    fire();
    await waitFor(() => expect(result.current.state.otherTyping).toBe(false));
  });

  it("sends typing at most every couple of seconds", async () => {
    realtime.typing.sent = 0;
    serve({ "rpc/direct_thread": () => thread(), messages: () => [] });
    const { result } = renderHook(() => useThread("them"));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    act(() => {
      result.current.notifyTyping();
      result.current.notifyTyping();
      result.current.notifyTyping();
    });
    expect(realtime.typing.sent).toBe(1);
  });
});

describe("useUnreadChats", () => {
  it("is unknown when signed out, and asks nothing", () => {
    auth.state = { status: "anonymous" };
    const calls = serve({});
    const { result } = renderHook(() => useUnreadChats());
    expect(result.current).toBeNull();
    expect(calls).toEqual([]);
  });

  it("is the database's number, and unknown rather than zero on failure", async () => {
    serve({ "rpc/direct_unread_total": () => 3 });
    const ok = renderHook(() => useUnreadChats());
    await waitFor(() => expect(ok.result.current).toBe(3));

    serve({});
    const failed = renderHook(() => useUnreadChats());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(failed.result.current).toBeNull();
  });
});
