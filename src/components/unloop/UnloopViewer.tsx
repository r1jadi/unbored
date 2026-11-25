import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Bookmark, ChevronDown, ChevronUp, Clapperboard, Volume2, VolumeX } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { EmptyState, ErrorState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UnloopSlide } from "@/components/unloop/UnloopSlide";
import { UnloopWordmark } from "@/components/unloop/UnloopMarks";
import { ApiError } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/session";
import { t } from "@/lib/settings/language";
import { safeSessionStorage } from "@/lib/storage";
import { UNLOOP_CATEGORIES, unloopCategory, type UnloopCategory } from "@/lib/unloop/categories";
import { setUnloopMark, unloopShareUrl, useUnloopFeed, type UnloopVideo } from "@/lib/unloop/feed";
import { cn } from "@/lib/utils";

export type UnloopChannel = "all" | "saved" | UnloopCategory;

type Marks = Pick<UnloopVideo, "liked" | "likes" | "saved" | "saves">;

const SOUND_KEY = "unbored:unloop:sound";

/**
 * Unloop: one loop at a time, full screen, swiped through like a stack of cards.
 *
 * The feed is its own: it never mixes with For You, and For You never shows a
 * loop. A shared link (`first`) opens on that loop. Likes and saves change at once
 * on screen and are taken back if the database refuses them.
 */
export function UnloopViewer({
  channel,
  first,
  onChannel,
}: {
  channel: UnloopChannel;
  first?: string;
  onChannel: (channel: UnloopChannel) => void;
}) {
  const auth = useAuth();
  const navigate = useNavigate();
  const here = useRouterState({ select: (s) => s.location.href });
  const scroller = useRef<HTMLDivElement>(null);

  const filter = useMemo(
    () => (channel === "saved" ? { saved: true } : channel === "all" ? {} : { category: channel }),
    [channel],
  );
  const feed = useUnloopFeed(filter, first);
  const videos = useMemo(() => {
    const seen = new Set<string>();
    return (feed.data?.pages.flat() ?? []).filter((video) => {
      if (seen.has(video.id)) return false;
      seen.add(video.id);
      return true;
    });
  }, [feed.data]);

  const [marks, setMarks] = useState<Record<string, Marks>>({});
  const shown = useMemo(
    () => videos.map((video) => (marks[video.id] ? { ...video, ...marks[video.id] } : video)),
    [videos, marks],
  );

  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    try {
      if (safeSessionStorage()?.getItem(SOUND_KEY) === "on") setMuted(false);
    } catch {
      // No storage: loops start muted, which is what browsers allow anyway.
    }
  }, []);
  const toggleSound = useCallback(() => {
    setMuted((value) => {
      try {
        safeSessionStorage()?.setItem(SOUND_KEY, value ? "on" : "off");
      } catch {
        // Not remembered; the toggle still works for this visit.
      }
      return !value;
    });
  }, []);

  // A new channel starts at its first loop.
  useEffect(() => {
    setActive(0);
    scroller.current?.scrollTo?.({ top: 0 });
  }, [channel]);

  // Which loop fills the screen: the one most in view.
  useEffect(() => {
    const root = scroller.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const index = Number((entry.target as HTMLElement).dataset["index"]);
            if (Number.isInteger(index)) setActive(index);
          }
        }
      },
      { root, threshold: [0.6] },
    );
    for (const child of root.querySelectorAll("[data-unloop]")) observer.observe(child);
    return () => observer.disconnect();
  }, [shown.length]);

  // Keep a page ahead.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && active >= shown.length - 3) void fetchNextPage();
  }, [active, shown.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // A hidden tab stops the sound.
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const update = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const go = useCallback(
    (step: number) => {
      const root = scroller.current;
      if (!root) return;
      const next = Math.min(Math.max(active + step, 0), shown.length - 1);
      root
        .querySelector<HTMLElement>(`[data-index="${next}"]`)
        ?.scrollIntoView?.({ behavior: "smooth" });
    },
    [active, shown.length],
  );

  const mark = useCallback(
    async (kind: "like" | "save", video: UnloopVideo, on: boolean) => {
      const before: Marks = {
        liked: video.liked,
        likes: video.likes,
        saved: video.saved,
        saves: video.saves,
      };
      const after: Marks =
        kind === "like"
          ? { ...before, liked: on, likes: Math.max(0, before.likes + (on ? 1 : -1)) }
          : { ...before, saved: on, saves: Math.max(0, before.saves + (on ? 1 : -1)) };
      setMarks((all) => ({ ...all, [video.id]: after }));
      try {
        await setUnloopMark(kind, video.id, on);
        if (kind === "save" && on) toast.success(t("Saved. Find it under Saved in Unloop."));
      } catch (error) {
        setMarks((all) => ({ ...all, [video.id]: before }));
        if (error instanceof ApiError && error.code === "unauthorized") {
          void navigate({ to: "/login", search: { redirect: here } });
          return;
        }
        toast.error(error instanceof ApiError ? error.message : t("Something went wrong."));
      }
    },
    [here, navigate],
  );

  const share = useCallback(async (video: UnloopVideo) => {
    const url = unloopShareUrl(video.id);
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: video.title, text: t("Watch this on Unloop"), url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      toast.success(t("Link copied. Paste it anywhere."));
    } catch {
      toast.error(t("Couldn't copy the link."));
    }
  }, []);

  // Keys: up/down or J/K move, space pauses (the slide's own button), M mutes,
  // L likes, S saves.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const current = shown[active];
      switch (event.key) {
        case "ArrowDown":
        case "j":
          event.preventDefault();
          go(1);
          break;
        case "ArrowUp":
        case "k":
          event.preventDefault();
          go(-1);
          break;
        case "m":
          toggleSound();
          break;
        case "l":
          if (current) void mark("like", current, !current.liked);
          break;
        case "s":
          if (current) void mark("save", current, !current.saved);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, go, mark, shown, toggleSound]);

  const current = shown[active];
  const hue = current
    ? unloopCategory(current.category).hue
    : channel !== "all" && channel !== "saved"
      ? unloopCategory(channel).hue
      : 40;
  const savedNeedsAccount = channel === "saved" && auth.status === "anonymous";

  let body: ReactNode;
  if (savedNeedsAccount) {
    body = (
      <Centered>
        <EmptyState
          icon={Bookmark}
          title={t("Your saved loops live here")}
          body={t("Sign in to save loops and come back to them.")}
          action={
            <Button asChild>
              <Link to="/login" search={{ redirect: "/unloop?c=saved" }}>
                {t("Sign in")}
              </Link>
            </Button>
          }
        />
      </Centered>
    );
  } else if (feed.status === "pending") {
    body = <UnloopSkeleton />;
  } else if (feed.status === "error") {
    body = (
      <Centered>
        <ErrorState
          title={t("Couldn't load Unloop")}
          body={feed.error instanceof ApiError ? feed.error.message : undefined}
          onRetry={() => void feed.refetch()}
        />
      </Centered>
    );
  } else if (shown.length === 0) {
    body = (
      <Centered>
        <EmptyState
          icon={channel === "saved" ? Bookmark : Clapperboard}
          title={channel === "saved" ? t("No saved loops yet") : t("Nothing's looping here yet")}
          body={
            channel === "saved"
              ? t("Tap the bookmark on a loop to keep it here.")
              : t("New loops land here as soon as they're published. Try another channel.")
          }
          action={
            channel !== "all" ? (
              <Button variant="secondary" onClick={() => onChannel("all")}>
                {t("Watch all loops")}
              </Button>
            ) : undefined
          }
        />
      </Centered>
    );
  } else {
    body = (
      <>
        {shown.map((video, index) => (
          <UnloopSlide
            key={video.id}
            video={video}
            index={index}
            active={index === active && !hidden}
            near={Math.abs(index - active) <= 1}
            muted={muted}
            upNext={shown[index + 1]}
            onToggleLike={(v, on) => void mark("like", v, on)}
            onToggleSave={(v, on) => void mark("save", v, on)}
            onShare={(v) => void share(v)}
            onPlayingChange={setPlaying}
          />
        ))}
        {!hasNextPage && (
          <div className="flex h-[40dvh] snap-start flex-col items-center justify-center gap-3 pb-24 text-center">
            <UnloopWordmark className="text-2xl" />
            <p className="text-sm text-muted-foreground">
              {t("You've seen every loop here. Fresh ones drop soon.")}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => scroller.current?.scrollTo?.({ top: 0, behavior: "smooth" })}
            >
              {t("Loop back to the start")}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <div
      className="unloop-stage relative min-h-dvh overflow-hidden"
      style={{ "--loop-hue": String(hue) } as CSSProperties}
    >
      {current?.thumbnailUrl && (
        <div
          aria-hidden
          className="unloop-ambient hidden md:block"
          style={{ backgroundImage: `url("${current.thumbnailUrl}")` }}
        />
      )}

      <UnloopHeader
        channel={channel}
        onChannel={onChannel}
        muted={muted}
        onToggleSound={toggleSound}
        playing={playing && !!current}
      />

      <div
        ref={scroller}
        data-unloop-scroller
        className="no-scrollbar relative h-dvh snap-y snap-mandatory overflow-y-auto overscroll-contain"
      >
        {body}
      </div>

      {shown.length > 1 && (
        <div className="absolute top-1/2 right-6 hidden -translate-y-1/2 flex-col gap-3 lg:flex">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={active === 0}
            aria-label={t("Previous loop")}
            className="press flex size-11 items-center justify-center rounded-full glass disabled:opacity-40"
          >
            <ChevronUp className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={active >= shown.length - 1}
            aria-label={t("Next loop")}
            className="press flex size-11 items-center justify-center rounded-full glass disabled:opacity-40"
          >
            <ChevronDown className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}

function UnloopHeader({
  channel,
  onChannel,
  muted,
  onToggleSound,
  playing,
}: {
  channel: UnloopChannel;
  onChannel: (channel: UnloopChannel) => void;
  muted: boolean;
  onToggleSound: () => void;
  playing: boolean;
}) {
  const channels: Array<{
    key: UnloopChannel;
    label: string;
    icon?: (typeof UNLOOP_CATEGORIES)[number]["icon"];
    hue: number;
  }> = [
    { key: "all", label: t("All loops"), hue: 40 },
    ...UNLOOP_CATEGORIES.map((category) => ({
      key: category.slug,
      label: t(category.label),
      icon: category.icon,
      hue: category.hue,
    })),
    { key: "saved", label: t("Saved"), hue: 40 },
  ];
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-20 md:left-60 lg:left-64">
      <div className="pointer-events-auto mx-auto max-w-[460px] pt-[calc(0.75rem+var(--safe-top))] md:pt-9">
        <div className="flex items-center justify-between px-4">
          <span className="text-white drop-shadow">
            <UnloopWordmark playing={playing} />
          </span>
          <button
            type="button"
            onClick={onToggleSound}
            aria-label={muted ? t("Turn sound on") : t("Turn sound off")}
            aria-pressed={!muted}
            className="press flex h-9 items-center gap-1.5 rounded-full bg-black/30 px-3 text-xs font-medium text-white ring-1 ring-white/15 backdrop-blur-md"
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            {muted ? t("Sound off") : t("Sound on")}
          </button>
        </div>
        <nav
          aria-label={t("Unloop channels")}
          className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1"
        >
          {channels.map(({ key, label, icon: Icon, hue }) => (
            <button
              key={key}
              type="button"
              onClick={() => onChannel(key)}
              data-active={channel === key || undefined}
              aria-pressed={channel === key}
              style={{ "--loop-hue": String(hue) } as CSSProperties}
              className="unloop-chip flex shrink-0 items-center gap-1 rounded-full bg-black/30 px-3 py-1.5 text-xs font-medium text-white/75 backdrop-blur-md"
            >
              {Icon && <Icon className="size-3" aria-hidden />}
              {key === "saved" && <Bookmark className="size-3" />}
              {label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-dvh items-center justify-center pt-24">{children}</div>;
}

function UnloopSkeleton() {
  return (
    <div
      className="flex h-dvh items-stretch justify-center md:py-6"
      aria-busy
      aria-label={t("Loading loops")}
    >
      <div className="relative w-full max-w-[460px] overflow-hidden md:rounded-[1.75rem]">
        <Skeleton className="absolute inset-0 rounded-none" />
        <div className="absolute right-3 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] flex flex-col gap-4 md:bottom-8">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="size-12 rounded-full bg-surface-2" />
          ))}
        </div>
        <div className="absolute bottom-[calc(5.25rem+env(safe-area-inset-bottom))] left-4 space-y-2 md:bottom-6">
          <Skeleton className="h-5 w-24 rounded-full bg-surface-2" />
          <Skeleton className="h-6 w-56 bg-surface-2" />
          <Skeleton className="h-4 w-44 bg-surface-2" />
        </div>
      </div>
    </div>
  );
}
