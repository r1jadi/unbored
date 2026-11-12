import {
  FLIPSIDE_HEIGHT,
  FLIPSIDE_ON_CEILING,
  FLIPSIDE_ON_FLOOR,
  FLIPSIDE_WIDTH,
} from "@/lib/games/flipside";

/** How Flipside's tunnel is drawn: shared by the live runtime and the feed's preview. */

/** The SVG viewBox: the field itself, so a hazard's numbers are its drawing. */
export const FLIPSIDE_VIEWBOX = `0 0 ${FLIPSIDE_WIDTH} ${FLIPSIDE_HEIGHT}`;

/** The rock's colour: it changes every 25 hazards, so a milestone is felt. */
export function rockColor(passed: number): string {
  const palette = [2, 1, 7, 6, 5];
  return `var(--game-${palette[Math.floor(passed / 25) % palette.length]})`;
}

/**
 * How far round the runner has turned: 0° on the floor, 180° on the ceiling,
 * in between on the way — so a flip reads as a roll.
 */
export function runnerAngle(y: number): number {
  const t = (FLIPSIDE_ON_FLOOR - y) / (FLIPSIDE_ON_FLOOR - FLIPSIDE_ON_CEILING);
  return Math.max(-20, Math.min(200, t * 180));
}
