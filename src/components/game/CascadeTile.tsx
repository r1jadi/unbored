import { BURST, COLUMN_LINE, ROW_LINE } from "@/lib/games/cascade";
import { cn } from "@/lib/utils";

/**
 * Cascade's six tiles: a shape and a hue each, so no two kinds are told apart
 * by colour alone. Mostly the app's game hues; violet is fixed, as in Decant,
 * because the theme's own turns pastel in light mode.
 */
export const CASCADE_TILES: readonly { fill: string; name: string; shape: string }[] = [
  { fill: "var(--game-5)", name: "red circle", shape: '<circle cx="12" cy="12" r="8.5"/>' },
  {
    fill: "var(--game-4)",
    name: "yellow square",
    shape: '<rect x="4" y="4" width="16" height="16" rx="3.5"/>',
  },
  {
    fill: "var(--game-2)",
    name: "green triangle",
    shape:
      '<path d="M12 3.2c.6 0 1.1.3 1.4.8l7.6 13.4c.6 1.1-.2 2.4-1.4 2.4H4.4c-1.2 0-2-1.3-1.4-2.4L10.6 4c.3-.5.8-.8 1.4-.8Z"/>',
  },
  {
    fill: "var(--game-1)",
    name: "blue diamond",
    shape:
      '<path d="M10.6 2.8a2 2 0 0 1 2.8 0l7.8 7.8a2 2 0 0 1 0 2.8l-7.8 7.8a2 2 0 0 1-2.8 0l-7.8-7.8a2 2 0 0 1 0-2.8Z"/>',
  },
  {
    fill: "oklch(0.6 0.17 300)",
    name: "violet hexagon",
    shape:
      '<path d="M10.9 2.9a2.2 2.2 0 0 1 2.2 0l6.3 3.6a2.2 2.2 0 0 1 1.1 1.9v7.2a2.2 2.2 0 0 1-1.1 1.9l-6.3 3.6a2.2 2.2 0 0 1-2.2 0l-6.3-3.6a2.2 2.2 0 0 1-1.1-1.9V8.4a2.2 2.2 0 0 1 1.1-1.9Z"/>',
  },
  {
    fill: "var(--game-6)",
    name: "teal star",
    shape:
      '<path d="M12 2.5c.5 0 .9.3 1.1.8l1.9 5.1 5.1 1.9c1 .4 1 1.8 0 2.2l-5.1 1.9-1.9 5.1c-.4 1-1.8 1-2.2 0l-1.9-5.1-5.1-1.9c-1-.4-1-1.8 0-2.2l5.1-1.9 1.9-5.1c.2-.5.6-.8 1.1-.8Z"/>',
  },
];

/** What a screen reader says for a special. */
export const SPECIAL_NAMES = ["", "row line", "column line", "burst"] as const;

/**
 * One tile: its shape in its hue, with a line tile's band or a burst's ring
 * drawn over it. Purely visual; `colour` is 1 to 6.
 */
export function CascadeTile({
  colour,
  special = 0,
  className,
}: {
  colour: number;
  special?: number;
  className?: string;
}) {
  const tile = CASCADE_TILES[colour - 1];
  if (!tile) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("block size-full overflow-visible", className)}
      aria-hidden
    >
      {special === BURST && (
        <circle
          cx="12"
          cy="12"
          r="11"
          fill="none"
          stroke={tile.fill}
          strokeWidth="1.6"
          opacity="0.7"
        />
      )}
      <g
        fill={tile.fill}
        style={{ filter: "drop-shadow(0 1.5px 0 oklch(0 0 0 / 0.25))" }}
        dangerouslySetInnerHTML={{ __html: tile.shape }}
      />
      {/* A highlight, so the shapes read as solid pieces rather than flat icons. */}
      <ellipse cx="9" cy="8" rx="3.2" ry="1.8" fill="white" opacity="0.28" />
      {special === ROW_LINE && (
        <rect x="2.5" y="10.6" width="19" height="2.8" rx="1.4" fill="white" opacity="0.92" />
      )}
      {special === COLUMN_LINE && (
        <rect x="10.6" y="2.5" width="2.8" height="19" rx="1.4" fill="white" opacity="0.92" />
      )}
      {special === BURST && <circle cx="12" cy="12" r="3" fill="white" opacity="0.92" />}
    </svg>
  );
}
