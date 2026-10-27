-- Sudoku joins the catalogue, playable.
--
-- `20261114120000_sudoku_sessions.sql` creates the verifier and teaches the start
-- gate the (`sudoku`, `sudoku@1`) pair; this migration is the other half and
-- lands last, in the same order as every game before it:
--
--   1. apply `20261114120000_sudoku_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `sudoku@1` completions to the new verifier
--      and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'sudoku',
  'Sudoku',
  'One to nine, once in every row, column and box.',
  'The classic number puzzle, against the clock: fill the grid so every row, column and 3×3 box holds 1 to 9 once each. Every solved board buys more time.',
  'Fill the 9×9 grid so that every row, every column and every 3×3 box holds the digits 1 to 9 once each. Select a cell and tap a number to place it, or Erase to clear it; cells that start filled stay as they are, and a digit that repeats in a row, column or box is marked in red. The clock starts at six minutes, and every solved board adds three minutes and ninety points. Each board starts with fewer cells filled, and the run ends when the clock runs out or when you end it.',
  (select c.id from public.categories c where c.slug = 'logic'),
  'published', true, true, 'sudoku', now()
on conflict (slug) do update
  set title        = excluded.title,
      tagline      = excluded.tagline,
      description  = excluded.description,
      instructions = excluded.instructions,
      category_id  = excluded.category_id,
      status       = excluded.status,
      is_official  = excluded.is_official,
      playable     = excluded.playable,
      runtime      = excluded.runtime,
      -- A re-run keeps the original publication date.
      published_at = coalesce(public.games.published_at, excluded.published_at);

do $$
begin
  if not exists (
    select 1 from public.games
     where slug = 'sudoku' and playable and runtime = 'sudoku' and status = 'published'
  ) then
    raise exception 'sudoku is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the twelve shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
