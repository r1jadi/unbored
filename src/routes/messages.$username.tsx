import { ReportDialog } from "@/components/social/ReportDialog";
import { usePlatformSettings } from "@/lib/platform-settings";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCheck,
  Hand,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  RotateCw,
  Send,
  Swords,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  Page,
  PageHeader,
  UserAvatar,
} from "@/components/common";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CalloutCard } from "@/components/messages/CalloutCard";
import { CalloutDialog } from "@/components/messages/CalloutDialog";
import { ChatWallpaper } from "@/components/messages/ChatWallpaper";
import { SharedGameCard } from "@/components/messages/SharedGameCard";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth/session";
import { shortDate } from "@/lib/format";
import {
  clearConversation,
  MAX_MESSAGE_LENGTH,
  sameRun,
  useThread,
  type ChatMessage,
} from "@/lib/messages/store";
import { useCallouts } from "@/lib/messages/callouts";
import { ownPath, sharedGameSlug } from "@/lib/messages/shared-links";
import { seo } from "@/lib/seo";
import { blockUsername } from "@/lib/settings/blocked";
import { t } from "@/lib/settings/language";
import { fetchProfileByUsername, type PublicProfile } from "@/lib/social/follows";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/messages/$username")({
  head: ({ params }) =>
    seo(
      t("Chat with @{username}", { username: params.username }),
      t("Your direct messages on Unbored."),
    ),
  component: Conversation,
});

/** Fills the space above the phone's navigation bar, so the composer stays on screen. */
const FRAME =
  "mx-auto flex h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] w-full max-w-3xl flex-col md:h-dvh md:px-8";

function Conversation() {
  const { username } = Route.useParams();
  const auth = useAuth();
  const [profile, setProfile] = useState<
    | { status: "loading" }
    | { status: "ready"; profile: PublicProfile }
    | { status: "missing" }
    | { status: "error" }
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setProfile({ status: "loading" });
    fetchProfileByUsername(username)
      .then((found) => {
        if (!cancelled) {
          setProfile(found ? { status: "ready", profile: found } : { status: "missing" });
        }
      })
      .catch(() => {
        if (!cancelled) setProfile({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [username, attempt]);

  const heading = `@${username}`;

  if (auth.status === "anonymous") {
    return (
      <Page>
        <PageHeader back title={heading} />
        <EmptyState
          icon={MessageCircle}
          title={t("Sign in to send messages")}
          body={t("Chat with other players once you're signed in.")}
          action={
            <Button asChild>
              <Link to="/login" search={{ redirect: `/messages/${username}` }}>
                {t("Log in")}
              </Link>
            </Button>
          }
        />
      </Page>
    );
  }

  if (profile.status === "missing") {
    return (
      <Page>
        <PageHeader back title={heading} />
        <EmptyState
          title={t("That account could not be found.")}
          action={
            <Button asChild variant="secondary">
              <Link to="/messages">{t("Back to messages")}</Link>
            </Button>
          }
        />
      </Page>
    );
  }

  if (profile.status === "error") {
    return (
      <Page>
        <PageHeader back title={heading} />
        <ErrorState onRetry={() => setAttempt((n) => n + 1)} />
      </Page>
    );
  }

  if (profile.status === "loading" || auth.status !== "authenticated") {
    return (
      <Page>
        <PageHeader back title={heading} />
        <ListSkeleton rows={4} />
      </Page>
    );
  }

  return <Thread key={profile.profile.id} other={profile.profile} />;
}

function Thread({ other }: { other: PublicProfile }) {
  const navigate = useNavigate();
  const { state, account, send, retrySend, discard, unsend, notifyTyping, loadOlder, retry } =
    useThread(other.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmUnsend, setConfirmUnsend] = useState<string>();
  const [callingOut, setCallingOut] = useState(false);
  const {
    callouts,
    rivalry,
    refresh: refreshCallouts,
  } = useCallouts(state.conversationId, other.id);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // Set just before older messages load, to hold the reader's place when they arrive.
  const heightBeforeOlder = useRef<number | null>(null);

  const itemCount = state.messages.length + state.pending.length;
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (heightBeforeOlder.current !== null) {
      element.scrollTop += element.scrollHeight - heightBeforeOlder.current;
      heightBeforeOlder.current = null;
    } else if (stickToBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [itemCount, state.status, state.otherTyping]);

  function onScroll() {
    const element = scroller.current;
    if (!element) return;
    stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  }

  const platform = usePlatformSettings();
  const [reporting, setReporting] = useState(false);

  function onSend(text: string) {
    stickToBottom.current = true;
    send(text);
  }

  function older() {
    heightBeforeOlder.current = scroller.current?.scrollHeight ?? null;
    void loadOlder();
  }

  async function block() {
    try {
      await blockUsername(other.username);
      toast.success(t("Blocked @{username}", { username: other.username }));
      void navigate({ to: "/messages" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Couldn't block this account."));
    }
  }

  async function deleteChat() {
    if (!state.conversationId) return;
    try {
      await clearConversation(state.conversationId);
      void navigate({ to: "/messages" });
    } catch {
      toast.error(t("Couldn't delete this chat. Try again."));
    }
  }

  const hasRivalry = rivalry !== null && rivalry.myWins + rivalry.theirWins + rivalry.draws > 0;

  // The last of my messages the other player has reached.
  const seenId =
    state.theirLastReadAt === null
      ? undefined
      : [...state.messages]
          .reverse()
          .find(
            (m) =>
              m.senderId === account &&
              !m.calloutId &&
              new Date(m.createdAt).getTime() <= new Date(state.theirLastReadAt!).getTime(),
          )?.id;

  return (
    <div className={FRAME}>
      <ReportDialog
        open={reporting}
        onOpenChange={setReporting}
        kind="profile"
        targetId={other.id}
        subject={`@${other.username}`}
        includeMessages
      />
      <header className="z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-2 pt-[env(safe-area-inset-top)] backdrop-blur-xl box-content md:mt-4 md:rounded-t-2xl md:border md:px-2">
        <Button asChild variant="ghost" size="icon" aria-label={t("Back to messages")}>
          <Link to="/messages">
            <ArrowLeft />
          </Link>
        </Button>
        <Link
          to="/u/$username"
          params={{ username: other.username }}
          className="flex min-w-0 flex-1 items-center gap-2.5"
        >
          <span className="dm-gradient inline-flex shrink-0 rounded-full p-[2px]">
            <span className="inline-flex rounded-full bg-background p-[1px]">
              <UserAvatar username={other.username} path={other.avatar_path} size="sm" />
            </span>
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{other.display_name}</span>
            {hasRivalry ? (
              <span className="flex items-center gap-1 text-xs font-medium tabular text-primary">
                <Swords className="size-3" aria-hidden />
                {t("You {mine} – {theirs}", {
                  mine: rivalry!.myWins,
                  theirs: rivalry!.theirWins,
                })}
              </span>
            ) : (
              <span className="block truncate text-xs text-muted-foreground">
                @{other.username}
              </span>
            )}
          </span>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("More")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setReporting(true)}>{t("Report")}</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => void block()}>
              {t("Block")}
            </DropdownMenuItem>
            {state.conversationId && state.messages.length > 0 && (
              <DropdownMenuItem className="text-destructive" onClick={() => setConfirmDelete(true)}>
                {t("Delete chat")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden md:border-x md:border-border">
        <ChatWallpaper ids={[account ?? "", other.id]} />
        <div
          ref={scroller}
          onScroll={onScroll}
          className="relative h-full overflow-y-auto overscroll-contain px-3 py-4 md:px-4"
          role="log"
          aria-label={t("Messages")}
        >
          {state.status === "loading" && <ListSkeleton rows={4} />}
          {state.status === "error" && (
            <ErrorState title={t("Couldn't load this chat")} body={state.error} onRetry={retry} />
          )}
          {state.status === "ready" && state.canSend && itemCount === 0 && (
            <div className="enter flex flex-col items-center px-4 py-14 text-center">
              <span className="dm-gradient flex size-16 items-center justify-center rounded-3xl text-primary-foreground">
                <Hand className="size-7" aria-hidden />
              </span>
              <p className="mt-4 text-lg font-bold">
                {t("Say hello to @{username}", { username: other.username })}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("Your messages are private to the two of you.")}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full"
                  onClick={() => onSend(t("Hey! 👋"))}
                >
                  {t("Hey! 👋")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full"
                  onClick={() => onSend(t("Up for a game? 🎮"))}
                >
                  {t("Up for a game? 🎮")}
                </Button>
                <Button
                  size="sm"
                  className="dm-gradient rounded-full"
                  onClick={() => setCallingOut(true)}
                >
                  <Swords /> {t("Call them out")}
                </Button>
              </div>
            </div>
          )}
          {state.status === "ready" && state.hasMore && (
            <div className="flex justify-center pb-4">
              <Button variant="secondary" size="sm" disabled={state.loadingOlder} onClick={older}>
                {state.loadingOlder && <Loader2 className="animate-spin" />}
                {t("Load earlier messages")}
              </Button>
            </div>
          )}
          <ol className="flex flex-col">
            {state.messages.map((message, index) => (
              <Fragment key={message.id}>
                <DayLine message={message} previous={state.messages[index - 1]} />
                {message.calloutId ? (
                  callouts.get(message.calloutId) && (
                    <CalloutCard
                      callout={callouts.get(message.calloutId)!}
                      me={account}
                      username={other.username}
                      otherId={other.id}
                      onChanged={() => void refreshCallouts()}
                    />
                  )
                ) : (
                  <Bubble
                    mine={message.senderId === account}
                    body={message.body}
                    first={!sameRun(state.messages[index - 1], message)}
                    last={!sameRun(message, state.messages[index + 1]) || message.id === seenId}
                    avatar={
                      <UserAvatar
                        username={other.username}
                        path={other.avatar_path}
                        size="sm"
                        className="size-6 text-[9px]"
                      />
                    }
                    onUnsend={
                      message.senderId === account ? () => setConfirmUnsend(message.id) : undefined
                    }
                    caption={
                      <>
                        {clock(message.createdAt)}
                        {message.id === seenId && (
                          <span className="ml-1 inline-flex items-center gap-0.5 font-medium text-primary">
                            <CheckCheck className="size-3" aria-hidden />
                            {t("Seen")}
                          </span>
                        )}
                      </>
                    }
                  />
                )}
              </Fragment>
            ))}
            {state.pending.map((item) => (
              <Bubble
                key={item.clientId}
                mine
                first
                last
                faded={item.status === "sending"}
                body={item.body}
                caption={
                  item.status === "sending" ? (
                    t("Sending…")
                  ) : (
                    <span className="text-destructive">
                      {t("Not sent.")}{" "}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
                        onClick={() => retrySend(item.clientId)}
                      >
                        <RotateCw className="size-3" aria-hidden />
                        {t("Retry")}
                      </button>{" "}
                      <button
                        type="button"
                        className="font-medium underline underline-offset-2"
                        onClick={() => discard(item.clientId)}
                      >
                        {t("Discard")}
                      </button>
                    </span>
                  )
                }
              />
            ))}
            {state.otherTyping && (
              <li className="mt-1 flex items-end gap-1.5" role="status">
                <UserAvatar
                  username={other.username}
                  path={other.avatar_path}
                  size="sm"
                  className="size-6 text-[9px]"
                />
                <span
                  className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-surface-2 px-3.5 py-3"
                  aria-label={t("@{username} is typing", { username: other.username })}
                >
                  <span className="dm-typing-dot size-1.5 rounded-full bg-muted-foreground" />
                  <span className="dm-typing-dot size-1.5 rounded-full bg-muted-foreground [animation-delay:150ms]" />
                  <span className="dm-typing-dot size-1.5 rounded-full bg-muted-foreground [animation-delay:300ms]" />
                </span>
              </li>
            )}
          </ol>
        </div>
      </div>

      {state.notice && (
        <p className="shrink-0 px-4 pb-2 text-sm text-destructive md:px-1" role="alert">
          {state.notice}
        </p>
      )}
      {state.status === "ready" &&
        (!platform.messagesEnabled ? (
          <div className="shrink-0 border-t border-border px-4 py-4 text-center text-sm text-muted-foreground">
            {t("Messages are paused for now. You can still read your chats.")}
          </div>
        ) : state.canSend ? (
          <Composer onSend={onSend} onTyping={notifyTyping} onCallOut={() => setCallingOut(true)} />
        ) : (
          <div className="shrink-0 border-t border-border px-4 py-4 text-center text-sm text-muted-foreground">
            <p>{t("You can't message this account.")}</p>
            <p className="mt-1 text-xs">
              {t("Most players only accept messages from friends: people who follow each other.")}
            </p>
          </div>
        ))}

      <CalloutDialog
        open={callingOut}
        onOpenChange={setCallingOut}
        opponentId={other.id}
        username={other.username}
        onCreated={() => void refreshCallouts()}
      />

      <AlertDialog
        open={confirmUnsend !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirmUnsend(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Unsend this message?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("It's removed for both of you, and this can't be undone.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmUnsend) void unsend(confirmUnsend);
              }}
            >
              {t("Unsend")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete this chat?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "It's removed for you only. @{username} keeps their copy, and a new message starts the chat again.",
                { username: other.username },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteChat()}>{t("Delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function clock(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** A date between two messages sent on different days, in the reader's time zone. */
function DayLine({ message, previous }: { message: ChatMessage; previous?: ChatMessage }) {
  const date = new Date(message.createdAt);
  const day = date.toDateString();
  if (previous && new Date(previous.createdAt).toDateString() === day) return null;
  const now = new Date();
  const label =
    day === now.toDateString()
      ? t("Today")
      : shortDate(date, date.getFullYear() !== now.getFullYear());
  return (
    <li className="flex justify-center py-3">
      <span className="rounded-full border border-border bg-background/80 px-3 py-0.5 text-[11px] font-medium text-muted-foreground backdrop-blur">
        {label}
      </span>
    </li>
  );
}

function Bubble({
  mine,
  body,
  caption,
  faded,
  onUnsend,
  first,
  last,
  avatar,
}: {
  mine: boolean;
  body: string;
  caption: ReactNode;
  faded?: boolean;
  onUnsend?: () => void;
  /** Where this sits in a run from one sender: the corners and the gaps follow from it. */
  first: boolean;
  last: boolean;
  /** Beside the last message of the other player's run. */
  avatar?: ReactNode;
}) {
  const gameSlug = sharedGameSlug(body);
  const text = (
    <p
      className={cn(
        "min-w-0 rounded-2xl px-3.5 py-2 text-sm break-words whitespace-pre-wrap [overflow-wrap:anywhere]",
        mine
          ? cn("dm-gradient text-primary-foreground", !first && "rounded-tr-md", "rounded-br-md")
          : cn("bg-surface-2 text-foreground", !first && "rounded-tl-md", "rounded-bl-md"),
        faded && "opacity-60",
      )}
    >
      <MessageText body={body} />
    </p>
  );
  return (
    <li
      className={cn(
        "flex flex-col",
        mine ? "items-end" : "enter items-start",
        first ? "mt-2" : "mt-0.5",
      )}
    >
      {/* Focusable so a tap on a phone, which has no hover, brings up the options. */}
      <div
        tabIndex={onUnsend ? -1 : undefined}
        className="group flex max-w-[85%] items-end gap-1.5 outline-none"
      >
        {!mine && <span className="size-6 shrink-0">{last && avatar}</span>}
        {onUnsend && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("Message options")}
                className="size-7 shrink-0 self-center text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-destructive" onClick={onUnsend}>
                {t("Unsend")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {gameSlug ? <SharedGameCard slug={gameSlug} fallback={text} /> : text}
      </div>
      {last && (
        <span
          className={cn(
            "mt-0.5 flex items-center px-1 text-[11px] text-muted-foreground",
            !mine && "ml-7",
          )}
        >
          {caption}
        </span>
      )}
    </li>
  );
}

/**
 * Plain text, except links to Unbored itself: a profile someone shared should open, but a
 * chat from a stranger must not be a way to deliver a phishing link.
 */
function MessageText({ body }: { body: string }) {
  return (
    <>
      {body.split(/(https?:\/\/\S+)/g).map((part, index) => {
        const path = index % 2 === 1 ? ownPath(part) : null;
        return path === null ? (
          <Fragment key={index}>{part}</Fragment>
        ) : (
          <a key={index} href={path} className="underline underline-offset-2">
            {part}
          </a>
        );
      })}
    </>
  );
}

function Composer({
  onSend,
  onTyping,
  onCallOut,
}: {
  onSend: (text: string) => void;
  onTyping: () => void;
  onCallOut: () => void;
}) {
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const tooLong = text.trim().length > MAX_MESSAGE_LENGTH;
  const canSubmit = text.trim() !== "" && !tooLong;

  // Grows with the text, up to the limit in its class, then scrolls.
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    // `scrollHeight` leaves out the border, which would leave one line just too short.
    element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
  }, [text]);

  function submit() {
    if (!canSubmit) return;
    onSend(text);
    setText("");
    input.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // On a phone, Return is a new line and the button sends. Mid-composition, Enter
    // belongs to the keyboard's input method.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    event.preventDefault();
    submit();
  }

  return (
    <form
      className="shrink-0 bg-background px-3 py-2.5 md:rounded-b-2xl md:border md:border-border"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex items-end gap-1 rounded-3xl border border-border bg-surface p-1 transition-colors focus-within:border-primary/60">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-full text-primary"
          aria-label={t("Call out")}
          title={t("Call out")}
          onClick={onCallOut}
        >
          <Swords />
        </Button>
        <Textarea
          ref={input}
          rows={1}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (event.target.value.trim() !== "") onTyping();
          }}
          onKeyDown={onKeyDown}
          placeholder={t("Write a message")}
          aria-label={t("Write a message")}
          aria-invalid={tooLong || undefined}
          className="max-h-36 min-h-9 min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!canSubmit}
          aria-label={t("Send")}
          className={cn(
            "size-9 shrink-0 rounded-full transition-transform",
            canSubmit ? "dm-gradient scale-100" : "scale-90 bg-surface-2 text-muted-foreground",
          )}
        >
          <Send />
        </Button>
      </div>
      {text.length > MAX_MESSAGE_LENGTH - 200 && (
        <p
          className={cn(
            "mt-1 px-3 text-right text-xs tabular",
            tooLong ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {text.trim().length} / {MAX_MESSAGE_LENGTH}
        </p>
      )}
    </form>
  );
}
