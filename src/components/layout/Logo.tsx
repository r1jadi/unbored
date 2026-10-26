import { cn } from "@/lib/utils";

// The mark is the sleep "Z" breaking apart: three pieces knocked off their axis
// with a few fragments flying. public/favicon.svg and the PNG app icons are
// drawn from this same geometry; change them together.
export function LogoMark({ className, label }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
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
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return <LogoMark label="Unbored" className={cn("size-9", className)} />;
}
