/** The loop ring's circumference: a circle of radius 20 in a 48-unit box. */
export const LOOP_RING = 2 * Math.PI * 20;

/** Sets the ring's fill to a fraction from 0 to 1, without a React render. */
export function setRingProgress(fill: SVGCircleElement | null, fraction: number) {
  if (!fill) return;
  const clamped = Math.min(1, Math.max(0, fraction));
  fill.style.strokeDashoffset = String(LOOP_RING * (1 - clamped));
}
