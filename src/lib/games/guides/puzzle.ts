import type { GameGuide } from "./types";

/** Sorting, sliding, merging and placement puzzles. */
export const PUZZLE_GUIDES = {
  "stack-10": {
    about: [
      "Stack 10 is a number-placement puzzle about hitting exactly ten. A numbered tile appears above four columns; you drop it into one of them. A column whose tiles add up to exactly ten clears and scores. Go past ten and the column busts — it empties, and your third bust ends the run.",
      "You can always see the tile after the current one, so every drop is a small plan. There is no final tile: heavier numbers turn up more often the longer you play, so clean tens get rarer and every decision gets tighter.",
    ],
    tips: [
      "Keep your columns at different totals. With columns sitting at, say, 2, 5, 7 and 8, almost any tile has a safe home; with all four at 6, a big tile has nowhere to go.",
      "Always check the next tile before placing the current one. Leave a column ready for it if you can.",
      "Avoid parking a column at 9 unless you expect a 1 soon. A column at 9 can only take a 1, which makes it dead weight when big tiles start arriving.",
      "A bust empties the column. With busts to spare, deliberately busting a column stuck at an awkward total can be a way to reset it — but remember the third one ends the run.",
    ],
    faq: [
      ["Can I play with a keyboard?", "Yes. Press 1 to 4 to drop the tile into that column."],
      [
        "When does the game end?",
        "On your third bust. There is no last tile, so the run goes on as long as you avoid three busts.",
      ],
    ],
  },
  "color-merge": {
    about: [
      "Color Merge is a sliding merge puzzle. Every move slides the whole board in one direction; when two tiles of the same shade meet, they merge into the next shade up — two 2s make a 4, two 4s make an 8. Each tile merges only once per slide, and a new tile arrives after every move.",
      "There is no final slide. The run ends only when the board locks: every cell full and no two matching neighbours. New tiles have a growing chance of arriving at a higher shade, so the space you have to work with keeps shrinking as you go.",
    ],
    tips: [
      "Pick a corner and keep your highest tile in it. Building around a fixed anchor keeps big tiles from getting stranded in the middle.",
      "Use mostly two directions, a third when needed, and the fourth only in an emergency. The fourth direction is the one that pulls your anchor out of its corner.",
      "Line tiles up in descending order along the edge from your corner, so each merge feeds the next one in a chain.",
      "Keep an empty row or column if you can. Space is what lets you recover when a new tile lands somewhere awkward.",
      "Before each slide, look at where the new tile could appear. A slide that leaves only one empty cell next to your anchor is a risk.",
    ],
    faq: [
      [
        "How do I move the tiles?",
        "Swipe, use the arrow keys or WASD, or tap the buttons below the board.",
      ],
      [
        "Why didn't three matching tiles merge?",
        "Each tile can merge only once per slide, so a row of three equal tiles merges two of them and leaves the third for the next slide.",
      ],
    ],
  },
  "8-puzzle": {
    about: [
      "8 Puzzle is the classic sliding-tile puzzle. Eight numbered tiles sit in a 3×3 frame with one gap. Slide tiles into the gap until they read 1 to 8 in order, left to right and top to bottom, with the gap in the bottom-right corner.",
      "Every board can be solved, and each is scrambled a little more than the last. The clock starts at 75 seconds; each solved board scores 100 points and adds time — 18 seconds for the first, less after each one, down to 7.5. The run ends when the clock does.",
    ],
    tips: [
      "Solve the top row first, then the rest of the left column (4 and 7), then rotate the last four tiles into place. Working in that order means you never disturb finished tiles.",
      "Placing the 3 in the top-right corner is the tricky step. Bring 3 just below its spot, move the gap around so you can slide 2 and 3 into place together, rather than trying to drop 3 in directly.",
      "Think of the gap as the piece you move. Plan where the gap needs to travel, and the tiles will follow.",
      "Use the arrow keys on a keyboard: it is much faster than tapping once you have the pattern in your hands.",
    ],
    faq: [
      [
        "Is every board solvable?",
        "Yes. Half of all random arrangements of an 8 puzzle can't be solved, but every board here is generated so it can.",
      ],
      ["Where should the gap end up?", "In the bottom-right corner, after the 8."],
    ],
  },
  gridburst: {
    about: [
      "Gridburst is a block-placing puzzle. Three pieces sit in your tray; drag each one onto the grid, or tap a piece and then the square for its top-left corner. Fill a complete row or column and it bursts, freeing up space. Pieces don't rotate, so where you leave room matters.",
      "Every square placed is worth 10 points, and bursting several lines at once is worth far more: 100 × the number of lines squared, multiplied by your combo. Each burst raises the combo by one, and three placements in a row without a burst reset it. Empty the whole board for 300 more. The run ends when nothing in your tray fits.",
    ],
    tips: [
      "Keep a 3×3 space open. Big square pieces are the ones that end runs, so always leave somewhere they can go.",
      "Avoid single-cell holes. A hole surrounded on all sides can only be filled by the one-square piece.",
      "Set up multi-line bursts. Two lines at once score 100 × 2² = 400 before the combo, against 200 for bursting them one at a time; three at once score 900.",
      "Protect your combo: try to burst something at least every third placement.",
      "Place the awkward piece in your tray first, while the board is still flexible, and save the small pieces for tidying up.",
    ],
    faq: [
      ["Can I rotate pieces?", "No. Pieces are placed exactly as they appear in the tray."],
      [
        "When do I get new pieces?",
        "When all three pieces in the tray have been placed, three more arrive.",
      ],
    ],
  },
  bolted: {
    about: [
      "Bolted is a sorting puzzle with nuts and bolts. Coloured nuts are stacked on several bolts; tap one bolt and then another to move the top nut across, along with every nut of the same colour directly beneath it, as many as fit. A nut can only land on an empty bolt or on a nut of the same colour.",
      "A bolt holding four nuts of one colour locks and can't be moved again. Lock every colour to sort the board for 10 points a colour and more time. From the third board, the nuts below each bolt's top start face down, and you only find out what they are by clearing the nuts above. The clock starts at 1:15, and boards gain a colour every second board, up to eight.",
    ],
    tips: [
      "Treat an empty bolt as your most valuable resource. Use it to stage a colour, and avoid filling it with a mix.",
      "Uncover hidden nuts early. A face-down nut is information you need, and the longer it stays hidden the more likely it is to block a plan.",
      "Move whole runs at once. Since a move carries every matching nut beneath the top one, building a tall single-colour stack lets you shift several nuts in one tap.",
      "If you're stuck, adding an empty bolt costs 15 seconds — often cheaper than a minute of shuffling. Undo and restart are free.",
    ],
    faq: [
      [
        "Why can't I move a bolt?",
        "A bolt with four nuts of one colour is locked: that colour is sorted and done.",
      ],
      [
        "What are the face-down nuts?",
        "From board three, the nuts under each bolt's top are hidden. Move the nuts above them away to reveal their colour.",
      ],
    ],
  },
  decant: {
    about: [
      "Decant is a colour-sorting puzzle with liquids. Layers of colour are stacked in tubes; tap a tube and then another to pour. A pour only lands in an empty tube or on top of the same colour, and the whole top layer of that colour goes across, as much as will fit.",
      "Sort every tube into a single colour to solve the board: 10 points per colour and about five more seconds per colour. Boards start with three colours and gain one every second board, up to nine. The run ends when the clock runs out.",
    ],
    tips: [
      "Keep an empty tube as long as you can. It's the only place any colour can go, so it's your escape route.",
      "Don't pour just because you can. A pour that doesn't bring a colour closer to finishing usually just moves the problem.",
      "Look for colours that are already near the top of several tubes, and gather them in one place.",
      "If the board locks up, an extra empty tube costs 15 seconds. Undo and restart cost nothing but time.",
    ],
    faq: [
      [
        "How much pours at once?",
        "The whole top layer of one colour, as much as fits in the target tube.",
      ],
      [
        "Does the game get harder?",
        "Yes. Boards start with three colours and gain one every second board, up to nine.",
      ],
    ],
  },
  huedini: {
    about: [
      "Huedini is a sliding-block escape puzzle. Coloured blocks sit inside a frame with coloured gates set into its edges. Drag a block up, down, left or right and it slides until a wall, another block or the edge stops it. When a block reaches a gate of its own colour, lined up so the gate covers its whole width, it slips out.",
      "Blocks get in each other's way, so order matters: often you have to move one aside to open a path for another. The clock starts at 75 seconds; each cleared board scores 10 points per block and adds time for the next, while the boards grow trickier.",
    ],
    tips: [
      "Work backwards from a gate. Ask which block needs to leave there and what is between it and the exit.",
      "Use blocks as stoppers. Since a block slides until it hits something, parking one in the right spot lets another stop exactly in line with its gate.",
      "Clear the easy blocks first: each one that leaves frees up room for the rest.",
      "Undo and restart are free, so try a line quickly rather than thinking through every possibility.",
    ],
    faq: [
      [
        "Why didn't my block exit through the gate?",
        "The gate has to cover the block's whole width, so the block must be exactly lined up with it.",
      ],
      ["Can I play with a keyboard?", "Yes. Focus a block and use the arrow keys to slide it."],
    ],
  },
  fusebox: {
    about: [
      "Fusebox is a chain-reaction puzzle. You have a supply of sparks; tap a cell to spend one and add a charge. When a cell reaches four charge it pops, firing a bolt in each direction. A bolt travels up to three cells and adds a charge to the first charged cell it meets — which can make that one pop too, setting off a chain.",
      "Each wave of a chain is worth more than the last, and long chains pay you back: four pops from a single tap return a spark, seven return two, eleven return three. Leave four or fewer charged cells on the board to clear it for three more sparks. Later boards add diagonal surge cells and shielded cells. The run ends when your sparks run out.",
    ],
    tips: [
      "Build up before you set anything off. A cluster of cells at three charge, within three cells of each other, turns one tap into a long chain.",
      "Think about where bolts land. A bolt stops at the first charged cell in its path, so an empty gap of up to three cells doesn't stop the chain.",
      "Aim for the refund thresholds. A chain of four gives a spark back, so a tap that makes four pops is free.",
      "On later boards, use surge cells to reach diagonally, and remember a shielded cell needs one extra hit.",
      "Finish each board with four or fewer charged cells left for the three-spark clear bonus.",
    ],
    faq: [
      [
        "How do I get more sparks?",
        "Long chains refund sparks (four pops for one, seven for two, eleven for three), and clearing a board gives three more.",
      ],
      ["What ends the run?", "Running out of sparks."],
    ],
  },
  scatter: {
    about: [
      "Scatter is a clear-the-board puzzle. Every tile carries an arrow; tap one and it flies off the board in that direction for 10 points — but only if nothing stands between it and the edge. A tile with something in its way jams and stays put, and three jams end the run.",
      "Turnstiles add a twist: tiles with a ⟳ badge turn a quarter turn clockwise every time any tile escapes, so a blocked turnstile may face an open lane a few moves later. Clear a board for 50 more points, and the next one is bigger and busier.",
    ],
    tips: [
      "Start at the edges. Tiles pointing outward from the rim usually have a clear lane already.",
      "Check the whole lane before tapping, all the way to the edge of the board.",
      "Count turnstile turns. Every escape rotates every turnstile a quarter turn, so you can work out how many escapes it takes for one to face a clear lane.",
      "Clear the tiles that block the most other tiles first, opening several lanes at once.",
    ],
    faq: [
      [
        "What is a jam?",
        "Tapping a tile whose path is blocked. It stays where it is and counts as a jam; three jams end the run.",
      ],
      [
        "What do turnstiles do?",
        "Tiles with a ⟳ badge rotate a quarter turn clockwise every time any tile leaves the board.",
      ],
    ],
  },
  cascade: {
    about: [
      "Cascade is a match-three puzzle. Swap two neighbouring tiles to line up three or more of the same shape in a row or column, and they clear. The tiles above fall into the gap, new ones drop in, and any new lines they form clear too — each wave of a cascade is worth more than the one before.",
      "Matching four in a line makes a line tile that clears its whole row or column; five, or an L or T shape, makes a burst that clears the 3×3 around it. From level 2, bombs fall in with a countdown that drops each swap: match one or catch it in a blast to defuse it for 50 points. If a bomb reaches zero, the run ends — but there's no clock, so you can take your time.",
    ],
    tips: [
      "Match low on the board. Clearing tiles near the bottom makes everything above fall, which gives cascades more chances to start.",
      "Deal with the bomb that has the lowest countdown first, even if it means passing up a bigger match elsewhere.",
      "Look for fours and fives before you take an easy three. Special tiles clear far more of the board and are the best way to reach bombs.",
      "Combine specials with bombs: a line tile or burst that catches a bomb defuses it.",
      "Use the time. Nothing moves between swaps, so scan the whole board before each one.",
    ],
    faq: [
      [
        "Is there a time limit?",
        "No. The run ends when you end it or when a bomb's countdown reaches zero.",
      ],
      [
        "What happens to my score if a bomb goes off?",
        "The run ends, and the score you had at that point is kept.",
      ],
    ],
  },
  checkmate: {
    about: [
      "Checkmate is a timed chess puzzle game. Every position has exactly one way to deliver checkmate, and you play the side at the bottom of the board. Tap a piece to see its legal moves, then tap the square to move it to.",
      "The first six puzzles are mates in one. After that they become mates in two: you make a move, the other side replies, and your second move mates. The clock starts at 1:30; a mate in one scores 100 and adds 15 seconds, a mate in two scores 300 and adds 40. A wrong move costs 10 seconds and the puzzle stays; skipping costs 20.",
    ],
    tips: [
      "Check the checks first. Most mating moves give check, so list every check you have before looking at quieter moves.",
      "Look at the enemy king's escape squares. A mate needs every escape covered, so ask which of your pieces controls each one.",
      "In a mate in two, consider the quiet move. Sometimes the first move isn't a check but takes away the king's last escape square, or forces a reply that blocks it in.",
      "If you are stuck for more than 20 seconds, skipping costs less than a long stare — and wrong guesses cost 10 seconds each.",
    ],
    faq: [
      ["Which side do I play?", "Always the side at the bottom of the board."],
      [
        "What happens if I make a wrong move?",
        "You lose 10 seconds and the puzzle stays on screen, so you can try again.",
      ],
    ],
  },
} as const satisfies Record<string, GameGuide>;
