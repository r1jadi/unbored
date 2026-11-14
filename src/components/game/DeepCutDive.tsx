import { useEffect, useState, type CSSProperties } from "react";

import { TIERS, type Tier } from "@/lib/games/deep-cut";
import { DIVE_MS, diveAt } from "@/lib/games/deep-cut-dive";
import { motionIsReduced } from "@/lib/settings/accessibility";
import { t } from "@/lib/settings/language";
import { cn } from "@/lib/utils";

/** The water, sunlit to black: each tier's band, blended into the next. */
const WATER =
  "linear-gradient(to bottom, oklch(0.86 0.1 210) 0%, oklch(0.74 0.12 220) 16%, oklch(0.6 0.13 235) 33%, oklch(0.44 0.13 260) 50%, oklch(0.3 0.09 270) 67%, oklch(0.18 0.06 280) 84%, oklch(0.12 0.04 285) 100%)";

/** Milliseconds since mount, every frame, until `until`; null with reduced motion. */
function useElapsed(until: number): number | null {
  const [elapsed, setElapsed] = useState<number | null>(0);
  useEffect(() => {
    if (motionIsReduced()) {
      setElapsed(null);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const passed = now - start;
      setElapsed(passed);
      if (passed < until) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [until]);
  return elapsed;
}

/**
 * How deep an answer went, as a dive: a column of water from the sunlit surface
 * to the black abyss, and a diver who sinks to the answer's tier while the depth
 * counter runs. A miss stays bobbing at the surface. With reduced motion the
 * diver is simply there.
 */
export function DeepCutDive({ tier, className }: { tier: Tier | null; className?: string }) {
  const elapsed = useElapsed(tier ? DIVE_MS + 200 : 0);
  const done = elapsed === null || (tier !== null && elapsed >= DIVE_MS);
  const { share, metres } = tier
    ? diveAt(tier, elapsed ?? Number.POSITIVE_INFINITY)
    : { share: 0.07, metres: 0 };
  const reached = tier ? TIERS[tier - 1]! : null;
  // Which band the diver is passing through now, for the label beside it.
  const passing = Math.min(5, Math.floor(share * TIERS.length));

  return (
    <div
      className={cn(
        "relative h-72 w-full max-w-[15rem] overflow-hidden rounded-2xl shadow-inner",
        className,
      )}
      style={{ background: WATER }}
      role="img"
      aria-label={
        reached
          ? t("Dived to {depth}: {tier}", { depth: reached.depth, tier: t(reached.name) })
          : t("Stayed at the surface")
      }
    >
      {/* Light from above, fading with depth. */}
      <div className="deep-cut-rays pointer-events-none absolute inset-x-0 top-0 h-1/3" />

      {/* The bands' depths down the left. */}
      {TIERS.map((info, index) => (
        <div
          key={info.tier}
          className={cn(
            "absolute left-2 flex items-center gap-1 text-[10px] font-medium transition-opacity duration-300",
            index >= 3 ? "text-white/70" : "text-black/55",
            index === passing ? "opacity-100" : "opacity-60",
          )}
          style={{ top: `calc(${(index / TIERS.length) * 100}% + 4px)` }}
        >
          <span className="tabular">{info.depth}</span>
          <span className="hidden min-[360px]:inline">· {t(info.name)}</span>
        </div>
      ))}
      {TIERS.slice(1).map((info, index) => (
        <div
          key={info.tier}
          className="absolute inset-x-0 border-t border-dashed border-white/15"
          style={{ top: `${((index + 1) / TIERS.length) * 100}%` }}
        />
      ))}

      {/* Life on the way down: a shoal near the top, a glow in the deep. */}
      <span className="deep-cut-drift absolute right-4 top-[22%] text-sm opacity-70" aria-hidden>
        🐟
      </span>
      <span
        className="deep-cut-drift absolute left-10 top-[44%] text-xs opacity-60"
        style={{ animationDelay: "-3s" } as CSSProperties}
        aria-hidden
      >
        🐠
      </span>
      <span
        className="absolute bottom-3 right-5 size-1.5 rounded-full bg-[oklch(0.9_0.15_140)] shadow-[0_0_10px_3px_oklch(0.9_0.15_140/0.6)]"
        aria-hidden
      />

      {/* The diver, with bubbles rising behind. */}
      <div
        className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ top: `${share * 100}%` }}
      >
        <div className={cn("relative text-3xl", !tier && "deep-cut-bob")} aria-hidden>
          🤿
          {!done &&
            [0, 1, 2].map((index) => (
              <span
                key={index}
                className="deep-cut-bubble absolute left-1/2 top-0 size-1.5 rounded-full border border-white/70"
                style={{ ["--bubble-delay" as string]: `${index * 260}ms` } as CSSProperties}
              />
            ))}
        </div>
      </div>

      {/* The depth counter, riding with the diver. */}
      <div
        className="absolute right-2 -translate-y-1/2 rounded-md bg-black/45 px-1.5 py-0.5 text-xs font-semibold tabular text-white"
        style={{ top: `${share * 100}%` }}
        aria-hidden
      >
        {metres.toLocaleString()} m
      </div>

      {tier && done && reached && (
        <div
          className="deep-cut-pop absolute inset-x-3 rounded-full py-1 text-center text-sm font-semibold"
          style={{
            top: share > 0.7 ? `calc(${share * 100}% - 3.2rem)` : `calc(${share * 100}% + 1.6rem)`,
            ...(tier >= 4
              ? { background: "oklch(0.95 0.02 270 / 0.9)", color: "oklch(0.2 0.05 270)" }
              : { background: "oklch(0.2 0.05 270 / 0.75)", color: "white" }),
          }}
        >
          {t(reached.name)}
        </div>
      )}
      {!tier && (
        <div className="deep-cut-pop absolute inset-x-3 top-[24%] rounded-full bg-white/80 py-1 text-center text-sm font-semibold text-black/75">
          {t("Stayed at the surface")}
        </div>
      )}
    </div>
  );
}
