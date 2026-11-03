/**
 * Every game's rules, in one place.
 *
 * The feed's "How to play" sheet and a game's own rules screen show the same
 * text, so it lives here once, keyed by the game's runtime (the catalogue's
 * `games.runtime`). Each rule is a short lead — the thing it is about — and the
 * sentence that explains it; the lead is set in bold where it is shown.
 *
 * These describe the rules the engines in this folder implement. A change to a
 * game's rules is a change here too.
 */

import { msg } from "@/lib/settings/language";

export type GameRule = {
  /** What the rule is about, in a few words: "A move", "The clock". */
  readonly lead: string;
  /** The rule itself, continuing from the lead. */
  readonly text: string;
};

export type GameRules = {
  /** The rules screen's title. */
  readonly heading: string;
  /** One line under the title: the game in a sentence. */
  readonly summary: string;
  readonly rules: readonly GameRule[];
};

export const GAME_RULES = {
  "stack-10": {
    heading: msg("Make it ten"),
    summary: msg("Drop each tile into a column. Exactly ten clears it."),
    rules: [
      {
        lead: msg("Place the tile"),
        text: msg(
          "shown above the board in one of the four columns: tap a column, or press 1 to 4.",
        ),
      },
      {
        lead: msg("Exactly ten"),
        text: msg("clears the column and scores. A column that goes past ten ends the run."),
      },
      {
        lead: msg("No final tile."),
        text: msg(
          "Heavier tiles turn up more often the longer you play, so clears get rarer and the board gets tighter.",
        ),
      },
    ],
  },
  chain: {
    heading: msg("Don't break the chain"),
    summary: msg("Watch the sequence, then tap it back."),
    rules: [
      {
        lead: msg("Watch"),
        text: msg(
          "the pads flash in order, then tap them back in the same order. Number keys 1 to 4 work too.",
        ),
      },
      {
        lead: msg("Every round"),
        text: msg("adds one more step, and the beat gets a little quicker."),
      },
      {
        lead: msg("A wrong tap"),
        text: msg(
          "breaks the chain and ends the run. Every correct tap scores 10 points, and there is no final round.",
        ),
      },
    ],
  },
  "memory-flash": {
    heading: msg("See it once"),
    summary: msg("A pattern flashes. Rebuild it from memory."),
    rules: [
      {
        lead: msg("Watch"),
        text: msg("the lit cells, then tap them back in any order."),
      },
      {
        lead: msg("One wrong or repeated cell"),
        text: msg("ends the run. A rebuilt pattern is 100 points."),
      },
      {
        lead: msg("No final pattern."),
        text: msg(
          "Every round adds a cell, the flash gets shorter, and the board grows when the pattern outgrows it.",
        ),
      },
    ],
  },
  "one-move": {
    heading: msg("One move away"),
    summary: msg("Every board is a checkerboard with exactly one move already made."),
    rules: [
      {
        lead: msg("A move"),
        text: msg(
          "flips one cell and the cells above, below, left and right of it that are on the board.",
        ),
      },
      {
        lead: msg("Your move"),
        text: msg("is the one that puts the checkerboard back. Tap that cell."),
      },
      {
        lead: msg("A wrong tap"),
        text: msg(
          "ends the run. The board grows as you go; every restored board is 100 points, and there is no final board.",
        ),
      },
    ],
  },
  "color-merge": {
    heading: msg("Merge the shades"),
    summary: msg("Two equal colours become the next shade. Keep the board moving."),
    rules: [
      {
        lead: msg("Slide"),
        text: msg(
          "the whole board with the arrow keys, WASD, a swipe, or the buttons below the board.",
        ),
      },
      {
        lead: msg("Merge"),
        text: msg(
          "equal neighbours — two 2s make a 4, two 4s make an 8. Each tile merges once per slide.",
        ),
      },
      {
        lead: msg("No final slide."),
        text: msg(
          "The run ends only when the board locks — every cell full with no matching neighbours. New tiles arrive with a growing chance of a higher shade, so the space you have to work with keeps shrinking.",
        ),
      },
    ],
  },
  "dont-touch": {
    heading: msg("Tap white. Only white."),
    summary: msg("Rows rise to the line. Clear every white tile before the row passes."),
    rules: [
      {
        lead: msg("Tap"),
        text: msg(
          "the white tiles in the row at the line. Number keys 1–3 or A, S and D work too.",
        ),
      },
      {
        lead: msg("Never touch a black tile."),
        text: msg("One black tap ends the run on the spot."),
      },
      {
        lead: msg("Don't let a white tile pass."),
        text: msg("A row that leaves the line with a white tile still on it ends the run too."),
      },
      {
        lead: msg("No final row."),
        text: msg(
          "Every row tightens the beat, and the longer you last the more of each row turns black — and the darker it gets, until you can't see what's coming.",
        ),
      },
    ],
  },
  "seven-second": {
    heading: msg("Seven seconds. Answer everything."),
    summary: msg("Arithmetic with three answers and one shrinking clock. Keep it alive."),
    rules: [
      {
        lead: msg("Seven seconds"),
        text: msg("on the clock. Answer as many challenges as you can before it empties."),
      },
      {
        lead: msg("A right answer"),
        text: msg("adds 1.5 seconds and scores 100 points."),
      },
      {
        lead: msg("A wrong answer"),
        text: msg("costs 2 seconds. Three of them can empty a fresh clock."),
      },
      {
        lead: msg("One ranked attempt"),
        text: msg(
          "per UTC day. Everyone plays the same deck; the next one arrives at midnight UTC.",
        ),
      },
    ],
  },
  queens: {
    heading: msg("One crown each"),
    summary: msg("Every board is split into coloured regions, one for each row."),
    rules: [
      {
        lead: msg("The goal"),
        text: msg(
          "is exactly one crown in every row, every column and every colour region. Two crowns can never touch, not even diagonally.",
        ),
      },
      {
        lead: msg("Tap a cell"),
        text: msg(
          "once for an X — a note that no crown goes there — twice for a crown, and a third time to clear it.",
        ),
      },
      {
        lead: msg("A wrong crown"),
        text: msg(
          "is a mistake, and the third one ends the run. Every board has one solution and is worth 100 points a row; the boards grow as you go, and you can end the run whenever you like.",
        ),
      },
    ],
  },
  zip: {
    heading: msg("Fill the grid"),
    summary: msg("One path, every cell, the numbers in order. Beat the clock."),
    rules: [
      {
        lead: msg("Draw one path"),
        text: msg(
          "from 1 through every number in order, ending on the highest. It must visit every cell exactly once, moving up, down, left or right, and never through a wall.",
        ),
      },
      {
        lead: msg("Drag or tap"),
        text: msg("to extend the path. Go back over it to undo."),
      },
      {
        lead: msg("The clock"),
        text: msg(
          "starts at 75 seconds, and every solved board adds about five seconds a row: a little more early on, less as the run goes. Each board is worth 100 points a row, the boards grow as you go, and the run ends when the clock does.",
        ),
      },
    ],
  },
  "eight-puzzle": {
    heading: msg("Slide it home"),
    summary: msg("Eight tiles, one gap. Put them back in order before the clock runs out."),
    rules: [
      {
        lead: msg("Tap a tile"),
        text: msg("next to the gap to slide it in, or use the arrow keys."),
      },
      {
        lead: msg("The goal"),
        text: msg(
          "is 1 to 8 in reading order, with the gap in the bottom-right corner. Every board can be solved; each one is scrambled a little more than the last.",
        ),
      },
      {
        lead: msg("The clock"),
        text: msg(
          "starts at 75 seconds, and every solved board adds 100 points and time: 18 seconds for the first, less with each board after, down to 7.5. The run ends when the clock does.",
        ),
      },
    ],
  },
  tango: {
    heading: msg("Suns and moons"),
    summary: msg("Balance every row and column. Beat the clock."),
    rules: [
      {
        lead: msg("Fill the grid"),
        text: msg(
          "with suns and moons: every row and every column holds three of each, and no three alike sit next to each other across or down.",
        ),
      },
      {
        lead: msg("Signs"),
        text: msg(
          "between two cells say how they relate: = means they match, × means they differ.",
        ),
      },
      {
        lead: msg("Tap a cell"),
        text: msg(
          "for a sun, again for a moon, and once more to clear it. Cells that start filled stay as they are; clashes are marked in red.",
        ),
      },
      {
        lead: msg("The clock"),
        text: msg(
          "starts at 2:20, and every solved board adds 600 points and time: 54 seconds for the first, less with each board after, down to 22.5. Each board starts with fewer cells filled, and the run ends when the clock does.",
        ),
      },
    ],
  },
  sudoku: {
    heading: msg("One to nine"),
    summary: msg("Every row, column and box, once each. Beat the clock."),
    rules: [
      {
        lead: msg("Fill the grid"),
        text: msg(
          "so that every row, every column and every 3×3 box holds the digits 1 to 9 once each. Every board has exactly one solution.",
        ),
      },
      {
        lead: msg("Pick a cell"),
        text: msg(
          "and tap a number to place it, or Erase to clear it. You can also type 1 to 9, and move with the arrow keys. Cells that start filled stay as they are; a digit that repeats is marked in red.",
        ),
      },
      {
        lead: msg("Notes and Undo"),
        text: msg(
          "Turn on Notes (or press N) to jot small candidate digits in a cell; placing a digit tidies them away. Undo (Ctrl+Z) steps back.",
        ),
      },
      {
        lead: msg("The clock"),
        text: msg(
          "starts at 6:40. Boards start gentle and get harder, and every solved board scores 900 points and adds time for the next one: generous early on, tighter as the run goes. The run ends when the clock does.",
        ),
      },
    ],
  },
  "mini-sudoku": {
    heading: msg("One to six"),
    summary: msg("A small Sudoku on a 6×6 grid. Beat the clock."),
    rules: [
      {
        lead: msg("Fill the grid"),
        text: msg(
          "so that every row, every column and every 2×3 box (two rows tall, three wide) holds the digits 1 to 6 once each. Every board has exactly one solution.",
        ),
      },
      {
        lead: msg("Pick a cell"),
        text: msg(
          "and tap a number to place it, or Erase to clear it. You can also type 1 to 6, and move with the arrow keys. Cells that start filled stay as they are; a digit that repeats is marked in red.",
        ),
      },
      {
        lead: msg("Notes and Undo"),
        text: msg(
          "Turn on Notes (or press N) to jot small candidate digits in a cell; placing a digit tidies them away. Undo (Ctrl+Z) steps back.",
        ),
      },
      {
        lead: msg("The clock"),
        text: msg(
          "starts at 2:00. Boards start gentle and get harder, and every solved board scores 600 points and adds time for the next one: generous early on, tighter as the run goes. The run ends when the clock does.",
        ),
      },
    ],
  },
  crossword: {
    heading: msg("Today's crossword"),
    summary: msg("One puzzle a day, the same for everyone. Solve it fast."),
    rules: [
      {
        lead: msg("A mini every weekday"),
        text: msg(
          "— a 5×5 grid — and a bigger 7×7 midi on Saturday and Sunday. Every clue is original.",
        ),
      },
      {
        lead: msg("Pick a square"),
        text: msg(
          "and type. Pick it again, or tap the clue, to switch between across and down; the arrows step through the clues.",
        ),
      },
      {
        lead: msg("Faster scores more."),
        text: msg(
          "A mini is worth 10,000 if you solve it within 30 seconds, a midi 20,000 within a minute; after that it slips 40 points a second.",
        ),
      },
      {
        lead: msg("Stuck?"),
        text: msg(
          "Check the grid (−50) to see which letters are wrong, or reveal a letter (−100 each). One ranked solve a day; a new crossword arrives at midnight UTC.",
        ),
      },
    ],
  },
  gridburst: {
    heading: msg("Fill a line, watch it burst"),
    summary: msg("Drop the pieces onto the grid. A full row or column bursts."),
    rules: [
      {
        lead: msg("Drag a piece"),
        text: msg(
          "from the tray onto the grid — or tap a piece, then a square for its top-left corner. Pieces don't rotate.",
        ),
      },
      {
        lead: msg("Fill a row or column"),
        text: msg(
          "and it bursts. Every square placed is 10 points; bursting L lines at once scores 100 × L², times your combo.",
        ),
      },
      {
        lead: msg("Keep the combo."),
        text: msg(
          "Each burst raises it by one; three placements in a row without a burst reset it. Empty the whole board for 300 more.",
        ),
      },
      {
        lead: msg("No final tray."),
        text: msg(
          "Place all three pieces and three more arrive, bigger ones more often as you go. The run ends when nothing in your tray fits.",
        ),
      },
    ],
  },
  cascade: {
    heading: "Line them up",
    summary: "Swap two tiles to line up three of a kind. Let it cascade.",
    rules: [
      {
        lead: "Swap two neighbours",
        text: "by dragging a tile onto the one beside it, or tapping one and then the other. A swap only counts if it lines up three or more of the same shape in a row or a column.",
      },
      {
        lead: "Cascades score more.",
        text: "Cleared tiles are 10 points each. The tiles above fall, new ones drop in, and every new line they make clears too: the second wave is worth double, the third triple, and so on.",
      },
      {
        lead: "Four or five in a line",
        text: "leave a special tile behind. Four makes a line tile that clears its whole row or column when it goes; five, or an L or T, makes a burst that clears the 3×3 around it.",
      },
      {
        lead: "The clock",
        text: "starts at one minute. Each level asks for more tiles cleared (30, then 40, 50, …) and adds time: 24 seconds for the first, less with each level after. The run ends when the clock does.",
      },
    ],
  },
  decant: {
    heading: msg("Pour until it's sorted"),
    summary: msg("Pour the colours between the tubes until each tube holds just one."),
    rules: [
      {
        lead: msg("Tap a tube, then another,"),
        text: msg(
          "to pour. It only lands on an empty tube or on the same colour, and the whole top layer of that colour goes — as much as fits.",
        ),
      },
      {
        lead: msg("Sort every tube"),
        text: msg(
          "into a single colour to solve the board: 10 points per colour, and about 5 more seconds on the clock per colour: a little more early on, less as the run goes.",
        ),
      },
      {
        lead: msg("Stuck?"),
        text: msg(
          "Undo a pour, restart the board, or add one empty tube to it for 15 seconds of clock.",
        ),
      },
      {
        lead: msg("No last board."),
        text: msg(
          "Boards start with three colours and gain one every second board, up to nine. The run ends when the clock does.",
        ),
      },
    ],
  },
  huedini: {
    heading: msg("Every block escapes"),
    summary: msg("Slide each block out through the gate of its own colour."),
    rules: [
      {
        lead: msg("Drag a block"),
        text: msg(
          "up, down, left or right, and it slides until a wall, another block or the edge stops it. On a keyboard, focus a block and use the arrow keys.",
        ),
      },
      {
        lead: msg("Gates"),
        text: msg(
          "sit in the board's frame. A block that reaches a gate of its own colour, lined up so the gate covers its whole width, slips out.",
        ),
      },
      {
        lead: msg("Blocks get in each other's way,"),
        text: msg(
          "so the order matters: move one aside to open a path for another. Undo or restart the board any time.",
        ),
      },
      {
        lead: msg("The clock"),
        text: msg(
          "starts at 75 seconds. Clear a board for 10 points per block and time for the next one; boards grow trickier, and the time they add tightens as the run goes. The run ends when the clock does.",
        ),
      },
    ],
  },
  scatter: {
    heading: msg("Clear the way"),
    summary: msg("Send every arrow off the board. Mind what stands in its lane."),
    rules: [
      {
        lead: msg("Tap a tile"),
        text: msg(
          "and it flies off the board the way its arrow points: 10 points. It only goes if nothing stands between it and the edge.",
        ),
      },
      {
        lead: msg("A blocked tile jams"),
        text: msg("and stays where it is. Three jams end the run."),
      },
      {
        lead: msg("Turnstiles"),
        text: msg(
          "carry a ⟳ badge: every tile that escapes turns each of them a quarter turn clockwise. Wait for one to face a clear lane.",
        ),
      },
      {
        lead: msg("No last board."),
        text: msg(
          "Clear a board for 50 more, and the next is bigger and busier. A board where no tile can leave is lost for a jam.",
        ),
      },
    ],
  },
  updraft: {
    heading: msg("Ride the updraft"),
    summary: msg("Tap to lift the glider. Thread the gaps between the columns."),
    rules: [
      {
        lead: msg("Tap to flap"),
        text: msg(
          "— or click, or press Space. Each flap lifts the glider; between flaps it falls.",
        ),
      },
      {
        lead: msg("Thread the gaps."),
        text: msg("Every column you get through is 10 points."),
      },
      {
        lead: msg("Don't touch"),
        text: msg(
          "a column or the ground: either one ends the run. The top of the sky is safe to brush.",
        ),
      },
      {
        lead: msg("No last column."),
        text: msg(
          "The field speeds up and the gaps narrow as you go, until you slip or end the run.",
        ),
      },
    ],
  },
} satisfies Record<string, GameRules>;

/** A game's rules by its runtime, or null for a runtime with none written. */
export function rulesFor(runtime: string | null | undefined): GameRules | null {
  if (!runtime) return null;
  return (GAME_RULES as Record<string, GameRules | undefined>)[runtime] ?? null;
}
