import { forwardRef } from "react";

import { t } from "@/lib/settings/language";
import { LOOP_RING as RING } from "@/lib/unloop/ring";
import { cn } from "@/lib/utils";

/**
 * The Unloop wordmark. The "oo" is two linked rings — the coral of Unbored and the
 * playing channel's hue — with a current that runs round them while a loop plays.
 */
export function UnloopWordmark({
  playing = false,
  className,
}: {
  playing?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "unloop-wordmark inline-flex items-center text-lg font-semibold tracking-tight",
        className,
      )}
      data-playing={playing || undefined}
      role="img"
      aria-label={t("Unloop")}
    >
      <span aria-hidden>Unl</span>
      <svg
        viewBox="2 1.2 30 17.6"
        className="mx-[0.04em] h-[0.78em] w-[1.33em] translate-y-[0.06em]"
        aria-hidden
      >
        <g>
          <circle
            className="unloop-wordmark-ring"
            cx="11"
            cy="10"
            r="7"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="3.2"
          />
          <circle
            className="unloop-wordmark-ring"
            cx="23"
            cy="10"
            r="7"
            fill="none"
            stroke="oklch(0.78 0.16 var(--loop-hue, 40))"
            strokeWidth="3.2"
          />
          {/* The coral ring passes over the second at the top: linked, not stacked. */}
          <path
            d="M 16.4 5.6 A 7 7 0 0 1 18 10"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="3.2"
          />
        </g>
      </svg>
      <span aria-hidden>p</span>
    </span>
  );
}

/**
 * The loop ring: fills as the video runs, and its centre counts the times this
 * loop has come round. The fill is driven from outside through `setProgress`, a
 * frame at a time, without re-rendering.
 */
export const LoopRing = forwardRef<
  SVGCircleElement,
  { loops: number; label: string; className?: string }
>(function LoopRing({ loops, label, className }, fill) {
  return (
    <span
      className={cn("relative flex size-12 items-center justify-center", className)}
      role="img"
      aria-label={label}
    >
      <svg viewBox="0 0 48 48" className="absolute inset-0 size-12 -rotate-90" aria-hidden>
        <circle cx="24" cy="24" r="20" fill="none" strokeWidth="3" className="unloop-ring-track" />
        <circle
          ref={fill}
          cx="24"
          cy="24"
          r="20"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          className="unloop-ring-fill"
          strokeDasharray={RING}
          strokeDashoffset={RING}
        />
      </svg>
      <span
        key={loops}
        className={cn("tabular text-[13px] font-semibold text-white", loops > 0 && "unloop-wrap")}
        aria-hidden
      >
        {loops > 0 ? `×${loops + 1}` : "∞"}
      </span>
    </span>
  );
});
