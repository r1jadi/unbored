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
          "per day. Everyone on your date plays the same deck; the next one arrives at midnight, your time.",
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
        lead: msg("Change your mind"),
        text: msg(
          "whenever you like: Undo takes back any tap and Clear board starts the board again, and neither costs a point. Crowns that break the rules turn red.",
        ),
      },
      {
        lead: msg("No clock"),
        text: msg(
          "to lose to. Every board has one solution and is worth 100 points a row, and beating its par time earns a speed bonus when the run ends, up to double. The boards grow as you go, and you end the run when you like.",
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
    summary: msg("Every row, column and box, once each. Be quick for a bonus."),
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
        lead: msg("No clock"),
        text: msg(
          "to lose to. Boards start gentle and get harder, and every solved board scores 900 points. Beating a board's par time earns a speed bonus when the run ends, up to double. You end the run when you like.",
        ),
      },
    ],
  },
  "mini-sudoku": {
    heading: msg("One to six"),
    summary: msg("A small Sudoku on a 6×6 grid. Be quick for a bonus."),
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
        lead: msg("No clock"),
        text: msg(
          "to lose to. Boards start gentle and get harder, and every solved board scores 600 points. Beating a board's par time earns a speed bonus when the run ends, up to double. You end the run when you like.",
        ),
      },
    ],
  },
  whittle: {
    heading: msg("Cross it out"),
    summary: msg("Cross numbers out until every row and column hits its target."),
    rules: [
      {
        lead: msg("Hit every target"),
        text: msg(
          "— the number at the end of each row and under each column. The numbers you leave in that row or column must add up to it.",
        ),
      },
      {
        lead: msg("Tap a number"),
        text: msg(
          "to cross it out. Tap it again to circle it as one you are sure stays, and once more to clear it. A target lights up when its line adds up; the small number under it is what the line makes now.",
        ),
      },
      {
        lead: msg("On a keyboard"),
        text: msg(
          "move with the arrow keys, press X to cross out, C to circle and Backspace to clear. Undo (Ctrl+Z) steps back.",
        ),
      },
      {
        lead: msg("No clock"),
        text: msg(
          "to lose to. The numbers get bigger as you go, and every solved board scores 500 points. Beating a board's par time earns a speed bonus when the run ends, up to double. You end the run when you like.",
        ),
      },
    ],
  },
  sumdoku: {
    heading: msg("Add it up"),
    summary: msg("Sudoku where the sums are the clues. Be quick for a bonus."),
    rules: [
      {
        lead: msg("Fill the grid"),
        text: msg(
          "so that every row, every column and every 2×3 box holds the digits 1 to 6 once each.",
        ),
      },
      {
        lead: msg("Mind the cages"),
        text: msg(
          "— the dashed outlines. The digits in a cage add up to the small total in its corner, and never repeat inside it. Early boards give a few digits away; later ones give you only the sums. Every board has exactly one solution.",
        ),
      },
      {
        lead: msg("Pick a cell"),
        text: msg(
          "and tap a number, or Erase to clear it. You can also type 1 to 6 and move with the arrow keys. A repeated digit, or a cage that goes over its total, is marked in red.",
        ),
      },
      {
        lead: msg("Notes and Undo"),
        text: msg(
          "Turn on Notes (or press N) to jot candidates in a cell; placing a digit tidies them away. Undo (Ctrl+Z) steps back.",
        ),
      },
      {
        lead: msg("No clock"),
        text: msg(
          "to lose to. Boards start gentle and get harder, and every solved board scores 600 points. Beating a board's par time earns a speed bonus when the run ends, up to double. You end the run when you like.",
        ),
      },
    ],
  },
  "deep-cut": {
    heading: msg("Deep Cut"),
    summary: msg(
      "Name something correct that nobody else would. The rarer the answer, the deeper it dives.",
    ),
    rules: [
      {
        lead: msg("Seven questions,"),
        text: msg(
          'the same for everyone today — "Name a US state", "Name a cheese". You get 25 seconds and one answer for each.',
        ),
      },
      {
        lead: msg("Any correct answer scores,"),
        text: msg(
          "but the obvious ones stay near the surface: 10 points for what everybody says, up to 100 for an answer from the abyss. 700 is a perfect day.",
        ),
      },
      {
        lead: msg("Spelling slips are fine,"),
        text: msg(
          "and so are abbreviations and other names. A wrong answer, or none, scores nothing.",
        ),
      },
    ],
  },
  guesswork: {
    heading: msg("Today's word"),
    summary: msg("One hidden five-letter word a day. Six guesses to find it."),
    rules: [
      {
        lead: msg("Type a word"),
        text: msg(
          "of five letters and press Enter. It has to be a real word from the list; on a keyboard you can just type.",
        ),
      },
      {
        lead: msg("Read the marks"),
        text: msg(
          "on every letter: filled means the right place, a dashed outline means it's in the word somewhere else, and faded means it isn't in the word. A letter you guess twice is only marked as often as the word holds it.",
        ),
      },
      {
        lead: msg("Fewer guesses, more points"),
        text: msg(
          "— 600 for the first guess, down to 100 on the sixth. Not found, or given up, scores nothing.",
        ),
      },
      {
        lead: msg("One word a day"),
        text: msg(
          "for everyone, and one ranked play. In Albanian it's Gjeje, with Albanian words: Ç and Ë are letters of their own, and SH or GJ take two squares. A new word arrives at midnight, your time.",
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
          "Check the grid (−50) to see which letters are wrong, or reveal a letter (−100 each). One ranked solve a day; a new crossword arrives at midnight, your time.",
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
  bolted: {
    heading: "Sort the nuts",
    summary: "Move coloured nuts between bolts until every bolt holds one colour.",
    rules: [
      {
        lead: "Tap a bolt, then another,",
        text: "to move its top nut there, along with every nut of the same colour right under it, as many as fit. A nut lands on an empty bolt or on the same colour.",
      },
      {
        lead: "Four of a colour lock.",
        text: "A full bolt of one colour is done and cannot be moved again. Lock every bolt to sort the board: 10 points a colour, and more time.",
      },
      {
        lead: "Hidden nuts.",
        text: "From board three, the nuts under each bolt's top start face down. Move the nuts above them off to see what is there.",
      },
      {
        lead: "Stuck?",
        text: "Undo a move, restart the board, or add one empty bolt to it for 15 seconds of clock. The clock starts at 1:15; boards gain a colour every second board, up to eight.",
      },
    ],
  },
  checkmate: {
    heading: "Find the mate",
    summary: "Every position has exactly one way to checkmate. Find it before the clock runs out.",
    rules: [
      {
        lead: "Tap a piece,",
        text: "then the square to move it to. Its legal moves are marked. You play the side at the bottom of the board.",
      },
      {
        lead: "Mate in one, then in two.",
        text: "The first six puzzles are mates in one. After that they are mates in two: the other side replies to your first move, and your second move mates.",
      },
      {
        lead: "Wrong move?",
        text: "It costs 10 seconds and the puzzle stays. Skip moves on to the next one for 20.",
      },
      {
        lead: "The clock",
        text: "starts at 1:30. A mate in one scores 100 and adds 15 seconds, a mate in two 300 and 40 seconds: a little more early on, less as the run goes. The run ends when the clock does.",
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
        lead: "Watch for bombs.",
        text: "From level 2, bombs drop in with a countdown that goes down by one every swap. Match a bomb, or catch it in a special's blast, to defuse it for 50 points. If one reaches 0, the run ends — your score so far is kept.",
      },
      {
        lead: "No clock.",
        text: "Each level asks for more tiles cleared (30, then 40, 50, …), and bombs come faster and with shorter fuses. Take your time between swaps: the run ends when you end it, or when a bomb goes off.",
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
  fusebox: {
    heading: msg("One tap, one chain"),
    summary: msg("Spend sparks to charge the grid. Set off chains that pay the sparks back."),
    rules: [
      {
        lead: msg("Tap a cell"),
        text: msg(
          "to spend a spark and add one charge. At four charge a cell pops and fires a bolt each way.",
        ),
      },
      {
        lead: msg("A bolt"),
        text: msg(
          "reaches up to three cells and adds one charge to the first charged cell it meets, which can pop that one too. Each wave of a chain is worth more than the last.",
        ),
      },
      {
        lead: msg("Long chains pay."),
        text: msg(
          "Four pops from one tap gives back a spark, seven gives two, eleven gives three. Leave four charged cells or fewer to clear the board for three more.",
        ),
      },
      {
        lead: msg("It gets harder."),
        text: msg(
          "Every second board asks for longer chains. From board three, surge cells fire diagonally too; from board five, a shielded cell's first hit only breaks its shield. The run ends when the sparks run out.",
        ),
      },
    ],
  },
  minefield: {
    heading: msg("Read the numbers"),
    summary: msg("Open every safe cell. The numbers tell you where the mines are."),
    rules: [
      {
        lead: msg("Tap a cell"),
        text: msg(
          "to open it. A number says how many of the eight cells around it hide a mine, and a cell with none opens its neighbours too. The first tap of a board is always safe.",
        ),
      },
      {
        lead: msg("Flag a mine"),
        text: msg(
          "by switching to Flag, long-pressing or right-clicking. A flag protects its cell. Tap an opened number whose flags add up to open the rest of its neighbours.",
        ),
      },
      {
        lead: msg("Three lives."),
        text: msg(
          "A mine costs a life, and the run ends when all three are gone. Every third cleared board brings one back.",
        ),
      },
      {
        lead: msg("No last board."),
        text: msg(
          "Each safe cell is 10 points, a cleared board 20 a row, and a board with no mine set off 10 more a row. The boards grow and hold more mines as you go.",
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
  flipside: {
    heading: msg("Flip the tunnel"),
    summary: msg("Tap to flip gravity. Jump the holes, dodge the spikes."),
    rules: [
      {
        lead: msg("Tap to flip"),
        text: msg(
          "— or click, or press Space. The runner falls to the other side: floor to ceiling and back.",
        ),
      },
      {
        lead: msg("Mind the gaps."),
        text: msg(
          "Fall into a hole or touch a spike and the run is over. You can only flip from a surface; tap early and the flip waits for you to land.",
        ),
      },
      {
        lead: msg("Skim the spikes."),
        text: msg(
          "Every hazard you clear is 10 points. Pass spikes close without touching for a near miss: a bonus that grows with every one in a row.",
        ),
      },
      {
        lead: msg("No last hazard."),
        text: msg("The tunnel speeds up as you go, until you slip or end the run."),
      },
    ],
  },
  "ton-up": {
    heading: msg("Three darts at 100"),
    summary: msg("Every answer is worth a number. Name up to three to hit exactly 100."),
    rules: [
      {
        lead: msg("One category a day"),
        text: msg(
          "— elements by atomic number, presidents by their number in office, states by when they joined, and more.",
        ),
      },
      {
        lead: msg("Throw a dart"),
        text: msg(
          "by typing an answer and picking it from the list. Its number is added to your total. Each answer once, three darts at most.",
        ),
      },
      {
        lead: msg("Stand or bust."),
        text: msg(
          "Stop whenever you like and keep your total. Go over 100 and you bust: nothing scores.",
        ),
      },
      {
        lead: msg("Exactly 100 is a ton"),
        text: msg(
          "— 1,250 in three darts, 1,500 in two, 1,750 in one. Anything less scores ten times your total. A new category arrives at midnight, your time.",
        ),
      },
    ],
  },
  ballpark: {
    heading: msg("What does it cost?"),
    summary: msg("One product a day. Six guesses at its price."),
    rules: [
      {
        lead: msg("Type a price"),
        text: msg("in dollars and press Guess. It's a typical US shelf price for the item shown."),
      },
      {
        lead: msg("Follow the arrow."),
        text: msg("Up means the price is higher, down means lower. Amber means you're within 25%."),
      },
      {
        lead: msg("Within 5% wins"),
        text: msg(
          "— 600 on the first guess, down to 100 on the sixth. Not found, or given up, scores nothing.",
        ),
      },
      {
        lead: msg("One product a day"),
        text: msg("for everyone, and one ranked play. A new one arrives at midnight, your time."),
      },
    ],
  },
  "only-once": {
    heading: msg("Never the same answer twice"),
    summary: msg("Seven questions about one kind of thing. Every answer can be used once."),
    rules: [
      {
        lead: msg("Answer seven questions"),
        text: msg(
          "about countries, US states or chemical elements. Start typing and pick from the list; you get 25 seconds each, after two to read.",
        ),
      },
      {
        lead: msg("Each answer once."),
        text: msg(
          "The first questions have plenty of right answers; the last have only a few, and the famous one you gave earlier is often among them.",
        ),
      },
      {
        lead: msg("Wrong costs nothing"),
        text: msg(
          "— a wrong or used answer is turned down and you try again. Only the clock ends your day.",
        ),
      },
      {
        lead: msg("100 a question,"),
        text: msg("and 1,000 for all seven. A new set arrives at midnight, your time."),
      },
    ],
  },
  "tee-time": {
    heading: msg("Today's nine"),
    summary: msg("A new nine-hole course every day. Every shot is your timing."),
    rules: [
      {
        lead: msg("Aim"),
        text: msg(
          "by tapping the course where you want the ball to go. Mind the wind: it pushes every shot.",
        ),
      },
      {
        lead: msg("Swing"),
        text: msg(
          "— tap Swing, then tap again to stop the power meter. Pick a club with the arrows; the suggested one reaches the pin at full power.",
        ),
      },
      {
        lead: msg("Find the rings."),
        text: msg(
          "On the green the putts are automatic: inside the inner ring one, the outer ring two, anywhere else three. Water and out of bounds cost a stroke.",
        ),
      },
      {
        lead: msg("Par is 300"),
        text: msg(
          "on every hole, a birdie 400, an eagle 500. One ranked round a day; a new course arrives at midnight, your time.",
        ),
      },
    ],
  },
  foursort: {
    heading: msg("Four groups of four"),
    summary: msg("Sixteen words. Find the four things they have in common."),
    rules: [
      {
        lead: msg("Pick four words"),
        text: msg(
          "you think belong together and press Submit. Right, and the group is locked in with its link.",
        ),
      },
      {
        lead: msg("Four mistakes"),
        text: msg("and the day is over. Three of the four right? You'll be told you're one away."),
      },
      {
        lead: msg("Watch for red herrings."),
        text: msg("Some words fit more than one group, but only one way sorts all sixteen."),
      },
      {
        lead: msg("150 a group,"),
        text: msg(
          "and finding all four adds 100 for every mistake you have left: 1,000 for a perfect day. A new set arrives at midnight, your time.",
        ),
      },
    ],
  },
  pixelock: {
    heading: msg("Draw the picture"),
    summary: msg("A 10 × 10 grid, a clue on every line. The filled cells draw today's picture."),
    rules: [
      {
        lead: msg("Read the clues."),
        text: msg(
          "The numbers by a row or column are its runs of filled cells, in order: 3 1 means three in a row, a gap, then one.",
        ),
      },
      {
        lead: msg("Fill or cross out"),
        text: msg(
          "— pick a tool and tap a cell, or drag across a line. Every picture can be solved without guessing.",
        ),
      },
      {
        lead: msg("Three lives."),
        text: msg(
          "A wrong cell costs one, and shows you what it really is. The third ends the day.",
        ),
      },
      {
        lead: msg("10 a filled cell,"),
        text: msg(
          "then 500 for finishing the picture and 250 for every life left. A new picture arrives at midnight, your time.",
        ),
      },
    ],
  },
  "then-and-now": {
    heading: msg("Put history in order"),
    summary: msg("Six events a day. Swap them into the order they happened."),
    rules: [
      {
        lead: msg("Oldest at the top."),
        text: msg("Tap two events to swap them, and keep going until the order looks right."),
      },
      {
        lead: msg("Submit your order."),
        text: msg(
          "Every event in its right place locks in green and shows its year; the rest stay to be moved.",
        ),
      },
      {
        lead: msg("Four tries"),
        text: msg("to get all six. One theme a day, the same for everyone."),
      },
      {
        lead: msg("100 an event in place,"),
        text: msg(
          "and getting all six adds 200 for every try left: 1,200 first time. A new timeline arrives at midnight, your time.",
        ),
      },
    ],
  },
  honeycomb: {
    heading: msg("Seven letters"),
    summary: msg("Make as many words as you can. Every word needs the centre letter."),
    rules: [
      {
        lead: msg("Four letters or more,"),
        text: msg(
          "from the seven on the hive. Letters can be used again; the centre one is always in.",
        ),
      },
      {
        lead: msg("Longer is better."),
        text: msg(
          "A four-letter word is worth 10, a longer one 10 a letter, and a word that uses all seven letters 70 more.",
        ),
      },
      {
        lead: msg("Climb the ranks"),
        text: msg(
          "from Egg to Royal as your score grows. Every day has at least one word that uses all seven.",
        ),
      },
      {
        lead: msg("Stop when you're done."),
        text: msg(
          "Your words are your score. One ranked hive a day; new letters at midnight, your time.",
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
