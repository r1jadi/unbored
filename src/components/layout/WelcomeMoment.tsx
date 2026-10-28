import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/session";
import { useProfile, type Profile } from "@/lib/users/profile";
import { markWelcomed, shouldWelcome } from "@/lib/users/welcome";
import { safeLocalStorage } from "@/lib/storage";

/**
 * The first-arrival welcome on the home feed.
 *
 * The Unbored mark is the sleep "Z" breaking apart, so the welcome plays that
 * out: a straight Z dozes, then snaps into the mark while confetti in the game
 * colours bursts from it. The final frame is the real logo, which is also what
 * reduced motion shows straight away.
 */
export function WelcomeMoment() {
  const auth = useAuth();
  const profileState = useProfile();
  const [profile, setProfile] = useState<Profile>();

  const finished = auth.status === "authenticated" && auth.session.onboarded !== false;
  const ready = profileState.status === "ready" ? profileState.profile : undefined;

  useEffect(() => {
    if (!finished || !ready || profile) return;
    if (!shouldWelcome(ready, safeLocalStorage())) return;
    // Marked as soon as it shows, so a reload or a tap away never replays it.
    markWelcomed(ready.id);
    setProfile(ready);
  }, [finished, ready, profile]);

  if (!profile) return null;
  return <WelcomeOverlay profile={profile} onClose={() => setProfile(undefined)} />;
}

const CONFETTI_COLORS = [
  "var(--primary)",
  "var(--game-1)",
  "var(--game-2)",
  "var(--game-4)",
  "var(--game-5)",
  "var(--game-6)",
  "var(--success)",
  "var(--info)",
];

// Laid out by index rather than at random, so the burst looks the same every
// time and spreads evenly instead of clumping.
const CONFETTI = Array.from({ length: 36 }, (_, i) => {
  const angle = (i / 36) * Math.PI * 2 + (i % 3) * 0.18;
  const reach = 130 + ((i * 47) % 110);
  return {
    dx: Math.cos(angle) * reach,
    dy: Math.sin(angle) * reach * 0.8 - 30,
    spin: ((i * 137) % 720) - 360,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    shape: i % 4 === 0 ? "rounded-full" : "rounded-[2px]",
    size: 6 + (i % 4) * 2,
    delay: (i % 5) * 25,
  };
});

function WelcomeOverlay({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const primary = useRef<HTMLButtonElement>(null);
  const [leaving, setLeaving] = useState(false);
  const name = profile.displayName.trim() || profile.username;

  function close() {
    setLeaving(true);
    window.setTimeout(onClose, 220);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    // Focus lands on the way in once the button has appeared — straight away
    // when motion is reduced, since everything shows at once.
    const still =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.classList.contains("a11y-reduce-motion");
    const focus = window.setTimeout(
      () => primary.current?.focus({ preventScroll: true }),
      still ? 0 : 2100,
    );
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(focus);
    };
    // `close` only sets state; binding it once is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      aria-describedby="welcome-body"
      className={`welcome-backdrop fixed inset-0 z-[100] flex items-center justify-center overflow-hidden px-5 ${leaving ? "welcome-leaving" : ""}`}
    >
      <div className="relative flex w-full max-w-sm flex-col items-center text-center">
        <div className="relative size-40" aria-hidden>
          <span className="welcome-glow absolute inset-0 rounded-full" />
          {["z", "z", "Z"].map((letter, i) => (
            <span
              key={i}
              className="welcome-zzz absolute font-semibold text-muted-foreground"
              style={
                {
                  left: `${62 + i * 12}%`,
                  top: `${14 - i * 6}%`,
                  fontSize: `${0.8 + i * 0.3}rem`,
                  animationDelay: `${150 + i * 220}ms`,
                } as CSSProperties
              }
            >
              {letter}
            </span>
          ))}
          <div className="absolute top-1/2 left-1/2">
            {CONFETTI.map((piece, i) => (
              <span
                key={i}
                className={`welcome-confetti absolute ${piece.shape}`}
                style={
                  {
                    "--dx": `${piece.dx}px`,
                    "--dy": `${piece.dy}px`,
                    "--spin": `${piece.spin}deg`,
                    width: piece.size,
                    height: piece.shape === "rounded-full" ? piece.size : piece.size * 0.55,
                    marginLeft: -piece.size / 2,
                    marginTop: -piece.size / 4,
                    background: piece.color,
                    animationDelay: `${1150 + piece.delay}ms`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <svg viewBox="0 0 32 32" className="welcome-mark absolute inset-6" fill="var(--primary)">
            <g className="welcome-piece-top">
              <rect x="5" y="3.5" width="20" height="5" rx="1.2" transform="rotate(-7 15 6)" />
            </g>
            <g className="welcome-piece-mid">
              <path d="M18.5 10.5 L26 10.5 L13.5 22 L6 22 Z" />
            </g>
            <g className="welcome-piece-bottom">
              <rect x="7" y="24.5" width="20" height="5" rx="1.2" transform="rotate(5 17 27)" />
            </g>
            <g className="welcome-shard" style={{ transformOrigin: "28px 12px" }}>
              <rect x="26.5" y="10.5" width="3" height="3" rx="0.6" transform="rotate(25 28 12)" />
            </g>
            <g className="welcome-shard" style={{ transformOrigin: "3px 19px" }}>
              <rect
                x="1.5"
                y="18"
                width="2.8"
                height="2.8"
                rx="0.6"
                transform="rotate(-20 2.9 19.4)"
              />
            </g>
            <g className="welcome-shard" style={{ transformOrigin: "29.6px 17px" }}>
              <rect x="28.6" y="16" width="2" height="2" rx="0.4" />
            </g>
          </svg>
        </div>

        <p
          className="welcome-rise mt-6 text-xs font-semibold tracking-[0.2em] text-primary uppercase"
          style={{ animationDelay: "1400ms" }}
        >
          Boredom: cancelled
        </p>
        <h1
          id="welcome-title"
          className="welcome-rise mt-3 text-4xl leading-tight font-semibold text-balance"
          style={{ animationDelay: "1550ms" }}
        >
          Welcome, <span className="text-primary">{name}</span>.
        </h1>
        <p
          id="welcome-body"
          className="welcome-rise mt-3 text-muted-foreground text-pretty"
          style={{ animationDelay: "1750ms" }}
        >
          You&apos;re verified and in. Every card in your feed is a game that takes seconds to play
          — set a score, then come back and beat it.
        </p>

        <div className="welcome-rise mt-8 w-full space-y-2" style={{ animationDelay: "1950ms" }}>
          <Button ref={primary} variant="play" size="xl" className="w-full" onClick={close}>
            Let&apos;s play
          </Button>
          <Button asChild variant="ghost" size="lg" className="w-full text-muted-foreground">
            <Link to="/settings/$section" params={{ section: "profile" }} onClick={onClose}>
              Add a photo and bio first
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
