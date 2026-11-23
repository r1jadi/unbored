import type { GameGuide } from "./types";

/** Grid and deduction puzzles: every board has one answer, found without guessing. */
export const LOGIC_GUIDES = {
  sudoku: {
    about: [
      "Sudoku is the classic number-placement puzzle: a 9×9 grid split into nine 3×3 boxes, with some digits already given. You fill the rest so that every row, every column and every box holds 1 to 9 exactly once. There is no arithmetic involved — the digits are just nine different symbols — so it is pure logic.",
      "On Unbored every board has exactly one solution and can be solved by reasoning alone. Boards start gentle and get harder as your run goes on, and there is no clock to lose to: you score 900 points for every solved board, plus a speed bonus of up to double for beating a board's par time. End the run whenever you like.",
    ],
    tips: [
      "Start with hidden singles. Pick a digit and look at one box: if the rows and columns crossing it already rule out every cell but one, the digit goes there. Sweeping all nine digits this way solves most of an easy board.",
      "Then look for naked singles: a cell whose row, column and box already contain eight different digits can only hold the ninth.",
      "Use Notes on harder boards. Pencil in every candidate for a cell, and placing a digit clears it from its neighbours' notes automatically, which makes the next step easy to spot.",
      "Look for pairs. If two cells in a row can only be the same two digits, those digits belong to those two cells, and you can remove them from every other cell in that row.",
      "Never guess. Every board has one solution reached by logic, so if you feel the need to guess, there is a deduction you have not seen yet: scan rows, then columns, then boxes again.",
    ],
    faq: [
      [
        "Is there a time limit?",
        "No. The run lasts as long as you want. Solving quickly only adds a bonus on top of the 900 points each board is worth.",
      ],
      [
        "What does a red digit mean?",
        "A digit turns red when it repeats in its row, column or box. It is a mistake you can fix with Erase or Undo — it costs nothing.",
      ],
      [
        "Can I play with a keyboard?",
        "Yes. Type 1 to 9 to place a digit, move with the arrow keys, press N to switch Notes on and off, and Ctrl+Z to undo.",
      ],
    ],
  },
  "mini-sudoku": {
    about: [
      "Mini Sudoku is Sudoku shrunk to a 6×6 grid. Every row, every column and every 2×3 box — two rows tall, three wide — holds the digits 1 to 6 once each. It keeps everything that makes Sudoku satisfying but a board takes a minute or two rather than twenty, which makes it a good warm-up or a quick break.",
      "Each board has exactly one solution. Boards get harder through the run, every solve scores 600 points, and beating a board's par time adds a speed bonus of up to double. There is no clock to lose to.",
    ],
    tips: [
      "With only six candidates per cell, naked singles appear constantly: look for a cell whose row, column and box already show five different digits.",
      "Remember each box is only two rows tall. If a digit the box still needs already appears in one of those rows elsewhere in the grid, it must go in the box's other row — then the columns usually leave one cell for it.",
      "Fill the most crowded row, column or box first. A line with four givens has only two empty cells, and usually one of them is forced.",
      "Use Notes for the last few cells of a harder board. Two cells sharing the same two candidates in a line lock those digits away from the rest of the line.",
    ],
    faq: [
      [
        "How is Mini Sudoku different from regular Sudoku?",
        "The grid is 6×6 with 2×3 boxes and the digits 1 to 6, instead of 9×9 with 3×3 boxes and 1 to 9. The logic is the same; the boards are just quicker.",
      ],
      [
        "How is the score worked out?",
        "Every solved board is worth 600 points. If you beat a board's par time, a speed bonus is added when the run ends, up to double the board's points.",
      ],
    ],
  },
  sumdoku: {
    about: [
      "Sumdoku is a 6×6 Sudoku where the clues are sums. As in Mini Sudoku, every row, column and 2×3 box holds 1 to 6 once each — but the grid is also divided into cages, the dashed outlines, and the digits in each cage add up to the small number in its corner without repeating.",
      "Early boards give you a few digits to get started. Later ones give you nothing but the sums, so all the information is in the arithmetic. Every board has one solution, each solve scores 600 points, and fast solves earn a bonus of up to double.",
    ],
    tips: [
      "Learn the forced combinations. A two-cell cage totalling 3 must be 1 and 2; one totalling 11 must be 5 and 6. A three-cell cage of 6 is 1, 2 and 3; one of 15 is 4, 5 and 6.",
      "A single-cell cage is a given: its total is the digit.",
      "Use the 21 rule. The digits 1 to 6 add up to 21, so every row, column and box totals 21. If the cages lying wholly inside a row add up to 17, the remaining cells of that row add up to 4.",
      "Note candidates per cage, not just per cell. A two-cell cage of 7 can be 1+6, 2+5 or 3+4; the row and column already in place usually remove two of those options.",
      "A cage turns red if it goes over its total, which is a quick way to catch an arithmetic slip.",
    ],
    faq: [
      [
        "Can a digit repeat inside a cage?",
        "No. Digits never repeat within a cage, even when the cage spans two boxes.",
      ],
      [
        "Do I need to be good at maths?",
        "Only at adding small numbers. The challenge is in combining the sums with the Sudoku rules, not in the arithmetic itself.",
      ],
    ],
  },
  crowns: {
    about: [
      "Crowns is a placement puzzle on a square grid divided into coloured regions — one region for each row. Your goal is to place exactly one crown in every row, every column and every colour region, with one extra rule: no two crowns may touch, not even diagonally.",
      "Every board has one solution. Tap a cell once to mark it with an X (a note that no crown goes there), twice for a crown, and a third time to clear it. Undo and Clear board are free. Each board is worth 100 points a row, beating par time earns a bonus of up to double, and the boards grow as your run goes on.",
    ],
    tips: [
      "Start with the smallest region. A region of one cell is a crown; a region of two or three cells narrows things down at once.",
      "When you place a crown, mark the eight cells around it with an X, along with the rest of its row, column and region. Crossing out aggressively is what makes the next move visible.",
      "Look for regions confined to a single row or column. If a region lives entirely in row 3, its crown is in row 3 — so no other region can put its crown there, and you can X out row 3 everywhere outside that region.",
      "Extend that to groups: if two regions sit entirely within the same two rows, those two rows belong to them, and every other cell in those rows can be crossed out.",
      "Test a cell by asking whether a crown there would wipe out every possible cell of some other region. If it would, that cell is an X.",
    ],
    faq: [
      [
        "Can crowns touch at the corners?",
        "No. Two crowns can never be in neighbouring cells, including diagonal neighbours.",
      ],
      [
        "Is there a penalty for mistakes?",
        "No. Crowns that break the rules turn red, and you can undo or clear the board at no cost. Only time matters, through the par-time bonus.",
      ],
    ],
  },
  "sun-and-moon": {
    about: [
      "Sun and Moon is a balance puzzle on a 6×6 grid. You fill every cell with a sun or a moon so that each row and each column holds three of each, and no three of the same symbol sit next to each other across or down. Signs between cells add constraints: = means the two cells match, × means they differ.",
      "The clock starts at 2:20. Every solved board scores 600 points and adds time — 54 seconds for the first, less for each one after — while each new board starts with fewer cells filled. The run ends when the clock does.",
    ],
    tips: [
      "Two of a kind side by side must be flanked by the opposite symbol: sun-sun means the cells on either end are moons.",
      "A gap between two of a kind must be the opposite: sun, empty, sun means the middle is a moon.",
      "Count. Once a row has three suns, every other cell in it is a moon. This alone finishes many lines.",
      "Follow chains of signs. A × next to a = next to a × lets you place several cells at once as soon as any one of them is known.",
      "Work quickly on the early boards: each one adds more time than the later ones, so a fast start banks a buffer for the harder boards.",
    ],
    faq: [
      [
        "What do = and × mean?",
        "They sit between two neighbouring cells. = means both cells hold the same symbol; × means one is a sun and the other a moon.",
      ],
      [
        "Can I change a cell that started filled?",
        "No. Pre-filled cells are part of the puzzle. Only the empty cells are yours to fill, and any clash is marked in red.",
      ],
    ],
  },
  trail: {
    about: [
      "Trail is a path-drawing puzzle. Starting from 1, you draw a single line through every numbered cell in order, ending on the highest number — and the line must also pass through every other cell of the grid exactly once. It moves up, down, left or right, and never through a wall.",
      "Drag or tap to extend the path, and go back over it to undo. The clock starts at 75 seconds, and each solved board adds time and is worth 100 points a row. Boards grow as you go, and the run ends when the clock runs out.",
    ],
    tips: [
      "Corners have only two neighbours, so unless a corner holds the start or end, the path must enter through one neighbour and leave through the other. Draw those corner segments first.",
      "Cells boxed in by walls behave like corners: if a cell has only two open sides, both are part of the path.",
      "Before you commit to a route between two numbers, check you are not walling off a pocket of empty cells that the path can never reach again.",
      "Think about where the last number sits. The path ends there, so the cells around it have to be filled before you arrive.",
    ],
    faq: [
      [
        "Do I have to visit every cell?",
        "Yes. A board is solved only when one continuous path covers every cell once and reaches the numbers in order.",
      ],
      [
        "How do I undo part of the path?",
        "Drag back over the path you have drawn and it retracts to that point.",
      ],
    ],
  },
  whittle: {
    about: [
      "Whittle is a subtraction puzzle. The grid is full of numbers, and every row and column has a target at its end. Cross numbers out until the numbers left in each line add up exactly to that line's target. It starts simple and gets harder as the numbers grow.",
      "Tap a number to cross it out, tap again to circle it as one you are sure stays, and tap once more to clear it. A target lights up when its line adds up. There's no clock: every solved board scores 500 points, plus a bonus of up to double for beating par time.",
    ],
    tips: [
      "A number bigger than its row's or column's target can never stay. Cross it out straight away.",
      "Compare a line's total with its target. If the difference equals exactly one number in the line, and no combination of other numbers makes the same difference, that number goes.",
      "If a line already adds up to its target with nothing crossed out, every number in it stays: circle them all, and use them as fixed points for the crossing lines.",
      "Circling is as useful as crossing out. A circled number is locked in for both its row and its column, which often settles the other line immediately.",
      "Watch the small number under each target. It shows what the line adds up to right now, so you can see how far off you are without doing the sum.",
    ],
    faq: [
      [
        "What do the circles do?",
        "A circle is your own note that a number definitely stays. It doesn't change the sums — it helps you keep track as you reason.",
      ],
      [
        "Can I play with a keyboard?",
        "Yes. Move with the arrow keys, press X to cross out, C to circle, Backspace to clear and Ctrl+Z to undo.",
      ],
    ],
  },
  minefield: {
    about: [
      "Minefield is the classic mine-finding puzzle with a twist for longer runs. Open every safe cell on the board; each number tells you how many of the eight cells around it hide a mine. The first tap on every board is always safe, and opening a cell with no mines around it opens its neighbours too.",
      "You have three lives instead of one: setting off a mine costs a life, and every third cleared board gives one back. Safe cells are worth 10 points, a cleared board 20 a row, and a board cleared without setting off a mine earns 10 more a row. The boards grow and hold more mines as you go.",
    ],
    tips: [
      "Once a number has as many flagged mines around it as its value, every other unopened cell around it is safe. A 1 touching one known mine clears all its other neighbours.",
      "The 1-2-1 pattern along a straight edge almost always means the mines are under the two 1s, and the cell under the 2 is safe.",
      "Flag mines you are certain of, then tap a number whose flags add up: it opens all of its remaining neighbours at once. That saves taps and time.",
      "When you truly have to guess, guess away from the numbers, in an open part of the board, where the chance of a mine is usually lower and a safe cell is more likely to open a large area.",
      "A mine costs a life rather than the whole run, so a forced guess is survivable — but a board cleared without setting off a mine pays a bonus, so only guess when there is nothing left to deduce.",
    ],
    faq: [
      [
        "How do I place a flag?",
        "Switch to Flag mode, long-press a cell, or right-click it. A flagged cell is protected from being opened by accident.",
      ],
      ["Is the first tap always safe?", "Yes. The first tap on every board never hits a mine."],
      [
        "How do I get lives back?",
        "Every third board you clear gives you back one life, up to three.",
      ],
    ],
  },
  pixelock: {
    about: [
      "Pixelock is a daily picture-logic puzzle. A 10×10 grid has a clue beside every row and above every column. The numbers are the lengths of the runs of filled cells in that line, in order: 3 1 means three filled cells, at least one gap, then one more. Fill the right cells and they draw today's picture.",
      "Every picture can be solved without guessing. You have three lives — a wrong cell costs one and shows you what that cell really is. Each filled cell is worth 10 points, finishing the picture 500 more, and every life left another 250. A new picture arrives at midnight, your time, and there is one ranked play a day.",
    ],
    tips: [
      "Start with big clues and use the overlap. In a line of ten, a run of 7 must cover cells 4 to 7 wherever it sits, so fill those four straight away.",
      "Add up a line's clues plus one gap between each run. If the total is 10, the line is fully determined: 5 4 is 5 + 4 + one gap = 10, and 4 2 2 is 4 + 2 + 2 + two gaps = 10, so you can fill either line exactly.",
      "Cross out cells you know are empty. Marking empties is what lets the clues on the crossing lines work.",
      "When a line's runs are all placed, cross out everything else in it.",
      "Work back and forth between rows and columns. Every cell you settle in one direction gives the crossing line a new constraint.",
    ],
    faq: [
      [
        "What happens if I fill a wrong cell?",
        "You lose a life and the cell shows its true state. The third wrong cell ends the day's puzzle.",
      ],
      [
        "Is there one picture for everyone?",
        "Yes. Everyone gets the same picture each day, and a new one arrives at midnight in your time zone.",
      ],
    ],
  },
  "one-move": {
    about: [
      "One Move is a quick-fire logic game. Every board is a checkerboard pattern with exactly one move already made on it. A move flips one cell along with the cells directly above, below, left and right of it. Your job is to find the cell that was flipped and tap it, putting the checkerboard back.",
      "A wrong tap ends the run. The boards grow as you go, every restored board is worth 100 points, and there is no final board — it is a test of how quickly you can spot what is out of place.",
    ],
    tips: [
      "Look for the plus sign. The cells that break the checkerboard form a cross, and the cell to tap is at its centre.",
      "On an edge the cross loses an arm, and in a corner it loses two, so the out-of-place cells form a T or an L. The answer is still the cell where the arms meet.",
      "Scan two cells that should differ. Anywhere two neighbours share a colour, one of them was flipped — that pins down the area fast on big boards.",
      "Don't rush the tap. There's no clock, and one wrong tap ends the run, so confirm the centre of the cross before you commit.",
    ],
    faq: [
      [
        "Is there a time limit?",
        "No. You can take as long as you need on each board — the challenge is getting every board right.",
      ],
      [
        "Can there be more than one right answer?",
        "No. Exactly one move was made, so exactly one cell puts the checkerboard back.",
      ],
    ],
  },
  foursort: {
    about: [
      "Foursort is a daily word-grouping puzzle. Sixteen words are on the board, and they split into four groups of four that share something in common — a category, a hidden word, a phrase they complete. Pick four words you think belong together and submit them; a correct group locks in and reveals its link.",
      "You can make four mistakes before the day is over, and if three of your four are right you'll be told you're one away. Each group is worth 150 points, and solving all four adds 100 for every mistake you have left — 1,000 for a perfect day. Everyone gets the same sixteen words, and a new set arrives at midnight, your time.",
    ],
    tips: [
      "Look for red herrings first. If you can see five or six words that fit one idea, some of them belong to another group — work out which group needs them more.",
      "Start with the group you are surest of, even if it is not the first you noticed. Every locked group removes four words and makes the rest clearer.",
      "Think beyond meanings: words can be grouped by what they rhyme with, a word they hide, or a word that goes before or after them.",
      "Use 'one away' as a clue. It tells you three of your four are right, so swap a single word rather than starting over.",
      "If you are down to two groups, the last eight words split only one way — check every word fits its group before submitting.",
    ],
    faq: [
      [
        "How many mistakes can I make?",
        "Four. The fourth mistake ends the day's puzzle, and any groups you didn't find are shown.",
      ],
      [
        "Does the order I find the groups in matter?",
        "No. Each group is worth 150 points whenever you find it; only the mistakes you have left change the bonus.",
      ],
    ],
  },
  alibi: {
    about: [
      "Alibi is a daily deduction case. Three suspects each give a statement about where they were. Two are telling the truth and one is lying. A few files of evidence — receipts, records, timetables — sit on the desk, and somewhere among them is the one that contradicts the liar.",
      "Opening files costs 80 points each, so the best detectives read carefully and open only what they need. To close the case you accuse a suspect and name the file that proves the lie. A first-try solve with only the proof open is worth 920. A wrong accusation costs 300, and a second one closes the case. One ranked case a day; a new one arrives at midnight, your time.",
    ],
    tips: [
      "Read all three statements closely before opening anything. Times, places and names are where lies are made — note exactly what each suspect claims.",
      "Think about which file could disprove each statement. A claim about a train ride can only be checked by something that records trains; open that one rather than browsing.",
      "Remember only one suspect is lying. When a file backs up someone's story, set them aside and focus on the other two.",
      "An accusation needs the right file too. Make sure the file you name actually contradicts the statement, not just that it seems suspicious.",
    ],
    faq: [
      ["How many suspects are lying?", "Exactly one. The other two statements are true."],
      [
        "What is the best possible score?",
        "920: solving the case on your first accusation with only the proving file opened.",
      ],
    ],
  },
} as const satisfies Record<string, GameGuide>;
