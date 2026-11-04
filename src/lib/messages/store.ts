/**
 * Direct messages, through the Supabase Data API like follows and notifications.
 *
 * Reads run under RLS with the caller's token. Every write is a function that takes
 * the sender from that token (`supabase/migrations/20261215120100_direct_messages.sql`),
 * so nothing here can name who is acting.
 *
 * Updates arrive live: the database signals that a chat changed (`./realtime.ts`,
 * ADR 0014) and this reads the newest page. The signal carries no text, so every read
 * still goes through RLS. Polling stays as the safety net, slow while the socket is up
 * and fast while it isn't, so messages still arrive if Realtime is down.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ApiError } from "@/lib/api/client";
import {
  getAccessToken,
  getAuthState,
  rotateRefusedSession,
  subscribe as subscribeToAuth,
} from "@/lib/auth/session";
import {
  isLive,
  joinTypingChannel,
  startRealtime,
  subscribeLive,
  subscribeSignals,
} from "@/lib/messages/realtime";
import { t } from "@/lib/settings/language";
import { restGet, restMutate, SupabaseRestError } from "@/lib/supabase/rest";

/** The database's limit on one message. */
export const MAX_MESSAGE_LENGTH = 2000;

const PAGE_SIZE = 50;
const THREAD_POLL_MS = 4_000;
const INBOX_POLL_MS = 10_000;
const BADGE_POLL_MS = 30_000;
/** With the socket up, polling only catches what a dropped signal might have missed. */
const SLOW_POLL_MS = 60_000;
/** How long "typing…" stays up after the last signal. */
const TYPING_SHOWN_MS = 4_000;
const TYPING_THROTTLE_MS = 2_000;

export type InboxEntry = {
  conversationId: string;
  otherId: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  lastBody: string;
  lastSenderId: string;
  lastAt: string;
  unreadCount: number;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  /** This message is a callout's card, not text. */
  calloutId?: string | null;
};

/** The body a callout's card is stored with, which the inbox shows as a word. */
export const CALLOUT_BODY = "⚔️";

/** A message this device is sending, or failed to send. Its id doubles as the client id. */
export type PendingMessage = {
  clientId: string;
  body: string;
  status: "sending" | "failed";
};

export type SendOutcome = "sent" | "invalid" | "suspended" | "rate_limited" | "not_allowed";

type InboxRow = {
  conversation_id: string;
  other_id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  last_body: string;
  last_sender_id: string;
  last_at: string;
  unread_count: number;
};

type MessageRow = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  challenge_id: string | null;
};

type ThreadRow = {
  conversation_id: string | null;
  can_send: boolean;
  their_last_read_at: string | null;
};

type SendRow = {
  outcome: SendOutcome;
  message_id: string | null;
  conversation_id: string | null;
  sent_at: string | null;
};

function unauthorised(): ApiError {
  return new ApiError(t("Sign in to use messages."), { code: "unauthorized", status: 401 });
}

/** Runs a call with the caller's token, rotating a lapsed one once. */
async function withToken<T>(operation: (token: string) => Promise<T>): Promise<T> {
  const token = getAccessToken();
  if (!token || getAuthState().status !== "authenticated") throw unauthorised();
  try {
    return await operation(token);
  } catch (error) {
    if (!(error instanceof SupabaseRestError) || error.status !== 401) throw error;
    const outcome = await rotateRefusedSession();
    const refreshed = getAccessToken();
    if (outcome !== "rotated" || !refreshed) throw unauthorised();
    return operation(refreshed);
  }
}

export function rpc<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  return withToken((token) =>
    restGet<T>(`rpc/${name}`, token, { method: "POST", body: JSON.stringify(body) }),
  );
}

/** For functions that return nothing: PostgREST answers those with an empty body. */
function rpcVoid(name: string, body: Record<string, unknown>): Promise<void> {
  return withToken(async (token) => {
    await restMutate(`rpc/${name}`, "POST", token, body);
  });
}

function toEntry(row: InboxRow): InboxEntry {
  return {
    conversationId: row.conversation_id,
    otherId: row.other_id,
    username: row.username,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    lastBody: row.last_body,
    lastSenderId: row.last_sender_id,
    lastAt: row.last_at,
    unreadCount: row.unread_count,
  };
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
    calloutId: row.challenge_id,
  };
}

export async function fetchInbox(): Promise<InboxEntry[]> {
  return (await rpc<InboxRow[]>("direct_inbox")).map(toEntry);
}

export function fetchUnreadChats(): Promise<number> {
  return rpc<number>("direct_unread_total");
}

/** One page, oldest first. `before` asks for the page older than that message. */
export async function fetchMessages(
  conversationId: string,
  before?: ChatMessage,
): Promise<ChatMessage[]> {
  const older = before ? `&created_at=lt.${encodeURIComponent(before.createdAt)}` : "";
  const rows = await withToken((token) =>
    restGet<MessageRow[]>(
      `messages?conversation_id=eq.${encodeURIComponent(conversationId)}${older}` +
        `&select=id,sender_id,body,created_at,challenge_id&order=created_at.desc,id.desc&limit=${PAGE_SIZE}`,
      token,
    ),
  );
  return rows.map(toMessage).reverse();
}

export async function fetchThread(otherId: string): Promise<{
  conversationId: string | null;
  canSend: boolean;
  theirLastReadAt: string | null;
}> {
  const rows = await rpc<ThreadRow[]>("direct_thread", { p_other: otherId });
  const row = rows[0];
  return {
    conversationId: row?.conversation_id ?? null,
    canSend: row?.can_send ?? false,
    theirLastReadAt: row?.their_last_read_at ?? null,
  };
}

export async function sendMessage(
  recipientId: string,
  body: string,
  clientId: string,
): Promise<{ outcome: SendOutcome; message?: ChatMessage; conversationId?: string }> {
  const rows = await rpc<SendRow[]>("send_direct_message", {
    p_recipient: recipientId,
    p_body: body,
    p_client_id: clientId,
  });
  const row = rows[0];
  if (!row) throw new ApiError(t("Couldn't send your message."), { code: "send_failed" });
  if (row.outcome !== "sent" || !row.message_id || !row.sent_at || !row.conversation_id) {
    return { outcome: row.outcome };
  }
  return {
    outcome: "sent",
    conversationId: row.conversation_id,
    message: {
      id: row.message_id,
      senderId: sessionUser(),
      body: body.trim(),
      createdAt: row.sent_at,
    },
  };
}

function sessionUser(): string {
  const auth = getAuthState();
  return auth.status === "authenticated" ? auth.session.userId : "";
}

export async function markConversationRead(conversationId: string): Promise<void> {
  await rpcVoid("mark_conversation_read", { p_conversation: conversationId });
  announceUnreadChange();
}

/** Deletes the chat for this player only. The other player keeps their copy. */
export async function clearConversation(conversationId: string): Promise<void> {
  await rpcVoid("clear_conversation", { p_conversation: conversationId });
  announceUnreadChange();
}

/** Takes back one of this player's own messages, for both players. */
export async function unsendMessage(messageId: string): Promise<void> {
  const removed = await rpc<boolean>("unsend_direct_message", { p_message: messageId });
  if (!removed)
    throw new ApiError(t("Couldn't unsend this message. Try again."), { code: "unsend_failed" });
  announceUnreadChange();
}

/** A real report row for the moderators' queue. It names the account, not the chat. */
export async function reportConversationPartner(userId: string): Promise<void> {
  const reporter = sessionUser();
  if (!reporter) throw unauthorised();
  await withToken((token) =>
    restMutate("reports", "POST", token, {
      reporter_id: reporter,
      target_kind: "profile",
      target_id: userId,
      reason: "Direct messages",
    }),
  );
}

// Badges listen here, so reading a chat clears them straight away.
const unreadListeners = new Set<() => void>();

function announceUnreadChange(): void {
  unreadListeners.forEach((listener) => listener());
}

/** Whether the live connection is up. While it isn't, polling takes over at full speed. */
function useLive(): boolean {
  return useSyncExternalStore(subscribeLive, isLive, () => false);
}

/**
 * The safety net: reads on an interval and on returning to the tab, only while visible.
 * With the socket up this is slow, and only there to catch something missed.
 */
function useVisiblePolling(tick: () => void, intervalMs: number): void {
  const latest = useRef(tick);
  latest.current = tick;
  useEffect(() => {
    const run = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    const timer = window.setInterval(run, intervalMs);
    document.addEventListener("visibilitychange", run);
    window.addEventListener("focus", run);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("focus", run);
    };
  }, [intervalMs]);
}

/** The signed-in account, kept current across sign-in and sign-out. */
function useAccount(): string | undefined {
  const [account, setAccount] = useState<string | undefined>(() => sessionUser() || undefined);
  useEffect(() => {
    const update = () => setAccount(sessionUser() || undefined);
    update();
    return subscribeToAuth(update);
  }, []);
  return account;
}

/**
 * How many chats have something unread. `null` is "not known": signed out, not read
 * yet, or a failed first read. A later failure keeps the last known number, so a
 * network blip doesn't make the badge blink.
 *
 * The app shell always mounts this, which makes it what opens the live connection.
 */
export function useUnreadChats(): number | null {
  const account = useAccount();
  const live = useLive();
  const [count, setCount] = useState<number | null>(null);

  const read = useCallback(() => {
    if (!sessionUser()) return;
    fetchUnreadChats()
      .then(setCount)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    startRealtime();
    setCount(null);
    if (!account) return;
    read();
    unreadListeners.add(read);
    const unsubscribe = subscribeSignals(read);
    return () => {
      unreadListeners.delete(read);
      unsubscribe();
    };
  }, [account, read]);

  useVisiblePolling(read, live ? SLOW_POLL_MS : BADGE_POLL_MS);
  return account ? count : null;
}

export type InboxState =
  | { status: "anonymous" }
  | { status: "loading" }
  | { status: "ready"; entries: InboxEntry[] }
  | { status: "error"; message: string };

export function useInbox(): { state: InboxState; retry: () => void; remove: (id: string) => void } {
  const account = useAccount();
  const live = useLive();
  const [state, setState] = useState<InboxState>(() =>
    sessionUser() ? { status: "loading" } : { status: "anonymous" },
  );
  // Only the newest read counts, however the answers arrive.
  const sequence = useRef(0);

  const read = useCallback((background: boolean) => {
    if (!sessionUser()) return;
    const mine = ++sequence.current;
    if (!background) setState({ status: "loading" });
    fetchInbox()
      .then((entries) => {
        if (mine === sequence.current) setState({ status: "ready", entries });
      })
      .catch((error: unknown) => {
        if (mine !== sequence.current) return;
        // A background read that fails keeps what is on screen. Only a first read
        // shows the error.
        setState((current) =>
          background && current.status === "ready"
            ? current
            : {
                status: "error",
                message:
                  error instanceof ApiError
                    ? error.message
                    : t("Check your connection and try again."),
              },
        );
      });
  }, []);

  useEffect(() => {
    if (!account) {
      setState({ status: "anonymous" });
      return;
    }
    read(false);
    return subscribeSignals(() => read(true));
  }, [account, read]);

  useVisiblePolling(() => read(true), live ? SLOW_POLL_MS : INBOX_POLL_MS);

  const retry = useCallback(() => read(false), [read]);
  const remove = useCallback((id: string) => {
    setState((current) =>
      current.status === "ready"
        ? { ...current, entries: current.entries.filter((e) => e.conversationId !== id) }
        : current,
    );
  }, []);
  return { state, retry, remove };
}

function timeOf(message: ChatMessage): number {
  return new Date(message.createdAt).getTime();
}

const RUN_GAP_MS = 3 * 60_000;

/** Whether two neighbouring messages read as one run: same sender, same moment, both text. */
export function sameRun(a: ChatMessage | undefined, b: ChatMessage | undefined): boolean {
  if (!a || !b || a.senderId !== b.senderId || a.calloutId || b.calloutId) return false;
  return Math.abs(timeOf(b) - timeOf(a)) <= RUN_GAP_MS;
}

/** Merges by id, oldest first. Ties on time fall back to the id, as the database orders them. */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => timeOf(a) - timeOf(b) || a.id.localeCompare(b.id));
}

/**
 * Folds the newest page into what is on screen. The page is the truth for the stretch
 * it covers, so a message held there but missing from it was unsent and goes. Anything
 * older was loaded by "load earlier" and stays. When a full page doesn't reach back to
 * anything held, messages in between were never read: keeping both would show a silent
 * gap, so the older ones go too and "load earlier" fetches them again.
 */
export function applyNewestPage(
  current: ChatMessage[],
  page: ChatMessage[],
): { messages: ChatMessage[]; truncated: boolean } {
  // A short page is the whole chat.
  if (page.length < PAGE_SIZE) return { messages: page, truncated: false };
  const held = new Set(current.map((message) => message.id));
  if (current.length > 0 && !page.some((message) => held.has(message.id))) {
    return { messages: page, truncated: true };
  }
  const floor = timeOf(page[0]!);
  const older = current.filter((message) => timeOf(message) < floor);
  return { messages: mergeMessages(older, page), truncated: false };
}

export type ThreadState = {
  status: "loading" | "ready" | "error";
  error?: string;
  conversationId: string | null;
  canSend: boolean;
  theirLastReadAt: string | null;
  messages: ChatMessage[];
  pending: PendingMessage[];
  hasMore: boolean;
  loadingOlder: boolean;
  /** The other player is typing right now. */
  otherTyping: boolean;
  /** Why the last send was refused, for a line above the composer. */
  notice?: string;
};

const initialThread: ThreadState = {
  status: "loading",
  conversationId: null,
  canSend: false,
  theirLastReadAt: null,
  messages: [],
  pending: [],
  hasMore: false,
  loadingOlder: false,
  otherTyping: false,
};

export function refusal(outcome: SendOutcome): string {
  switch (outcome) {
    case "rate_limited":
      return t("You're sending messages too quickly. Wait a moment and try again.");
    case "suspended":
      return t("Your account is suspended, so you can't send messages.");
    case "invalid":
      return t("That message can't be sent.");
    default:
      return t("You can't message this account.");
  }
}

function newClientId(): string {
  return crypto.randomUUID();
}

/** One chat: its messages, what is being sent, and how far the other player has read. */
export function useThread(otherId: string | undefined) {
  const account = useAccount();
  const live = useLive();
  const [state, setState] = useState<ThreadState>(initialThread);
  const lastMarked = useRef<string | undefined>(undefined);
  // Guards against a slow read from a previous chat landing in this one.
  const generation = useRef(0);
  // Only the newest read counts: an older answer could bring back an unsent message
  // or lose one just sent.
  const sequence = useRef(0);
  const typingChannel = useRef<{ send: () => void; leave: () => void } | undefined>(undefined);
  const typingTimer = useRef<number | undefined>(undefined);
  const lastTypingSent = useRef(0);

  const refresh = useCallback(
    async (background: boolean) => {
      if (!otherId || !sessionUser()) return;
      const chat = generation.current;
      const mine = ++sequence.current;
      try {
        const thread = await fetchThread(otherId);
        const page = thread.conversationId ? await fetchMessages(thread.conversationId) : [];
        if (chat !== generation.current || mine !== sequence.current) return;
        setState((current) => {
          const { messages, truncated } = applyNewestPage(current.messages, page);
          const hasIncoming = messages.length > current.messages.length;
          return {
            ...current,
            status: "ready",
            error: undefined,
            conversationId: thread.conversationId,
            canSend: thread.canSend,
            theirLastReadAt: thread.theirLastReadAt,
            messages,
            // A message arriving ends the "typing" that led to it.
            otherTyping: hasIncoming ? false : current.otherTyping,
            hasMore:
              page.length === PAGE_SIZE &&
              (truncated || current.hasMore || current.status === "loading"),
          };
        });
      } catch (error) {
        if (chat !== generation.current || mine !== sequence.current || background) return;
        setState((current) => ({
          ...current,
          status: "error",
          error:
            error instanceof ApiError ? error.message : t("Check your connection and try again."),
        }));
      }
    },
    [otherId],
  );

  useEffect(() => {
    generation.current += 1;
    lastMarked.current = undefined;
    setState(initialThread);
    if (!account) return;
    void refresh(false);
    return subscribeSignals(() => void refresh(true));
  }, [otherId, account, refresh]);

  useVisiblePolling(() => void refresh(true), live ? SLOW_POLL_MS : THREAD_POLL_MS);

  // Seeing an incoming message reads it, but only while someone is looking.
  const newestIncoming = [...state.messages].reverse().find((m) => m.senderId !== account);
  const conversationId = state.conversationId;
  useEffect(() => {
    if (!conversationId || !newestIncoming || lastMarked.current === newestIncoming.id) return;
    const mark = () => {
      if (document.visibilityState !== "visible" || lastMarked.current === newestIncoming.id) {
        return;
      }
      lastMarked.current = newestIncoming.id;
      markConversationRead(conversationId).catch(() => {
        // Left unread on the server, so the next look tries again.
        lastMarked.current = undefined;
      });
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [conversationId, newestIncoming]);

  // Typing indicators need a conversation to belong to, so a first message starts them.
  useEffect(() => {
    if (!conversationId) return;
    const stopShowing = () => {
      window.clearTimeout(typingTimer.current);
      setState((current) => (current.otherTyping ? { ...current, otherTyping: false } : current));
    };
    const channel = joinTypingChannel(conversationId, () => {
      window.clearTimeout(typingTimer.current);
      // The sender repeats while typing, so silence means they stopped.
      typingTimer.current = window.setTimeout(stopShowing, TYPING_SHOWN_MS);
      setState((current) => (current.otherTyping ? current : { ...current, otherTyping: true }));
    });
    typingChannel.current = channel;
    return () => {
      channel.leave();
      typingChannel.current = undefined;
      stopShowing();
    };
  }, [conversationId]);

  /** Tells the other player this one is typing, at most every couple of seconds. */
  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_THROTTLE_MS) return;
    lastTypingSent.current = now;
    typingChannel.current?.send();
  }, []);

  const deliver = useCallback(
    async (clientId: string, body: string) => {
      if (!otherId) return;
      const chat = generation.current;
      setState((current) => ({
        ...current,
        notice: undefined,
        pending: current.pending.map((p) =>
          p.clientId === clientId ? { ...p, status: "sending" as const } : p,
        ),
      }));
      try {
        const result = await sendMessage(otherId, body, clientId);
        if (chat !== generation.current) return;
        if (result.outcome === "sent" && result.message) {
          const message = result.message;
          // Outdates any read already on its way, which can't have seen this message.
          sequence.current += 1;
          lastTypingSent.current = 0;
          setState((current) => ({
            ...current,
            conversationId: result.conversationId ?? current.conversationId,
            messages: mergeMessages(current.messages, [message]),
            pending: current.pending.filter((p) => p.clientId !== clientId),
          }));
          return;
        }
        setState((current) => ({
          ...current,
          notice: refusal(result.outcome),
          canSend: result.outcome === "not_allowed" ? false : current.canSend,
          pending: current.pending.map((p) =>
            p.clientId === clientId ? { ...p, status: "failed" as const } : p,
          ),
        }));
      } catch {
        // The response was lost or the call failed. Retrying reuses this client id, so
        // it can't send twice even if this attempt actually landed.
        if (chat !== generation.current) return;
        setState((current) => ({
          ...current,
          pending: current.pending.map((p) =>
            p.clientId === clientId ? { ...p, status: "failed" as const } : p,
          ),
        }));
      }
    },
    [otherId],
  );

  const send = useCallback(
    (text: string) => {
      const body = text.trim();
      if (body === "" || body.length > MAX_MESSAGE_LENGTH) return;
      const clientId = newClientId();
      setState((current) => ({
        ...current,
        pending: [...current.pending, { clientId, body, status: "sending" }],
      }));
      void deliver(clientId, body);
    },
    [deliver],
  );

  const retrySend = useCallback(
    (clientId: string) => {
      const item = state.pending.find((p) => p.clientId === clientId);
      if (item) void deliver(clientId, item.body);
    },
    [deliver, state.pending],
  );

  const discard = useCallback((clientId: string) => {
    setState((current) => ({
      ...current,
      pending: current.pending.filter((p) => p.clientId !== clientId),
    }));
  }, []);

  /** Takes a message back. It leaves the screen at once and returns if that failed. */
  const unsend = useCallback(
    async (messageId: string) => {
      sequence.current += 1;
      setState((current) => ({
        ...current,
        notice: undefined,
        messages: current.messages.filter((m) => m.id !== messageId),
      }));
      try {
        await unsendMessage(messageId);
      } catch {
        setState((current) => ({
          ...current,
          notice: t("Couldn't unsend this message. Try again."),
        }));
      }
      // Either way, the database says what is true now.
      void refresh(true);
    },
    [refresh],
  );

  const loadOlder = useCallback(async () => {
    const oldest = state.messages[0];
    if (!state.conversationId || !oldest || state.loadingOlder) return;
    const chat = generation.current;
    setState((current) => ({ ...current, loadingOlder: true }));
    try {
      const page = await fetchMessages(state.conversationId, oldest);
      if (chat !== generation.current) return;
      setState((current) => ({
        ...current,
        loadingOlder: false,
        messages: mergeMessages(current.messages, page),
        hasMore: page.length === PAGE_SIZE,
      }));
    } catch {
      if (chat !== generation.current) return;
      setState((current) => ({
        ...current,
        loadingOlder: false,
        notice: t("Couldn't load earlier messages."),
      }));
    }
  }, [state.conversationId, state.loadingOlder, state.messages]);

  const retry = useCallback(() => {
    setState((current) => ({ ...current, status: "loading", error: undefined }));
    void refresh(false);
  }, [refresh]);

  return { state, account, send, retrySend, discard, unsend, notifyTyping, loadOlder, retry };
}
