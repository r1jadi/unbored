import { ARCADE_GUIDES } from "./arcade";
import { DAILY_GUIDES } from "./daily";
import { LOGIC_GUIDES } from "./logic";
import { PUZZLE_GUIDES } from "./puzzle";
import type { GameGuide } from "./types";

export type { GameGuide } from "./types";

/** Every game's guide, by catalogue slug. */
export const GAME_GUIDES: Readonly<Record<string, GameGuide>> = {
  ...LOGIC_GUIDES,
  ...PUZZLE_GUIDES,
  ...DAILY_GUIDES,
  ...ARCADE_GUIDES,
};

/** A game's guide by its slug, or null for a game with none written. */
export function guideFor(slug: string): GameGuide | null {
  return GAME_GUIDES[slug] ?? null;
}
