-- The catalogue text for Crowns, Sudoku and Mini Sudoku, now they have no clock to
-- lose to. Apply last, after the deployment carrying the service routing and the
-- client: until then the game still plays the old rules these words no longer describe.

update public.games
   set description  = 'Place a crown in every row, column and colour region, with no two touching. Every board has one solution, the boards keep coming, and the quick earn more.',
       instructions = 'Every board is split into coloured regions. Place exactly one crown in each row, each column and each region; two crowns can never touch, not even diagonally. Tap a cell once for an X, twice for a crown, and a third time to clear it. Undo takes back any tap and Clear board starts the board again, for free. Crowns that break the rules turn red. Each solved board is worth ten points a row, the boards grow from 5×5 to 9×9, and there is no clock to lose to: beating a board''s par time earns a speed bonus when you end the run, up to double.',
       updated_at   = now()
 where runtime = 'queens' and is_official;

update public.games
   set description  = 'The classic number puzzle with no clock to lose to: fill the grid so every row, column and 3×3 box holds 1 to 9 once each. The quicker you solve, the more you earn.',
       instructions = 'Fill the 9×9 grid so that every row, every column and every 3×3 box holds the digits 1 to 9 once each. Select a cell and tap a number to place it, or Erase to clear it; cells that start filled stay as they are, and a digit that repeats in a row, column or box is marked in red. Every solved board is worth ninety points and the boards get harder. There is no clock to lose to: beating a board''s par time earns a speed bonus when you end the run, up to double.',
       updated_at   = now()
 where runtime = 'sudoku' and is_official;

update public.games
   set description  = 'The small Sudoku: a 6×6 grid in boxes two rows tall and three wide, with the digits 1 to 6. Every board has exactly one solution, and the quicker you solve, the more you earn.',
       instructions = 'Fill the grid so every row, every column and every 2×3 box holds the digits 1 to 6 once each. Tap a cell, then a digit. A wrong digit never ends a run: fix it and carry on. Every solved board is worth 60 points and the boards get harder. There is no clock to lose to: beating a board''s par time earns a speed bonus when you end the run, up to double.',
       updated_at   = now()
 where runtime = 'mini-sudoku' and is_official;
