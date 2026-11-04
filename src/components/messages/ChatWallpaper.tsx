import { useMemo } from "react";

const COLUMNS = 12;
const CELL = 26;

/** A small, stable hash, so the same two players always get the same board. */
function hashOf(text: string): number {
  let hash = 2166136261;
  for (const char of text) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
}

/**
 * A faint game board behind a chat, unique to the two people in it: which tiles are lit
 * comes from both their ids, in an order that doesn't depend on who is looking, so they
 * see the same one. It measures nothing, so it is decoration only.
 */
export function ChatWallpaper({ ids }: { ids: readonly string[] }) {
  const key = [...ids].sort().join(":");
  const cells = useMemo(() => {
    let state = hashOf(key);
    const next = () => {
      state = Math.imul(state ^ (state >>> 15), state | 1);
      state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
      return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
    };
    const lit: Array<{ x: number; y: number; opacity: number }> = [];
    for (let y = 0; y < COLUMNS; y += 1) {
      for (let x = 0; x < COLUMNS; x += 1) {
        if (next() < 0.26) lit.push({ x, y, opacity: 0.35 + next() * 0.65 });
      }
    }
    return lit;
  }, [key]);
  const id = `dm-board-${hashOf(key).toString(36)}`;
  const size = COLUMNS * CELL;

  return (
    <svg
      aria-hidden
      data-testid="chat-wallpaper"
      className="pointer-events-none absolute inset-0 size-full text-primary opacity-[0.07]"
    >
      <defs>
        <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse">
          {cells.map((cell) => (
            <rect
              key={`${cell.x}-${cell.y}`}
              x={cell.x * CELL + 2}
              y={cell.y * CELL + 2}
              width={CELL - 4}
              height={CELL - 4}
              rx={5}
              fill="currentColor"
              opacity={cell.opacity}
            />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
