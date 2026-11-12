import {
  FLIPSIDE_CEILING,
  FLIPSIDE_FLOOR,
  FLIPSIDE_HALF,
  FLIPSIDE_HEIGHT,
  FLIPSIDE_RUNNER_X,
  FLIPSIDE_SPIKE,
  FLIPSIDE_WIDTH,
  type FlipsideHazard,
} from "@/lib/games/flipside";
import { runnerAngle } from "@/lib/games/flipside-view";

/**
 * Flipside's tunnel, drawn in world units: an SVG whose viewBox is the field
 * itself, so a hazard's numbers are its drawing. Shared by the live runtime and
 * the feed's preview.
 */

/** The floor and the ceiling, full width: hazards are drawn over them. */
export function TunnelRock({ color }: { color: string }) {
  return (
    <g>
      <rect x={0} y={0} width={FLIPSIDE_WIDTH} height={FLIPSIDE_CEILING} fill={color} />
      <rect
        x={0}
        y={FLIPSIDE_FLOOR}
        width={FLIPSIDE_WIDTH}
        height={FLIPSIDE_HEIGHT - FLIPSIDE_FLOOR}
        fill={color}
      />
      {/* A lip of light along each surface: the line the runner stands on. */}
      <rect
        x={0}
        y={FLIPSIDE_CEILING - 500}
        width={FLIPSIDE_WIDTH}
        height={500}
        fill="var(--background)"
        opacity={0.25}
      />
      <rect
        x={0}
        y={FLIPSIDE_FLOOR}
        width={FLIPSIDE_WIDTH}
        height={500}
        fill="var(--background)"
        opacity={0.25}
      />
    </g>
  );
}

/** One hazard, at its world x: a hole cut through the rock, or a row of spikes. */
export function TunnelHazard({ hazard }: { hazard: FlipsideHazard }) {
  const { x, width, surface, kind } = hazard;
  if (kind === "hole") {
    return surface === "floor" ? (
      <rect
        x={x}
        y={FLIPSIDE_FLOOR}
        width={width}
        height={FLIPSIDE_HEIGHT - FLIPSIDE_FLOOR}
        fill="var(--background)"
      />
    ) : (
      <rect x={x} y={0} width={width} height={FLIPSIDE_CEILING} fill="var(--background)" />
    );
  }
  const teeth = Math.max(1, Math.round(width / 2_000));
  const tooth = width / teeth;
  const base = surface === "floor" ? FLIPSIDE_FLOOR : FLIPSIDE_CEILING;
  const tip =
    surface === "floor" ? FLIPSIDE_FLOOR - FLIPSIDE_SPIKE : FLIPSIDE_CEILING + FLIPSIDE_SPIKE;
  const points = [`${x},${base}`];
  for (let i = 0; i < teeth; i += 1) {
    points.push(`${x + tooth * (i + 0.5)},${tip}`, `${x + tooth * (i + 1)},${base}`);
  }
  return <polygon points={points.join(" ")} fill="var(--destructive)" />;
}

/** The runner, centred at its fixed x and height `y`. */
export function TunnelRunner({ y }: { y: number }) {
  const size = FLIPSIDE_HALF * 2;
  return (
    <g transform={`translate(${FLIPSIDE_RUNNER_X} ${y}) rotate(${runnerAngle(y)})`}>
      <rect
        x={-FLIPSIDE_HALF}
        y={-FLIPSIDE_HALF}
        width={size}
        height={size}
        rx={900}
        fill="var(--primary)"
        stroke="var(--background)"
        strokeOpacity={0.5}
        strokeWidth={400}
      />
      {/* An eye, looking ahead and to the surface it stands on. */}
      <circle cx={1300} cy={-600} r={1000} fill="var(--background)" />
      <circle cx={1650} cy={-500} r={480} fill="var(--foreground)" />
    </g>
  );
}
