import { useId } from "react";

import { cn } from "@/lib/utils";

import { t } from "@/lib/settings/language";
// The mark is the sleep "Z" breaking apart: three pieces knocked off their axis
// with a few fragments flying. public/favicon.svg and the PNG app icons are
// drawn from this same geometry; change them together.
export function LogoMark({ className, label }: { className?: string; label?: string }) {
  const hatClip = useId();
  return (
    <svg
      viewBox="0 0 32 32"
      overflow="visible"
      className={cn("size-7", className)}
      fill="var(--primary)"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <rect x="5" y="3.5" width="20" height="5" rx="1.2" transform="rotate(-7 15 6)" />
      <path d="M18.5 10.5 L26 10.5 L13.5 22 L6 22 Z" />
      <rect x="7" y="24.5" width="20" height="5" rx="1.2" transform="rotate(5 17 27)" />
      <rect x="26.5" y="10.5" width="3" height="3" rx="0.6" transform="rotate(25 28 12)" />
      <rect x="1.5" y="18" width="2.8" height="2.8" rx="0.6" transform="rotate(-20 2.9 19.4)" />
      <rect x="28.6" y="16" width="2" height="2" rx="0.4" />
      {/* Party hat on the top bar, shown only with the New Year's theme (styles.css). */}
      <g className="ny-deco">
        <clipPath id={hatClip}>
          <path d="M10 4.4 L20.5 3.1 L17.2 -9 Z" />
        </clipPath>
        <path d="M10 4.4 L20.5 3.1 L17.2 -9 Z" fill="var(--ny-hat)" />
        <g clipPath={`url(#${hatClip})`} stroke="var(--ny-hat-stripe)" strokeWidth="1.6">
          <line x1="4" y1="0.6" x2="26" y2="-2.6" />
          <line x1="4" y1="-4.4" x2="26" y2="-7.6" />
        </g>
        <path
          d="M9.6 4.5 L20.9 3.1"
          stroke="var(--ny-hat-stripe)"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <circle cx="17.2" cy="-9.4" r="1.9" fill="var(--ny-hat-pom)" />
      </g>
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return <LogoMark label={t("Unbored")} className={cn("size-9", className)} />;
}

/**
 * The whole-screen wait (a stored session being checked, a sign-up being
 * finished): the mark, breathing gently, where a spinner would be.
 */
export function LogoLoader({ label }: { label: string }) {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-background"
      role="status"
      aria-label={label}
    >
      <LogoMark className="size-14 animate-pulse" />
    </div>
  );
}
