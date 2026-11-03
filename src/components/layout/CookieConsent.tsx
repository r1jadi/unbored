import { ChevronDown } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import { setConsent, useConsent } from "@/lib/consent";
import { msg, t } from "@/lib/settings/language";
import { cn } from "@/lib/utils";

/**
 * The cookie pop-up: a cookie jar, asked once per browser.
 *
 * The cookie is a toy before it is a question — tap it and it loses a bite,
 * crumbs and all, and the line under it answers back. "Accept" lets the player
 * finish it off and turns analytics on; "Essentials only" drops it back in the
 * jar. Either way the choice is kept (`lib/consent.ts`) and can be changed in
 * Settings → Privacy, which brings the jar back.
 *
 * It renders nothing on the server and while hydrating — the choice lives in
 * this browser — and nothing once a choice exists.
 */

/** Where each bite lands on the cookie's rim, in the 100×100 drawing. */
const BITES = [
  { cx: 88, cy: 26, r: 17 },
  { cx: 92, cy: 62, r: 15 },
  { cx: 70, cy: 90, r: 16 },
  { cx: 30, cy: 92, r: 15 },
  { cx: 9, cy: 56, r: 16 },
];

/** Chocolate chips, each hidden once a bite covers it. */
const CHIPS = [
  { x: 36, y: 30, r: 5 },
  { x: 60, y: 40, r: 4.5 },
  { x: 42, y: 58, r: 5.5 },
  { x: 66, y: 66, r: 4 },
  { x: 28, y: 48, r: 3.5 },
  { x: 52, y: 22, r: 3.5 },
  { x: 50, y: 76, r: 4 },
  { x: 76, y: 50, r: 3.5 },
];

const BITE_LINES = [
  msg("Psst — want a cookie?"),
  msg("Go on, have a bite."),
  msg("Crunchy, right?"),
  msg("Okay, you clearly like cookies."),
  msg("There goes the last chocolate chip."),
  msg("That was the whole cookie. Decide already!"),
];

type Leaving = "accepted" | "declined" | null;

export function CookieConsent() {
  const consent = useConsent();
  const [bites, setBites] = useState(0);
  const [crumbs, setCrumbs] = useState<number[]>([]);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState<Leaving>(null);
  const [visible, setVisible] = useState(false);

  // Rise in a moment after the page settles, rather than on top of its first paint.
  useEffect(() => {
    if (consent !== null) return;
    const timer = setTimeout(() => setVisible(true), 700);
    return () => clearTimeout(timer);
  }, [consent]);

  if (consent !== null || !visible) return null;

  const eaten = Math.min(bites, BITES.length);

  function bite() {
    if (leaving) return;
    setBites((n) => n + 1);
    const id = Date.now();
    setCrumbs((current) => [...current.slice(-6), id]);
  }

  function decide(analytics: boolean) {
    if (leaving) return;
    setLeaving(analytics ? "accepted" : "declined");
    if (analytics) setBites(BITES.length);
    // Let the cookie's exit play, then store the choice (which unmounts this).
    setTimeout(() => setConsent(analytics), 650);
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-jar-title"
      aria-describedby="cookie-jar-body"
      className={cn(
        "cookie-jar fixed inset-x-3 z-50 mx-auto max-w-sm md:inset-x-auto md:right-6 md:bottom-6",
        "bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] md:bottom-6",
        leaving && "cookie-jar-leaving",
      )}
    >
      <div className="relative overflow-hidden rounded-3xl border border-border bg-surface/95 p-4 shadow-2xl backdrop-blur-md">
        {/* A warm glow behind the cookie, in the brand's orange. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 -left-12 size-48 rounded-full bg-primary/15 blur-3xl"
        />

        <div className="relative flex items-start gap-4">
          <button
            type="button"
            onClick={bite}
            aria-label={t("Take a bite of the cookie")}
            className={cn(
              "cookie-jar-cookie relative size-20 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
              leaving === "declined" && "cookie-jar-cookie-back",
              leaving === "accepted" && "cookie-jar-cookie-gone",
            )}
          >
            <Cookie bites={eaten} />
            {crumbs.map((id, index) => (
              <span
                key={id}
                aria-hidden
                className="cookie-jar-crumb"
                style={
                  {
                    left: `${30 + ((index * 23) % 45)}%`,
                    animationDelay: `${index * 15}ms`,
                    "--crumb-x": `${((id % 7) - 3) * 9}px`,
                  } as CSSProperties
                }
              />
            ))}
          </button>

          <div className="min-w-0 flex-1 pt-1">
            <p
              key={eaten}
              id="cookie-jar-title"
              className="cookie-jar-line text-base leading-snug font-semibold"
            >
              {t(BITE_LINES[Math.min(eaten, BITE_LINES.length - 1)]!)}
            </p>
            <p id="cookie-jar-body" className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t(
                "We keep a few essentials so you stay signed in, your language sticks and games work offline. With your OK we also count how people play, to make Unbored better.",
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="relative mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {t("What's in the jar?")}
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <dl className="relative mt-2 grid gap-2 rounded-2xl bg-surface-2 p-3 text-xs">
            <div>
              <dt className="flex items-center justify-between font-medium">
                {t("Essentials")}
                <span className="text-[11px] text-muted-foreground">{t("Always on")}</span>
              </dt>
              <dd className="mt-0.5 text-muted-foreground">
                {t(
                  "Your sign-in, your language, your settings and the copies that let games run offline. Unbored can't work without them.",
                )}
              </dd>
            </div>
            <div>
              <dt className="flex items-center justify-between font-medium">
                {t("Analytics")}
                <span className="text-[11px] text-muted-foreground">{t("Your choice")}</span>
              </dt>
              <dd className="mt-0.5 text-muted-foreground">
                {t(
                  "PostHog and Vercel Analytics count visits and how games are played. They set cookies, so they only start if you accept. No ads, ever.",
                )}
              </dd>
            </div>
          </dl>
        )}

        <div className="relative mt-4 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => decide(false)} disabled={leaving !== null}>
            {t("Essentials only")}
          </Button>
          <Button variant="play" onClick={() => decide(true)} disabled={leaving !== null}>
            {t("Accept all")} 🍪
          </Button>
        </div>
        <p className="relative mt-2 text-center text-[11px] text-muted-foreground">
          {t("Change your mind any time in Settings → Privacy.")}
        </p>
      </div>
    </div>
  );
}

/** A chocolate-chip cookie with `bites` taken out of its rim. */
function Cookie({ bites }: { bites: number }) {
  const taken = BITES.slice(0, bites);
  const hidden = (chip: { x: number; y: number }) =>
    taken.some((b) => Math.hypot(chip.x - b.cx, chip.y - b.cy) < b.r + 2);
  return (
    <svg viewBox="0 0 100 100" className="size-full drop-shadow-lg" aria-hidden>
      <defs>
        <mask id="cookie-jar-bites">
          <rect width="100" height="100" fill="white" />
          {taken.map((b) => (
            <circle key={`${b.cx}-${b.cy}`} cx={b.cx} cy={b.cy} r={b.r} fill="black" />
          ))}
        </mask>
        <radialGradient id="cookie-jar-dough" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="oklch(0.82 0.11 75)" />
          <stop offset="70%" stopColor="oklch(0.68 0.12 60)" />
          <stop offset="100%" stopColor="oklch(0.55 0.11 50)" />
        </radialGradient>
      </defs>
      <g mask="url(#cookie-jar-bites)">
        <circle cx="50" cy="50" r="46" fill="url(#cookie-jar-dough)" />
        {/* Baked cracks */}
        <path
          d="M24 36 q6 -4 12 0 M58 28 q5 3 9 -1 M30 70 q7 3 12 -2 M64 58 q4 4 10 2"
          stroke="oklch(0.52 0.09 50)"
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
          opacity="0.6"
        />
        {CHIPS.map((chip) =>
          hidden(chip) ? null : (
            <circle
              key={`${chip.x}-${chip.y}`}
              cx={chip.x}
              cy={chip.y}
              r={chip.r}
              fill="oklch(0.28 0.04 40)"
            />
          ),
        )}
      </g>
    </svg>
  );
}
