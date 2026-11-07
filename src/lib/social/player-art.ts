/** A small, stable hash, so a player's art is the same on every visit. */
function hashOf(text: string): number {
  let hash = 2166136261;
  for (const char of text) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
}

/**
 * A repeatable stream of numbers from 0 to 1 for one player. Everything drawn from it
 * is decoration: none of it measures anything about the player.
 */
export function playerRandom(username: string): () => number {
  let state = hashOf(username);
  return () => {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

/** The hue a player's art is drawn in, shared by their banner and their header. */
export function playerHue(username: string): number {
  return playerRandom(username)() * 360;
}

export const SIGIL_SIZE = 5;

/**
 * A player's mark: a small mirrored grid of tiles, so every player gets one that reads
 * as a shape. Lists the lit tiles' positions.
 */
export function playerSigil(username: string): Array<{ x: number; y: number }> {
  const next = playerRandom(`sigil:${username}`);
  const lit: Array<{ x: number; y: number }> = [];
  const middle = (SIGIL_SIZE - 1) / 2;
  for (let y = 0; y < SIGIL_SIZE; y += 1) {
    for (let x = 0; x <= middle; x += 1) {
      if (next() < 0.55) {
        lit.push({ x, y });
        if (x !== middle) lit.push({ x: SIGIL_SIZE - 1 - x, y });
      }
    }
  }
  return lit;
}
