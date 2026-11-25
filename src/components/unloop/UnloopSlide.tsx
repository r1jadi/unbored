import { Bookmark, Heart, Play, Share2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";

import { LoopRing } from "@/components/unloop/UnloopMarks";
import { fmt } from "@/lib/format";
import { t } from "@/lib/settings/language";
import { unloopCategory } from "@/lib/unloop/categories";
import { setRingProgress } from "@/lib/unloop/ring";
import type { UnloopVideo } from "@/lib/unloop/feed";
import { cn } from "@/lib/utils";

const DOUBLE_TAP_MS = 260;

/**
 * One loop, filling the screen.
 *
 *   - Only the active slide plays; its neighbours keep a loaded `<video>` so the
 *     next swipe starts at once, and the rest show their thumbnail.
 *   - Tap pauses and resumes. Double-tap likes (never unlikes), with a burst where
 *     the finger landed.
 *   - The loop ring fills as the video runs; each time it wraps, the counter ticks.
 */
export function UnloopSlide({
  video,
  active,
  near,
  muted,
  index,
  upNext,
  onToggleLike,
  onToggleSave,
  onShare,
  onPlayingChange,
}: {
  video: UnloopVideo;
  active: boolean;
  near: boolean;
  muted: boolean;
  index: number;
  upNext?: UnloopVideo;
  onToggleLike: (video: UnloopVideo, on: boolean) => void;
  onToggleSave: (video: UnloopVideo, on: boolean) => void;
  onShare: (video: UnloopVideo) => void;
  onPlayingChange?: (playing: boolean) => void;
}) {
  const element = useRef<HTMLVideoElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const lastTime = useRef(0);
  const tapTimer = useRef<number | undefined>(undefined);
  const lastTap = useRef(0);

  const [paused, setPaused] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [loops, setLoops] = useState(0);
  const [landscape, setLandscape] = useState(false);
  const [bursts, setBursts] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const [expanded, setExpanded] = useState(false);
  const [popped, setPopped] = useState<"like" | "save" | null>(null);

  const category = unloopCategory(video.category);
  const hue = { "--loop-hue": String(category.hue) } as CSSProperties;

  // Playing follows the slide's place in the feed, and the visitor's pause.
  useEffect(() => {
    const player = element.current;
    if (!player) return;
    if (active && !paused) {
      const attempt = player.play();
      if (attempt && typeof attempt.then === "function") {
        attempt.then(
          () => setBlocked(false),
          // Autoplay refused (low-power mode, a strict browser): show the play button.
          () => setBlocked(true),
        );
      }
    } else {
      player.pause();
    }
  }, [active, paused, near]);

  // Leaving a loop rewinds it, so coming back starts it fresh.
  useEffect(() => {
    if (active) return;
    const player = element.current;
    if (player) player.currentTime = 0;
    lastTime.current = 0;
    setPaused(false);
    setLoops(0);
    setExpanded(false);
    setRingProgress(ring.current, 0);
  }, [active]);

  useEffect(() => {
    if (active) onPlayingChange?.(!paused && !blocked);
  }, [active, paused, blocked, onPlayingChange]);

  // The ring, a frame at a time while this loop is on screen.
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const tick = () => {
      const player = element.current;
      if (player && player.duration > 0) {
        const now = player.currentTime;
        if (now + 0.4 < lastTime.current) setLoops((count) => count + 1);
        lastTime.current = now;
        setRingProgress(ring.current, now / player.duration);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => () => window.clearTimeout(tapTimer.current), []);

  const like = useCallback(
    (on: boolean) => {
      setPopped(on ? "like" : null);
      onToggleLike(video, on);
    },
    [onToggleLike, video],
  );

  function onSurfaceTap(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const now = Date.now();
    const rect = event.currentTarget.getBoundingClientRect();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      window.clearTimeout(tapTimer.current);
      lastTap.current = 0;
      const id = now;
      setBursts((all) => [
        ...all,
        { id, x: event.clientX - rect.left, y: event.clientY - rect.top },
      ]);
      window.setTimeout(() => setBursts((all) => all.filter((b) => b.id !== id)), 800);
      if (!video.liked) like(true);
      return;
    }
    lastTap.current = now;
    tapTimer.current = window.setTimeout(() => {
      if (blocked) {
        setBlocked(false);
        setPaused(false);
        void element.current?.play().catch(() => setBlocked(true));
        return;
      }
      setPaused((value) => !value);
    }, DOUBLE_TAP_MS);
  }

  const showPlay = active && (paused || blocked);

  return (
    <article
      className="relative flex h-dvh snap-start snap-always items-stretch justify-center md:py-6"
      aria-label={video.title}
      aria-roledescription={t("loop")}
      data-unloop={video.id}
      data-index={index}
      style={hue}
    >
      <div className="unloop-frame relative flex w-full max-w-[460px] flex-col overflow-hidden bg-black md:rounded-[1.75rem]">
        {/* The picture. Far slides keep only the thumbnail. */}
        {near ? (
          <video
            ref={element}
            src={video.videoUrl}
            poster={video.thumbnailUrl ?? undefined}
            className={cn(
              "absolute inset-0 size-full",
              landscape ? "object-contain" : "object-cover",
            )}
            playsInline
            loop
            muted={muted}
            preload={active ? "auto" : "metadata"}
            aria-label={video.title}
            onLoadedMetadata={(event) =>
              setLandscape(event.currentTarget.videoWidth > event.currentTarget.videoHeight)
            }
          />
        ) : video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}

        <div className="unloop-shade-top pointer-events-none absolute inset-x-0 top-0 h-40" />
        <div className="unloop-shade-bottom pointer-events-none absolute inset-x-0 bottom-0 h-[55%]" />

        {/* The tap surface: everything not covered by a control. */}
        <div
          className="absolute inset-0 cursor-pointer select-none"
          onPointerUp={onSurfaceTap}
          role="button"
          tabIndex={-1}
          aria-label={paused ? t("Play") : t("Pause")}
        >
          {bursts.map((burst) => (
            <span key={burst.id} className="unloop-burst" style={{ left: burst.x, top: burst.y }}>
              <Heart
                className="size-20 fill-primary text-primary drop-shadow-lg"
                strokeWidth={1.5}
              />
            </span>
          ))}
        </div>

        {showPlay && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="enter flex size-20 items-center justify-center rounded-full bg-black/35 backdrop-blur-md">
              <Play className="ml-1 size-9 fill-white text-white" />
            </span>
          </div>
        )}

        {/* The rail: like, save, share, and the loop ring. */}
        <div className="absolute right-3 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] flex flex-col items-center gap-4 md:bottom-8">
          <RailButton
            label={video.liked ? t("Unlike") : t("Like")}
            count={video.likes}
            active={video.liked}
            popped={popped === "like"}
            onClick={() => like(!video.liked)}
          >
            <Heart
              className={cn("size-[22px]", video.liked && "fill-primary text-primary")}
              strokeWidth={1.9}
            />
          </RailButton>
          <RailButton
            label={video.saved ? t("Remove from saved") : t("Save")}
            count={video.saves}
            active={video.saved}
            popped={popped === "save"}
            onClick={() => {
              setPopped(video.saved ? null : "save");
              onToggleSave(video, !video.saved);
            }}
          >
            <Bookmark
              className={cn("size-[22px]", video.saved && "fill-primary text-primary")}
              strokeWidth={1.9}
            />
          </RailButton>
          <RailButton label={t("Share")} onClick={() => onShare(video)}>
            <Share2 className="size-[22px]" strokeWidth={1.9} />
          </RailButton>
          <LoopRing
            ref={ring}
            loops={loops}
            label={
              loops > 0 ? t("Watched {count} times", { count: loops + 1 }) : t("Playing progress")
            }
          />
        </div>

        {/* What it is. */}
        <div className="absolute inset-x-0 bottom-0 pr-20 pb-[calc(5.25rem+env(safe-area-inset-bottom))] pl-4 text-white md:pb-6">
          <span
            className="mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
            style={{
              backgroundColor: `oklch(0.72 0.16 ${category.hue} / 0.22)`,
              boxShadow: `inset 0 0 0 1px oklch(0.8 0.16 ${category.hue} / 0.5)`,
            }}
          >
            <category.icon className="size-3.5" aria-hidden />
            {t(category.label)}
          </span>
          <h2 className="text-lg leading-snug font-semibold text-balance drop-shadow">
            {video.title}
          </h2>
          {video.description && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className={cn(
                "mt-1 block text-left text-sm text-white/80",
                !expanded && "line-clamp-2",
              )}
              aria-expanded={expanded}
            >
              {video.description}
            </button>
          )}
          {upNext && active && (
            <p className="unloop-up-next mt-3 flex items-center gap-2 text-xs text-white/60">
              <span className="rounded-full bg-white/10 px-2 py-0.5 font-medium tracking-wide uppercase">
                {t("Next loop")}
              </span>
              <span className="truncate">{upNext.title}</span>
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function RailButton({
  label,
  count,
  active,
  popped,
  onClick,
  children,
}: {
  label: string;
  count?: number;
  active?: boolean;
  popped?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={count === undefined ? label : `${label}, ${fmt(count)}`}
      aria-pressed={active}
      className="press flex flex-col items-center gap-1 text-white"
    >
      <span
        className={cn(
          "flex size-12 items-center justify-center rounded-full bg-black/30 ring-1 ring-white/15 backdrop-blur-md",
          active && "ring-primary/50",
          popped && "unloop-pop",
        )}
      >
        {children}
      </span>
      {count !== undefined && <span className="tabular text-xs text-white/85">{fmt(count)}</span>}
    </button>
  );
}
