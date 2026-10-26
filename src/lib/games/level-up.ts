import { useEffect, useRef, useState } from "react";

/**
 * The moment between two levels.
 *
 * Every game with levels used to swap the solved board for the next one in the
 * same frame, so the board just changed under the player's finger with nothing
 * to say why. A solved level now gets a short beat: a check, what was solved and
 * what it earned, and what comes next. It moves on by itself — no tap — because
 * in the timed games (Zip, 8 Puzzle) the server's clock keeps running and a card
 * that waited for a tap would cost the player time.
 *
 * The beat is short on purpose: just under a second, or a little longer when the
 * next level is harder in a way worth saying (a bigger board), so the note has
 * time to be read. The board underneath is inert for the duration, so a tap
 * meant for the old board never lands on the new one.
 */

/**
 * How long a level-up shows: `ms` normally, `noteMs` when it carries a note about
 * the next level. A length of zero turns the beat off, which is what the play
 * tests use so they can solve level after level without waiting on a clock; the
 * level-up tests turn it back on.
 */
export const levelUpTiming = { ms: 900, noteMs: 1700 };

/** The beat's length for the next level: longer when there is a note to read. */
export function levelUpHold(withNote: boolean): number {
  return withNote ? levelUpTiming.noteMs : levelUpTiming.ms;
}

export type LevelUp = {
  /** The level just solved. */
  readonly solved: number;
  /** The points that level earned. */
  readonly gained: number;
};

/**
 * Watches a run's level and reports a level-up for `holdMs` after it rises.
 *
 * Only a rise seen while this board is mounted counts: a board that mounts on
 * level five (a retried submission, say) has solved nothing in front of the
 * player, so it shows nothing. `score` is the run's score, so the beat can say
 * what the level earned.
 */
export function useLevelUp(level: number, score: number, holdMs: number): LevelUp | null {
  const [levelUp, setLevelUp] = useState<LevelUp | null>(null);
  const seen = useRef({ level, score });

  useEffect(() => {
    const previous = seen.current;
    // The score as this level starts, so the next beat can say what it earned.
    seen.current = { level, score };
    if (level <= previous.level || holdMs <= 0) return;
    setLevelUp({ solved: previous.level, gained: Math.max(0, score - previous.score) });
    const timer = setTimeout(() => setLevelUp(null), holdMs);
    return () => clearTimeout(timer);
    // `score` changes within a level too; only a new level starts a beat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  return levelUp;
}
