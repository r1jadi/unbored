/**
 * The live connection behind direct messages: one socket per signed-in tab, through
 * Supabase Realtime (ADR 0014). It carries two things, neither of them a message:
 *
 *   - signals on `dm:user:<id>`, sent by the database, saying a chat changed. Whoever
 *     hears one reads the chat through the Data API, under RLS;
 *   - typing indicators on `dm:conv:<id>`, sent by the other player's browser and
 *     stored nowhere.
 *
 * Both channels are private: Realtime asks the policies on `realtime.messages` before
 * letting anyone join. If the socket can't connect, nothing breaks; `useThread` and the
 * badges poll faster while `isLive()` is false.
 */

import type { RealtimeChannel, RealtimeClient } from "@supabase/realtime-js";

import { getAccessToken, getAuthState, subscribe as subscribeToAuth } from "@/lib/auth/session";
import { publicConfig } from "@/lib/config";

export type DmSignal = {
  /** Empty after a reconnect: anything may have changed while the socket was down. */
  conversationId: string;
  kind: string;
};

let client: RealtimeClient | undefined;
let clientTask: Promise<RealtimeClient | undefined> | undefined;
let userChannel: RealtimeChannel | undefined;
let account: string | undefined;
let live = false;
let watching = false;

const signalListeners = new Set<(signal: DmSignal) => void>();
const liveListeners = new Set<() => void>();

function setLive(next: boolean): void {
  if (live === next) return;
  live = next;
  liveListeners.forEach((listener) => listener());
}

export function isLive(): boolean {
  return live;
}

export function subscribeLive(listener: () => void): () => void {
  liveListeners.add(listener);
  return () => liveListeners.delete(listener);
}

export function subscribeSignals(listener: (signal: DmSignal) => void): () => void {
  signalListeners.add(listener);
  return () => signalListeners.delete(listener);
}

function emit(signal: DmSignal): void {
  signalListeners.forEach((listener) => listener(signal));
}

/** Loaded on demand: a visitor who never signs in never downloads the client. */
function loadClient(): Promise<RealtimeClient | undefined> {
  clientTask ??= (async () => {
    const { url, publishableKey } = publicConfig.supabase;
    if (!url || !publishableKey) return undefined;
    const { RealtimeClient: Client } = await import("@supabase/realtime-js");
    // The configured Supabase URL is an HTTP(S) Data API origin; RealtimeClient
    // needs the matching WebSocket endpoint instead.
    const endpoint = new URL("/realtime/v1", url);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    client = new Client(endpoint.toString(), {
      params: { apikey: publishableKey },
      accessToken: async () => getAccessToken() ?? null,
    });
    return client;
  })().catch(() => undefined);
  return clientTask;
}

function dropUserChannel(): void {
  if (userChannel && client) void client.removeChannel(userChannel);
  userChannel = undefined;
  setLive(false);
}

async function sync(): Promise<void> {
  const auth = getAuthState();
  const next = auth.status === "authenticated" ? auth.session.userId : undefined;

  if (next === account) {
    // Same player, possibly a rotated token. Open channels need to hear about it.
    if (next && client) void client.setAuth().catch(() => undefined);
    return;
  }
  dropUserChannel();
  account = next;
  if (!next) return;

  const realtime = await loadClient();
  // Signed out or switched account while the client loaded.
  if (!realtime || account !== next) return;
  await realtime.setAuth().catch(() => undefined);

  const channel = realtime.channel(`dm:user:${next}`, { config: { private: true } });
  userChannel = channel;
  channel
    .on("broadcast", { event: "changed" }, (message: { payload?: unknown }) => {
      const payload = (message.payload ?? {}) as { conversation_id?: unknown; kind?: unknown };
      emit({
        conversationId: typeof payload.conversation_id === "string" ? payload.conversation_id : "",
        kind: typeof payload.kind === "string" ? payload.kind : "",
      });
    })
    .subscribe((status: string) => {
      if (userChannel !== channel) return;
      if (status === "SUBSCRIBED") {
        setLive(true);
        // Signals sent while the socket was down are gone, so everyone re-reads.
        emit({ conversationId: "", kind: "resync" });
      } else {
        setLive(false);
      }
    });
}

/** Starts following the session. Safe to call from every component that wants it. */
export function startRealtime(): void {
  if (typeof window === "undefined" || watching) return;
  watching = true;
  subscribeToAuth(() => void sync());
  void sync();
}

/**
 * Typing indicators for one chat. `onTyping` fires when the other player is typing;
 * the returned `send` says this player is. Sending before the channel has joined does
 * nothing, because an indicator is only worth anything right now.
 */
export function joinTypingChannel(
  conversationId: string,
  onTyping: () => void,
): { send: () => void; leave: () => void } {
  let channel: RealtimeChannel | undefined;
  let joined = false;
  let left = false;

  void loadClient().then((realtime) => {
    if (!realtime || left) return;
    channel = realtime.channel(`dm:conv:${conversationId}`, {
      config: { private: true, broadcast: { self: false } },
    });
    channel
      .on("broadcast", { event: "typing" }, () => onTyping())
      .subscribe((status: string) => {
        joined = status === "SUBSCRIBED";
      });
  });

  return {
    send: () => {
      if (!joined || !channel) return;
      void channel.send({ type: "broadcast", event: "typing", payload: {} }).catch(() => undefined);
    },
    leave: () => {
      left = true;
      joined = false;
      if (channel && client) void client.removeChannel(channel);
    },
  };
}
